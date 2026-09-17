BEGIN;

-- =========================================================
-- 0027 Trusted selected-location intake
-- =========================================================
-- Product rule:
-- typing is search only; a movement location exists only after
-- the authenticated member selects one concrete provider result.
--
-- This migration records that selection as an unresolved
-- member_selected location. It does not trust or store coordinates,
-- perform geocoding, create intents, or generate routes.

-- =========================================================
-- Immutable retry receipt
-- =========================================================

CREATE TABLE private.movement_location_selection_receipts (
  request_id uuid PRIMARY KEY,
  location_reference_id uuid NOT NULL UNIQUE
    REFERENCES private.movement_location_references(id)
    ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT movement_location_selection_receipt_recorded_at_finite
    CHECK (isfinite(recorded_at))
);

ALTER TABLE private.movement_location_selection_receipts
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON TABLE private.movement_location_selection_receipts
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE private.movement_location_selection_receipts
TO service_role;

-- =========================================================
-- Receipt immutability
-- =========================================================

CREATE OR REPLACE FUNCTION private.protect_movement_location_selection_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location receipt history is immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location receipt history cannot be deleted';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION private.protect_movement_location_selection_receipt()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_movement_location_selection_receipt
BEFORE UPDATE OR DELETE
ON private.movement_location_selection_receipts
FOR EACH ROW
EXECUTE FUNCTION private.protect_movement_location_selection_receipt();

-- =========================================================
-- Receipt assertion
-- =========================================================

CREATE OR REPLACE FUNCTION private.assert_movement_location_selection_receipt(
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_receipt private.movement_location_selection_receipts%ROWTYPE;
  v_location private.movement_location_references%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selection request identity is required';
  END IF;

  SELECT *
  INTO v_receipt
  FROM private.movement_location_selection_receipts
  WHERE request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location receipt does not exist';
  END IF;

  SELECT *
  INTO v_location
  FROM private.movement_location_references
  WHERE id = v_receipt.location_reference_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location reference does not exist';
  END IF;

  IF v_location.source_kind IS DISTINCT FROM 'member_selected'
     OR v_location.resolution_status IS DISTINCT FROM 'unresolved'
     OR v_location.latitude IS NOT NULL
     OR v_location.longitude IS NOT NULL
     OR v_location.resolved_at IS NOT NULL
     OR v_location.resolution_version IS NOT NULL
     OR v_location.provider_namespace IS NULL
     OR v_location.provider_place_reference IS NULL
     OR btrim(v_location.provider_namespace) = ''
     OR btrim(v_location.provider_place_reference) = ''
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location receipt target is invalid';
  END IF;

  IF v_receipt.recorded_at IS DISTINCT FROM v_location.created_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location receipt timing is inconsistent';
  END IF;
END;
$function$;

REVOKE ALL
ON FUNCTION private.assert_movement_location_selection_receipt(uuid)
FROM PUBLIC, anon, authenticated, service_role;

-- Validate every newly constructed receipt immediately.

CREATE OR REPLACE FUNCTION private.validate_movement_location_selection_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.assert_movement_location_selection_receipt(NEW.request_id);
  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION private.validate_movement_location_selection_receipt()
FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER movement_location_selection_receipt_complete
AFTER INSERT
ON private.movement_location_selection_receipts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION private.validate_movement_location_selection_receipt();

-- =========================================================
-- Authenticated selected-location writer
-- =========================================================

CREATE OR REPLACE FUNCTION public.record_selected_location_for_member(
  p_request_id uuid,
  p_declared_label text,
  p_provider_namespace text,
  p_provider_place_reference text
)
RETURNS TABLE (
  location_reference_id uuid,
  declared_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_member_id uuid;
  v_now timestamptz;

  v_existing_receipt private.movement_location_selection_receipts%ROWTYPE;
  v_existing_location private.movement_location_references%ROWTYPE;

  v_location_id uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'Selected location intake requires READ COMMITTED';
  END IF;

  -- Existing movement-app identity contract:
  -- public.members.id = auth.users.id = auth.uid().
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Authentication required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.members
    WHERE id = v_member_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Member record not found for the authenticated user';
  END IF;

  -- Request identity.
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selection request identity is required';
  END IF;

  -- The selected result must already be canonicalized.
  IF p_declared_label IS NULL
     OR p_declared_label <> btrim(p_declared_label)
     OR p_declared_label = ''
     OR length(p_declared_label) > 300
     OR p_declared_label !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location label is invalid';
  END IF;

  IF p_provider_namespace IS NULL
     OR p_provider_namespace <> btrim(p_provider_namespace)
     OR p_provider_namespace = ''
     OR length(p_provider_namespace) > 100
     OR p_provider_namespace !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location provider namespace is invalid';
  END IF;

  IF p_provider_place_reference IS NULL
     OR p_provider_place_reference <> btrim(p_provider_place_reference)
     OR p_provider_place_reference = ''
     OR length(p_provider_place_reference) > 500
     OR p_provider_place_reference !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Selected location provider reference is invalid';
  END IF;

  -- -------------------------------------------------------
  -- Fast idempotent replay path
  -- -------------------------------------------------------

  SELECT *
  INTO v_existing_receipt
  FROM private.movement_location_selection_receipts
  WHERE request_id = p_request_id;

  IF FOUND THEN
    SELECT *
    INTO v_existing_location
    FROM private.movement_location_references
    WHERE id = v_existing_receipt.location_reference_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Selected location receipt is inconsistent';
    END IF;

    IF v_existing_location.owner_member_id IS DISTINCT FROM v_member_id
       OR v_existing_location.declared_label IS DISTINCT FROM p_declared_label
       OR v_existing_location.provider_namespace IS DISTINCT FROM p_provider_namespace
       OR v_existing_location.provider_place_reference IS DISTINCT FROM p_provider_place_reference
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Selection request replay does not match the original request';
    END IF;

    PERFORM private.assert_movement_location_selection_receipt(p_request_id);

    RETURN QUERY
    SELECT
      v_existing_location.id,
      v_existing_location.declared_label;

    RETURN;
  END IF;

  -- -------------------------------------------------------
  -- First creation / concurrent retry-safe creation
  -- -------------------------------------------------------
  --
  -- The nested block is a PL/pgSQL subtransaction.
  -- If another transaction wins the same request_id race,
  -- a unique_violation rolls back BOTH attempted inserts from
  -- this block, preventing an orphan immutable location row.

  BEGIN
    v_now := clock_timestamp();

    INSERT INTO private.movement_location_references (
      owner_member_id,
      declared_label,
      source_kind,
      resolution_status,
      latitude,
      longitude,
      provider_namespace,
      provider_place_reference,
      resolution_version,
      created_at,
      resolved_at,
      expires_at
    )
    VALUES (
      v_member_id,
      p_declared_label,
      'member_selected',
      'unresolved',
      NULL,
      NULL,
      p_provider_namespace,
      p_provider_place_reference,
      NULL,
      v_now,
      NULL,
      NULL
    )
    RETURNING id
    INTO v_location_id;

    INSERT INTO private.movement_location_selection_receipts (
      request_id,
      location_reference_id,
      recorded_at
    )
    VALUES (
      p_request_id,
      v_location_id,
      v_now
    );

    PERFORM private.assert_movement_location_selection_receipt(p_request_id);

  EXCEPTION
    WHEN unique_violation THEN
      -- Everything inserted inside this block has already been
      -- rolled back by the subtransaction.

      SELECT *
      INTO v_existing_receipt
      FROM private.movement_location_selection_receipts
      WHERE request_id = p_request_id;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      SELECT *
      INTO v_existing_location
      FROM private.movement_location_references
      WHERE id = v_existing_receipt.location_reference_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Selected location receipt is inconsistent';
      END IF;

      IF v_existing_location.owner_member_id IS DISTINCT FROM v_member_id
         OR v_existing_location.declared_label IS DISTINCT FROM p_declared_label
         OR v_existing_location.provider_namespace IS DISTINCT FROM p_provider_namespace
         OR v_existing_location.provider_place_reference IS DISTINCT FROM p_provider_place_reference
      THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Selection request replay does not match the original request';
      END IF;

      PERFORM private.assert_movement_location_selection_receipt(p_request_id);

      RETURN QUERY
      SELECT
        v_existing_location.id,
        v_existing_location.declared_label;

      RETURN;
  END;

  RETURN QUERY
  SELECT
    mlr.id,
    mlr.declared_label
  FROM private.movement_location_references AS mlr
  WHERE mlr.id = v_location_id;
END;
$function$;

REVOKE ALL
ON FUNCTION public.record_selected_location_for_member(uuid, text, text, text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.record_selected_location_for_member(uuid, text, text, text)
TO authenticated;

COMMIT;
