BEGIN;

-- Trusted evidence infrastructure only. No provider calls or admission effects.
-- The CASCADE follows 0035 movement_need_locations: an ephemeral claim must
-- disappear with its authoritative need. 0092 evidence retains its history FK.
CREATE TABLE private.requester_route_generation_claims (
  movement_need_id uuid PRIMARY KEY REFERENCES public.movement_needs(id) ON DELETE CASCADE,
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  origin_location_reference_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  destination_location_reference_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  evidence_schema_version text NOT NULL CHECK (evidence_schema_version='requester_route_evidence_v1'),
  route_shape_format text NOT NULL CHECK (route_shape_format='geojson_linestring_v1'),
  provider_namespace text NOT NULL CHECK (provider_namespace=btrim(provider_namespace) AND length(provider_namespace) BETWEEN 1 AND 100 AND provider_namespace ~ '[^[:space:]]'),
  provider_product text NOT NULL CHECK (provider_product=btrim(provider_product) AND length(provider_product) BETWEEN 1 AND 100 AND provider_product ~ '[^[:space:]]'),
  provider_version text NOT NULL CHECK (provider_version=btrim(provider_version) AND length(provider_version) BETWEEN 1 AND 100 AND provider_version ~ '[^[:space:]]'),
  claim_token uuid NOT NULL UNIQUE,
  claimed_at timestamptz NOT NULL CHECK (isfinite(claimed_at)),
  lease_expires_at timestamptz NOT NULL CHECK (isfinite(lease_expires_at)),
  completed_route_evidence_id uuid UNIQUE REFERENCES private.requester_route_evidence(id),
  completed_at timestamptz CHECK (isfinite(completed_at)),
  completion_kind text CHECK (completion_kind IN ('published','reuse_existing')),
  CHECK (origin_location_reference_id<>destination_location_reference_id),
  CHECK (lease_expires_at=claimed_at+interval '30 seconds'),
  CHECK ((completed_route_evidence_id IS NULL)=(completed_at IS NULL)),
  CHECK ((completed_at IS NULL)=(completion_kind IS NULL)),
  CHECK (completed_at IS NULL OR (completed_at>=claimed_at AND completed_at<lease_expires_at))
);
ALTER TABLE private.requester_route_generation_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.requester_route_generation_claims FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_requester_route_generation_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    -- Permit only parent deletion's FK cascade, never standalone release.
    IF EXISTS (SELECT 1 FROM public.movement_needs n WHERE n.id=OLD.movement_need_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim cannot be deleted while its need exists';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.movement_need_id,NEW.requesting_member_id,NEW.origin_location_reference_id,NEW.destination_location_reference_id)
      IS DISTINCT FROM ROW(OLD.movement_need_id,OLD.requesting_member_id,OLD.origin_location_reference_id,OLD.destination_location_reference_id) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim binding is immutable';
    END IF;
    IF NEW.claim_token=OLD.claim_token THEN
      IF (to_jsonb(NEW)-ARRAY['completed_route_evidence_id','completed_at','completion_kind'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['completed_route_evidence_id','completed_at','completion_kind'])
        OR (OLD.completed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim attempt is immutable';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.lease_expires_at>clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim lease is still active';
    END IF;
  END IF;
  IF NEW.completed_at IS NOT NULL OR NEW.claimed_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim must start incomplete with server time';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_requester_route_generation_claim() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_requester_route_generation_claim BEFORE INSERT OR UPDATE OR DELETE
ON private.requester_route_generation_claims FOR EACH ROW EXECUTE FUNCTION private.protect_requester_route_generation_claim();

-- Caller locks need first. Lifecycle/discoverability is deliberately separate.
CREATE FUNCTION private.lock_requester_route_generation_context(p_need uuid,p_member uuid)
RETURNS TABLE(origin_id uuid,destination_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n public.movement_needs%ROWTYPE; r private.movement_location_references%ROWTYPE; count_refs integer:=0;
BEGIN
  SELECT x.* INTO n FROM public.movement_needs x WHERE x.id=p_need FOR UPDATE;
  IF NOT FOUND OR p_member IS NULL OR n.member_id IS DISTINCT FROM p_member THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Requester movement context unavailable';
  END IF;
  PERFORM l.role FROM private.movement_need_locations l WHERE l.movement_need_id=p_need ORDER BY l.role FOR SHARE;
  SELECT l.location_reference_id INTO STRICT origin_id FROM private.movement_need_locations l WHERE l.movement_need_id=p_need AND l.role='origin';
  SELECT l.location_reference_id INTO STRICT destination_id FROM private.movement_need_locations l WHERE l.movement_need_id=p_need AND l.role='destination';
  IF origin_id=destination_id THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester endpoints must be distinct'; END IF;
  FOR r IN SELECT x.* FROM private.movement_location_references x WHERE x.id IN (origin_id,destination_id) ORDER BY x.id FOR SHARE LOOP
    count_refs:=count_refs+1;
    IF r.owner_member_id IS DISTINCT FROM p_member OR r.resolution_status<>'resolved' OR r.source_kind<>'provider_resolved'
      OR r.latitude IS NULL OR r.longitude IS NULL OR NOT (r.latitude BETWEEN -90 AND 90) OR NOT (r.longitude BETWEEN -180 AND 180)
      OR r.latitude::text IN ('NaN','Infinity','-Infinity') OR r.longitude::text IN ('NaN','Infinity','-Infinity')
      OR (r.expires_at IS NOT NULL AND r.expires_at<=clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester endpoints unavailable or stale';
    END IF;
  END LOOP;
  IF count_refs<>2 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester endpoints unavailable'; END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION private.lock_requester_route_generation_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Read immutable identity without a row lock, then acquire parent/context before
-- evidence and reread. Preserves 0092 status, freshness and structural semantics.
CREATE OR REPLACE FUNCTION private.assert_requester_route_evidence(p_evidence_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.requester_route_evidence%ROWTYPE;
BEGIN
  SELECT x.* INTO STRICT e FROM private.requester_route_evidence x WHERE x.id=p_evidence_id;
  PERFORM private.lock_requester_route_generation_context(e.movement_need_id,e.requesting_member_id);
  SELECT x.* INTO STRICT e FROM private.requester_route_evidence x WHERE x.id=p_evidence_id FOR UPDATE;
  IF e.status<>'current' OR (e.expires_at IS NOT NULL AND e.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester route evidence is not current and unexpired';
  END IF;
  PERFORM private.validate_requester_route_evidence_structure(e);
END;
$$;
REVOKE ALL ON FUNCTION private.assert_requester_route_evidence(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_requester_generation_contract(p_namespace text,p_product text,p_version text,p_schema text,p_format text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF p_schema IS DISTINCT FROM 'requester_route_evidence_v1' OR p_format IS DISTINCT FROM 'geojson_linestring_v1'
    OR p_namespace IS NULL OR p_product IS NULL OR p_version IS NULL
    OR p_namespace<>btrim(p_namespace) OR p_product<>btrim(p_product) OR p_version<>btrim(p_version)
    OR length(p_namespace) NOT BETWEEN 1 AND 100 OR length(p_product) NOT BETWEEN 1 AND 100 OR length(p_version) NOT BETWEEN 1 AND 100
    OR p_namespace !~ '[^[:space:]]' OR p_product !~ '[^[:space:]]' OR p_version !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid trusted requester generation contract';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_requester_generation_contract(text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Validate structure even for a nonreusable current row: corruption fails closed.
CREATE FUNCTION private.reusable_requester_route_evidence(p_need uuid,p_namespace text,p_product text,p_version text,p_schema text,p_format text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.requester_route_evidence%ROWTYPE; member_id uuid;
BEGIN
  -- Read identity without a tuple lock; the context helper locks the need and
  -- revalidates that identity before any evidence lock, including direct calls.
  SELECT n.member_id INTO member_id FROM public.movement_needs n WHERE n.id=p_need;
  PERFORM private.lock_requester_route_generation_context(p_need,member_id);
  SELECT x.* INTO e FROM private.requester_route_evidence x WHERE x.movement_need_id=p_need AND x.status='current' FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM private.validate_requester_route_evidence_structure(e);
  IF e.expires_at IS NOT NULL AND e.expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
  IF ROW(e.provider_namespace,e.provider_product,e.provider_version,e.evidence_schema_version,e.route_shape_format)
    IS DISTINCT FROM ROW(p_namespace,p_product,p_version,p_schema,p_format) THEN RETURN NULL; END IF;
  PERFORM private.assert_requester_route_evidence(e.id);
  RETURN e.id;
END;
$$;
REVOKE ALL ON FUNCTION private.reusable_requester_route_evidence(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.claim_requester_route_generation_for_server(
  p_movement_need_id uuid,p_requesting_member_id uuid,p_provider_namespace text,p_provider_product text,p_provider_version text,
  p_evidence_schema_version text DEFAULT 'requester_route_evidence_v1',p_route_shape_format text DEFAULT 'geojson_linestring_v1')
RETURNS TABLE(generation_state text,generation_claim_token uuid,retry_after_seconds integer,route_evidence_id uuid,route_evidence_version integer,
  origin_location_reference_id uuid,destination_location_reference_id uuid,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx record; c private.requester_route_generation_claims%ROWTYPE; reusable uuid; stamp timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Requester generation requires READ COMMITTED';
  END IF;
  PERFORM private.validate_requester_generation_contract(p_provider_namespace,p_provider_product,p_provider_version,p_evidence_schema_version,p_route_shape_format);
  SELECT * INTO STRICT ctx FROM private.lock_requester_route_generation_context(p_movement_need_id,p_requesting_member_id);
  SELECT x.* INTO c FROM private.requester_route_generation_claims x WHERE x.movement_need_id=p_movement_need_id FOR UPDATE;
  IF FOUND AND ROW(c.requesting_member_id,c.origin_location_reference_id,c.destination_location_reference_id)
    IS DISTINCT FROM ROW(p_requesting_member_id,ctx.origin_id,ctx.destination_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim binding mismatch';
  END IF;
  reusable:=private.reusable_requester_route_evidence(p_movement_need_id,p_provider_namespace,p_provider_product,p_provider_version,p_evidence_schema_version,p_route_shape_format);
  IF reusable IS NOT NULL THEN
    RETURN QUERY SELECT 'reuse_existing'::text,NULL::uuid,0,reusable,e.version,NULL::uuid,NULL::uuid,NULL::timestamptz FROM private.requester_route_evidence e WHERE e.id=reusable;
    RETURN;
  END IF;
  stamp:=clock_timestamp();
  IF c.movement_need_id IS NOT NULL AND c.lease_expires_at>stamp THEN
    RETURN QUERY SELECT 'in_progress'::text,NULL::uuid,greatest(1,least(30,ceil(extract(epoch FROM c.lease_expires_at-stamp))::integer)),NULL::uuid,NULL::integer,NULL::uuid,NULL::uuid,NULL::timestamptz;
    RETURN;
  END IF;
  generation_claim_token:=gen_random_uuid();
  INSERT INTO private.requester_route_generation_claims AS slot(movement_need_id,requesting_member_id,origin_location_reference_id,destination_location_reference_id,
    evidence_schema_version,route_shape_format,provider_namespace,provider_product,provider_version,claim_token,claimed_at,lease_expires_at)
  VALUES(p_movement_need_id,p_requesting_member_id,ctx.origin_id,ctx.destination_id,p_evidence_schema_version,p_route_shape_format,
    p_provider_namespace,p_provider_product,p_provider_version,generation_claim_token,stamp,stamp+interval '30 seconds')
  ON CONFLICT(movement_need_id) DO UPDATE SET claim_token=EXCLUDED.claim_token,claimed_at=EXCLUDED.claimed_at,lease_expires_at=EXCLUDED.lease_expires_at,
    evidence_schema_version=EXCLUDED.evidence_schema_version,route_shape_format=EXCLUDED.route_shape_format,provider_namespace=EXCLUDED.provider_namespace,
    provider_product=EXCLUDED.provider_product,provider_version=EXCLUDED.provider_version,completed_route_evidence_id=NULL,completed_at=NULL,completion_kind=NULL;
  RETURN QUERY SELECT 'claimed'::text,generation_claim_token,0,NULL::uuid,NULL::integer,ctx.origin_id,ctx.destination_id,stamp+interval '30 seconds';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_requester_route_generation_for_server(uuid,uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.claim_requester_route_generation_for_server(uuid,uuid,text,text,text,text,text) TO service_role;

CREATE FUNCTION public.record_claimed_requester_route_evidence_for_server(
  p_movement_need_id uuid,p_requesting_member_id uuid,p_generation_claim_token uuid,p_origin_location_reference_id uuid,p_destination_location_reference_id uuid,
  p_evidence_schema_version text,p_route_shape_format text,p_provider_namespace text,p_provider_product text,p_provider_version text,p_provider_route_reference text,
  p_route_shape jsonb,p_route_distance_meters bigint,p_route_duration_seconds bigint,p_generated_at timestamptz,p_expires_at timestamptz DEFAULT NULL)
RETURNS TABLE(publication_state text,route_evidence_id uuid,route_evidence_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx record; c private.requester_route_generation_claims%ROWTYPE; e private.requester_route_evidence%ROWTYPE;
  reusable uuid; result_id uuid; next_version integer; effective_expiry timestamptz; stamp timestamptz; earliest_generation timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Requester generation requires READ COMMITTED';
  END IF;
  PERFORM private.validate_requester_generation_contract(p_provider_namespace,p_provider_product,p_provider_version,p_evidence_schema_version,p_route_shape_format);
  SELECT * INTO STRICT ctx FROM private.lock_requester_route_generation_context(p_movement_need_id,p_requesting_member_id);
  SELECT x.* INTO c FROM private.requester_route_generation_claims x WHERE x.movement_need_id=p_movement_need_id FOR UPDATE;
  IF NOT FOUND OR p_generation_claim_token IS NULL OR c.claim_token IS DISTINCT FROM p_generation_claim_token
    OR ROW(c.requesting_member_id,c.origin_location_reference_id,c.destination_location_reference_id,c.evidence_schema_version,c.route_shape_format,c.provider_namespace,c.provider_product,c.provider_version)
    IS DISTINCT FROM ROW(p_requesting_member_id,p_origin_location_reference_id,p_destination_location_reference_id,p_evidence_schema_version,p_route_shape_format,p_provider_namespace,p_provider_product,p_provider_version)
    OR ROW(ctx.origin_id,ctx.destination_id) IS DISTINCT FROM ROW(c.origin_location_reference_id,c.destination_location_reference_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester generation claim unavailable or mismatched';
  END IF;
  IF c.completed_at IS NOT NULL THEN
    PERFORM private.assert_requester_route_evidence(c.completed_route_evidence_id);
    SELECT x.* INTO STRICT e FROM private.requester_route_evidence x WHERE x.id=c.completed_route_evidence_id;
    IF c.completion_kind='published' AND ROW(e.provider_route_reference,e.route_shape,e.route_distance_meters,e.route_duration_seconds,e.generated_at)
      IS DISTINCT FROM ROW(p_provider_route_reference,p_route_shape,p_route_distance_meters,p_route_duration_seconds,p_generated_at) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester completed replay payload mismatch';
    END IF;
    -- A reuse completion does not attest this worker's discarded provider payload.
    effective_expiry:=LEAST(p_expires_at,(SELECT expires_at FROM private.movement_location_references WHERE id=ctx.origin_id),(SELECT expires_at FROM private.movement_location_references WHERE id=ctx.destination_id));
    IF c.completion_kind='published' AND e.expires_at IS DISTINCT FROM effective_expiry THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester completed replay expiry mismatch';
    END IF;
    RETURN QUERY SELECT c.completion_kind,e.id,e.version; RETURN;
  END IF;
  IF c.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim expired'; END IF;
  reusable:=private.reusable_requester_route_evidence(p_movement_need_id,p_provider_namespace,p_provider_product,p_provider_version,p_evidence_schema_version,p_route_shape_format);
  IF reusable IS NOT NULL THEN
    result_id:=reusable; publication_state:='reuse_existing';
  ELSE
    SELECT greatest(n.created_at,o.resolved_at,d.resolved_at,c.claimed_at),LEAST(p_expires_at,o.expires_at,d.expires_at)
      INTO earliest_generation,effective_expiry FROM public.movement_needs n
      JOIN private.movement_location_references o ON o.id=ctx.origin_id JOIN private.movement_location_references d ON d.id=ctx.destination_id WHERE n.id=p_movement_need_id;
    stamp:=clock_timestamp();
    IF p_generated_at IS NULL OR NOT isfinite(p_generated_at) OR p_generated_at<earliest_generation OR p_generated_at>stamp
      OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=stamp))
      OR (effective_expiry IS NOT NULL AND (NOT isfinite(effective_expiry) OR effective_expiry<=stamp)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester generation timestamps invalid';
    END IF;
    PERFORM private.assert_geojson_linestring_v1(p_route_shape);
    IF EXISTS(SELECT 1 FROM private.requester_route_evidence x WHERE x.movement_need_id=p_movement_need_id AND
      ROW(x.provider_namespace,x.provider_product,x.provider_version,x.provider_route_reference)=ROW(p_provider_namespace,p_provider_product,p_provider_version,p_provider_route_reference)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester provider reference already recorded';
    END IF;
    SELECT coalesce(max(x.version),0)+1 INTO next_version FROM private.requester_route_evidence x WHERE x.movement_need_id=p_movement_need_id;
    UPDATE private.requester_route_evidence x SET status='superseded' WHERE x.movement_need_id=p_movement_need_id AND x.status='current';
    stamp:=clock_timestamp();
    IF c.lease_expires_at<=stamp THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim expired'; END IF;
    INSERT INTO private.requester_route_evidence(movement_need_id,requesting_member_id,origin_location_reference_id,destination_location_reference_id,
      version,evidence_schema_version,provider_namespace,provider_product,provider_version,provider_route_reference,route_shape_format,route_shape,
      route_distance_meters,route_duration_seconds,generated_at,created_at,expires_at,status)
    VALUES(p_movement_need_id,p_requesting_member_id,ctx.origin_id,ctx.destination_id,next_version,p_evidence_schema_version,p_provider_namespace,p_provider_product,
      p_provider_version,p_provider_route_reference,p_route_shape_format,p_route_shape,p_route_distance_meters,p_route_duration_seconds,p_generated_at,stamp,effective_expiry,'current') RETURNING id INTO result_id;
    SET CONSTRAINTS private.requester_route_evidence_complete IMMEDIATE;
    SET CONSTRAINTS private.requester_route_evidence_complete DEFERRED;
    publication_state:='published';
  END IF;
  PERFORM private.assert_requester_route_evidence(result_id);
  stamp:=clock_timestamp();
  IF c.lease_expires_at<=stamp THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester claim expired'; END IF;
  IF EXISTS(SELECT 1 FROM private.movement_location_references x WHERE x.id IN (ctx.origin_id,ctx.destination_id) AND x.expires_at IS NOT NULL AND x.expires_at<=stamp)
    OR EXISTS(SELECT 1 FROM private.requester_route_evidence x WHERE x.id=result_id AND x.expires_at IS NOT NULL AND x.expires_at<=stamp) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester publication dependencies expired';
  END IF;
  UPDATE private.requester_route_generation_claims SET completed_route_evidence_id=result_id,completed_at=stamp,completion_kind=publication_state WHERE movement_need_id=p_movement_need_id AND claim_token=p_generation_claim_token;
  RETURN QUERY SELECT publication_state,result_id,x.version FROM private.requester_route_evidence x WHERE x.id=result_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_claimed_requester_route_evidence_for_server(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_claimed_requester_route_evidence_for_server(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz) TO service_role;

COMMIT;
