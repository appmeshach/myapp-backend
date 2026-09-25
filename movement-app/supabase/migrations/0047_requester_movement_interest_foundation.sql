BEGIN;

-- WE DO NOT CREATE JOURNEYS. Explicit interest records willingness only.
-- Public need ids deliberately have no FK, preserving history after deletion.
CREATE TABLE private.requester_movement_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  movement_need_id uuid NOT NULL,
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  availability_id uuid NOT NULL REFERENCES private.offering_movement_availability(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  route_match_evidence_id uuid NOT NULL REFERENCES private.trusted_route_match_evidence(id),
  route_match_evidence_version integer NOT NULL CHECK (route_match_evidence_version >= 1),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn','expired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  UNIQUE (requesting_member_id,request_id),
  CHECK (requesting_member_id <> offering_member_id),
  CHECK (updated_at >= created_at),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX requester_movement_interests_active_pair
ON private.requester_movement_interests (movement_need_id,availability_id)
WHERE status='active';
CREATE INDEX requester_movement_interests_offerer
ON private.requester_movement_interests (offering_member_id,created_at,id)
WHERE status='active';
ALTER TABLE private.requester_movement_interests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.requester_movement_interests FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.requester_movement_interests TO service_role;

CREATE FUNCTION private.protect_requester_movement_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $protect$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'active' OR NEW.created_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest must start active and unexpired';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD)-'status'-'updated_at') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest bindings are immutable';
  END IF;
  IF OLD.status<>'active' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inactive interest cannot reopen or change';
  END IF;
  IF NEW.status='expired' AND OLD.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest expiry has not elapsed';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$protect$;
REVOKE ALL ON FUNCTION private.protect_requester_movement_interest()
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_requester_movement_interest
BEFORE INSERT OR UPDATE OR DELETE ON private.requester_movement_interests
FOR EACH ROW EXECUTE FUNCTION private.protect_requester_movement_interest();

-- 0046 owns the lock order: need -> requester endpoints -> intent -> exact
-- route -> availability -> vehicle/access. Only then lock match evidence.
-- Check supplied evidence bindings BEFORE invoking its context assertion so
-- mismatched input never acquires locks for a second need/intent.
CREATE FUNCTION private.assert_requester_interest_support(
  p_requesting_member_id uuid,p_movement_need_id uuid,p_availability_id uuid,p_evidence_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $support$
DECLARE
  a private.offering_movement_availability%ROWTYPE;
  e private.trusted_route_match_evidence%ROWTYPE;
BEGIN
  PERFORM 1 FROM public.get_requester_availability_matching_context_for_server(
    p_requesting_member_id,p_movement_need_id,p_availability_id);
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=p_availability_id;
  SELECT x.* INTO STRICT e FROM private.trusted_route_match_evidence x WHERE x.id=p_evidence_id FOR SHARE;
  IF e.movement_need_id IS DISTINCT FROM p_movement_need_id
    OR e.requesting_member_id IS DISTINCT FROM p_requesting_member_id
    OR e.offering_member_id IS DISTINCT FROM a.offering_member_id
    OR e.offering_movement_intent_id IS DISTINCT FROM a.offering_movement_intent_id
    OR e.route_evidence_id IS DISTINCT FROM a.route_evidence_id
    OR e.route_evidence_version IS DISTINCT FROM a.route_evidence_version
    OR p_requesting_member_id=a.offering_member_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest evidence does not match requester and availability';
  END IF;
  PERFORM private.assert_trusted_route_match_evidence(e.id);
END;
$support$;
REVOKE ALL ON FUNCTION private.assert_requester_interest_support(uuid,uuid,uuid,uuid)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_requester_movement_interest(p_interest_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $assert$
DECLARE
  i private.requester_movement_interests%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  e private.trusted_route_match_evidence%ROWTYPE;
BEGIN
  SELECT x.* INTO STRICT i FROM private.requester_movement_interests x WHERE x.id=p_interest_id;
  PERFORM private.assert_requester_interest_support(
    i.requesting_member_id,i.movement_need_id,i.availability_id,i.route_match_evidence_id);
  -- Interest is locked last; withdrawal locks only interest and never support.
  SELECT x.* INTO STRICT i FROM private.requester_movement_interests x WHERE x.id=p_interest_id FOR SHARE;
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=i.availability_id;
  SELECT x.* INTO STRICT e FROM private.trusted_route_match_evidence x WHERE x.id=i.route_match_evidence_id;
  IF i.status<>'active' OR i.expires_at<=clock_timestamp()
    OR i.offering_member_id IS DISTINCT FROM a.offering_member_id
    OR i.offering_movement_intent_id IS DISTINCT FROM a.offering_movement_intent_id
    OR i.route_match_evidence_version IS DISTINCT FROM e.version
    OR i.expires_at>LEAST(a.expires_at,e.expires_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest is not active with current exact support';
  END IF;
END;
$assert$;
REVOKE ALL ON FUNCTION private.assert_requester_movement_interest(uuid)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_requester_movement_interest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $validate$
BEGIN
  PERFORM private.assert_requester_movement_interest(NEW.id);
  RETURN NULL;
END;
$validate$;
REVOKE ALL ON FUNCTION private.validate_requester_movement_interest()
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_requester_movement_interest
AFTER INSERT ON private.requester_movement_interests
FOR EACH ROW EXECUTE FUNCTION private.validate_requester_movement_interest();

CREATE FUNCTION public.create_requester_movement_interest(
  p_request_id uuid,p_movement_need_id uuid,p_availability_id uuid,p_route_match_evidence_id uuid
)
RETURNS TABLE (interest_id uuid,interest_status text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $create$
DECLARE
  v_member_id uuid := auth.uid();
  i private.requester_movement_interests%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  e private.trusted_route_match_evidence%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Interest creation requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=v_member_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_request_id IS NULL OR p_movement_need_id IS NULL OR p_availability_id IS NULL OR p_route_match_evidence_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Request, movement need, availability and exact evidence are required';
  END IF;
  -- Serialize request-key replays across different needs before support locks.
  PERFORM pg_advisory_xact_lock(hashtextextended('requester-interest:'||v_member_id::text||':'||p_request_id::text,0));
  SELECT x.* INTO i FROM private.requester_movement_interests x
    WHERE x.requesting_member_id=v_member_id AND x.request_id=p_request_id;
  IF FOUND THEN
    IF i.movement_need_id IS DISTINCT FROM p_movement_need_id
      OR i.availability_id IS DISTINCT FROM p_availability_id
      OR i.route_match_evidence_id IS DISTINCT FROM p_route_match_evidence_id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest request replay has different bindings';
    END IF;
    IF i.status='active' THEN PERFORM private.assert_requester_movement_interest(i.id); END IF;
    SELECT x.* INTO STRICT i FROM private.requester_movement_interests x WHERE x.id=i.id;
    RETURN QUERY SELECT i.id,i.status,i.created_at;
    RETURN;
  END IF;
  PERFORM private.assert_requester_interest_support(
    v_member_id,p_movement_need_id,p_availability_id,p_route_match_evidence_id);
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=p_availability_id;
  SELECT x.* INTO STRICT e FROM private.trusted_route_match_evidence x WHERE x.id=p_route_match_evidence_id;
  INSERT INTO private.requester_movement_interests (
    request_id,movement_need_id,requesting_member_id,availability_id,offering_member_id,
    offering_movement_intent_id,route_match_evidence_id,route_match_evidence_version,expires_at
  ) VALUES (
    p_request_id,p_movement_need_id,v_member_id,a.id,a.offering_member_id,
    a.offering_movement_intent_id,e.id,e.version,LEAST(a.expires_at,e.expires_at)
  ) RETURNING * INTO i;
  RETURN QUERY SELECT i.id,i.status,i.created_at;
END;
$create$;
REVOKE ALL ON FUNCTION public.create_requester_movement_interest(uuid,uuid,uuid,uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_requester_movement_interest(uuid,uuid,uuid,uuid) TO authenticated;

CREATE FUNCTION public.withdraw_requester_movement_interest(p_interest_id uuid)
RETURNS TABLE (interest_id uuid,interest_status text,created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $withdraw$
DECLARE
  v_member_id uuid := auth.uid();
  i private.requester_movement_interests%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Interest withdrawal requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_interest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Interest is required';
  END IF;
  SELECT x.* INTO i FROM private.requester_movement_interests x
    WHERE x.id=p_interest_id AND x.requesting_member_id=v_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Requester interest unavailable';
  END IF;
  IF i.status='expired' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Expired interest cannot change';
  END IF;
  IF i.status='active' THEN
    UPDATE private.requester_movement_interests x SET status='withdrawn'
    WHERE x.id=i.id RETURNING * INTO i;
  END IF;
  RETURN QUERY SELECT i.id,i.status,i.created_at;
END;
$withdraw$;
REVOKE ALL ON FUNCTION public.withdraw_requester_movement_interest(uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.withdraw_requester_movement_interest(uuid) TO authenticated;

-- Single-interest safe read, not a global requester feed. A future inbox can
-- build on this boundary without making private compatibility checks visible.
-- Missing, foreign, withdrawn and unsupported interests all return zero rows.
CREATE FUNCTION public.get_requester_movement_interest(p_interest_id uuid)
RETURNS TABLE (
  interest_id uuid,movement_need_id uuid,origin_area text,destination_area text,
  people_count integer,earliest_departure_at timestamptz,latest_departure_at timestamptz,
  requester_origin_distance_to_route_meters bigint,created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $read$
DECLARE
  v_member_id uuid := auth.uid();
  i private.requester_movement_interests%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Interest reading requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_interest_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Interest is required';
  END IF;
  SELECT x.* INTO i FROM private.requester_movement_interests x
    WHERE x.id=p_interest_id AND x.offering_member_id=v_member_id AND x.status='active';
  IF NOT FOUND THEN RETURN; END IF;
  BEGIN
    PERFORM private.assert_requester_movement_interest(i.id);
  EXCEPTION WHEN check_violation OR no_data_found OR raise_exception OR insufficient_privilege THEN
    RETURN;
  END;
  RETURN QUERY
  SELECT i.id,n.id,od.discovery_area_label,dd.discovery_area_label,n.people_count,
    n.earliest_departure_at,n.latest_departure_at,e.requester_origin_distance_to_route_meters,i.created_at
  FROM public.movement_needs n
  JOIN private.trusted_route_match_evidence e ON e.id=i.route_match_evidence_id
  JOIN private.trusted_location_discovery_areas od ON od.resolved_location_reference_id=e.requester_origin_location_reference_id
  JOIN private.trusted_location_discovery_areas dd ON dd.resolved_location_reference_id=e.requester_destination_location_reference_id
  WHERE n.id=i.movement_need_id;
END;
$read$;
REVOKE ALL ON FUNCTION public.get_requester_movement_interest(uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_requester_movement_interest(uuid) TO authenticated;

COMMIT;
