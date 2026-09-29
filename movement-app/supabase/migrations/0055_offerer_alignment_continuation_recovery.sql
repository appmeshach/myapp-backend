BEGIN;

-- WE DO NOT CREATE JOURNEYS. Read already-materialized accepted alignments only.
CREATE FUNCTION public.list_my_offerer_movement_continuations(p_limit integer DEFAULT 20)
RETURNS TABLE (
  movement_need_id uuid,
  alignment_status text,
  origin_area text,
  destination_area text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $continuations$
DECLARE
  v_member_id uuid := auth.uid();
BEGIN
  IF v_member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members m WHERE m.id = v_member_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Continuation limit must be between 1 and 50';
  END IF;

  -- Never fall back to precise movement_needs labels. Broad mappings remain
  -- useful after a need closes or its original discovery deadline elapses.
  RETURN QUERY
  SELECT a.movement_need_id, a.status,
    od.discovery_area_label, dd.discovery_area_label, a.created_at
  FROM public.alignments a
  JOIN private.movement_need_locations ol
    ON ol.movement_need_id = a.movement_need_id AND ol.role = 'origin'
  JOIN private.trusted_location_discovery_areas od
    ON od.resolved_location_reference_id = ol.location_reference_id
  JOIN private.movement_need_locations dl
    ON dl.movement_need_id = a.movement_need_id AND dl.role = 'destination'
  JOIN private.trusted_location_discovery_areas dd
    ON dd.resolved_location_reference_id = dl.location_reference_id
  WHERE a.offering_member_id = v_member_id
    AND a.status IN ('awaiting_activation_payment', 'activated')
  ORDER BY a.created_at DESC, a.movement_need_id DESC
  LIMIT p_limit;
END;
$continuations$;

REVOKE ALL ON FUNCTION public.list_my_offerer_movement_continuations(integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_offerer_movement_continuations(integer)
TO authenticated;

COMMIT;
