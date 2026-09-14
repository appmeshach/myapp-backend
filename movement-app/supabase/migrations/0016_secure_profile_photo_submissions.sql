BEGIN;

-- Upload/processing is NOT verification. No biometric templates or provider
-- payloads are stored. The existing single Verified badge is unchanged.
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('profile-photo-submissions','profile-photo-submissions',false,5242880,
  ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public=false, file_size_limit=EXCLUDED.file_size_limit,
  allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE POLICY profile_photo_submissions_no_direct_client_objects
  ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING (bucket_id <> 'profile-photo-submissions') WITH CHECK (bucket_id <> 'profile-photo-submissions');
CREATE POLICY profile_photo_submissions_no_direct_client_bucket
  ON storage.buckets AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING (id <> 'profile-photo-submissions') WITH CHECK (id <> 'profile-photo-submissions');

-- Fail rather than silently selecting among existing duplicate current photos.
-- Any pre-existing duplicates require a reviewed data repair before application.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.member_media WHERE media_type='photo' AND is_current
    GROUP BY member_id HAVING count(*)>1) THEN
    RAISE EXCEPTION '0016 preflight failed: multiple current photos exist for a member'
      USING HINT='Run the read-only preflight in supabase/FACE_VERIFICATION.md and review data separately. No rows were repaired.';
  END IF;
END;
$$;
-- The unique index also catches writes racing the preflight above.
CREATE UNIQUE INDEX idx_member_media_one_current_photo_per_member
  ON public.member_media(member_id) WHERE media_type='photo' AND is_current;
REVOKE INSERT,UPDATE,DELETE ON public.member_media FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.members FROM PUBLIC,anon,authenticated;
REVOKE UPDATE (verified,is_current,storage_path) ON public.member_media FROM PUBLIC,anon,authenticated;
REVOKE UPDATE (identity_verified,profile_media_verified) ON public.members FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.valid_face_object_key(p_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(length(p_key) BETWEEN 1 AND 1024
    AND p_key !~ '[[:space:][:cntrl:]\\%?#:]'
    AND NOT EXISTS (SELECT 1 FROM unnest(string_to_array(p_key,'/')) s
      WHERE s IN ('','.','..')),false);
$$;
REVOKE ALL ON FUNCTION private.valid_face_object_key(text) FROM PUBLIC,anon,authenticated;

CREATE TABLE private.profile_photo_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  submission_storage_path text NOT NULL UNIQUE CHECK (private.valid_face_object_key(submission_storage_path)),
  submitted_mime_type text NOT NULL CHECK (submitted_mime_type IN ('image/jpeg','image/png','image/webp')),
  submitted_size_bytes bigint NOT NULL CHECK (submitted_size_bytes BETWEEN 1 AND 5242880),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed','superseded')),
  media_id uuid UNIQUE REFERENCES public.member_media(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz
);
CREATE INDEX profile_photo_submissions_member ON private.profile_photo_submissions(member_id,created_at DESC);
ALTER TABLE private.profile_photo_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.profile_photo_submissions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.profile_photo_submissions TO service_role;

CREATE TABLE private.alignment_face_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alignment_id uuid NOT NULL REFERENCES public.alignments(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.member_media(id),
  purpose text NOT NULL DEFAULT 'movement_activation' CHECK (purpose='movement_activation'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','expired','superseded')),
  provider text NOT NULL CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  provider_reference text NOT NULL CHECK (length(btrim(provider_reference)) BETWEEN 1 AND 255),
  liveness_passed boolean,
  face_match_passed boolean,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (provider,provider_reference),
  CHECK (expires_at > started_at AND expires_at <= started_at + interval '10 minutes'),
  CHECK (status <> 'succeeded' OR (liveness_passed IS TRUE AND face_match_passed IS TRUE
    AND completed_at IS NOT NULL AND completed_at >= started_at AND completed_at < expires_at))
);
CREATE INDEX alignment_face_verifications_lookup ON private.alignment_face_verifications(alignment_id,member_id);
ALTER TABLE private.alignment_face_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.alignment_face_verifications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.alignment_face_verifications TO service_role;

CREATE FUNCTION private.required_face_members(p_alignment_id uuid)
RETURNS TABLE (member_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.offering_member_id FROM public.alignments a WHERE a.id=p_alignment_id
  UNION SELECT a.member_needing_movement_id FROM public.alignments a WHERE a.id=p_alignment_id
  UNION SELECT mp.member_id FROM public.alignments a
  JOIN public.movement_participants mp ON mp.movement_need_id=a.movement_need_id
  WHERE a.id=p_alignment_id AND mp.status='confirmed' AND mp.role='invited_participant';
$$;
REVOKE ALL ON FUNCTION private.required_face_members(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.create_profile_photo_submission_for_server(
  p_member_id uuid,p_submission_storage_path text,p_submitted_mime_type text,p_submitted_size_bytes bigint
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM 1 FROM public.members WHERE id=p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  INSERT INTO private.profile_photo_submissions(member_id,submission_storage_path,submitted_mime_type,submitted_size_bytes)
  VALUES (p_member_id,p_submission_storage_path,p_submitted_mime_type,p_submitted_size_bytes) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_profile_photo_submission_for_server(uuid,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_profile_photo_submission_for_server(uuid,text,text,bigint) TO service_role;

-- Trusted worker stores sanitized, metadata-stripped bytes at a NEW immutable
-- key in verified-profile-photos. That bucket name does not confer verification:
-- 0014 delivers only rows which subsequently pass a trusted live face check.
CREATE FUNCTION public.prepare_profile_photo_submission_for_server(p_submission_id uuid,p_processed_storage_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_member uuid; v_submission private.profile_photo_submissions%ROWTYPE; v_media uuid;
BEGIN
  SELECT member_id INTO v_member FROM private.profile_photo_submissions WHERE id=p_submission_id;
  PERFORM 1 FROM public.members WHERE id=v_member FOR UPDATE;
  SELECT * INTO v_submission FROM private.profile_photo_submissions WHERE id=p_submission_id FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'pending' THEN RAISE EXCEPTION 'Submission is not pending'; END IF;
  IF NOT private.valid_face_object_key(p_processed_storage_path) THEN RAISE EXCEPTION 'Invalid processed photo key'; END IF;
  -- Serialize key allocation across members without imposing a new uniqueness
  -- constraint on historical media. Hash collisions only cause extra waiting.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_processed_storage_path,16));
  IF EXISTS (SELECT 1 FROM public.member_media WHERE storage_path=p_processed_storage_path) THEN
    RAISE EXCEPTION 'Processed photo key has already been used';
  END IF;
  UPDATE public.member_media SET is_current=false WHERE member_id=v_member AND media_type='photo' AND is_current;
  INSERT INTO public.member_media(member_id,media_type,storage_path,verified,is_current)
  VALUES (v_member,'photo',p_processed_storage_path,false,true) RETURNING id INTO v_media;
  UPDATE public.members SET profile_media_verified=false WHERE id=v_member;
  UPDATE private.profile_photo_submissions SET status='superseded' WHERE member_id=v_member AND status='ready';
  UPDATE private.profile_photo_submissions SET status='ready',media_id=v_media,processed_at=clock_timestamp() WHERE id=p_submission_id;
  -- Success is historical evidence. Exact-current-media readiness invalidates
  -- old successes without rewriting their result, timestamps or provider data.
  UPDATE private.alignment_face_verifications SET status='superseded' WHERE member_id=v_member AND status='pending';
  DELETE FROM private.post_activation_photo_tokens WHERE subject_member_id=v_member;
  RETURN v_media;
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_profile_photo_submission_for_server(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_profile_photo_submission_for_server(uuid,text) TO service_role;

CREATE FUNCTION public.fail_profile_photo_submission_for_server(p_submission_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE private.profile_photo_submissions SET status='failed',processed_at=clock_timestamp()
    WHERE id=p_submission_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Submission is not pending'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.fail_profile_photo_submission_for_server(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fail_profile_photo_submission_for_server(uuid) TO service_role;

CREATE FUNCTION public.start_alignment_face_verification_for_server(
  p_alignment_id uuid,p_member_id uuid,p_provider text,p_provider_reference text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_media uuid; v_id uuid; v_now timestamptz;
BEGIN
  PERFORM 1 FROM public.alignments WHERE id=p_alignment_id AND status='awaiting_activation_payment' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM private.required_face_members(p_alignment_id) r WHERE r.member_id=p_member_id) THEN
    RAISE EXCEPTION 'Face verification unavailable';
  END IF;
  PERFORM 1 FROM public.members WHERE id=p_member_id FOR UPDATE;
  -- Only prepare_profile_photo_submission_for_server establishes this binding.
  -- Successful live checks leave the submission ready, allowing later reuse.
  SELECT mm.id INTO v_media FROM public.member_media mm
    JOIN private.profile_photo_submissions ps ON ps.media_id=mm.id AND ps.member_id=mm.member_id
      AND ps.status='ready' AND ps.processed_at IS NOT NULL
    WHERE mm.member_id=p_member_id AND mm.media_type='photo' AND mm.is_current
    FOR SHARE OF ps;
  IF v_media IS NULL THEN RAISE EXCEPTION 'Prepared current face photo required'; END IF;
  UPDATE private.alignment_face_verifications SET status='superseded'
    WHERE alignment_id=p_alignment_id AND member_id=p_member_id AND status='pending';
  v_now:=clock_timestamp();
  INSERT INTO private.alignment_face_verifications(alignment_id,member_id,media_id,provider,provider_reference,started_at,expires_at)
  VALUES (p_alignment_id,p_member_id,v_media,p_provider,p_provider_reference,v_now,v_now+interval '10 minutes') RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.start_alignment_face_verification_for_server(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_alignment_face_verification_for_server(uuid,uuid,text,text) TO service_role;

-- Provider adapter must authenticate callbacks, bind the provider reference to
-- the session, and verify capture freshness. Never forward client booleans here.
-- Deadlines and member/media binding cannot be supplied or changed by a client.
CREATE FUNCTION public.complete_alignment_face_verification_for_server(
  p_session_id uuid,p_matched_media_id uuid,p_liveness_passed boolean,p_face_match_passed boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_session private.alignment_face_verifications%ROWTYPE; v_now timestamptz;
BEGIN
  SELECT * INTO v_session FROM private.alignment_face_verifications WHERE id=p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Face verification unavailable'; END IF;
  PERFORM 1 FROM public.alignments WHERE id=v_session.alignment_id AND status='awaiting_activation_payment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Face verification unavailable'; END IF;
  PERFORM 1 FROM public.members WHERE id=v_session.member_id FOR UPDATE;
  SELECT * INTO v_session FROM private.alignment_face_verifications WHERE id=p_session_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM private.required_face_members(v_session.alignment_id) r WHERE r.member_id=v_session.member_id)
    OR p_matched_media_id IS DISTINCT FROM v_session.media_id
    OR NOT EXISTS (SELECT 1 FROM public.member_media mm
      JOIN private.profile_photo_submissions ps ON ps.media_id=mm.id AND ps.member_id=mm.member_id
        AND ps.status='ready' AND ps.processed_at IS NOT NULL
      WHERE mm.id=v_session.media_id AND mm.member_id=v_session.member_id
        AND mm.media_type='photo' AND mm.is_current FOR SHARE OF ps) THEN
    RAISE EXCEPTION 'Face verification unavailable';
  END IF;
  IF p_liveness_passed IS NULL OR p_face_match_passed IS NULL THEN RAISE EXCEPTION 'Verification result required'; END IF;
  IF v_session.status='succeeded' AND p_liveness_passed AND p_face_match_passed THEN RETURN; END IF;
  IF v_session.status <> 'pending' THEN RAISE EXCEPTION 'Face verification is not pending'; END IF;
  v_now:=clock_timestamp();
  UPDATE private.alignment_face_verifications SET
    status=CASE WHEN expires_at<=v_now THEN 'expired'
      WHEN p_liveness_passed AND p_face_match_passed THEN 'succeeded' ELSE 'failed' END,
    liveness_passed=p_liveness_passed,face_match_passed=p_face_match_passed,completed_at=v_now
  WHERE id=p_session_id;
  IF v_now<v_session.expires_at AND p_liveness_passed AND p_face_match_passed THEN
    UPDATE public.member_media SET verified=true WHERE id=v_session.media_id;
    UPDATE public.members SET profile_media_verified=true WHERE id=v_session.member_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_alignment_face_verification_for_server(uuid,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_alignment_face_verification_for_server(uuid,uuid,boolean,boolean) TO service_role;

CREATE FUNCTION public.revoke_current_profile_photo_for_server(p_member_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.members WHERE id=p_member_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found'; END IF;
  UPDATE public.member_media SET verified=false,is_current=false WHERE member_id=p_member_id AND media_type='photo' AND is_current;
  UPDATE public.members SET profile_media_verified=false WHERE id=p_member_id;
  UPDATE private.alignment_face_verifications SET status='superseded' WHERE member_id=p_member_id AND status='pending';
  DELETE FROM private.post_activation_photo_tokens WHERE subject_member_id=p_member_id;
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_current_profile_photo_for_server(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_current_profile_photo_for_server(uuid) TO service_role;

CREATE FUNCTION private.has_current_alignment_face_check(p_alignment_id uuid,p_member_id uuid,p_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.alignment_face_verifications f
    JOIN public.member_media mm ON mm.id=f.media_id AND mm.member_id=f.member_id
      AND mm.media_type='photo' AND mm.is_current AND mm.verified
    JOIN private.profile_photo_submissions ps ON ps.media_id=mm.id AND ps.member_id=mm.member_id
      AND ps.status='ready' AND ps.processed_at IS NOT NULL
    JOIN public.members m ON m.id=f.member_id AND m.profile_media_verified
    WHERE f.alignment_id=p_alignment_id AND f.member_id=p_member_id
      AND f.status='succeeded' AND f.liveness_passed AND f.face_match_passed
      -- A newly started attempt replaces authorization, not historical evidence.
      AND f.id=(SELECT latest.id FROM private.alignment_face_verifications latest
        WHERE latest.alignment_id=f.alignment_id AND latest.member_id=f.member_id
        ORDER BY latest.started_at DESC,latest.id DESC LIMIT 1)
      AND f.completed_at<=p_at AND f.expires_at>p_at);
$$;
REVOKE ALL ON FUNCTION private.has_current_alignment_face_check(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;

-- Shared authoritative gate for payment initiation and final activation. Locks
-- are held until transaction end; time is read only AFTER any lock waiting.
CREATE FUNCTION private.assert_alignment_face_ready(p_alignment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_need uuid; v_member uuid; v_now timestamptz;
BEGIN
  SELECT movement_need_id INTO v_need FROM public.alignments
    WHERE id=p_alignment_id AND status='awaiting_activation_payment' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alignment is not awaiting activation payment'; END IF;
  PERFORM 1 FROM public.movement_needs WHERE id=v_need FOR UPDATE;
  FOR v_member IN SELECT r.member_id FROM private.required_face_members(p_alignment_id) r ORDER BY r.member_id LOOP
    PERFORM 1 FROM public.members WHERE id=v_member FOR UPDATE;
  END LOOP;
  v_now:=clock_timestamp();
  IF EXISTS (SELECT 1 FROM private.required_face_members(p_alignment_id) r
    WHERE NOT private.has_current_alignment_face_check(p_alignment_id,r.member_id,v_now)) THEN
    RAISE EXCEPTION 'Fresh face verification required for every movement participant';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_alignment_face_ready(uuid) FROM PUBLIC,anon,authenticated;

-- Cover trusted direct INSERT as well as RPC creation. Existing pending rows
-- are not removed: re-initiation through the RPC must recheck readiness too.
CREATE FUNCTION private.require_face_ready_payment_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status<>'pending' THEN RAISE EXCEPTION 'New activation payment must be pending'; END IF;
  PERFORM private.assert_alignment_face_ready(NEW.alignment_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_face_ready_payment_insert() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_face_ready_payment_insert BEFORE INSERT ON private.alignment_activation_payments
  FOR EACH ROW EXECUTE FUNCTION private.require_face_ready_payment_insert();

-- Preserve the 0007 signature, validation, pending-payment reuse and ACLs.
CREATE OR REPLACE FUNCTION public.create_alignment_activation_payment(
  p_alignment_id uuid,
  p_amount_minor bigint,
  p_currency text DEFAULT 'NGN',
  p_provider text DEFAULT NULL
)
RETURNS TABLE (
  payment_id uuid,
  alignment_id uuid,
  payment_status text,
  amount_minor bigint,
  currency text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alignment_record public.alignments%ROWTYPE;
  v_provider text;
  v_payment_id uuid;
  v_recorded_status text;
BEGIN
  SELECT *
  INTO v_alignment_record
  FROM public.alignments AS a
  WHERE a.id = p_alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  IF v_alignment_record.status <> 'awaiting_activation_payment' THEN
    RAISE EXCEPTION 'Alignment is not awaiting activation payment';
  END IF;

  -- Recheck even when returning an existing pending payment. Future provider
  -- initiation must occur only after this RPC succeeds and commits.
  PERFORM private.assert_alignment_face_ready(p_alignment_id);

  IF p_amount_minor IS NULL THEN
    RAISE EXCEPTION 'Amount is required';
  END IF;

  IF p_amount_minor < 0 THEN
    RAISE EXCEPTION 'Amount must be zero or greater';
  END IF;

  IF p_currency IS NULL OR trim(p_currency) = '' THEN
    RAISE EXCEPTION 'Currency is required';
  END IF;

  IF p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'Currency must be exactly three uppercase letters';
  END IF;

  v_provider := p_provider;
  IF v_provider IS NOT NULL THEN
    v_provider := trim(v_provider);
    IF v_provider = '' THEN
      v_provider := NULL;
    END IF;
    IF length(v_provider) > 100 THEN
      RAISE EXCEPTION 'Provider must be 100 characters or fewer';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.alignment_activation_payments AS ap
    WHERE ap.alignment_id = p_alignment_id
      AND ap.status = 'succeeded'
  ) THEN
    RAISE EXCEPTION 'This alignment already has a succeeded activation payment';
  END IF;

  SELECT ap.id, ap.status
  INTO v_payment_id, v_recorded_status
  FROM private.alignment_activation_payments AS ap
  WHERE ap.alignment_id = p_alignment_id
    AND ap.status = 'pending';

  IF FOUND THEN
    RETURN QUERY
    SELECT
      v_payment_id,
      p_alignment_id,
      v_recorded_status,
      ap.amount_minor,
      ap.currency
    FROM private.alignment_activation_payments AS ap
    WHERE ap.id = v_payment_id;
    RETURN;
  END IF;

  INSERT INTO private.alignment_activation_payments (
    alignment_id,
    payer_member_id,
    amount_minor,
    currency,
    status,
    provider,
    created_at,
    updated_at
  )
  VALUES (
    p_alignment_id,
    v_alignment_record.offering_member_id,
    p_amount_minor,
    p_currency,
    'pending',
    v_provider,
    NOW(),
    NOW()
  )
  RETURNING private.alignment_activation_payments.id,
            private.alignment_activation_payments.amount_minor,
            private.alignment_activation_payments.currency,
            private.alignment_activation_payments.status
  INTO v_payment_id, p_amount_minor, p_currency, v_recorded_status;

  UPDATE public.alignments AS a
  SET
    activation_fee_minor = p_amount_minor,
    activation_currency = p_currency,
    updated_at = NOW()
  WHERE a.id = p_alignment_id;

  RETURN QUERY
  SELECT v_payment_id, p_alignment_id, v_recorded_status, p_amount_minor, p_currency;
END;
$$;

REVOKE ALL ON FUNCTION public.create_alignment_activation_payment(uuid, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_alignment_activation_payment(uuid, bigint, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_alignment_activation_payment(uuid, bigint, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_alignment_activation_payment(uuid, bigint, text, text) TO service_role;

-- Advisory pre-capture check for future trusted payment orchestration. This
-- cannot reserve readiness across a network payment call; activation rechecks.
CREATE FUNCTION public.get_alignment_face_readiness_for_server(p_alignment_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH read_time AS MATERIALIZED (SELECT clock_timestamp() AS at)
  SELECT EXISTS (SELECT 1 FROM public.alignments a CROSS JOIN read_time t
    WHERE a.id=p_alignment_id AND a.status='awaiting_activation_payment'
      AND NOT EXISTS (SELECT 1 FROM private.required_face_members(a.id) r
        WHERE NOT private.has_current_alignment_face_check(a.id,r.member_id,t.at)));
$$;
REVOKE ALL ON FUNCTION public.get_alignment_face_readiness_for_server(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_alignment_face_readiness_for_server(uuid) TO service_role;

-- Freeze the accepted roster even if a modified requester reopens their need.
-- Existing invitation/acceptance RPCs lock the need; no 0013 function is replaced.
CREATE FUNCTION private.freeze_aligned_face_roster()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_need uuid;
BEGIN
  FOR v_need IN SELECT DISTINCT id FROM unnest(ARRAY[
    CASE WHEN TG_OP<>'INSERT' THEN OLD.movement_need_id END,
    CASE WHEN TG_OP<>'DELETE' THEN NEW.movement_need_id END]) id WHERE id IS NOT NULL ORDER BY id
  LOOP
    PERFORM 1 FROM public.movement_needs WHERE id=v_need FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.alignments WHERE movement_need_id=v_need
      AND status IN ('awaiting_activation_payment','activated','in_progress','completed')) THEN
      RAISE EXCEPTION 'Accepted movement roster is frozen';
    END IF;
  END LOOP;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.freeze_aligned_face_roster() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER freeze_aligned_face_roster BEFORE INSERT OR UPDATE OR DELETE ON public.movement_participants
  FOR EACH ROW EXECUTE FUNCTION private.freeze_aligned_face_roster();

CREATE FUNCTION private.require_alignment_face_verification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status IN ('activated','in_progress','completed') THEN RAISE EXCEPTION 'Alignment must activate through payment'; END IF;
    RETURN NEW;
  END IF;
  -- Session bindings must never refer to the old participants/offer while the
  -- same UPDATE activates a different movement. Existing RPCs never rebind these.
  IF ROW(NEW.movement_need_id,NEW.movement_offer_id,NEW.member_needing_movement_id,NEW.offering_member_id)
    IS DISTINCT FROM ROW(OLD.movement_need_id,OLD.movement_offer_id,OLD.member_needing_movement_id,OLD.offering_member_id) THEN
    RAISE EXCEPTION 'Alignment participant and offer bindings are immutable';
  END IF;
  IF OLD.status='awaiting_activation_payment' AND NEW.status IN ('in_progress','completed') THEN
    RAISE EXCEPTION 'Alignment must activate through payment';
  END IF;
  IF NEW.status<>'activated' OR OLD.status='activated' THEN RETURN NEW; END IF;
  IF OLD.status<>'awaiting_activation_payment' THEN RAISE EXCEPTION 'Invalid activation transition'; END IF;
  PERFORM private.assert_alignment_face_ready(NEW.id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_alignment_face_verification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_alignment_face_verification BEFORE INSERT OR UPDATE OF status,
  movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id ON public.alignments
  FOR EACH ROW EXECUTE FUNCTION private.require_alignment_face_verification();
-- 0007 payment-success RPC and 0008 journey trigger stay intact. A trigger error rolls
-- back payment success and activation together. External capture is separate:
-- the future payment adapter must preflight and reconcile/retry provider events.

CREATE FUNCTION public.get_my_profile_photo_submission_status()
RETURNS TABLE (status text,submitted_at timestamptz,processed_at timestamptz,current_photo_verified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.status,p.created_at,p.processed_at,
    EXISTS (SELECT 1 FROM public.member_media mm WHERE mm.member_id=auth.uid()
      AND mm.media_type='photo' AND mm.is_current AND mm.verified)
  FROM private.profile_photo_submissions p WHERE p.member_id=auth.uid()
  ORDER BY p.created_at DESC,p.id DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_my_profile_photo_submission_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile_photo_submission_status() TO authenticated;

CREATE FUNCTION public.get_my_alignment_face_verification_status(p_movement_need_id uuid)
RETURNS TABLE (status text,completed_at timestamptz,expires_at timestamptz,ready_for_activation boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  WITH read_time AS MATERIALIZED (SELECT clock_timestamp() AS at)
  SELECT CASE WHEN f.id IS NULL THEN 'not_started'
    WHEN f.status IN ('pending','succeeded') AND f.expires_at<=t.at THEN 'expired'
    ELSE f.status END,f.completed_at,f.expires_at,
    a.status='awaiting_activation_payment' AND private.has_current_alignment_face_check(a.id,auth.uid(),t.at)
  FROM public.alignments a CROSS JOIN read_time t
  LEFT JOIN LATERAL (SELECT s.* FROM private.alignment_face_verifications s
    WHERE s.alignment_id=a.id AND s.member_id=auth.uid() ORDER BY s.started_at DESC,s.id DESC LIMIT 1) f ON true
  WHERE a.movement_need_id=p_movement_need_id AND a.status IN ('awaiting_activation_payment','activated','in_progress','completed')
    AND EXISTS (SELECT 1 FROM private.required_face_members(a.id) r WHERE r.member_id=auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_my_alignment_face_verification_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_alignment_face_verification_status(uuid) TO authenticated;

COMMIT;


