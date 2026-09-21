BEGIN;

-- =========================================================
-- 0037 Trusted route-match evidence foundation
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- This private table records objective facts about how one
-- requester's trusted movement need relates to one offerer's
-- exact trusted route.
--
-- It does NOT:
-- - create a movement offer;
-- - create an alignment or journey;
-- - decide whether the offerer must serve the requester;
-- - define a maximum detour;
-- - reject a match because a requester is far from the route;
-- - represent human willingness or agreement.
--
-- Distances and route positions are evidence for later human
-- decision-making.
--
-- movement_need_id intentionally has no foreign key.
-- Existing movement_needs are historically deletable by their
-- owners, but historical route-match evidence must remain.

CREATE TABLE private.trusted_route_match_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  movement_need_id uuid NOT NULL,

  requesting_member_id uuid NOT NULL
    REFERENCES public.members(id),

  requester_origin_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  requester_destination_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  offering_member_id uuid NOT NULL
    REFERENCES public.members(id),

  offering_movement_intent_id uuid NOT NULL
    REFERENCES private.offering_movement_intents(id),

  offering_intent_version integer NOT NULL
    CHECK (offering_intent_version >= 1),

  route_evidence_id uuid NOT NULL
    REFERENCES private.offering_route_evidence(id),

  route_evidence_version integer NOT NULL
    CHECK (route_evidence_version >= 1),

  version integer NOT NULL
    CHECK (version >= 1),

  evidence_schema_version text NOT NULL
    CHECK (
      evidence_schema_version =
        'trusted_route_match_evidence_v1'
    ),

  algorithm_version text NOT NULL
    CHECK (
      algorithm_version =
        'route_match_geometry_v1'
    ),

  -- Straight-line/geodesic distance from the requester's
  -- trusted origin/destination to the closest calculated point
  -- on the offerer's trusted route shape.
  requester_origin_distance_to_route_meters bigint NOT NULL
    CHECK (
      requester_origin_distance_to_route_meters >= 0
    ),

  requester_destination_distance_to_route_meters bigint NOT NULL
    CHECK (
      requester_destination_distance_to_route_meters >= 0
    ),

  -- The route-shape length used by this calculation.
  -- This is calculation geometry, not a replacement for the
  -- provider's authoritative route_distance_meters stored on
  -- offering_route_evidence.
  calculated_route_shape_length_meters bigint NOT NULL
    CHECK (
      calculated_route_shape_length_meters > 0
    ),

  -- Position of each closest point measured from the beginning
  -- of the trusted route shape.
  requester_origin_position_along_route_meters bigint NOT NULL
    CHECK (
      requester_origin_position_along_route_meters >= 0
    ),

  requester_destination_position_along_route_meters bigint NOT NULL
    CHECK (
      requester_destination_position_along_route_meters >= 0
    ),

  -- Closest calculated route point for the requester origin.
  requester_origin_closest_route_latitude numeric NOT NULL
    CHECK (
      requester_origin_closest_route_latitude
        BETWEEN -90 AND 90
    ),

  requester_origin_closest_route_longitude numeric NOT NULL
    CHECK (
      requester_origin_closest_route_longitude
        BETWEEN -180 AND 180
    ),

  -- Closest calculated route point for the requester destination.
  requester_destination_closest_route_latitude numeric NOT NULL
    CHECK (
      requester_destination_closest_route_latitude
        BETWEEN -90 AND 90
    ),

  requester_destination_closest_route_longitude numeric NOT NULL
    CHECK (
      requester_destination_closest_route_longitude
        BETWEEN -180 AND 180
    ),

  -- Objective ordering of the two closest route positions.
  -- This is informational evidence. It is not an automatic
  -- rejection or acceptance decision.
  route_order text NOT NULL
    CHECK (
      route_order IN (
        'forward',
        'same_position',
        'reverse'
      )
    ),

  calculated_at timestamptz NOT NULL
    CHECK (isfinite(calculated_at)),

  created_at timestamptz NOT NULL
    DEFAULT clock_timestamp()
    CHECK (isfinite(created_at)),

  expires_at timestamptz
    CHECK (isfinite(expires_at)),

  status text NOT NULL DEFAULT 'current'
    CHECK (
      status IN (
        'current',
        'superseded',
        'expired'
      )
    ),

  UNIQUE (
    movement_need_id,
    offering_movement_intent_id,
    version
  ),

  UNIQUE (
    movement_need_id,
    route_evidence_id,
    algorithm_version
  ),

  CHECK (
    requesting_member_id <> offering_member_id
  ),

  CHECK (
    requester_origin_location_reference_id
      <> requester_destination_location_reference_id
  ),

  CHECK (
    requester_origin_position_along_route_meters
      <= calculated_route_shape_length_meters
  ),

  CHECK (
    requester_destination_position_along_route_meters
      <= calculated_route_shape_length_meters
  ),

  CHECK (
    (
      route_order = 'forward'
      AND requester_origin_position_along_route_meters
            < requester_destination_position_along_route_meters
    )
    OR
    (
      route_order = 'same_position'
      AND requester_origin_position_along_route_meters
            = requester_destination_position_along_route_meters
    )
    OR
    (
      route_order = 'reverse'
      AND requester_origin_position_along_route_meters
            > requester_destination_position_along_route_meters
    )
  ),

  CHECK (
    calculated_at <= created_at
  ),

  CHECK (
    expires_at IS NULL
    OR expires_at > calculated_at
  )
);


-- Only one route-match evidence version may be current for the
-- same requester need and offering movement intent.
CREATE UNIQUE INDEX
trusted_route_match_evidence_one_current
ON private.trusted_route_match_evidence (
  movement_need_id,
  offering_movement_intent_id
)
WHERE status = 'current';


ALTER TABLE private.trusted_route_match_evidence
ENABLE ROW LEVEL SECURITY;


REVOKE ALL
ON private.trusted_route_match_evidence
FROM PUBLIC, anon, authenticated, service_role;


-- The application client receives no direct access.
-- Trusted backend code may inspect evidence.
GRANT SELECT
ON private.trusted_route_match_evidence
TO service_role;


-- =========================================================
-- Cross-table trusted-context validation
-- =========================================================
--
-- This assertion does not calculate geographic facts.
-- It proves that a stored route-match evidence row is bound
-- to the exact trusted requester need, requester endpoints,
-- offerer movement intent, intent version, route evidence,
-- route version and members supplied by the trusted matching
-- context.
--
-- The existing trusted matching-context function owns the
-- reviewed lock order and eligibility checks. Reuse it rather
-- than creating a second competing matching-context validator.

CREATE FUNCTION
private.assert_trusted_route_match_evidence(
  p_evidence_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_trusted_route_match_evidence$
DECLARE
  v_evidence
    private.trusted_route_match_evidence%ROWTYPE;

  v_context record;

  v_requester_origin_expires_at timestamptz;
  v_requester_destination_expires_at timestamptz;
  v_offering_intent_expires_at timestamptz;
BEGIN
  SELECT e.*
  INTO STRICT v_evidence
  FROM private.trusted_route_match_evidence e
  WHERE e.id = p_evidence_id;


  IF v_evidence.status <> 'current'
     OR (
       v_evidence.expires_at IS NOT NULL
       AND v_evidence.expires_at <= clock_timestamp()
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence is not current and unexpired';
  END IF;


  SELECT c.*
  INTO STRICT v_context
  FROM public.get_trusted_matching_context_for_server(
    v_evidence.movement_need_id,
    v_evidence.offering_movement_intent_id,
    v_evidence.offering_member_id
  ) c;


  IF v_context.requesting_member_id
       <> v_evidence.requesting_member_id
     OR v_context.requester_origin_location_reference_id
       <> v_evidence.requester_origin_location_reference_id
     OR v_context.requester_destination_location_reference_id
       <> v_evidence.requester_destination_location_reference_id
     OR v_context.offering_member_id
       <> v_evidence.offering_member_id
     OR v_context.offering_movement_intent_id
       <> v_evidence.offering_movement_intent_id
     OR v_context.offering_intent_version
       <> v_evidence.offering_intent_version
     OR v_context.route_evidence_id
       <> v_evidence.route_evidence_id
     OR v_context.route_evidence_version
       <> v_evidence.route_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence does not match trusted matching context';
  END IF;


  IF v_evidence.calculated_at
       < v_context.route_generated_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence predates its trusted route evidence';
  END IF;


  SELECT lr.expires_at
  INTO STRICT v_requester_origin_expires_at
  FROM private.movement_location_references lr
  WHERE lr.id =
    v_evidence.requester_origin_location_reference_id;


  SELECT lr.expires_at
  INTO STRICT v_requester_destination_expires_at
  FROM private.movement_location_references lr
  WHERE lr.id =
    v_evidence.requester_destination_location_reference_id;


  SELECT i.expires_at
  INTO STRICT v_offering_intent_expires_at
  FROM private.offering_movement_intents i
  WHERE i.id =
    v_evidence.offering_movement_intent_id;


  IF (
       v_requester_origin_expires_at IS NOT NULL
       OR v_requester_destination_expires_at IS NOT NULL
       OR v_offering_intent_expires_at IS NOT NULL
       OR v_context.route_expires_at IS NOT NULL
     )
     AND v_evidence.expires_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence expiry exceeds a trusted dependency';
  END IF;


  IF v_evidence.expires_at IS NOT NULL
     AND (
       (
         v_requester_origin_expires_at IS NOT NULL
         AND v_evidence.expires_at
               > v_requester_origin_expires_at
       )
       OR (
         v_requester_destination_expires_at IS NOT NULL
         AND v_evidence.expires_at
               > v_requester_destination_expires_at
       )
       OR (
         v_offering_intent_expires_at IS NOT NULL
         AND v_evidence.expires_at
               > v_offering_intent_expires_at
       )
       OR (
         v_context.route_expires_at IS NOT NULL
         AND v_evidence.expires_at
               > v_context.route_expires_at
       )
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence expiry exceeds a trusted dependency';
  END IF;
END;
$assert_trusted_route_match_evidence$;


REVOKE ALL
ON FUNCTION
private.assert_trusted_route_match_evidence(uuid)
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION
private.validate_trusted_route_match_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $validate_trusted_route_match_evidence$
BEGIN
  PERFORM
    private.assert_trusted_route_match_evidence(
      NEW.id
    );

  RETURN NULL;
END;
$validate_trusted_route_match_evidence$;


REVOKE ALL
ON FUNCTION
private.validate_trusted_route_match_evidence()
FROM PUBLIC, anon, authenticated, service_role;


CREATE CONSTRAINT TRIGGER trusted_route_match_evidence_complete
AFTER INSERT
ON private.trusted_route_match_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION
private.validate_trusted_route_match_evidence();


-- =========================================================
-- Immutable evidence/history protection
-- =========================================================

CREATE FUNCTION
private.protect_trusted_route_match_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect_trusted_route_match_evidence$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence history cannot be deleted';
  END IF;


  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'current' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match evidence must start current';
    END IF;


    IF NEW.created_at > clock_timestamp()
       OR NEW.calculated_at > clock_timestamp()
       OR (
         NEW.expires_at IS NOT NULL
         AND NEW.expires_at <= clock_timestamp()
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match evidence timestamps are invalid';
    END IF;


    RETURN NEW;
  END IF;


  -- Evidence facts are immutable.
  -- Only lifecycle status may change.
  IF (
    to_jsonb(NEW) - 'status'
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - 'status'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence fields are immutable';
  END IF;


  IF OLD.status <> 'current'
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence lifecycle cannot reopen';
  END IF;


  IF NEW.status NOT IN (
    'superseded',
    'expired'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence lifecycle transition is invalid';
  END IF;


  IF NEW.status = 'expired'
     AND (
       NEW.expires_at IS NULL
       OR NEW.expires_at > clock_timestamp()
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence expiry has not elapsed';
  END IF;


  RETURN NEW;
END;
$protect_trusted_route_match_evidence$;


REVOKE ALL
ON FUNCTION
private.protect_trusted_route_match_evidence()
FROM PUBLIC, anon, authenticated, service_role;


CREATE TRIGGER protect_trusted_route_match_evidence
BEFORE INSERT OR UPDATE OR DELETE
ON private.trusted_route_match_evidence
FOR EACH ROW
EXECUTE FUNCTION
private.protect_trusted_route_match_evidence();


COMMIT;