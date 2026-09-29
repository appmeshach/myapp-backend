BEGIN;

-- WE DO NOT CREATE JOURNEYS. Recover existing, actually started movements only.
CREATE FUNCTION public.list_my_active_movement_continuations(p_limit integer DEFAULT 20)
RETURNS TABLE (movement_need_id uuid, origin_area text, destination_area text, started_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $active_movements$
DECLARE
  v_member_id uuid := auth.uid();
BEGIN
  IF v_member_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = v_member_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Recovery limit must be between 1 and 50';
  END IF;
  RETURN QUERY
  SELECT a.movement_need_id, od.discovery_area_label, dd.discovery_area_label, c.began_at
  FROM public.alignments a
  CROSS JOIN LATERAL private.movement_coordination_context(a.movement_need_id, false) c
  JOIN private.movement_need_locations ol ON ol.movement_need_id = a.movement_need_id AND ol.role = 'origin'
  JOIN private.trusted_location_discovery_areas od ON od.resolved_location_reference_id = ol.location_reference_id
  JOIN private.movement_need_locations dl ON dl.movement_need_id = a.movement_need_id AND dl.role = 'destination'
  JOIN private.trusted_location_discovery_areas dd ON dd.resolved_location_reference_id = dl.location_reference_id
  WHERE (a.offering_member_id = v_member_id OR a.member_needing_movement_id = v_member_id)
    AND a.status = 'in_progress'
    AND c.alignment_id = a.id AND c.journey_status = 'in_progress'
    AND c.began_at IS NOT NULL AND isfinite(c.began_at)
  ORDER BY c.began_at DESC, a.movement_need_id DESC
  LIMIT p_limit;
END;
$active_movements$;

REVOKE ALL ON FUNCTION public.list_my_active_movement_continuations(integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_active_movement_continuations(integer) TO authenticated;

COMMIT;
