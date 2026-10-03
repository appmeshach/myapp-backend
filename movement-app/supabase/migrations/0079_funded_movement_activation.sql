BEGIN;

CREATE TABLE private.funded_movement_activations (
 financial_agreement_id uuid PRIMARY KEY REFERENCES private.financial_agreements(id),
 alignment_id uuid NOT NULL UNIQUE REFERENCES public.alignments(id),
 activated_at timestamptz NOT NULL CHECK(isfinite(activated_at))
);
CREATE TABLE private.funded_movement_activation_faces (
 financial_agreement_id uuid NOT NULL REFERENCES private.funded_movement_activations(financial_agreement_id),
 member_id uuid NOT NULL REFERENCES public.members(id),
 face_verification_id uuid NOT NULL REFERENCES private.alignment_face_verifications(id),
 PRIMARY KEY(financial_agreement_id,member_id), UNIQUE(financial_agreement_id,face_verification_id)
);
ALTER TABLE private.funded_movement_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_movement_activation_faces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_movement_activations,private.funded_movement_activation_faces FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_funded_movement_activations BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_activations
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_funded_movement_activation_faces BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_activation_faces
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE FUNCTION private.is_financial_alignment(p_alignment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $financial$
 SELECT EXISTS(SELECT 1 FROM private.financial_agreements g WHERE g.alignment_id=p_alignment)
 OR EXISTS(SELECT 1 FROM private.financial_proposals p WHERE p.alignment_id=p_alignment);
$financial$;

-- Agreement SHARE precedes alignment UPDATE. This avoids both a SHARE->UPDATE
-- upgrade between duplicates and 0020's agreement UPDATE -> alignment SHARE cycle.
-- No proposal UPDATE, wallet account lock or journey lock is taken here.
CREATE FUNCTION private.funded_activation_agreement(p_id uuid,p_version integer,p_lock boolean)
RETURNS private.financial_agreements LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $selector$
DECLARE g private.financial_agreements%ROWTYPE; caller uuid:=auth.uid();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Activation requires READ COMMITTED'; END IF;
 IF p_id IS NULL OR p_version IS NULL THEN RAISE EXCEPTION USING ERRCODE='22004',MESSAGE='Exact agreement and version required'; END IF;
 SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=p_id;
 IF caller IS NULL OR NOT FOUND OR g.member_needing_movement_id IS DISTINCT FROM caller THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Own requester agreement required'; END IF;
 IF p_version<1 OR g.version<>p_version THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact agreement version required'; END IF;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=p_id FOR SHARE;
 IF p_lock THEN PERFORM 1 FROM public.alignments x WHERE x.id=g.alignment_id FOR UPDATE;
 ELSE PERFORM 1 FROM public.alignments x WHERE x.id=g.alignment_id FOR SHARE; END IF;
 -- Reuses all 0077 quote/snapshot/roster/consent/economics/three-component checks.
 RETURN private.movement_funding_agreement(p_id,caller,p_version);
END;
$selector$;

CREATE FUNCTION private.assert_funded_activation(g private.financial_agreements,a public.alignments)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $historical$
DECLARE receipt private.funded_movement_activations%ROWTYPE; evidence record; p private.financial_proposals%ROWTYPE;
BEGIN
 SELECT x.* INTO receipt FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id;
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 IF receipt.financial_agreement_id IS NULL OR receipt.alignment_id IS DISTINCT FROM a.id
  OR g.alignment_id IS DISTINCT FROM a.id OR receipt.activated_at IS DISTINCT FROM a.activated_at
  OR a.status NOT IN ('activated','in_progress','completed','cancelled')
  OR evidence.fully_held_at IS NULL OR evidence.held_minor<>evidence.required_minor
  OR evidence.fully_held_at>receipt.activated_at OR receipt.activated_at>clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical funded activation required'; END IF;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 -- Receipt certifies current prepared/verified media and member flags at the
 -- original gate. Historical checks do not demand that media remain current now.
 IF EXISTS (
  (SELECT g.offering_member_id AS member_id UNION SELECT t.member_id FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id)
  EXCEPT SELECT x.member_id FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id=g.id
 ) OR EXISTS (
  SELECT x.member_id FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id=g.id
  EXCEPT (SELECT g.offering_member_id UNION SELECT t.member_id FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id)
 ) OR EXISTS (
  SELECT 1 FROM private.funded_movement_activation_faces x
  LEFT JOIN private.alignment_face_verifications f ON f.id=x.face_verification_id
  WHERE x.financial_agreement_id=g.id AND (f.id IS NULL OR f.alignment_id IS DISTINCT FROM a.id
   OR f.member_id IS DISTINCT FROM x.member_id OR f.status<>'succeeded'
   OR f.liveness_passed IS DISTINCT FROM true OR f.face_match_passed IS DISTINCT FROM true
   OR f.completed_at IS NULL OR f.completed_at<f.started_at OR f.completed_at>receipt.activated_at
   OR f.expires_at<=receipt.activated_at OR NOT isfinite(f.completed_at) OR NOT isfinite(f.expires_at)
   OR EXISTS(SELECT 1 FROM private.alignment_face_verifications newer WHERE newer.alignment_id=a.id AND newer.member_id=x.member_id
    AND newer.started_at<=receipt.activated_at AND ROW(newer.started_at,newer.id)>ROW(f.started_at,f.id)))
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical activation face evidence required'; END IF;
END;
$historical$;

CREATE FUNCTION public.activate_my_funded_movement(p_financial_agreement_id uuid,p_expected_agreement_version integer)
RETURNS TABLE(financial_agreement_id uuid,agreement_version integer,alignment_id uuid,alignment_status text,activated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $activate$
DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; evidence record; stamp timestamptz;
BEGIN
 g:=private.funded_activation_agreement(p_financial_agreement_id,p_expected_agreement_version,true);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=g.alignment_id;
 IF EXISTS(SELECT 1 FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id) THEN
  PERFORM private.assert_funded_activation(g,a);
  RETURN QUERY SELECT g.id,g.version,a.id,a.status,a.activated_at; RETURN;
 END IF;
 IF g.status<>'current' OR a.status<>'awaiting_activation_payment' OR a.activated_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current pre-activation agreement required'; END IF;
 -- Existing gate owns alignment -> need -> every required member in UUID order.
 PERFORM private.assert_alignment_face_ready(a.id);
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 IF evidence.fully_held_at IS NULL OR evidence.held_minor<>evidence.required_minor THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed exact requester funding required'; END IF;
 -- Capture time AFTER every wait, and check the same authoritative face predicate
 -- at precisely the timestamp to be recorded (not a statement-start timestamp).
 stamp:=clock_timestamp();
 IF evidence.fully_held_at>stamp OR EXISTS(SELECT 1 FROM private.required_face_members(a.id) r
  WHERE NOT private.has_current_alignment_face_check(a.id,r.member_id,stamp)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh face verification required'; END IF;
 INSERT INTO private.funded_movement_activations VALUES(g.id,a.id,stamp);
 INSERT INTO private.funded_movement_activation_faces(financial_agreement_id,member_id,face_verification_id)
 SELECT g.id,r.member_id,(SELECT f.id FROM private.alignment_face_verifications f WHERE f.alignment_id=a.id AND f.member_id=r.member_id
  ORDER BY f.started_at DESC,f.id DESC LIMIT 1) FROM private.required_face_members(a.id) r;
 UPDATE public.alignments x SET status='activated',activated_at=stamp,updated_at=stamp WHERE x.id=a.id RETURNING x.* INTO a;
 PERFORM private.assert_funded_activation(g,a);
 RETURN QUERY SELECT g.id,g.version,a.id,a.status,a.activated_at;
END;
$activate$;

CREATE FUNCTION public.get_my_movement_activation_status(p_financial_agreement_id uuid,p_expected_agreement_version integer)
RETURNS TABLE(financial_agreement_id uuid,agreement_version integer,alignment_id uuid,alignment_status text,activation_status text,activated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $projection$
DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; evidence record; ready boolean;
BEGIN
 g:=private.funded_activation_agreement(p_financial_agreement_id,p_expected_agreement_version,false);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=g.alignment_id;
 IF EXISTS(SELECT 1 FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id) THEN
  PERFORM private.assert_funded_activation(g,a);
  RETURN QUERY SELECT g.id,g.version,a.id,a.status,'activated'::text,a.activated_at; RETURN;
 END IF;
 IF g.status<>'current' OR a.status<>'awaiting_activation_payment' OR a.activated_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activation unavailable'; END IF;
 -- Same member gate as 0078. SHARE never claims readiness as a reservation:
 -- activation rechecks under UPDATE locks. Projection performs no writes.
 PERFORM m.id FROM public.members m JOIN private.required_face_members(a.id) r ON r.member_id=m.id ORDER BY m.id FOR SHARE OF m;
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 ready:=NOT EXISTS(SELECT 1 FROM private.required_face_members(a.id) r WHERE NOT private.has_current_alignment_face_check(a.id,r.member_id,clock_timestamp()));
 RETURN QUERY SELECT g.id,g.version,a.id,a.status,CASE WHEN evidence.fully_held_at IS NULL THEN 'funding_required'
  WHEN NOT ready THEN 'identity_required' ELSE 'ready_to_activate' END,NULL::timestamptz;
END;
$projection$;

-- Cover retained RPCs AND trusted direct payment writes. No service-role bypass.
CREATE FUNCTION private.reject_financial_activation_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $payment_guard$
BEGIN
 IF private.is_financial_alignment(NEW.alignment_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial movement requires funded activation'; END IF;
 RETURN NEW;
END;
$payment_guard$;
CREATE TRIGGER reject_financial_activation_payment BEFORE INSERT OR UPDATE ON private.alignment_activation_payments
 FOR EACH ROW EXECUTE FUNCTION private.reject_financial_activation_payment();
CREATE FUNCTION private.require_funded_alignment_activation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $alignment_guard$
DECLARE g private.financial_agreements%ROWTYPE;
BEGIN
 IF NEW.status='activated' AND OLD.status IS DISTINCT FROM NEW.status AND private.is_financial_alignment(NEW.id) THEN
  SELECT x.* INTO g FROM private.financial_agreements x JOIN private.funded_movement_activations r ON r.financial_agreement_id=x.id WHERE r.alignment_id=NEW.id;
  IF g.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Funded activation receipt required'; END IF;
  PERFORM private.assert_funded_activation(g,NEW);
 END IF;
 IF EXISTS(SELECT 1 FROM private.funded_movement_activations r WHERE r.alignment_id=OLD.id)
  AND OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Funded activation timestamp is immutable'; END IF;
 RETURN NEW;
END;
$alignment_guard$;
CREATE TRIGGER require_funded_alignment_activation BEFORE UPDATE ON public.alignments
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_alignment_activation();

REVOKE ALL ON FUNCTION private.is_financial_alignment(uuid),private.funded_activation_agreement(uuid,integer,boolean),
 private.assert_funded_activation(private.financial_agreements,public.alignments),private.reject_financial_activation_payment(),
 private.require_funded_alignment_activation() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.activate_my_funded_movement(uuid,integer),public.get_my_movement_activation_status(uuid,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.activate_my_funded_movement(uuid,integer),public.get_my_movement_activation_status(uuid,integer) TO authenticated;

CREATE FUNCTION private.has_funded_activation(p_alignment uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $reveal$
DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; p private.financial_proposals%ROWTYPE;
BEGIN
 SELECT x.* INTO g FROM private.financial_agreements x JOIN private.funded_movement_activations r ON r.financial_agreement_id=x.id WHERE r.alignment_id=p_alignment;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 PERFORM private.assert_financial_proposal_materialization(p);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 PERFORM private.assert_funded_activation(g,a);
 RETURN true;
EXCEPTION WHEN check_violation OR no_data_found OR too_many_rows THEN RETURN false;
END;
$reveal$;
REVOKE ALL ON FUNCTION private.has_funded_activation(uuid) FROM PUBLIC,anon,authenticated,service_role;

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
  IF private.is_financial_alignment(p_alignment_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial movement requires funded activation'; END IF;
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

CREATE OR REPLACE FUNCTION public.mark_alignment_activation_payment_succeeded(
  p_payment_id uuid,
  p_provider_reference text DEFAULT NULL
)
RETURNS TABLE (
  alignment_id uuid,
  alignment_status text,
  activated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payment_record private.alignment_activation_payments%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_provider_reference text;
  v_activated_at timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM private.alignment_activation_payments ap WHERE ap.id=p_payment_id AND private.is_financial_alignment(ap.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial movement requires funded activation'; END IF;
  SELECT *
  INTO v_payment_record
  FROM private.alignment_activation_payments AS ap
  WHERE ap.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  SELECT *
  INTO v_alignment_record
  FROM public.alignments AS a
  WHERE a.id = v_payment_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  IF v_payment_record.payer_member_id <> v_alignment_record.offering_member_id THEN
    RAISE EXCEPTION 'Payment payer does not match the alignment offering member';
  END IF;

  IF v_alignment_record.activation_fee_minor IS DISTINCT FROM v_payment_record.amount_minor
    OR v_alignment_record.activation_currency IS DISTINCT FROM v_payment_record.currency THEN
    RAISE EXCEPTION 'Payment amount or currency does not match alignment activation fee';
  END IF;

  IF v_payment_record.status = 'succeeded' AND v_alignment_record.status = 'activated' THEN
    RETURN QUERY
    SELECT
      v_alignment_record.id,
      v_alignment_record.status,
      v_alignment_record.activated_at;
    RETURN;
  END IF;

  IF v_payment_record.status <> 'pending' THEN
    RAISE EXCEPTION 'Payment is not pending';
  END IF;

  IF v_alignment_record.status <> 'awaiting_activation_payment' THEN
    RAISE EXCEPTION 'Alignment is not awaiting activation payment';
  END IF;

  v_provider_reference := p_provider_reference;
  IF v_provider_reference IS NOT NULL THEN
    v_provider_reference := trim(v_provider_reference);
    IF v_provider_reference = '' THEN
      v_provider_reference := NULL;
    END IF;
    IF length(v_provider_reference) > 255 THEN
      RAISE EXCEPTION 'Provider reference must be 255 characters or fewer';
    END IF;
  END IF;

  UPDATE private.alignment_activation_payments AS ap
  SET
    status = 'succeeded',
    provider_reference = v_provider_reference,
    succeeded_at = NOW(),
    updated_at = NOW()
  WHERE ap.id = p_payment_id;

  UPDATE public.alignments AS a
  SET
    status = 'activated',
    activated_at = NOW(),
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id
  RETURNING a.activated_at
  INTO v_activated_at;

  RETURN QUERY
  SELECT
    v_alignment_record.id,
    'activated'::text,
    v_activated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_activation_payment_status(
  p_alignment_id uuid
)
RETURNS TABLE (
  alignment_id uuid,
  alignment_status text,
  activation_fee_minor bigint,
  activation_currency text,
  payment_status text,
  payment_required_from_me boolean,
  activated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_alignment_record public.alignments%ROWTYPE;
  v_payment_record private.alignment_activation_payments%ROWTYPE;
BEGIN
  IF private.is_financial_alignment(p_alignment_id) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Use movement activation status'; END IF;
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
  INTO v_alignment_record
  FROM public.alignments AS a
  WHERE a.id = p_alignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  IF v_alignment_record.member_needing_movement_id <> v_member_id
    AND v_alignment_record.offering_member_id <> v_member_id THEN
    RAISE EXCEPTION 'You are not a participant in this alignment';
  END IF;

  SELECT *
  INTO v_payment_record
  FROM private.alignment_activation_payments AS ap
  WHERE ap.alignment_id = p_alignment_id
  ORDER BY
    CASE
      WHEN ap.status = 'succeeded' THEN 1
      WHEN ap.status = 'pending' THEN 2
      WHEN ap.status IN ('failed', 'cancelled') THEN 3
      ELSE 4
    END ASC,
    ap.created_at DESC
  LIMIT 1;

  RETURN QUERY
  SELECT
    v_alignment_record.id AS alignment_id,
    v_alignment_record.status AS alignment_status,
    v_alignment_record.activation_fee_minor,
    v_alignment_record.activation_currency,
    COALESCE(v_payment_record.status, NULL::text) AS payment_status,
    (v_alignment_record.offering_member_id = v_member_id
      AND v_alignment_record.status = 'awaiting_activation_payment')::boolean AS payment_required_from_me,
    v_alignment_record.activated_at
  ;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_journey_on_alignment_activation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_journey_exists BOOLEAN;
  v_vehicle_id UUID;
  v_offer_record public.movement_offers%ROWTYPE;
BEGIN
  -- Financial activation unlocks reveal, but creates no journey. Legacy trigger
  -- behavior remains unchanged for non-financial alignments.
  IF private.is_financial_alignment(NEW.id) THEN RETURN NEW; END IF;
  -- Only react when transitioning INTO 'activated'
  IF NEW.status = 'activated' AND (OLD.status IS NULL OR OLD.status <> 'activated') THEN

    -- Check if journey already exists for this alignment
    SELECT EXISTS(
      SELECT 1
      FROM public.journeys j
      WHERE j.alignment_id = NEW.id
    ) INTO v_journey_exists;

    IF NOT v_journey_exists THEN
      -- Load the accepted movement offer to get the vehicle
      SELECT *
      INTO v_offer_record
      FROM public.movement_offers mo
      WHERE mo.id = NEW.movement_offer_id
      FOR SHARE;

      IF FOUND THEN
        v_vehicle_id := v_offer_record.vehicle_id;
      ELSE
        -- This should not happen if alignment is well-formed, but protect against it
        RAISE EXCEPTION 'Movement offer not found for alignment';
      END IF;

      -- Insert journey with status 'not_started'
      INSERT INTO public.journeys (
        alignment_id,
        vehicle_id,
        status,
        created_at,
        updated_at
      )
      VALUES (
        NEW.id,
        v_vehicle_id,
        'not_started',
        NOW(),
        NOW()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.post_activation_reveal_subjects(
  p_movement_need_id uuid, p_viewer_member_id uuid
)
RETURNS TABLE (alignment_id uuid, vehicle_id uuid, subject_member_id uuid,
  subject_role text, subject_number integer)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH eligible AS (
    SELECT a.id, a.offering_member_id, a.member_needing_movement_id,
      a.movement_need_id, mo.vehicle_id
    FROM public.alignments a
    JOIN public.movement_needs mn ON mn.id = a.movement_need_id
      AND mn.member_id = a.member_needing_movement_id AND mn.status = 'closed'
    JOIN public.movement_offers mo ON mo.id = a.movement_offer_id
      AND mo.movement_need_id = a.movement_need_id
      AND mo.offering_member_id = a.offering_member_id AND mo.status = 'accepted'
    LEFT JOIN public.journeys j ON j.alignment_id = a.id AND j.vehicle_id = mo.vehicle_id
    WHERE a.movement_need_id = p_movement_need_id
      AND p_viewer_member_id IS NOT NULL
      AND a.activated_at IS NOT NULL
      AND ((a.status = 'activated' AND (j.status = 'not_started' OR (j.id IS NULL AND private.has_funded_activation(a.id))))
        OR (a.status = 'in_progress' AND j.status = 'in_progress')
        OR (a.status = 'completed' AND j.status = 'completed'))
      AND (private.has_funded_activation(a.id) OR (NOT private.is_financial_alignment(a.id) AND EXISTS (
        SELECT 1 FROM private.alignment_activation_payments ap
        WHERE ap.alignment_id = a.id AND ap.status = 'succeeded'
          AND ap.succeeded_at IS NOT NULL
          AND ap.payer_member_id = a.offering_member_id
          AND ap.amount_minor = a.activation_fee_minor
          AND ap.currency = a.activation_currency
      )))
      AND (p_viewer_member_id = a.offering_member_id OR EXISTS (
        SELECT 1 FROM public.movement_participants mp
        WHERE mp.movement_need_id = a.movement_need_id
          AND mp.member_id = p_viewer_member_id AND mp.status = 'confirmed'
          AND ((mp.role = 'primary_requester' AND mp.member_id = a.member_needing_movement_id)
            OR (mp.role = 'invited_participant' AND mp.member_id <> a.member_needing_movement_id))
      ))
  ), subjects AS (
    -- Travellers see only the offering member through this reveal.
    SELECT e.id, e.vehicle_id, e.offering_member_id AS member_id,
      'offering_member'::text AS role, 1::bigint AS ordinal
    FROM eligible e WHERE p_viewer_member_id <> e.offering_member_id
    UNION ALL
    -- Offering member sees only the confirmed travellers of this movement.
    SELECT e.id, e.vehicle_id, mp.member_id, mp.role,
      row_number() OVER (ORDER BY
        CASE WHEN mp.role = 'primary_requester' THEN 0 ELSE 1 END, mp.created_at, mp.id)
    FROM eligible e
    JOIN public.movement_participants mp ON mp.movement_need_id = e.movement_need_id
    WHERE p_viewer_member_id = e.offering_member_id
      AND mp.status = 'confirmed' AND mp.member_id <> e.offering_member_id
      AND ((mp.role = 'primary_requester' AND mp.member_id = e.member_needing_movement_id)
        OR (mp.role = 'invited_participant' AND mp.member_id <> e.member_needing_movement_id))
  )
  SELECT s.id, s.vehicle_id, s.member_id, s.role, s.ordinal::integer FROM subjects s;
$$;
REVOKE ALL ON FUNCTION public.create_journey_on_alignment_activation(),private.post_activation_reveal_subjects(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.create_alignment_activation_payment(uuid,bigint,text,text),public.mark_alignment_activation_payment_succeeded(uuid,text),public.get_my_activation_payment_status(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_alignment_activation_payment(uuid,bigint,text,text),public.mark_alignment_activation_payment_succeeded(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_my_activation_payment_status(uuid) TO authenticated;
COMMIT;
