BEGIN;

CREATE TABLE private.movement_location_resolution_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_location_reference_id uuid NOT NULL REFERENCES private.movement_location_references(id) ON DELETE RESTRICT,
  resolved_location_reference_id uuid NOT NULL UNIQUE REFERENCES private.movement_location_references(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version >= 1),
  producer_request_id uuid NOT NULL UNIQUE,
  provider_product text NOT NULL CHECK (provider_product=btrim(provider_product) AND length(provider_product) BETWEEN 1 AND 100 AND provider_product ~ '[^[:space:]]'),
  provider_version text NOT NULL CHECK (provider_version=btrim(provider_version) AND length(provider_version) BETWEEN 1 AND 100 AND provider_version ~ '[^[:space:]]'),
  resolution_schema_version text NOT NULL CHECK (resolution_schema_version='movement_location_resolution_v1'),
  requested_expires_at timestamptz CHECK (isfinite(requested_expires_at)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(recorded_at)),
  UNIQUE (source_location_reference_id,version),
  CHECK (source_location_reference_id<>resolved_location_reference_id)
);

ALTER TABLE private.movement_location_resolution_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.movement_location_resolution_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.movement_location_resolution_evidence TO service_role;

CREATE FUNCTION private.protect_movement_location_resolution_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $protect_resolution$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution evidence is immutable';
END;
$protect_resolution$;
REVOKE ALL ON FUNCTION private.protect_movement_location_resolution_evidence() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_movement_location_resolution_evidence
BEFORE UPDATE OR DELETE ON private.movement_location_resolution_evidence
FOR EACH ROW EXECUTE FUNCTION private.protect_movement_location_resolution_evidence();

-- Evidence and location contents are immutable. Read identity first, then lock
-- source -> target; never acquire an offering-intent lock in this boundary.
CREATE FUNCTION private.assert_movement_location_resolution_evidence(p_evidence_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $assert_resolution$
DECLARE
  e private.movement_location_resolution_evidence%ROWTYPE;
  s private.movement_location_references%ROWTYPE;
  t private.movement_location_references%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT r.* INTO STRICT e FROM private.movement_location_resolution_evidence r WHERE r.id=p_evidence_id;
  SELECT r.* INTO STRICT s FROM private.movement_location_references r WHERE r.id=e.source_location_reference_id FOR UPDATE;
  SELECT r.* INTO STRICT t FROM private.movement_location_references r WHERE r.id=e.resolved_location_reference_id FOR SHARE;
  v_now := clock_timestamp();
  IF s.resolution_status IS DISTINCT FROM 'unresolved'
    OR s.source_kind NOT IN ('member_declared','member_selected')
    OR s.latitude IS NOT NULL OR s.longitude IS NOT NULL
    OR s.resolved_at IS NOT NULL OR s.resolution_version IS NOT NULL
    OR (s.provider_namespace IS NULL)<>(s.provider_place_reference IS NULL)
    OR s.id=t.id OR s.owner_member_id IS DISTINCT FROM t.owner_member_id
    OR s.declared_label IS DISTINCT FROM t.declared_label THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution source binding is invalid';
  END IF;
  IF t.source_kind IS DISTINCT FROM 'provider_resolved' OR t.resolution_status IS DISTINCT FROM 'resolved'
    OR t.latitude IS NULL OR t.longitude IS NULL
    OR NOT (t.latitude BETWEEN -90 AND 90) OR NOT (t.longitude BETWEEN -180 AND 180)
    OR t.latitude::text IN ('NaN','Infinity','-Infinity') OR t.longitude::text IN ('NaN','Infinity','-Infinity')
    OR t.provider_namespace IS NULL OR t.provider_place_reference IS NULL OR t.resolution_version IS NULL
    OR t.provider_namespace !~ '[^[:space:]]' OR t.provider_place_reference !~ '[^[:space:]]'
    OR t.resolution_version !~ '[^[:space:]]'
    OR e.version<1 OR e.resolution_schema_version IS DISTINCT FROM 'movement_location_resolution_v1'
    OR e.provider_product !~ '[^[:space:]]' OR e.provider_version !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution target evidence is invalid';
  END IF;
  IF s.provider_namespace IS NOT NULL AND
    (s.provider_namespace IS DISTINCT FROM t.provider_namespace
      OR s.provider_place_reference IS DISTINCT FROM t.provider_place_reference) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution must preserve provider selection identity';
  END IF;
  IF t.resolved_at IS NULL OR NOT isfinite(t.resolved_at)
    OR t.resolved_at<s.created_at OR t.resolved_at>t.created_at
    OR t.created_at IS DISTINCT FROM e.recorded_at OR e.recorded_at>v_now
    OR (s.expires_at IS NOT NULL AND s.expires_at<=v_now)
    OR (t.expires_at IS NOT NULL AND (t.expires_at<=v_now OR t.expires_at<=t.created_at))
    OR t.expires_at IS DISTINCT FROM LEAST(e.requested_expires_at,s.expires_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution timing or expiry is invalid';
  END IF;
END;
$assert_resolution$;
REVOKE ALL ON FUNCTION private.assert_movement_location_resolution_evidence(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_movement_location_resolution_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $validate_resolution$
BEGIN
  PERFORM private.assert_movement_location_resolution_evidence(NEW.id);
  RETURN NULL;
END;
$validate_resolution$;
REVOKE ALL ON FUNCTION private.validate_movement_location_resolution_evidence() FROM PUBLIC,anon,authenticated,service_role;
-- Immediate construction validation: later versions never invalidate history.
CREATE TRIGGER validate_movement_location_resolution_evidence
AFTER INSERT ON private.movement_location_resolution_evidence
FOR EACH ROW EXECUTE FUNCTION private.validate_movement_location_resolution_evidence();

CREATE FUNCTION public.record_location_resolution_for_server(
  p_source_location_reference_id uuid,
  p_producer_request_id uuid,
  p_provider_namespace text,
  p_provider_product text,
  p_provider_version text,
  p_provider_place_reference text,
  p_resolution_version text,
  p_latitude numeric,
  p_longitude numeric,
  p_resolved_at timestamptz,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (evidence_id uuid,resolved_location_reference_id uuid,version integer,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $record_resolution$
DECLARE
  v_source private.movement_location_references%ROWTYPE;
  v_existing private.movement_location_resolution_evidence%ROWTYPE;
  v_target private.movement_location_references%ROWTYPE;
  v_now timestamptz;
  v_expiry timestamptz;
  v_version integer;
  v_target_id uuid;
  v_evidence_id uuid;
  v_text text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Location resolution requires READ COMMITTED';
  END IF;
  IF p_source_location_reference_id IS NULL OR p_producer_request_id IS NULL
    OR p_provider_namespace IS NULL OR p_provider_product IS NULL OR p_provider_version IS NULL
    OR p_provider_place_reference IS NULL OR p_resolution_version IS NULL
    OR p_latitude IS NULL OR p_longitude IS NULL OR p_resolved_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Complete trusted location resolution is required';
  END IF;
  FOREACH v_text IN ARRAY ARRAY[p_provider_namespace,p_provider_product,p_provider_version,p_resolution_version]
  LOOP
    IF v_text<>btrim(v_text) OR length(v_text) NOT BETWEEN 1 AND 100 OR v_text !~ '[^[:space:]]' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution provider metadata is invalid';
    END IF;
  END LOOP;
  IF p_provider_place_reference<>btrim(p_provider_place_reference)
    OR length(p_provider_place_reference) NOT BETWEEN 1 AND 500 OR p_provider_place_reference !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution provider place reference is invalid';
  END IF;
  IF NOT (p_latitude BETWEEN -90 AND 90) OR NOT (p_longitude BETWEEN -180 AND 180)
    OR p_latitude::text IN ('NaN','Infinity','-Infinity') OR p_longitude::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution coordinates are invalid';
  END IF;

  SELECT r.* INTO v_source FROM private.movement_location_references r
  WHERE r.id=p_source_location_reference_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution source not found';
  END IF;
  v_now := clock_timestamp();
  IF v_source.resolution_status IS DISTINCT FROM 'unresolved'
    OR v_source.source_kind NOT IN ('member_declared','member_selected')
    OR v_source.latitude IS NOT NULL OR v_source.longitude IS NOT NULL
    OR v_source.resolved_at IS NOT NULL OR v_source.resolution_version IS NOT NULL
    OR (v_source.provider_namespace IS NULL)<>(v_source.provider_place_reference IS NULL)
    OR (v_source.expires_at IS NOT NULL AND v_source.expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution source is not eligible';
  END IF;
  IF v_source.provider_namespace IS NOT NULL AND
    (v_source.provider_namespace IS DISTINCT FROM p_provider_namespace
      OR v_source.provider_place_reference IS DISTINCT FROM p_provider_place_reference) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution must preserve provider selection identity';
  END IF;
  IF NOT isfinite(p_resolved_at) OR p_resolved_at<v_source.created_at OR p_resolved_at>v_now
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_now)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution timestamps are invalid';
  END IF;

  SELECT e.* INTO v_existing FROM private.movement_location_resolution_evidence e
  WHERE e.producer_request_id=p_producer_request_id;
  IF FOUND THEN
    SELECT r.* INTO STRICT v_target FROM private.movement_location_references r
    WHERE r.id=v_existing.resolved_location_reference_id FOR SHARE;
    IF v_existing.source_location_reference_id IS DISTINCT FROM v_source.id
      OR v_existing.provider_product IS DISTINCT FROM p_provider_product
      OR v_existing.provider_version IS DISTINCT FROM p_provider_version
      OR v_existing.requested_expires_at IS DISTINCT FROM p_expires_at
      OR v_target.provider_namespace IS DISTINCT FROM p_provider_namespace
      OR v_target.provider_place_reference IS DISTINCT FROM p_provider_place_reference
      OR v_target.resolution_version IS DISTINCT FROM p_resolution_version
      OR v_target.latitude IS DISTINCT FROM p_latitude OR v_target.longitude IS DISTINCT FROM p_longitude
      OR v_target.resolved_at IS DISTINCT FROM p_resolved_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution request does not match recorded evidence';
    END IF;
    -- Reacquires source/target in the same order and checks time AFTER all waits.
    PERFORM private.assert_movement_location_resolution_evidence(v_existing.id);
    RETURN QUERY SELECT v_existing.id,v_target.id,v_existing.version,v_target.expires_at;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(e.version),0)+1 INTO v_version
  FROM private.movement_location_resolution_evidence e WHERE e.source_location_reference_id=v_source.id;
  v_now := clock_timestamp();
  -- PostgreSQL LEAST ignores NULL; two NULL deadlines deliberately mean no expiry.
  v_expiry := LEAST(p_expires_at,v_source.expires_at);
  IF v_expiry IS NOT NULL AND v_expiry<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution expiry elapsed before recording';
  END IF;
  INSERT INTO private.movement_location_references(
    owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,
    provider_namespace,provider_place_reference,resolution_version,resolved_at,created_at,expires_at
  ) VALUES (
    v_source.owner_member_id,v_source.declared_label,'provider_resolved','resolved',p_latitude,p_longitude,
    p_provider_namespace,p_provider_place_reference,p_resolution_version,p_resolved_at,v_now,v_expiry
  ) RETURNING id INTO v_target_id;
  INSERT INTO private.movement_location_resolution_evidence(
    source_location_reference_id,resolved_location_reference_id,version,producer_request_id,
    provider_product,provider_version,resolution_schema_version,requested_expires_at,recorded_at
  ) VALUES (
    v_source.id,v_target_id,v_version,p_producer_request_id,p_provider_product,p_provider_version,
    'movement_location_resolution_v1',p_expires_at,v_now
  ) RETURNING id INTO v_evidence_id;
  -- No caught uniqueness errors: statement atomicity removes a losing target too.
  PERFORM private.assert_movement_location_resolution_evidence(v_evidence_id);
  RETURN QUERY SELECT v_evidence_id,v_target_id,v_version,v_expiry;
END;
$record_resolution$;
REVOKE ALL ON FUNCTION public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)
TO service_role;

COMMIT;
