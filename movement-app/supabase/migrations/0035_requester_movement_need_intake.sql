BEGIN;

-- =========================================================
-- Trusted requester movement-need intake
-- =========================================================
--
-- A requester may create a movement need only from trusted,
-- provider-resolved location references belonging to the
-- authenticated member.
--
-- The client may choose only:
--   * an idempotency request id;
--   * its trusted origin location reference;
--   * its trusted destination location reference;
--   * its departure window;
--   * the number of real travellers represented by the need.
--
-- The client does NOT choose:
--   * member_id;
--   * coordinates;
--   * provider identity;
--   * movement-need status;
--   * arbitrary origin/destination database text.
--
-- origin_area and destination_area remain on the legacy/core
-- movement_needs row for existing discovery/display contracts,
-- but are derived here from the trusted resolved locations.
--
-- The existing 0024 movement planning-horizon trigger remains
-- authoritative for the 24-hour departure rule.


-- =========================================================
-- Trusted requester endpoint bindings
-- =========================================================

CREATE TABLE private.movement_need_locations (
  movement_need_id uuid NOT NULL
    REFERENCES public.movement_needs(id)
    ON DELETE CASCADE,

  role text NOT NULL
    CHECK (role IN ('origin', 'destination')),

  location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  PRIMARY KEY (movement_need_id, role),

  UNIQUE (
    movement_need_id,
    location_reference_id
  )
);

ALTER TABLE private.movement_need_locations
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.movement_need_locations
FROM PUBLIC, anon, authenticated, service_role;


-- =========================================================
-- Protect trusted requester endpoint bindings
-- =========================================================

CREATE FUNCTION private.protect_movement_need_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect_location$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need trusted location bindings are immutable';
  END IF;

  RETURN NEW;
END;
$protect_location$;

REVOKE ALL
ON FUNCTION private.protect_movement_need_location()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_movement_need_location
BEFORE UPDATE
ON private.movement_need_locations
FOR EACH ROW
EXECUTE FUNCTION private.protect_movement_need_location();


-- =========================================================
-- Idempotency receipts
-- =========================================================
--
-- movement_need_id intentionally has no foreign key.
--
-- Existing movement_needs are historically deletable by their
-- owners. Keeping the receipt independent means an already-used
-- request identity cannot silently become a brand-new request
-- merely because the original movement need was later deleted.

CREATE TABLE private.movement_need_creation_receipts (
  request_id uuid PRIMARY KEY,

  requesting_member_id uuid NOT NULL
    REFERENCES public.members(id),

  movement_need_id uuid NOT NULL UNIQUE,

  origin_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  destination_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  earliest_departure_at timestamptz NOT NULL,

  latest_departure_at timestamptz,

  people_count integer NOT NULL
    CHECK (people_count >= 1),

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

ALTER TABLE private.movement_need_creation_receipts
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.movement_need_creation_receipts
FROM PUBLIC, anon, authenticated, service_role;


-- =========================================================
-- Protect creation receipts
-- =========================================================

CREATE FUNCTION private.protect_movement_need_creation_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need creation receipts are immutable';
  END IF;

  IF NEW.recorded_at > clock_timestamp() THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need creation receipt time is invalid';
  END IF;

  RETURN NEW;
END;
$protect$;

REVOKE ALL
ON FUNCTION private.protect_movement_need_creation_receipt()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_movement_need_creation_receipt
BEFORE INSERT OR UPDATE OR DELETE
ON private.movement_need_creation_receipts
FOR EACH ROW
EXECUTE FUNCTION
  private.protect_movement_need_creation_receipt();


-- =========================================================
-- Secure movement-need creation RPC
-- =========================================================

CREATE FUNCTION public.create_movement_need(
  p_request_id uuid,
  p_origin_location_reference_id uuid,
  p_destination_location_reference_id uuid,
  p_earliest_departure_at timestamptz,
  p_latest_departure_at timestamptz DEFAULT NULL,
  p_people_count integer DEFAULT 1
)
RETURNS TABLE (
  movement_need_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_movement_need$
DECLARE
  v_member_id uuid;
  v_now timestamptz;

  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
  v_location private.movement_location_references%ROWTYPE;

  v_existing
    private.movement_need_creation_receipts%ROWTYPE;

  v_need_id uuid;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'Movement need intake requires READ COMMITTED';
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
      MESSAGE = 'Movement need request identity is required';
  END IF;

  IF p_origin_location_reference_id IS NULL
     OR p_destination_location_reference_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need origin and destination are required';
  END IF;

  IF p_origin_location_reference_id
       = p_destination_location_reference_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need requires distinct origin and destination';
  END IF;

  IF p_earliest_departure_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need earliest departure is required';
  END IF;

  IF NOT isfinite(p_earliest_departure_at)
     OR (
       p_latest_departure_at IS NOT NULL
       AND NOT isfinite(p_latest_departure_at)
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need departure times must be finite';
  END IF;

  IF p_latest_departure_at IS NOT NULL
     AND p_latest_departure_at < p_earliest_departure_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need latest departure cannot be before earliest departure';
  END IF;

  IF p_people_count IS NULL
     OR p_people_count < 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need people count must be at least one';
  END IF;


  -- =======================================================
  -- Fast idempotent replay path
  -- =======================================================

  SELECT r.*
  INTO v_existing
  FROM private.movement_need_creation_receipts r
  WHERE r.request_id = p_request_id;

  IF FOUND THEN
    IF v_existing.requesting_member_id
         IS DISTINCT FROM v_member_id
       OR v_existing.origin_location_reference_id
         IS DISTINCT FROM p_origin_location_reference_id
       OR v_existing.destination_location_reference_id
         IS DISTINCT FROM p_destination_location_reference_id
       OR v_existing.earliest_departure_at
         IS DISTINCT FROM p_earliest_departure_at
       OR v_existing.latest_departure_at
         IS DISTINCT FROM p_latest_departure_at
       OR v_existing.people_count
         IS DISTINCT FROM p_people_count THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Movement need request replay does not match the original request';
    END IF;

      SELECT n.id
    INTO v_need_id
    FROM public.movement_needs n
    WHERE n.id = v_existing.movement_need_id
      AND n.member_id = v_member_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Original movement need for this request no longer exists';
    END IF;

    RETURN QUERY
    SELECT v_need_id;

    RETURN;
  END IF;


  -- =======================================================
  -- Lock the two trusted endpoint rows in deterministic UUID
  -- order so concurrent requests cannot acquire them in
  -- opposite origin/destination order.
  -- =======================================================

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

    ELSIF v_location.id
            = p_destination_location_reference_id THEN
      v_destination := v_location;
    END IF;
  END LOOP;

  IF v_origin.id IS NULL
     OR v_destination.id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need trusted location was not found';
  END IF;

  v_now := clock_timestamp();

  IF v_origin.owner_member_id IS DISTINCT FROM v_member_id
     OR v_destination.owner_member_id
          IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Movement need locations do not belong to the authenticated member';
  END IF;

  IF v_origin.resolution_status <> 'resolved'
     OR v_destination.resolution_status <> 'resolved'
     OR v_origin.source_kind <> 'provider_resolved'
     OR v_destination.source_kind <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need requires trusted resolved locations';
  END IF;

  IF v_origin.latitude IS NULL
     OR v_origin.longitude IS NULL
     OR v_destination.latitude IS NULL
     OR v_destination.longitude IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need trusted coordinates are incomplete';
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
      MESSAGE = 'Movement need trusted location has expired';
  END IF;


  -- =======================================================
  -- First creation / concurrent retry-safe creation
  -- =======================================================
  --
  -- If another transaction wins the same request_id race,
  -- this nested PL/pgSQL block rolls back the losing need,
  -- its automatically-created primary requester participant,
  -- and its trusted-location bindings before re-reading the
  -- winning receipt.

  BEGIN
    v_now := clock_timestamp();

    INSERT INTO public.movement_needs (
      member_id,
      origin_area,
      destination_area,
      earliest_departure_at,
      latest_departure_at,
      people_count,
      status
    )
    VALUES (
      v_member_id,
      v_origin.declared_label,
      v_destination.declared_label,
      p_earliest_departure_at,
      p_latest_departure_at,
      p_people_count,
      'discoverable'
    )
    RETURNING id
    INTO v_need_id;


    INSERT INTO private.movement_need_locations (
      movement_need_id,
      role,
      location_reference_id
    )
    VALUES
      (
        v_need_id,
        'origin',
        p_origin_location_reference_id
      ),
      (
        v_need_id,
        'destination',
        p_destination_location_reference_id
      );


    IF (
      SELECT count(*)
      FROM private.movement_need_locations l
      WHERE l.movement_need_id = v_need_id
    ) <> 2 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Movement need requires exactly origin and destination';
    END IF;


    INSERT INTO private.movement_need_creation_receipts (
      request_id,
      requesting_member_id,
      movement_need_id,
      origin_location_reference_id,
      destination_location_reference_id,
      earliest_departure_at,
      latest_departure_at,
      people_count,
      recorded_at
    )
    VALUES (
      p_request_id,
      v_member_id,
      v_need_id,
      p_origin_location_reference_id,
      p_destination_location_reference_id,
      p_earliest_departure_at,
      p_latest_departure_at,
      p_people_count,
      v_now
    );

  EXCEPTION
    WHEN unique_violation THEN
      SELECT r.*
      INTO v_existing
      FROM private.movement_need_creation_receipts r
      WHERE r.request_id = p_request_id;

      IF NOT FOUND THEN
        RAISE;
      END IF;

      IF v_existing.requesting_member_id
           IS DISTINCT FROM v_member_id
         OR v_existing.origin_location_reference_id
           IS DISTINCT FROM p_origin_location_reference_id
         OR v_existing.destination_location_reference_id
           IS DISTINCT FROM p_destination_location_reference_id
         OR v_existing.earliest_departure_at
           IS DISTINCT FROM p_earliest_departure_at
         OR v_existing.latest_departure_at
           IS DISTINCT FROM p_latest_departure_at
         OR v_existing.people_count
           IS DISTINCT FROM p_people_count THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Movement need request replay does not match the original request';
      END IF;

      SELECT n.id
      INTO v_need_id
      FROM public.movement_needs n
      WHERE n.id = v_existing.movement_need_id
        AND n.member_id = v_member_id
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          MESSAGE = 'Original movement need for this request no longer exists';
      END IF;

      RETURN QUERY
      SELECT v_need_id;

      RETURN;
  END;


  RETURN QUERY
  SELECT v_need_id;
END;
$create_movement_need$;


-- =========================================================
-- Close the old insecure creation path
-- =========================================================
--
-- RLS alone previously prevented one member from creating a
-- need for another member, but it still allowed the member to
-- supply arbitrary origin/destination text.
--
-- New movement needs must now go through create_movement_need()
-- so their endpoints are trusted before the row exists.

REVOKE INSERT
ON TABLE public.movement_needs
FROM authenticated;

DROP POLICY IF EXISTS "movement_needs_insert_own"
ON public.movement_needs;


-- =========================================================
-- RPC privileges
-- =========================================================

REVOKE ALL
ON FUNCTION public.create_movement_need(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer
)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.create_movement_need(
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer
)
TO authenticated;

COMMIT;
