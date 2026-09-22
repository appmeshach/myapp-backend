BEGIN;

-- =========================================================
-- Trusted masked movement discovery
-- =========================================================
-- Supersedes the discovery function introduced in 0003.
--
-- Discovery must expose only server-derived trusted broad-area labels.
-- Precise movement_needs origin/destination labels are not discovery data.
--
-- A movement need is discoverable through this RPC only when both its
-- origin and destination bindings have trusted discovery-area evidence.
-- There is intentionally no fallback to movement_needs.origin_area or
-- movement_needs.destination_area.

CREATE OR REPLACE FUNCTION public.discover_masked_movement_needs(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  movement_need_id uuid,
  origin_area text,
  destination_area text,
  earliest_departure_at timestamptz,
  latest_departure_at timestamptz,
  people_count integer,
  age integer,
  common_movement_area text,
  identity_verified boolean,
  profile_media_verified boolean,
  completed_movements integer,
  rating numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trusted_masked_discovery$
DECLARE
  v_member_id uuid;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_limit IS NULL THEN
    RAISE EXCEPTION 'p_limit is required';
  END IF;

  IF p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 50';
  END IF;

  RETURN QUERY
  SELECT
    mn.id AS movement_need_id,
    origin_discovery.discovery_area_label AS origin_area,
    destination_discovery.discovery_area_label AS destination_area,
    mn.earliest_departure_at,
    mn.latest_departure_at,
    mn.people_count,
    CASE
      WHEN m.date_of_birth IS NOT NULL THEN
        EXTRACT(
          YEAR FROM age(
            CURRENT_DATE,
            m.date_of_birth
          )
        )::integer
      ELSE NULL
    END AS age,
    m.common_movement_area,
    m.identity_verified,
    m.profile_media_verified,
    m.completed_movements,
    m.rating
  FROM public.movement_needs AS mn
  INNER JOIN public.members AS m
    ON m.id = mn.member_id
  INNER JOIN private.movement_need_locations AS origin_binding
    ON origin_binding.movement_need_id = mn.id
    AND origin_binding.role = 'origin'
  INNER JOIN private.trusted_location_discovery_areas AS origin_discovery
    ON origin_discovery.resolved_location_reference_id =
      origin_binding.location_reference_id
  INNER JOIN private.movement_need_locations AS destination_binding
    ON destination_binding.movement_need_id = mn.id
    AND destination_binding.role = 'destination'
  INNER JOIN private.trusted_location_discovery_areas AS destination_discovery
    ON destination_discovery.resolved_location_reference_id =
      destination_binding.location_reference_id
  WHERE mn.status = 'discoverable'
    AND mn.member_id <> v_member_id
  ORDER BY
    mn.earliest_departure_at ASC,
    mn.created_at ASC
  LIMIT p_limit;
END;
$trusted_masked_discovery$;

REVOKE ALL
ON FUNCTION public.discover_masked_movement_needs(integer)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.discover_masked_movement_needs(integer)
TO authenticated;

COMMIT;