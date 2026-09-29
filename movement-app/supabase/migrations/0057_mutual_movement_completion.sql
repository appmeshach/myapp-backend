BEGIN;

-- The reveal context intentionally hides cancelled movements. Resolve the two
-- principals separately so 0019's authenticated no-travel receipt stays readable.
-- Count all mappings before filtering; never silently choose among alignments.
-- Locks are read-only and always journey then alignment, matching 0019.
CREATE FUNCTION private.movement_end_context(p_movement_need_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; selected_id uuid; selected_alignment uuid; a public.alignments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  SELECT array_agg(j.id) INTO ids FROM public.journeys j
    JOIN public.alignments x ON x.id=j.alignment_id WHERE x.movement_need_id=p_movement_need_id;
  IF cardinality(ids) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  selected_id:=ids[1];
  IF NOT EXISTS (SELECT 1 FROM public.journeys j JOIN public.alignments x ON x.id=j.alignment_id
    WHERE j.id=selected_id AND auth.uid() IN (x.offering_member_id,x.member_needing_movement_id)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  SELECT j.alignment_id INTO selected_alignment FROM public.journeys j WHERE j.id=selected_id FOR UPDATE;
  SELECT x.* INTO a FROM public.alignments x WHERE x.id=selected_alignment FOR UPDATE;
  SELECT array_agg(j.id) INTO ids FROM public.journeys j
    JOIN public.alignments x ON x.id=j.alignment_id WHERE x.movement_need_id=p_movement_need_id;
  IF cardinality(ids) IS DISTINCT FROM 1 OR ids[1] IS DISTINCT FROM selected_id
    OR a.movement_need_id IS DISTINCT FROM p_movement_need_id
    OR auth.uid() NOT IN (a.offering_member_id,a.member_needing_movement_id)
    OR NOT (
      EXISTS (SELECT 1 FROM private.movement_coordination_context(p_movement_need_id,false) c
        WHERE c.journey_id=selected_id AND c.alignment_id=a.id)
      OR (a.status='cancelled' AND EXISTS (
        SELECT 1 FROM private.mutual_no_travel_closures n JOIN public.journeys j ON j.id=n.journey_id
        WHERE j.id=selected_id AND j.status='cancelled' AND j.started_at IS NULL AND j.completed_at IS NULL
          AND auth.uid() IN (n.first_principal_id,n.second_principal_id)))
    ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  RETURN selected_id;
END;
$$;
REVOKE ALL ON FUNCTION private.movement_end_context(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Exact end statuses are inherited from 0019: no_pending_end_request,
-- awaiting_other_member, action_required_from_me, completed, mutual_no_travel.
-- journey_state is not_started, in_progress, completed, or cancelled (no-travel only).
CREATE FUNCTION public.get_my_movement_end_status_by_need(p_movement_need_id uuid)
RETURNS TABLE (journey_state text, end_status text, requested_by_me boolean,
  action_required_from_me boolean, requested_at timestamptz, completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_id uuid;
BEGIN
  selected_id:=private.movement_end_context(p_movement_need_id);
  RETURN QUERY SELECT s.journey_status,s.end_status,s.requested_by_me,s.action_required_from_me,s.requested_at,s.completed_at
    FROM public.get_my_movement_end_status(selected_id) s;
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_movement_end_status_by_need(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_movement_end_status_by_need(uuid) TO authenticated;

CREATE FUNCTION public.request_my_movement_end(p_movement_need_id uuid, p_reason text DEFAULT NULL)
RETURNS TABLE (journey_state text, end_status text, requested_by_me boolean,
  action_required_from_me boolean, requested_at timestamptz, completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_id uuid;
BEGIN
  selected_id:=private.movement_end_context(p_movement_need_id);
  -- Legacy request can double as consent. Require a separate explicit confirm
  -- here; the context holds both locks so a concurrent request cannot bypass it.
  IF EXISTS (SELECT 1 FROM public.get_my_movement_end_status(selected_id) s WHERE s.action_required_from_me) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Confirm or decline the pending request';
  END IF;
  PERFORM * FROM public.request_movement_end(selected_id,p_reason);
  RETURN QUERY SELECT * FROM public.get_my_movement_end_status_by_need(p_movement_need_id);
END;
$$;
REVOKE ALL ON FUNCTION public.request_my_movement_end(uuid,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.request_my_movement_end(uuid,text) TO authenticated;

CREATE FUNCTION public.confirm_my_movement_end(p_movement_need_id uuid)
RETURNS TABLE (journey_state text, end_status text, requested_by_me boolean,
  action_required_from_me boolean, requested_at timestamptz, completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_id uuid;
BEGIN
  selected_id:=private.movement_end_context(p_movement_need_id);
  PERFORM * FROM public.confirm_movement_end(selected_id);
  RETURN QUERY SELECT * FROM public.get_my_movement_end_status_by_need(p_movement_need_id);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_my_movement_end(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_my_movement_end(uuid) TO authenticated;

CREATE FUNCTION public.decline_my_movement_end(p_movement_need_id uuid)
RETURNS TABLE (journey_state text, end_status text, requested_by_me boolean,
  action_required_from_me boolean, requested_at timestamptz, completed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE selected_id uuid;
BEGIN
  selected_id:=private.movement_end_context(p_movement_need_id);
  PERFORM * FROM public.decline_movement_end(selected_id);
  RETURN QUERY SELECT * FROM public.get_my_movement_end_status_by_need(p_movement_need_id);
END;
$$;
REVOKE ALL ON FUNCTION public.decline_my_movement_end(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_my_movement_end(uuid) TO authenticated;

COMMIT;
