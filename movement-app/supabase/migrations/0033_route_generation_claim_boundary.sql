BEGIN;

-- =========================================================
-- 0033 Route-generation claim boundary
-- =========================================================
--
-- Purpose:
-- - serialize provider-backed route generation per offering intent;
-- - allow only one active route-generation caller to reach the
--   routing provider at a time;
-- - return an already-current valid route before consuming quota
--   or calling the routing provider;
-- - give a crashed generation attempt a short server-controlled
--   lease so the intent cannot remain blocked forever.
--
-- This migration does not call a routing provider and does not
-- create journeys, requester matches, pricing, or payments.

CREATE TABLE private.offering_route_generation_claims (
  offering_movement_intent_id uuid PRIMARY KEY
    REFERENCES private.offering_movement_intents(id)
    ON DELETE RESTRICT,

  offering_member_id uuid NOT NULL
    REFERENCES public.members(id)
    ON DELETE RESTRICT,

  claim_token uuid NOT NULL UNIQUE,

  claimed_at timestamptz NOT NULL
    CHECK (isfinite(claimed_at)),

  lease_expires_at timestamptz NOT NULL
    CHECK (isfinite(lease_expires_at)),

  completed_route_evidence_id uuid UNIQUE
    REFERENCES private.offering_route_evidence(id)
    ON DELETE RESTRICT,

  completed_at timestamptz
    CHECK (isfinite(completed_at)),

  CHECK (
    lease_expires_at
      = claimed_at + interval '30 seconds'
  ),

  CHECK (
    (completed_route_evidence_id IS NULL)
      = (completed_at IS NULL)
  ),

  CHECK (
    completed_at IS NULL
    OR completed_at >= claimed_at
  )
);

ALTER TABLE private.offering_route_generation_claims
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.offering_route_generation_claims
FROM PUBLIC, anon, authenticated, service_role;


-- =========================================================
-- Claim-row protection
-- =========================================================

CREATE FUNCTION private.protect_offering_route_generation_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation claim cannot be deleted';
  END IF;

  IF NEW.offering_movement_intent_id
       IS DISTINCT FROM OLD.offering_movement_intent_id
     OR NEW.offering_member_id
       IS DISTINCT FROM OLD.offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation claim binding is immutable';
  END IF;

  IF NEW.claim_token
       IS DISTINCT FROM OLD.claim_token THEN

    IF NEW.completed_route_evidence_id IS NOT NULL
       OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A renewed route generation claim must start incomplete';
    END IF;

  ELSE
    IF NEW.claimed_at
         IS DISTINCT FROM OLD.claimed_at
       OR NEW.lease_expires_at
         IS DISTINCT FROM OLD.lease_expires_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Route generation claim lease cannot be extended';
    END IF;

    IF OLD.completed_route_evidence_id IS NOT NULL
       AND (
         NEW.completed_route_evidence_id
           IS DISTINCT FROM OLD.completed_route_evidence_id
         OR NEW.completed_at
           IS DISTINCT FROM OLD.completed_at
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Completed route generation claim is immutable';
    END IF;
  END IF;

  RETURN NEW;
END;
$protect$;

REVOKE ALL
ON FUNCTION private.protect_offering_route_generation_claim()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_offering_route_generation_claim
BEFORE UPDATE OR DELETE
ON private.offering_route_generation_claims
FOR EACH ROW
EXECUTE FUNCTION private.protect_offering_route_generation_claim();


-- =========================================================
-- Claim route generation
-- =========================================================

CREATE FUNCTION public.claim_offering_route_generation_for_server(
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid
)
RETURNS TABLE (
  generation_state text,
  generation_claim_token uuid,
  retry_after_seconds integer,

  route_evidence_id uuid,
  route_evidence_version integer,
  route_evidence_status text,
  route_evidence_expires_at timestamptz,

  origin_location_reference_id uuid,
  origin_latitude numeric,
  origin_longitude numeric,

  destination_location_reference_id uuid,
  destination_latitude numeric,
  destination_longitude numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $claim$
DECLARE
  v_intent private.offering_movement_intents%ROWTYPE;
  v_claim private.offering_route_generation_claims%ROWTYPE;
  v_evidence private.offering_route_evidence%ROWTYPE;

  v_context record;

  v_now timestamptz;
  v_claim_token uuid;
  v_retry_after integer;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'Route generation claim requires READ COMMITTED';
  END IF;

  IF p_offering_movement_intent_id IS NULL
     OR p_offering_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Offering movement intent and member are required';
  END IF;

  -- Lock the offering intent before checking current route evidence
  -- or the mutable claim row. This is the serialization point for
  -- one offering intent.
  SELECT i.*
  INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Offering movement intent not found';
  END IF;

  IF v_intent.offering_member_id
       IS DISTINCT FROM p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Offering movement intent does not belong to member';
  END IF;

  -- Reuse the existing authoritative route-generation validation.
  -- Because this transaction already owns the intent UPDATE lock,
  -- the nested SHARE lock does not create a competing lock order.
  SELECT *
  INTO STRICT v_context
  FROM public.get_offering_route_generation_context_for_server(
    p_offering_movement_intent_id,
    p_offering_member_id
  );

  v_now := clock_timestamp();

  -- A current, unexpired route wins before a claim is created or
  -- renewed. A retry after an ambiguous successful write therefore
  -- recovers the committed route without another provider call.
  SELECT e.*
  INTO v_evidence
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id
          = p_offering_movement_intent_id
    AND e.status = 'current';

  IF FOUND
     AND (
       v_evidence.expires_at IS NULL
       OR v_evidence.expires_at > v_now
     ) THEN

    PERFORM private.assert_offering_route_evidence(
      v_evidence.id
    );

    RETURN QUERY
    SELECT
      'existing'::text,
      NULL::uuid,
      0::integer,

      v_evidence.id,
      v_evidence.version,
      v_evidence.status,
      v_evidence.expires_at,

      NULL::uuid,
      NULL::numeric,
      NULL::numeric,

      NULL::uuid,
      NULL::numeric,
      NULL::numeric;

    RETURN;
  END IF;

  SELECT c.*
  INTO v_claim
  FROM private.offering_route_generation_claims c
  WHERE c.offering_movement_intent_id
          = p_offering_movement_intent_id
  FOR UPDATE;

  IF FOUND
     AND v_claim.offering_member_id
           IS DISTINCT FROM p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation claim binding is invalid';
  END IF;

  v_now := clock_timestamp();

  IF FOUND
     AND v_claim.lease_expires_at > v_now THEN

    v_retry_after :=
      GREATEST(
        1,
        LEAST(
          30,
          CEIL(
            EXTRACT(
              EPOCH FROM (
                v_claim.lease_expires_at
                - v_now
              )
            )
          )::integer
        )
      );

    RETURN QUERY
    SELECT
      'busy'::text,
      NULL::uuid,
      v_retry_after,

      NULL::uuid,
      NULL::integer,
      NULL::text,
      NULL::timestamptz,

      NULL::uuid,
      NULL::numeric,
      NULL::numeric,

      NULL::uuid,
      NULL::numeric,
      NULL::numeric;

    RETURN;
  END IF;

  v_claim_token := gen_random_uuid();
  v_now := clock_timestamp();

  IF FOUND THEN
        UPDATE private.offering_route_generation_claims
    SET
      claim_token = v_claim_token,
      claimed_at = v_now,
      lease_expires_at =
        v_now + interval '30 seconds',
      completed_route_evidence_id = NULL,
      completed_at = NULL
    WHERE offering_movement_intent_id
            = p_offering_movement_intent_id;
  ELSE
    INSERT INTO private.offering_route_generation_claims (
      offering_movement_intent_id,
      offering_member_id,
      claim_token,
      claimed_at,
      lease_expires_at
    )
    VALUES (
      p_offering_movement_intent_id,
      p_offering_member_id,
      v_claim_token,
      v_now,
      v_now + interval '30 seconds'
    );
  END IF;

  RETURN QUERY
  SELECT
    'claimed'::text,
    v_claim_token,
    0::integer,

    NULL::uuid,
    NULL::integer,
    NULL::text,
    NULL::timestamptz,

    v_context.origin_location_reference_id,
    v_context.origin_latitude,
    v_context.origin_longitude,

    v_context.destination_location_reference_id,
    v_context.destination_latitude,
    v_context.destination_longitude;
END;
$claim$;

REVOKE ALL
ON FUNCTION public.claim_offering_route_generation_for_server(
  uuid,
  uuid
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.claim_offering_route_generation_for_server(
  uuid,
  uuid
)
TO service_role;


-- =========================================================
-- Claim-bound route evidence writer
-- =========================================================

CREATE FUNCTION public.record_claimed_offering_route_evidence_for_server(
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid,
  p_generation_claim_token uuid,

  p_provider_namespace text,
  p_provider_product text,
  p_provider_version text,
  p_provider_route_reference text,

  p_route_shape jsonb,
  p_route_distance_meters bigint,
  p_route_duration_seconds bigint,

  p_generated_at timestamptz,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  route_evidence_id uuid,
  route_evidence_version integer,
  route_evidence_status text,
  route_evidence_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $record$
DECLARE
  v_intent private.offering_movement_intents%ROWTYPE;
  v_claim private.offering_route_generation_claims%ROWTYPE;
  v_completed private.offering_route_evidence%ROWTYPE;

  v_recorded_id uuid;
  v_recorded_version integer;
  v_recorded_status text;
  v_recorded_expires_at timestamptz;

  v_now timestamptz;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'Claimed route evidence requires READ COMMITTED';
  END IF;

  IF p_offering_movement_intent_id IS NULL
     OR p_offering_member_id IS NULL
     OR p_generation_claim_token IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Route generation claim identity is required';
  END IF;

  -- Match the claim RPC lock order: intent first, claim second.
  SELECT i.*
  INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Offering movement intent not found';
  END IF;

  IF v_intent.offering_member_id
       IS DISTINCT FROM p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Offering movement intent does not belong to member';
  END IF;

  SELECT c.*
  INTO v_claim
  FROM private.offering_route_generation_claims c
  WHERE c.offering_movement_intent_id
          = p_offering_movement_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation claim is unavailable';
  END IF;

  v_now := clock_timestamp();

  IF v_claim.offering_member_id
       IS DISTINCT FROM p_offering_member_id
     OR v_claim.claim_token
       IS DISTINCT FROM p_generation_claim_token THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation claim is unavailable';
  END IF;

  -- A completed claim is replayable only for the same provider
  -- route identity. 0025 then verifies the entire normalized
  -- payload before returning the original evidence.
  IF v_claim.completed_route_evidence_id IS NOT NULL THEN
    SELECT e.*
    INTO STRICT v_completed
    FROM private.offering_route_evidence e
    WHERE e.id = v_claim.completed_route_evidence_id;

    IF v_completed.provider_namespace
         IS DISTINCT FROM p_provider_namespace
       OR v_completed.provider_product
         IS DISTINCT FROM p_provider_product
       OR v_completed.provider_version
         IS DISTINCT FROM p_provider_version
       OR v_completed.provider_route_reference
         IS DISTINCT FROM p_provider_route_reference THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Completed route generation claim does not match';
    END IF;

    RETURN QUERY
    SELECT r.*
    FROM public.record_offering_route_evidence_for_server(
      p_offering_movement_intent_id,
      p_provider_namespace,
      p_provider_product,
      p_provider_version,
      p_provider_route_reference,
      p_route_shape,
      p_route_distance_meters,
      p_route_duration_seconds,
      p_generated_at,
      p_expires_at
    ) AS r;

    RETURN;
  END IF;

  IF v_claim.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route generation claim is unavailable';
  END IF;

  SELECT
    r.route_evidence_id,
    r.route_evidence_version,
    r.route_evidence_status,
    r.route_evidence_expires_at
  INTO
    v_recorded_id,
    v_recorded_version,
    v_recorded_status,
    v_recorded_expires_at
  FROM public.record_offering_route_evidence_for_server(
    p_offering_movement_intent_id,
    p_provider_namespace,
    p_provider_product,
    p_provider_version,
    p_provider_route_reference,
    p_route_shape,
    p_route_distance_meters,
    p_route_duration_seconds,
    p_generated_at,
    p_expires_at
  ) AS r;

  IF v_recorded_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Route evidence recording returned no result';
  END IF;

  UPDATE private.offering_route_generation_claims
  SET
    completed_route_evidence_id = v_recorded_id,
    completed_at = clock_timestamp()
  WHERE offering_movement_intent_id
          = p_offering_movement_intent_id
    AND claim_token
          = p_generation_claim_token;

  RETURN QUERY
  SELECT
    v_recorded_id,
    v_recorded_version,
    v_recorded_status,
    v_recorded_expires_at;
END;
$record$;

REVOKE ALL
ON FUNCTION public.record_claimed_offering_route_evidence_for_server(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  bigint,
  bigint,
  timestamptz,
  timestamptz
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.record_claimed_offering_route_evidence_for_server(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  bigint,
  bigint,
  timestamptz,
  timestamptz
)
TO service_role;

COMMIT;