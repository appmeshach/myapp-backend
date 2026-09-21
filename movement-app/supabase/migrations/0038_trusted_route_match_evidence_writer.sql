BEGIN;

-- =========================================================
-- 0038 Trusted route-match evidence writer
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- This migration opens one narrow server-only write path for
-- objective trusted route-match evidence created by the
-- trusted matching system.
--
-- The caller may provide only calculated geographic facts.
-- The database derives the requester, offerer, trusted
-- endpoint bindings, movement-intent version and trusted
-- route-evidence identity from authoritative server context.
--
-- This writer does NOT:
-- - create a movement offer;
-- - create an alignment or journey;
-- - decide whether an offerer should serve a requester;
-- - define a maximum detour;
-- - reject a requester because they are far from the route;
-- - record human willingness or agreement.
--
-- Geographic distance and route order remain objective facts.


CREATE FUNCTION
public.record_trusted_route_match_evidence_for_server(
  p_movement_need_id uuid,
  p_offering_movement_intent_id uuid,

  p_expected_route_evidence_id uuid,
  p_expected_route_evidence_version integer,

  p_requester_origin_distance_to_route_meters bigint,
  p_requester_destination_distance_to_route_meters bigint,

  p_calculated_route_shape_length_meters bigint,

  p_requester_origin_position_along_route_meters bigint,
  p_requester_destination_position_along_route_meters bigint,

  p_requester_origin_closest_route_latitude numeric,
  p_requester_origin_closest_route_longitude numeric,

  p_requester_destination_closest_route_latitude numeric,
  p_requester_destination_closest_route_longitude numeric,

  p_calculated_at timestamptz,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  route_match_evidence_id uuid,
  route_match_evidence_version integer,
  route_match_evidence_status text,
  route_match_evidence_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record_trusted_route_match_evidence$
DECLARE
  v_context record;

  v_offering_member_id uuid;

  v_existing
    private.trusted_route_match_evidence%ROWTYPE;

  v_requester_origin_expires_at timestamptz;
  v_requester_destination_expires_at timestamptz;
  v_offering_intent_expires_at timestamptz;

  v_effective_expires_at timestamptz;

  v_route_order text;

  v_next_version integer;
  v_new_id uuid;

  v_now timestamptz;
BEGIN
  -- The trusted matching-context function is deliberately
  -- READ COMMITTED only. Keep this writer on the same
  -- transaction-isolation contract.
  IF current_setting('transaction_isolation')
       IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25001',
      MESSAGE =
        'Trusted route-match evidence requires READ COMMITTED';
  END IF;


  IF p_movement_need_id IS NULL
     OR p_offering_movement_intent_id IS NULL

     OR p_expected_route_evidence_id IS NULL
     OR p_expected_route_evidence_version IS NULL

     OR p_requester_origin_distance_to_route_meters IS NULL
     OR p_requester_destination_distance_to_route_meters IS NULL

     OR p_calculated_route_shape_length_meters IS NULL

     OR p_requester_origin_position_along_route_meters IS NULL
     OR p_requester_destination_position_along_route_meters IS NULL

     OR p_requester_origin_closest_route_latitude IS NULL
     OR p_requester_origin_closest_route_longitude IS NULL

     OR p_requester_destination_closest_route_latitude IS NULL
     OR p_requester_destination_closest_route_longitude IS NULL

     OR p_calculated_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Complete trusted route-match evidence is required';
  END IF;


  -- No maximum-distance rule exists.
  --
  -- Large requester-to-route distances are legitimate
  -- objective facts and must not be rejected here.
  IF p_requester_origin_distance_to_route_meters < 0
     OR p_requester_destination_distance_to_route_meters < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match distances cannot be negative';
  END IF;


  IF p_calculated_route_shape_length_meters <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match route-shape length must be positive';
  END IF;


  IF p_requester_origin_position_along_route_meters < 0
     OR p_requester_destination_position_along_route_meters < 0
     OR p_requester_origin_position_along_route_meters
          > p_calculated_route_shape_length_meters
     OR p_requester_destination_position_along_route_meters
          > p_calculated_route_shape_length_meters THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match route positions are invalid';
  END IF;


  IF p_requester_origin_closest_route_latitude
       NOT BETWEEN -90 AND 90
     OR p_requester_origin_closest_route_longitude
       NOT BETWEEN -180 AND 180
     OR p_requester_destination_closest_route_latitude
       NOT BETWEEN -90 AND 90
     OR p_requester_destination_closest_route_longitude
       NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match closest route coordinates are invalid';
  END IF;


  -- Route order is a deterministic fact derived from the
  -- calculated positions. The caller does not choose it.
  IF p_requester_origin_position_along_route_meters
       < p_requester_destination_position_along_route_meters THEN
    v_route_order := 'forward';

  ELSIF p_requester_origin_position_along_route_meters
       = p_requester_destination_position_along_route_meters THEN
    v_route_order := 'same_position';

  ELSE
    v_route_order := 'reverse';
  END IF;


  -- Serialize route-match history for one requester need.
  --
  -- The existing trusted matching-context function also begins
  -- with the movement-need lock. Taking the stronger lock here
  -- preserves that lock order and prevents concurrent writers
  -- from allocating competing route-match versions.
  PERFORM 1
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Movement need not found';
  END IF;


  -- Offering intent ownership is immutable. Read the member id
  -- only so the existing trusted matching-context function can
  -- perform its authoritative ownership and eligibility checks.
  SELECT i.offering_member_id
  INTO v_offering_member_id
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Offering movement intent not found';
  END IF;


  SELECT c.*
  INTO STRICT v_context
  FROM public.get_trusted_matching_context_for_server(
    p_movement_need_id,
    p_offering_movement_intent_id,
    v_offering_member_id
  ) c;


  -- The geometry facts must have been calculated from the exact
  -- trusted route version that is still current now.
  --
  -- Without this check, route A could be calculated by the
  -- matcher and then silently recorded against newer route B.
  IF v_context.route_evidence_id
       IS DISTINCT FROM p_expected_route_evidence_id
     OR v_context.route_evidence_version
       IS DISTINCT FROM p_expected_route_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match calculation route is no longer current';
  END IF;


  v_now := clock_timestamp();

  IF NOT isfinite(p_calculated_at)
     OR p_calculated_at > v_now
     OR p_calculated_at < v_context.route_generated_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match calculation time is invalid';
  END IF;


  IF p_expires_at IS NOT NULL
     AND (
       NOT isfinite(p_expires_at)
       OR p_expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match requested expiry is invalid';
  END IF;


  -- These rows are already protected by the trusted matching
  -- context acquired above. Read their dependency expiries so
  -- this writer, rather than the caller, determines the maximum
  -- lifetime of the recorded evidence.
  SELECT lr.expires_at
  INTO STRICT v_requester_origin_expires_at
  FROM private.movement_location_references lr
  WHERE lr.id =
    v_context.requester_origin_location_reference_id;


  SELECT lr.expires_at
  INTO STRICT v_requester_destination_expires_at
  FROM private.movement_location_references lr
  WHERE lr.id =
    v_context.requester_destination_location_reference_id;


  SELECT i.expires_at
  INTO STRICT v_offering_intent_expires_at
  FROM private.offering_movement_intents i
  WHERE i.id =
    v_context.offering_movement_intent_id;


  v_effective_expires_at := LEAST(
    p_expires_at,
    v_requester_origin_expires_at,
    v_requester_destination_expires_at,
    v_offering_intent_expires_at,
    v_context.route_expires_at
  );


  v_now := clock_timestamp();

  IF v_effective_expires_at IS NOT NULL
     AND v_effective_expires_at <= v_now THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence dependencies are expired';
  END IF;


  -- One trusted route evidence + algorithm pair identifies one
  -- replayable calculation for this requester need.
  SELECT e.*
  INTO v_existing
  FROM private.trusted_route_match_evidence e
  WHERE e.movement_need_id = p_movement_need_id
    AND e.route_evidence_id = v_context.route_evidence_id
    AND e.algorithm_version = 'route_match_geometry_v1'
  FOR UPDATE;


  IF FOUND THEN
    v_now := clock_timestamp();

    IF v_existing.requesting_member_id
         IS DISTINCT FROM v_context.requesting_member_id

       OR v_existing.requester_origin_location_reference_id
         IS DISTINCT FROM
           v_context.requester_origin_location_reference_id

       OR v_existing.requester_destination_location_reference_id
         IS DISTINCT FROM
           v_context.requester_destination_location_reference_id

       OR v_existing.offering_member_id
         IS DISTINCT FROM v_context.offering_member_id

       OR v_existing.offering_movement_intent_id
         IS DISTINCT FROM
           v_context.offering_movement_intent_id

       OR v_existing.offering_intent_version
         IS DISTINCT FROM
           v_context.offering_intent_version

       OR v_existing.route_evidence_version
         IS DISTINCT FROM
           v_context.route_evidence_version

       OR v_existing.evidence_schema_version
         IS DISTINCT FROM
           'trusted_route_match_evidence_v1'

       OR v_existing.algorithm_version
         IS DISTINCT FROM
           'route_match_geometry_v1'

       OR v_existing.requester_origin_distance_to_route_meters
         IS DISTINCT FROM
           p_requester_origin_distance_to_route_meters

       OR v_existing.requester_destination_distance_to_route_meters
         IS DISTINCT FROM
           p_requester_destination_distance_to_route_meters

       OR v_existing.calculated_route_shape_length_meters
         IS DISTINCT FROM
           p_calculated_route_shape_length_meters

       OR v_existing.requester_origin_position_along_route_meters
         IS DISTINCT FROM
           p_requester_origin_position_along_route_meters

       OR v_existing.requester_destination_position_along_route_meters
         IS DISTINCT FROM
           p_requester_destination_position_along_route_meters

       OR v_existing.requester_origin_closest_route_latitude
         IS DISTINCT FROM
           p_requester_origin_closest_route_latitude

       OR v_existing.requester_origin_closest_route_longitude
         IS DISTINCT FROM
           p_requester_origin_closest_route_longitude

       OR v_existing.requester_destination_closest_route_latitude
         IS DISTINCT FROM
           p_requester_destination_closest_route_latitude

       OR v_existing.requester_destination_closest_route_longitude
         IS DISTINCT FROM
           p_requester_destination_closest_route_longitude

       OR v_existing.route_order
         IS DISTINCT FROM v_route_order

       OR v_existing.calculated_at
         IS DISTINCT FROM p_calculated_at

       OR v_existing.expires_at
         IS DISTINCT FROM v_effective_expires_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match replay does not match recorded evidence';
    END IF;


    IF v_existing.status <> 'current'
       OR (
         v_existing.expires_at IS NOT NULL
         AND v_existing.expires_at <= v_now
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match replay belongs to stale evidence';
    END IF;


    PERFORM
      private.assert_trusted_route_match_evidence(
        v_existing.id
      );


    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.version,
      v_existing.status,
      v_existing.expires_at;

    RETURN;
  END IF;


  SELECT
    COALESCE(MAX(e.version), 0) + 1
  INTO v_next_version
  FROM private.trusted_route_match_evidence e
  WHERE e.movement_need_id = p_movement_need_id
    AND e.offering_movement_intent_id =
      v_context.offering_movement_intent_id;


  UPDATE private.trusted_route_match_evidence e
  SET status = 'superseded'
  WHERE e.movement_need_id = p_movement_need_id
    AND e.offering_movement_intent_id =
      v_context.offering_movement_intent_id
    AND e.status = 'current';


  INSERT INTO private.trusted_route_match_evidence (
    movement_need_id,

    requesting_member_id,

    requester_origin_location_reference_id,
    requester_destination_location_reference_id,

    offering_member_id,
    offering_movement_intent_id,
    offering_intent_version,

    route_evidence_id,
    route_evidence_version,

    version,
    evidence_schema_version,
    algorithm_version,

    requester_origin_distance_to_route_meters,
    requester_destination_distance_to_route_meters,

    calculated_route_shape_length_meters,

    requester_origin_position_along_route_meters,
    requester_destination_position_along_route_meters,

    requester_origin_closest_route_latitude,
    requester_origin_closest_route_longitude,

    requester_destination_closest_route_latitude,
    requester_destination_closest_route_longitude,

    route_order,

    calculated_at,
    expires_at,
    status
  )
  VALUES (
    p_movement_need_id,

    v_context.requesting_member_id,

    v_context.requester_origin_location_reference_id,
    v_context.requester_destination_location_reference_id,

    v_context.offering_member_id,
    v_context.offering_movement_intent_id,
    v_context.offering_intent_version,

    v_context.route_evidence_id,
    v_context.route_evidence_version,

    v_next_version,
    'trusted_route_match_evidence_v1',
    'route_match_geometry_v1',

    p_requester_origin_distance_to_route_meters,
    p_requester_destination_distance_to_route_meters,

    p_calculated_route_shape_length_meters,

    p_requester_origin_position_along_route_meters,
    p_requester_destination_position_along_route_meters,

    p_requester_origin_closest_route_latitude,
    p_requester_origin_closest_route_longitude,

    p_requester_destination_closest_route_latitude,
    p_requester_destination_closest_route_longitude,

    v_route_order,

    p_calculated_at,
    v_effective_expires_at,
    'current'
  )
  RETURNING id
  INTO v_new_id;


  PERFORM
    private.assert_trusted_route_match_evidence(
      v_new_id
    );


  -- Drain the deferred INSERT validator while this newly created
  -- version is still current. A later call in the same
  -- transaction may legitimately supersede it.
  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    IMMEDIATE;

  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  RETURN QUERY
  SELECT
    e.id,
    e.version,
    e.status,
    e.expires_at
  FROM private.trusted_route_match_evidence e
  WHERE e.id = v_new_id;
END;
$record_trusted_route_match_evidence$;


REVOKE ALL
ON FUNCTION public.record_trusted_route_match_evidence_for_server(
  uuid,
  uuid,
  uuid,
  integer,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  numeric,
  numeric,
  numeric,
  numeric,
  timestamptz,
  timestamptz
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION public.record_trusted_route_match_evidence_for_server(
  uuid,
  uuid,
  uuid,
  integer,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  numeric,
  numeric,
  numeric,
  numeric,
  timestamptz,
  timestamptz
)
TO service_role;


COMMIT;