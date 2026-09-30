BEGIN;

-- =========================================================
-- 0062 Trusted pricing-classification context
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- This boundary exposes the exact live trusted route-match
-- geometry required by a future transport-geography classifier.
--
-- It does NOT:
-- - classify roads;
-- - calculate pricing corridor distance;
-- - create geographic events;
-- - calculate money;
-- - create pricing quotes;
-- - write pricing geography evidence;
-- - create financial proposals or agreements;
-- - expose this context to the application client.
--
-- The future classifier must consume this exact context and
-- submit its normalized result through the existing 0060
-- record_pricing_geography_evidence_for_server boundary.

CREATE FUNCTION
public.get_pricing_classification_context_for_server(
  p_route_match_evidence_id uuid,
  p_expected_route_match_evidence_version integer,
  p_expected_route_evidence_id uuid,
  p_expected_route_evidence_version integer
)
RETURNS TABLE (
  route_match_evidence_id uuid,
  route_match_evidence_version integer,

  movement_need_id uuid,

  offering_movement_intent_id uuid,
  offering_intent_version integer,

  route_evidence_id uuid,
  route_evidence_version integer,

  route_shape_format text,
  route_shape jsonb,

  calculated_route_shape_length_meters bigint,

  requester_origin_position_along_route_meters bigint,
  requester_destination_position_along_route_meters bigint,

  requester_origin_closest_route_latitude numeric,
  requester_origin_closest_route_longitude numeric,

  requester_destination_closest_route_latitude numeric,
  requester_destination_closest_route_longitude numeric,

  route_order text,

  route_match_evidence_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $pricing_classification_context$
DECLARE
  v_match
    private.trusted_route_match_evidence%ROWTYPE;

  v_route
    private.offering_route_evidence%ROWTYPE;
BEGIN
  IF p_route_match_evidence_id IS NULL
     OR p_expected_route_match_evidence_version IS NULL
     OR p_expected_route_evidence_id IS NULL
     OR p_expected_route_evidence_version IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Complete pricing classification source identity required';
  END IF;

  IF p_expected_route_match_evidence_version < 1
     OR p_expected_route_evidence_version < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Invalid pricing classification source version';
  END IF;

  /*
   * Preliminary lookup discovers only the exact evidence row.
   * The existing trusted-route-match assertion owns canonical
   * matching eligibility and its reviewed dependency checks.
   */
  SELECT e.*
  INTO v_match
  FROM private.trusted_route_match_evidence e
  WHERE e.id = p_route_match_evidence_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Exact trusted route-match evidence unavailable';
  END IF;

  IF v_match.version
       IS DISTINCT FROM
         p_expected_route_match_evidence_version
     OR v_match.route_evidence_id
       IS DISTINCT FROM
         p_expected_route_evidence_id
     OR v_match.route_evidence_version
       IS DISTINCT FROM
         p_expected_route_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Pricing classification source identity or version mismatch';
  END IF;

  /*
   * Reuse the canonical trusted matching assertion.
   * Do not create a second weaker matching validator here.
   */
  PERFORM
    private.assert_trusted_route_match_evidence(
      p_route_match_evidence_id
    );

  /*
   * Lock and re-read the exact route-match evidence after
   * canonical validation so a caller cannot classify stale
   * evidence after waiting on concurrent lifecycle work.
   */
  SELECT e.*
  INTO STRICT v_match
  FROM private.trusted_route_match_evidence e
  WHERE e.id = p_route_match_evidence_id
  FOR SHARE;

  IF v_match.version
       IS DISTINCT FROM
         p_expected_route_match_evidence_version
     OR v_match.route_evidence_id
       IS DISTINCT FROM
         p_expected_route_evidence_id
     OR v_match.route_evidence_version
       IS DISTINCT FROM
         p_expected_route_evidence_version
     OR v_match.status IS DISTINCT FROM 'current'
     OR (
       v_match.expires_at IS NOT NULL
       AND v_match.expires_at <= clock_timestamp()
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Pricing classification source became stale';
  END IF;

  /*
   * Read the exact route evidence already bound to the match.
   * Provider route distance is intentionally NOT returned as
   * pricing corridor distance.
   */
  SELECT r.*
  INTO STRICT v_route
  FROM private.offering_route_evidence r
  WHERE r.id = v_match.route_evidence_id
  FOR SHARE;

  IF v_route.version
       IS DISTINCT FROM
         v_match.route_evidence_version
     OR v_route.id
       IS DISTINCT FROM
         p_expected_route_evidence_id
     OR v_route.version
       IS DISTINCT FROM
         p_expected_route_evidence_version
     OR v_route.status IS DISTINCT FROM 'current'
     OR (
       v_route.expires_at IS NOT NULL
       AND v_route.expires_at <= clock_timestamp()
     )
     OR v_route.route_shape_format
       IS DISTINCT FROM
         'geojson_linestring_v1'
     OR v_route.route_shape IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Exact trusted pricing classification route unavailable';
  END IF;

  /*
   * One final canonical check after all local locks.
   */
  PERFORM
    private.assert_trusted_route_match_evidence(
      v_match.id
    );

  RETURN QUERY
  SELECT
    v_match.id,
    v_match.version,

    v_match.movement_need_id,

    v_match.offering_movement_intent_id,
    v_match.offering_intent_version,

    v_match.route_evidence_id,
    v_match.route_evidence_version,

    v_route.route_shape_format,
    v_route.route_shape,

    v_match.calculated_route_shape_length_meters,

    v_match.requester_origin_position_along_route_meters,
    v_match.requester_destination_position_along_route_meters,

    v_match.requester_origin_closest_route_latitude,
    v_match.requester_origin_closest_route_longitude,

    v_match.requester_destination_closest_route_latitude,
    v_match.requester_destination_closest_route_longitude,

    v_match.route_order,

    v_match.expires_at;
END;
$pricing_classification_context$;


REVOKE ALL
ON FUNCTION
public.get_pricing_classification_context_for_server(
  uuid,
  integer,
  uuid,
  integer
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION
public.get_pricing_classification_context_for_server(
  uuid,
  integer,
  uuid,
  integer
)
TO service_role;


COMMIT;
