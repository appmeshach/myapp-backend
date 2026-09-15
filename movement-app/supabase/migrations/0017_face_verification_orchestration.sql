BEGIN;

-- Service-only bridge for an authenticated server. p_member_id must come from
-- verified Auth, never request JSON. Private tables remain unexposed to clients.
CREATE FUNCTION public.start_movement_face_verification_for_server(
  p_movement_need_id uuid, p_member_id uuid, p_provider text, p_provider_reference text
)
RETURNS TABLE (session_id uuid, media_id uuid, storage_path text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_alignment uuid; v_session uuid;
BEGIN
  SELECT a.id INTO v_alignment FROM public.alignments a
  WHERE a.movement_need_id=p_movement_need_id AND a.status='awaiting_activation_payment'
    AND EXISTS (SELECT 1 FROM private.required_face_members(a.id) r WHERE r.member_id=p_member_id);
  IF v_alignment IS NULL OR (SELECT count(*) FROM public.alignments a
    WHERE a.movement_need_id=p_movement_need_id AND a.status='awaiting_activation_payment')<>1 THEN
    RAISE EXCEPTION 'Verification unavailable';
  END IF;
  -- Installed 0016 rechecks state, participant eligibility and ready provenance
  -- under its alignment/member locks and binds the exact current media.
  v_session:=public.start_alignment_face_verification_for_server(
    v_alignment,p_member_id,p_provider,p_provider_reference);
  RETURN QUERY SELECT f.id,f.media_id,mm.storage_path,f.expires_at
    FROM private.alignment_face_verifications f JOIN public.member_media mm ON mm.id=f.media_id
    WHERE f.id=v_session;
END;
$$;
REVOKE ALL ON FUNCTION public.start_movement_face_verification_for_server(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_movement_face_verification_for_server(uuid,uuid,text,text) TO service_role;

-- The provider adapter authenticates the raw callback before this call and
-- checks that its echoed media binding matches the server-provided start data.
-- No callback payloads/templates are stored. The existing unique provider/ref
-- constraint binds callbacks to exactly one database-created session.
CREATE FUNCTION public.complete_face_verification_callback_for_server(
  p_provider text,p_provider_reference text,p_matched_media_id uuid,
  p_liveness_passed boolean,p_face_match_passed boolean
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE f private.alignment_face_verifications%ROWTYPE;
BEGIN
  SELECT * INTO f FROM private.alignment_face_verifications s
    WHERE s.provider=p_provider AND s.provider_reference=p_provider_reference;
  IF NOT FOUND THEN RAISE EXCEPTION 'Callback unavailable'; END IF;
  -- Match 0016 lock order; concurrent callbacks serialize before result checks.
  PERFORM 1 FROM public.alignments WHERE id=f.alignment_id FOR UPDATE;
  PERFORM 1 FROM public.members WHERE id=f.member_id FOR UPDATE;
  SELECT * INTO f FROM private.alignment_face_verifications WHERE id=f.id FOR UPDATE;
  IF p_matched_media_id IS DISTINCT FROM f.media_id
    OR p_liveness_passed IS NULL OR p_face_match_passed IS NULL THEN
    RAISE EXCEPTION 'Callback unavailable';
  END IF;
  IF f.status IN ('succeeded','failed') THEN
    IF f.liveness_passed IS DISTINCT FROM p_liveness_passed
      OR f.face_match_passed IS DISTINCT FROM p_face_match_passed THEN
      RAISE EXCEPTION 'Callback unavailable';
    END IF;
    -- Acknowledge the recorded fact, without re-verifying media, extending expiry,
    -- restoring readiness or changing history even after activation/replacement.
    RETURN f.status;
  END IF;
  IF f.status<>'pending' THEN RAISE EXCEPTION 'Callback unavailable'; END IF;
  PERFORM public.complete_alignment_face_verification_for_server(
    f.id,p_matched_media_id,p_liveness_passed,p_face_match_passed);
  SELECT status INTO f.status FROM private.alignment_face_verifications WHERE id=f.id;
  RETURN f.status;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_face_verification_callback_for_server(text,text,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_face_verification_callback_for_server(text,text,uuid,boolean,boolean) TO service_role;

COMMIT;
