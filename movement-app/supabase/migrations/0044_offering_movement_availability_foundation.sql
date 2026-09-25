BEGIN;

-- WE DO NOT CREATE JOURNEYS. Availability is operational state, not intent
-- history or a requester-specific offer. Neither interest nor offers consume it.
CREATE TABLE private.offering_movement_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  offering_movement_intent_id uuid NOT NULL UNIQUE
    REFERENCES private.offering_movement_intents(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  route_evidence_id uuid NOT NULL REFERENCES private.offering_route_evidence(id),
  route_evidence_version integer NOT NULL CHECK (route_evidence_version >= 1),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  total_places integer NOT NULL CHECK (total_places >= 1),
  remaining_places integer NOT NULL CHECK (remaining_places BETWEEN 0 AND total_places),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','full','withdrawn','expired','unavailable')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  UNIQUE (offering_member_id,request_id),
  CHECK (updated_at >= created_at),
  CHECK (expires_at > created_at),
  CHECK (status <> 'open' OR remaining_places > 0),
  CHECK (status <> 'full' OR remaining_places = 0)
);

-- One availability lifetime per immutable intent in this foundation. A new
-- request cannot reset capacity or reopen a full/withdrawn historical record.
-- A future acceptance path must lock this row and subtract the entire group's
-- people_count atomically, after all 0042 authorization/group checks succeed.
-- No acceptance, reservation, or capacity-consumption RPC is introduced here.
ALTER TABLE private.offering_movement_availability ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.offering_movement_availability FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.offering_movement_availability TO service_role;

CREATE FUNCTION private.protect_offering_movement_availability()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $protect$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'open' OR NEW.remaining_places<>NEW.total_places
      OR NEW.created_at>clock_timestamp() OR NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability must start open with its declared capacity';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'remaining_places'-'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD)-'status'-'remaining_places'-'updated_at') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability bindings and total capacity are immutable';
  END IF;
  IF OLD.status<>'open' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Terminal availability cannot reopen or change';
  END IF;
  IF NEW.remaining_places>OLD.remaining_places
    OR (NEW.remaining_places<>OLD.remaining_places AND NEW.status NOT IN ('open','full')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability capacity transition is invalid';
  END IF;
  IF NEW.status='expired' AND OLD.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability expiry has not elapsed';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$protect$;
REVOKE ALL ON FUNCTION private.protect_offering_movement_availability()
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_offering_movement_availability
BEFORE INSERT OR UPDATE OR DELETE ON private.offering_movement_availability
FOR EACH ROW EXECUTE FUNCTION private.protect_offering_movement_availability();

-- Lock contract for future sensitive consumers (after any need/offer locks):
-- intent -> exact route -> availability -> vehicle -> access. The immutable
-- preliminary read only finds those locks; authoritative state is reread under
-- lock. Consumers must follow this order before changing remaining_places.
CREATE FUNCTION private.assert_offering_movement_availability(p_availability_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $assert$
DECLARE
  a private.offering_movement_availability%ROWTYPE;
  i private.offering_movement_intents%ROWTYPE;
  e private.offering_route_evidence%ROWTYPE;
  v_capacity integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Availability validation requires READ COMMITTED';
  END IF;
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=p_availability_id;
  SELECT x.* INTO STRICT i FROM private.offering_movement_intents x
    WHERE x.id=a.offering_movement_intent_id FOR UPDATE;
  PERFORM private.assert_offering_movement_intent(i.id);
  SELECT x.* INTO STRICT e FROM private.offering_route_evidence x WHERE x.id=a.route_evidence_id FOR UPDATE;
  PERFORM private.assert_offering_route_evidence(e.id);
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=p_availability_id FOR UPDATE;
  IF a.offering_member_id IS DISTINCT FROM i.offering_member_id
    OR e.offering_movement_intent_id IS DISTINCT FROM i.id
    OR e.offering_member_id IS DISTINCT FROM a.offering_member_id
    OR e.version IS DISTINCT FROM a.route_evidence_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability trusted movement binding does not match';
  END IF;
  SELECT v.seat_capacity INTO STRICT v_capacity FROM public.vehicles v WHERE v.id=a.vehicle_id FOR SHARE;
  PERFORM 1 FROM public.member_vehicle_access mva
    WHERE mva.vehicle_id=a.vehicle_id AND mva.member_id=a.offering_member_id AND mva.active FOR SHARE;
  IF NOT FOUND OR a.total_places>v_capacity THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability requires active vehicle access and sufficient capacity';
  END IF;
  -- Stop discovery at earliest declared departure; there is no independent
  -- departure event in this foundation and no inference from GPS.
  IF a.status<>'open' OR a.remaining_places<1 OR a.expires_at<=clock_timestamp()
    OR i.earliest_departure_at<=clock_timestamp()
    OR a.expires_at>LEAST(i.earliest_departure_at,i.expires_at,e.expires_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability is not open and eligible';
  END IF;
END;
$assert$;
REVOKE ALL ON FUNCTION private.assert_offering_movement_availability(uuid)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_offering_movement_availability()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $validate$
BEGIN
  PERFORM private.assert_offering_movement_availability(NEW.id);
  RETURN NULL;
END;
$validate$;
REVOKE ALL ON FUNCTION private.validate_offering_movement_availability()
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_offering_movement_availability
AFTER INSERT ON private.offering_movement_availability
FOR EACH ROW EXECUTE FUNCTION private.validate_offering_movement_availability();

CREATE FUNCTION public.open_offering_movement_availability(
  p_request_id uuid,
  p_offering_movement_intent_id uuid,
  p_vehicle_id uuid,
  p_total_places integer
)
RETURNS TABLE (availability_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $open$
DECLARE
  v_member_id uuid := auth.uid();
  i private.offering_movement_intents%ROWTYPE;
  e private.offering_route_evidence%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  v_id uuid;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Availability opening requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=v_member_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_request_id IS NULL OR p_offering_movement_intent_id IS NULL OR p_vehicle_id IS NULL
    OR p_total_places IS NULL OR p_total_places<1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability request, intent, vehicle and positive places are required';
  END IF;
  -- Serialize this member/request pair even when conflicting retries name
  -- different intents. Hash collisions only serialize unrelated requests.
  PERFORM pg_advisory_xact_lock(hashtextextended('availability:'||v_member_id::text||':'||p_request_id::text,0));
  SELECT x.* INTO i FROM private.offering_movement_intents x
    WHERE x.id=p_offering_movement_intent_id AND x.offering_member_id=v_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own offering movement intent required';
  END IF;
  SELECT x.* INTO a FROM private.offering_movement_availability x
    WHERE x.offering_member_id=v_member_id AND x.request_id=p_request_id;
  IF FOUND THEN
    IF a.offering_movement_intent_id IS DISTINCT FROM i.id
      OR a.vehicle_id IS DISTINCT FROM p_vehicle_id OR a.total_places IS DISTINCT FROM p_total_places THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability request replay does not match';
    END IF;
    -- An old request never rebinds to a newer route or resets capacity.
    PERFORM private.assert_offering_movement_availability(a.id);
    RETURN QUERY SELECT a.id;
    RETURN;
  END IF;
  PERFORM private.assert_offering_movement_intent(i.id);
  SELECT x.* INTO e FROM private.offering_route_evidence x
    WHERE x.offering_movement_intent_id=i.id AND x.offering_member_id=v_member_id AND x.status='current' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Current trusted route for own intent required';
  END IF;
  PERFORM private.assert_offering_route_evidence(e.id);
  IF EXISTS(SELECT 1 FROM private.offering_movement_availability x WHERE x.offering_movement_intent_id=i.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Intent already has an availability lifetime';
  END IF;
  INSERT INTO private.offering_movement_availability(
    request_id,offering_movement_intent_id,offering_member_id,route_evidence_id,route_evidence_version,
    vehicle_id,total_places,remaining_places,expires_at
  ) VALUES (
    p_request_id,i.id,v_member_id,e.id,e.version,p_vehicle_id,p_total_places,p_total_places,
    LEAST(i.earliest_departure_at,i.expires_at,e.expires_at)
  ) RETURNING id INTO v_id;
  -- The immediate INSERT assertion locks/checks vehicle access and capacity,
  -- and revalidates every trusted binding before this RPC can return success.
  RETURN QUERY SELECT v_id;
END;
$open$;
REVOKE ALL ON FUNCTION public.open_offering_movement_availability(uuid,uuid,uuid,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.open_offering_movement_availability(uuid,uuid,uuid,integer) TO authenticated;

CREATE FUNCTION public.discover_offering_movement_availability(p_limit integer DEFAULT 20)
RETURNS TABLE (
  availability_id uuid,
  origin_area text,
  destination_area text,
  earliest_departure_at timestamptz,
  latest_departure_at timestamptz,
  remaining_places integer,
  make text,
  model text,
  year integer,
  color text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $discover$
DECLARE
  v_member_id uuid := auth.uid();
BEGIN
  IF v_member_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=v_member_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Discovery limit must be between 1 and 50';
  END IF;
  -- Discovery is a bounded snapshot, never a capacity reservation. Immutable
  -- bindings/shapes are validated at insertion; all mutable eligibility and
  -- expiry facts are filtered again here. Sensitive use must call the locking
  -- private assertion, rather than trusting this earlier discovery result.
  RETURN QUERY
  SELECT a.id,od.discovery_area_label,dd.discovery_area_label,
    i.earliest_departure_at,i.latest_departure_at,a.remaining_places,v.make,v.model,v.year,v.color
  FROM private.offering_movement_availability a
  JOIN private.offering_movement_intents i
    ON i.id=a.offering_movement_intent_id AND i.offering_member_id=a.offering_member_id
  JOIN private.offering_route_evidence e
    ON e.id=a.route_evidence_id AND e.version=a.route_evidence_version
    AND e.offering_movement_intent_id=i.id AND e.offering_member_id=a.offering_member_id
  JOIN private.offering_movement_intent_locations oi
    ON oi.intent_id=i.id AND oi.role='origin' AND oi.location_reference_id=e.origin_location_reference_id
  JOIN private.offering_movement_intent_locations di
    ON di.intent_id=i.id AND di.role='destination' AND di.location_reference_id=e.destination_location_reference_id
  JOIN private.movement_location_references ol ON ol.id=oi.location_reference_id
  JOIN private.movement_location_references dl ON dl.id=di.location_reference_id
  JOIN private.trusted_location_discovery_areas od ON od.resolved_location_reference_id=ol.id
  JOIN private.trusted_location_discovery_areas dd ON dd.resolved_location_reference_id=dl.id
  JOIN public.vehicles v ON v.id=a.vehicle_id
  JOIN public.member_vehicle_access mva
    ON mva.vehicle_id=v.id AND mva.member_id=a.offering_member_id AND mva.active
  WHERE a.offering_member_id<>v_member_id AND a.status='open' AND a.remaining_places>0
    AND a.total_places<=v.seat_capacity AND a.expires_at>clock_timestamp()
    AND i.status='current' AND i.earliest_departure_at>clock_timestamp()
    AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())
    AND e.status='current' AND (e.expires_at IS NULL OR e.expires_at>clock_timestamp())
    AND ol.owner_member_id=a.offering_member_id AND dl.owner_member_id=a.offering_member_id
    AND ol.source_kind='provider_resolved' AND dl.source_kind='provider_resolved'
    AND ol.resolution_status='resolved' AND dl.resolution_status='resolved'
    AND (ol.expires_at IS NULL OR ol.expires_at>clock_timestamp())
    AND (dl.expires_at IS NULL OR dl.expires_at>clock_timestamp())
  ORDER BY i.earliest_departure_at,a.created_at,a.id
  LIMIT p_limit;
END;
$discover$;
REVOKE ALL ON FUNCTION public.discover_offering_movement_availability(integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.discover_offering_movement_availability(integer) TO authenticated;

COMMIT;
