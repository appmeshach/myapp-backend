BEGIN;

-- =========================================================
-- Masked movement discovery
-- =========================================================
-- This is the pre-alignment masked discovery layer.
-- It intentionally withholds identifying information while allowing an
-- authenticated member to judge whether a movement need is relevant.
-- The movement_need_id is returned because later secure offer RPCs will
-- reference the need directly. Deeper route and compatibility ranking will be
-- added in a later phase after the privacy model is settled.

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
AS $$
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
    mn.origin_area,
    mn.destination_area,
    mn.earliest_departure_at,
    mn.latest_departure_at,
    mn.people_count,
    CASE
      WHEN m.date_of_birth IS NOT NULL THEN
        EXTRACT(YEAR FROM age(CURRENT_DATE, m.date_of_birth))::integer
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
  WHERE mn.status = 'discoverable'
    AND mn.member_id <> v_member_id
  ORDER BY
    mn.earliest_departure_at ASC,
    mn.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.discover_masked_movement_needs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discover_masked_movement_needs(integer) TO authenticated;

COMMIT;
