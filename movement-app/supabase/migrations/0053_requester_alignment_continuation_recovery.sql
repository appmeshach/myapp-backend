BEGIN;

-- Accepted lifecycle state survives closed needs and elapsed departure deadlines.
CREATE OR REPLACE FUNCTION public.get_my_requester_movement_continuation()
RETURNS TABLE (
  movement_need_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $requester_continuation$
DECLARE
  v_member_id uuid;
BEGIN
  v_member_id := auth.uid();
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
  SELECT a.movement_need_id
  FROM public.alignments AS a
  WHERE a.member_needing_movement_id = v_member_id
    AND a.status IN ('awaiting_activation_payment', 'activated')
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 1;
END;
$requester_continuation$;

REVOKE ALL
ON FUNCTION public.get_my_requester_movement_continuation()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.get_my_requester_movement_continuation()
TO authenticated;

COMMIT;
