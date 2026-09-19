BEGIN;

-- Production intake boundary for an offering member's own independent movement.
--
-- WE DO NOT CREATE JOURNEYS.
--
-- The client may identify only:
--   * two already trusted/resolved location references that belong to itself;
--   * the member's own near-term departure window;
--   * an idempotency request id.
--
-- The client does NOT choose:
--   * offering_member_id;
--   * coordinates;
--   * provider identity;
--   * intent_key;
--   * version;
--   * status;
--   * route evidence.
--
-- The existing 0024 planning-horizon trigger remains authoritative for
-- departure-time eligibility.

CREATE TABLE private.offering_movement_intent_creation_receipts (
  request_id uuid PRIMARY KEY,
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL UNIQUE
    REFERENCES private.offering_movement_intents(id),
  origin_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),
  destination_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),
  earliest_departure_at timestamptz NOT NULL,
  latest_departure_at timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now()
    CHECK (isfinite(recorded_at)),
  CHECK (
    origin_location_reference_id
      <> destination_location_reference_id
  ),
  CHECK (
    latest_departure_at IS NULL
    OR latest_departure_at >= earliest_departure_at
  )
);

ALTER TABLE
  private.offering_movement_intent_creation_receipts
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.offering_movement_intent_creation_receipts
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION private.protect_offering_movement_intent_creation_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent creation receipts are immutable';
  END IF;

  IF NEW.recorded_at > clock_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent creation receipt time is invalid';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION private.protect_offering_movement_intent_creation_receipt()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_offering_movement_intent_creation_receipt
BEFORE INSERT OR UPDATE OR DELETE
ON private.offering_movement_intent_creation_receipts
FOR EACH ROW
EXECUTE FUNCTION
  private.protect_offering_movement_intent_creation_receipt();


CREATE FUNCTION public.create_offering_movement_intent(
  p_request_id uuid,
  p_origin_location_reference_id uuid,
  p_destination_location_reference_id uuid,
  p_earliest_departure_at timestamptz,
  p_latest_departure_at timestamptz DEFAULT NULL
)
RETURNS TABLE (
  offering_movement_intent_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_offering_intent$
DECLARE
  v_member_id uuid;
  v_now timestamptz;

  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
  v_location private.movement_location_references%ROWTYPE;

  v_existing
    private.offering_movement_intent_creation_receipts%ROWTYPE;

  v_intent_id uuid;
  v_intent_key uuid;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'Offering movement intent intake requires READ COMMITTED';
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
    FROM public.members m
    WHERE m.id = v_member_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Member record not found for the authenticated user';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent request identity is required';
  END IF;

  IF p_origin_location_reference_id IS NULL
     OR p_destination_location_reference_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent origin and destination are required';
  END IF;

  IF p_origin_location_reference_id
       = p_destination_location_reference_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent requires distinct origin and destination';
  END IF;

  IF p_earliest_departure_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent earliest departure is required';
  END IF;

  IF NOT isfinite(p_earliest_departure_at)
     OR (
       p_latest_departure_at IS NOT NULL
       AND NOT isfinite(p_latest_departure_at)
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent departure times must be finite';
  END IF;

  IF p_latest_departure_at IS NOT NULL
     AND p_latest_departure_at < p_earliest_departure_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent latest departure cannot be before earliest departure';
  END IF;

  -- -------------------------------------------------------
  -- Fast idempotent replay path.
  -- -------------------------------------------------------

  SELECT r.*
  INTO v_existing
  FROM private.offering_movement_intent_creation_receipts r
  WHERE r.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.offering_member_id IS DISTINCT FROM v_member_id
       OR v_existing.origin_location_reference_id
            IS DISTINCT FROM p_origin_location_reference_id
       OR v_existing.destination_location_reference_id
            IS DISTINCT FROM p_destination_location_reference_id
       OR v_existing.earliest_departure_at
            IS DISTINCT FROM p_earliest_departure_at
       OR v_existing.latest_departure_at
            IS DISTINCT FROM p_latest_departure_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Offering movement intent request replay does not match the original request';
    END IF;

    PERFORM private.assert_offering_movement_intent(
      v_existing.offering_movement_intent_id
    );

    RETURN QUERY
    SELECT v_existing.offering_movement_intent_id;

    RETURN;
  END IF;

  -- -------------------------------------------------------
  -- Lock both trusted endpoint rows in deterministic UUID
  -- order. This avoids opposite origin/destination lock order
  -- between concurrent requests.
  -- -------------------------------------------------------

  FOR v_location IN
    SELECT lr.*
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      p_origin_location_reference_id,
      p_destination_location_reference_id
    )
    ORDER BY lr.id
    FOR SHARE
  LOOP
    IF v_location.id = p_origin_location_reference_id THEN
      v_origin := v_location;
    ELSIF v_location.id = p_destination_location_reference_id THEN
      v_destination := v_location;
    END IF;
  END LOOP;

  IF v_origin.id IS NULL OR v_destination.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent trusted location was not found';
  END IF;

  v_now := clock_timestamp();

  IF v_origin.owner_member_id IS DISTINCT FROM v_member_id
     OR v_destination.owner_member_id IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Offering movement intent locations do not belong to the authenticated member';
  END IF;

  IF v_origin.resolution_status <> 'resolved'
     OR v_destination.resolution_status <> 'resolved'
     OR v_origin.source_kind <> 'provider_resolved'
     OR v_destination.source_kind <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent requires trusted resolved locations';
  END IF;

  IF v_origin.latitude IS NULL
     OR v_origin.longitude IS NULL
     OR v_destination.latitude IS NULL
     OR v_destination.longitude IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent trusted coordinates are incomplete';
  END IF;

  IF (
       v_origin.expires_at IS NOT NULL
       AND v_origin.expires_at <= v_now
     )
     OR (
       v_destination.expires_at IS NOT NULL
       AND v_destination.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent trusted location has expired';
  END IF;

  -- -------------------------------------------------------
  -- First creation / concurrent retry-safe creation.
  --
  -- The nested block is a PL/pgSQL subtransaction. If a
  -- concurrent request wins the same request_id race, every
  -- insert below from the losing attempt is rolled back.
  -- -------------------------------------------------------

  BEGIN
    v_now := clock_timestamp();
    v_intent_key := gen_random_uuid();

    INSERT INTO private.offering_movement_intents (
      offering_member_id,
      intent_key,
      version,
      earliest_departure_at,
      latest_departure_at,
      created_at,
      expires_at,
      status
    )
    VALUES (
      v_member_id,
      v_intent_key,
      1,
      p_earliest_departure_at,
      p_latest_departure_at,
      v_now,
      NULL,
      'current'
    )
    RETURNING id
    INTO v_intent_id;

    INSERT INTO private.offering_movement_intent_locations (
      intent_id,
      role,
      location_reference_id
    )
    VALUES
      (
        v_intent_id,
        'origin',
        p_origin_location_reference_id
      ),
      (
        v_intent_id,
        'destination',
        p_destination_location_reference_id
      );

    -- Explicitly validate completeness now rather than waiting
    -- only for the deferred constraint trigger at transaction end.
    PERFORM private.assert_offering_movement_intent(v_intent_id);

    INSERT INTO
      private.offering_movement_intent_creation_receipts (
        request_id,
        offering_member_id,
        offering_movement_intent_id,
        origin_location_reference_id,
        destination_location_reference_id,
        earliest_departure_at,
        latest_departure_at,
        recorded_at
      )
    VALUES (
      p_request_id,
      v_member_id,
      v_intent_id,
      p_origin_location_reference_id,
      p_destination_location_reference_id,
      p_earliest_departure_at,
      p_latest_departure_at,
      v_now
    );

  EXCEPTION
    WHEN unique_violation THEN
      -- If another transaction won the same idempotency request,
      -- this subtransaction has already removed the losing intent
      -- and its child rows. Re-read the winner.
      SELECT r.*
      INTO v_existing
      FROM private.offering_movement_intent_creation_receipts r
      WHERE r.request_id = p_request_id;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      IF v_existing.offering_member_id IS DISTINCT FROM v_member_id
         OR v_existing.origin_location_reference_id
              IS DISTINCT FROM p_origin_location_reference_id
         OR v_existing.destination_location_reference_id
              IS DISTINCT FROM p_destination_location_reference_id
         OR v_existing.earliest_departure_at
              IS DISTINCT FROM p_earliest_departure_at
         OR v_existing.latest_departure_at
              IS DISTINCT FROM p_latest_departure_at THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Offering movement intent request replay does not match the original request';
      END IF;

      PERFORM private.assert_offering_movement_intent(
        v_existing.offering_movement_intent_id
      );

      RETURN QUERY
      SELECT v_existing.offering_movement_intent_id;

      RETURN;
  END;

  RETURN QUERY
  SELECT v_intent_id;
END;
$create_offering_intent$;


REVOKE ALL
ON FUNCTION public.create_offering_movement_intent(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.create_offering_movement_intent(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz
)
TO authenticated;

COMMIT;