BEGIN;

-- =========================================================
-- Private payment foundation
-- =========================================================
-- Payment success can only be recorded by trusted server-side infrastructure.
-- Ordinary authenticated users may inspect masked alignment/payment status only,
-- not set fees or record provider success.
-- The offering member is the payer for the platform alignment activation fee,
-- not a payment to access another person or their identity.

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO service_role;

-- =========================================================
-- private.alignment_activation_payments
-- =========================================================
CREATE TABLE IF NOT EXISTS private.alignment_activation_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alignment_id UUID NOT NULL REFERENCES public.alignments(id) ON DELETE CASCADE,
  payer_member_id UUID NOT NULL REFERENCES public.members(id),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency ~ '^[A-Z]{3}$'),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  provider TEXT NULL,
  provider_reference TEXT NULL,
  succeeded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE private.alignment_activation_payments ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated policies; this payment ledger is intentionally private.

REVOKE ALL ON TABLE private.alignment_activation_payments FROM PUBLIC;
REVOKE ALL ON TABLE private.alignment_activation_payments FROM anon;
REVOKE ALL ON TABLE private.alignment_activation_payments FROM authenticated;

GRANT ALL ON TABLE private.alignment_activation_payments TO service_role;

CREATE INDEX IF NOT EXISTS idx_alignment_activation_payments_alignment_id
  ON private.alignment_activation_payments (alignment_id);

CREATE INDEX IF NOT EXISTS idx_alignment_activation_payments_payer_member_id
  ON private.alignment_activation_payments (payer_member_id);

CREATE INDEX IF NOT EXISTS idx_alignment_activation_payments_status
  ON private.alignment_activation_payments (status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_alignment_activation_payments_succeeded_one_per_alignment
  ON private.alignment_activation_payments (alignment_id)
  WHERE status = 'succeeded';

CREATE UNIQUE INDEX IF NOT EXISTS ux_alignment_activation_payments_pending_one_per_alignment
  ON private.alignment_activation_payments (alignment_id)
  WHERE status = 'pending';

-- =========================================================
-- public.create_alignment_activation_payment
-- =========================================================
-- This is server-only infrastructure. The payer is always the alignment's
-- offering member, not the client, and the amount is set by trusted service logic.
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

-- =========================================================
-- public.mark_alignment_activation_payment_succeeded
-- =========================================================
-- This is server-only infrastructure. Payment success is recorded by trusted
-- backend logic, not by ordinary authenticated clients.
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

REVOKE ALL ON FUNCTION public.mark_alignment_activation_payment_succeeded(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_alignment_activation_payment_succeeded(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.mark_alignment_activation_payment_succeeded(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_alignment_activation_payment_succeeded(uuid, text) TO service_role;

-- =========================================================
-- public.get_my_activation_payment_status
-- =========================================================
-- Ordinary authenticated users may inspect a safe payment/alignment state, but
-- they cannot set fees, trigger provider success, or retrieve raw participant IDs.
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

REVOKE ALL ON FUNCTION public.get_my_activation_payment_status(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_activation_payment_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_activation_payment_status(uuid) TO authenticated;

COMMIT;
