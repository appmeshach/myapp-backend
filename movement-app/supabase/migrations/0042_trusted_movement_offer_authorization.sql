BEGIN;

-- =========================================================
-- 0042 Trusted movement-offer authorization
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- A requester may be visible through masked discovery before
-- an offerer has established their own movement.
--
-- But a movement offer may attach to that requester only after
-- the offerer has:
--
--   1. created their own trusted movement intent;
--   2. produced a trusted route for that intent;
--   3. produced trusted route-match evidence for this exact
--      requester movement need.
--
-- The route-match evidence records objective geographic facts.
-- It does not itself represent willingness or agreement.
--
-- This migration keeps the route-match authorization private.
-- No route evidence ids, coordinates, route geometry or private
-- requester destination facts are added to movement_offers.
--
-- Vehicle choice remains an offer-time decision. The existing
-- live vehicle-access and seat-capacity checks are preserved.


-- =========================================================
-- Private immutable offer -> trusted route-match binding
-- =========================================================
--
-- movement_offer_id and movement_need_id intentionally have no
-- foreign keys.
--
-- movement_needs are historically deletable and their offers
-- cascade-delete with them. This private authorization history
-- must not make that existing deletion behavior impossible.
--
-- The binding therefore preserves the historical identifiers
-- even if the public operational rows later disappear.

CREATE TABLE private.movement_offer_route_match_bindings (
  movement_offer_id uuid PRIMARY KEY,

  movement_need_id uuid NOT NULL,

  offering_member_id uuid NOT NULL
    REFERENCES public.members(id),

  offering_movement_intent_id uuid NOT NULL
    REFERENCES private.offering_movement_intents(id),

  route_match_evidence_id uuid NOT NULL UNIQUE
    REFERENCES private.trusted_route_match_evidence(id),

  route_match_evidence_version integer NOT NULL
    CHECK (route_match_evidence_version >= 1),

  binding_schema_version text NOT NULL
    CHECK (
      binding_schema_version =
        'movement_offer_route_match_binding_v1'
    ),

  bound_at timestamptz NOT NULL
    DEFAULT clock_timestamp()
    CHECK (isfinite(bound_at))
);


ALTER TABLE private.movement_offer_route_match_bindings
ENABLE ROW LEVEL SECURITY;


REVOKE ALL
ON private.movement_offer_route_match_bindings
FROM PUBLIC, anon, authenticated, service_role;


GRANT SELECT
ON private.movement_offer_route_match_bindings
TO service_role;


-- =========================================================
-- Binding immutability
-- =========================================================

CREATE FUNCTION
private.protect_movement_offer_route_match_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect_movement_offer_route_match_binding$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement offer route-match authorization history cannot be deleted';
  END IF;

  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement offer route-match authorization is immutable';
  END IF;

  RETURN NEW;
END;
$protect_movement_offer_route_match_binding$;


REVOKE ALL
ON FUNCTION
private.protect_movement_offer_route_match_binding()
FROM PUBLIC, anon, authenticated, service_role;


CREATE TRIGGER
protect_movement_offer_route_match_binding
BEFORE UPDATE OR DELETE
ON private.movement_offer_route_match_bindings
FOR EACH ROW
EXECUTE FUNCTION
private.protect_movement_offer_route_match_binding();


-- =========================================================
-- Binding assertion
-- =========================================================
--
-- Lock order:
--
--   movement need
--   -> movement offer
--   -> trusted matching context dependencies
--
-- The trusted route-match assertion reuses the reviewed
-- matching-context lock order:
--
--   need
--   -> requester endpoints
--   -> offering intent
--   -> current trusted route evidence
--
-- The route-match writer also serializes replacement by first
-- taking the movement-need lock. Therefore a caller holding the
-- need lock cannot have its exact route-match evidence silently
-- superseded during this authorization decision.

CREATE FUNCTION
private.assert_movement_offer_route_match_binding(
  p_movement_offer_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_movement_offer_route_match_binding$
DECLARE
  v_binding
    private.movement_offer_route_match_bindings%ROWTYPE;

  v_need
    public.movement_needs%ROWTYPE;

  v_offer
    public.movement_offers%ROWTYPE;

  v_evidence
    private.trusted_route_match_evidence%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Movement offer route-match authorization requires READ COMMITTED';
  END IF;


  IF p_movement_offer_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Movement offer is required for route-match authorization';
  END IF;


  SELECT b.*
  INTO STRICT v_binding
  FROM private.movement_offer_route_match_bindings b
  WHERE b.movement_offer_id = p_movement_offer_id;


  SELECT n.*
  INTO STRICT v_need
  FROM public.movement_needs n
  WHERE n.id = v_binding.movement_need_id
  FOR SHARE;


  SELECT o.*
  INTO STRICT v_offer
  FROM public.movement_offers o
  WHERE o.id = v_binding.movement_offer_id
    AND o.movement_need_id = v_need.id
  FOR SHARE;


  IF v_offer.movement_need_id
       IS DISTINCT FROM v_binding.movement_need_id
     OR v_offer.offering_member_id
       IS DISTINCT FROM v_binding.offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement offer does not match trusted route-match authorization';
  END IF;


  SELECT e.*
  INTO STRICT v_evidence
  FROM private.trusted_route_match_evidence e
  WHERE e.id = v_binding.route_match_evidence_id;


  IF v_evidence.movement_need_id
       IS DISTINCT FROM v_binding.movement_need_id
     OR v_evidence.offering_member_id
       IS DISTINCT FROM v_binding.offering_member_id
     OR v_evidence.offering_movement_intent_id
       IS DISTINCT FROM v_binding.offering_movement_intent_id
     OR v_evidence.version
       IS DISTINCT FROM v_binding.route_match_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence does not match movement offer authorization';
  END IF;


  PERFORM
    private.assert_trusted_route_match_evidence(
      v_evidence.id
    );
END;
$assert_movement_offer_route_match_binding$;


REVOKE ALL
ON FUNCTION
private.assert_movement_offer_route_match_binding(uuid)
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION
private.validate_movement_offer_route_match_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $validate_movement_offer_route_match_binding$
BEGIN
  PERFORM
    private.assert_movement_offer_route_match_binding(
      NEW.movement_offer_id
    );

  RETURN NULL;
END;
$validate_movement_offer_route_match_binding$;


REVOKE ALL
ON FUNCTION
private.validate_movement_offer_route_match_binding()
FROM PUBLIC, anon, authenticated, service_role;


CREATE CONSTRAINT TRIGGER
movement_offer_route_match_binding_complete
AFTER INSERT
ON private.movement_offer_route_match_bindings
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION
private.validate_movement_offer_route_match_binding();


-- =========================================================
-- Close the old offer-creation path
-- =========================================================
--
-- Leaving the old six-argument overload installed would allow
-- an authenticated member to bypass trusted route matching.

REVOKE ALL
ON FUNCTION public.create_movement_offer(
  uuid,
  uuid,
  integer,
  text,
  text,
  integer
)
FROM PUBLIC, anon, authenticated, service_role;


DROP FUNCTION public.create_movement_offer(
  uuid,
  uuid,
  integer,
  text,
  text,
  integer
);


-- =========================================================
-- Trusted movement-offer creation
-- =========================================================

CREATE FUNCTION public.create_movement_offer(
  p_movement_need_id uuid,
  p_route_match_evidence_id uuid,
  p_vehicle_id uuid,
  p_seats_offered integer,
  p_proposed_pickup_area text DEFAULT NULL,
  p_proposed_dropoff_area text DEFAULT NULL,
  p_estimated_arrival_minutes integer DEFAULT NULL
)
RETURNS TABLE (
  movement_offer_id uuid,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $create_trusted_movement_offer$
DECLARE
  v_member_id uuid;

  v_need_record
    public.movement_needs%ROWTYPE;

  v_vehicle_record
    public.vehicles%ROWTYPE;

  v_evidence
    private.trusted_route_match_evidence%ROWTYPE;

  v_pickup_area text;
  v_dropoff_area text;

  v_offer_id uuid;
  v_offer_status text;
  v_created_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Movement offer creation requires READ COMMITTED';
  END IF;


  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;


  IF p_movement_need_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Movement need is required';
  END IF;


  IF p_route_match_evidence_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Trusted route-match evidence is required';
  END IF;


  IF p_vehicle_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Vehicle is required';
  END IF;


  -- =======================================================
  -- Movement need is the serialization boundary.
  --
  -- This preserves the lock order already used by trusted
  -- route-match evidence creation.
  -- =======================================================

  SELECT mn.*
  INTO v_need_record
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;


  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable';
  END IF;


  IF v_need_record.member_id = v_member_id THEN
    RAISE EXCEPTION
      'You cannot offer on your own movement need';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM public.alignments a
    WHERE a.movement_need_id = v_need_record.id
      AND a.status IN (
        'awaiting_activation_payment',
        'activated',
        'in_progress',
        'completed'
      )
  ) THEN
    RAISE EXCEPTION
      'This movement need already has an active or completed alignment';
  END IF;


  -- =======================================================
  -- Exact trusted route-match evidence
  -- =======================================================

  SELECT e.*
  INTO v_evidence
  FROM private.trusted_route_match_evidence e
  WHERE e.id = p_route_match_evidence_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence is unavailable';
  END IF;


  IF v_evidence.movement_need_id
       IS DISTINCT FROM v_need_record.id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence does not belong to this movement need';
  END IF;


  IF v_evidence.offering_member_id
       IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Trusted route-match evidence does not belong to the authenticated member';
  END IF;


  -- This re-runs the authoritative trusted matching context.
  -- It proves that the exact evidence is still current,
  -- unexpired and bound to the still-current offering intent
  -- and trusted route.
  PERFORM
    private.assert_trusted_route_match_evidence(
      v_evidence.id
    );


  -- Re-read after validation while the movement-need lock still
  -- prevents a competing route-match writer from superseding
  -- the evidence.
  SELECT e.*
  INTO STRICT v_evidence
  FROM private.trusted_route_match_evidence e
  WHERE e.id = p_route_match_evidence_id;


  IF v_evidence.status <> 'current'
     OR (
       v_evidence.expires_at IS NOT NULL
       AND v_evidence.expires_at <= clock_timestamp()
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence is not current and unexpired';
  END IF;


  -- =======================================================
  -- Existing vehicle/access/capacity behavior
  -- =======================================================

  SELECT *
  INTO v_vehicle_record
  FROM public.vehicles AS v
  WHERE v.id = p_vehicle_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.member_vehicle_access AS mva
    WHERE mva.member_id = v_member_id
      AND mva.vehicle_id = p_vehicle_id
      AND mva.active = TRUE
  ) THEN
    RAISE EXCEPTION
      'Vehicle access not found for the authenticated user';
  END IF;


  IF p_seats_offered IS NULL THEN
    RAISE EXCEPTION 'Seats offered is required';
  END IF;


  IF p_seats_offered < 1 THEN
    RAISE EXCEPTION
      'Seats offered must be at least 1';
  END IF;


  IF p_seats_offered > v_vehicle_record.seat_capacity THEN
    RAISE EXCEPTION
      'Seats offered cannot exceed the vehicle seat capacity';
  END IF;


  IF p_seats_offered < v_need_record.people_count THEN
    RAISE EXCEPTION
      'Seats offered are fewer than the travellers declared for this movement';
  END IF;


  IF p_estimated_arrival_minutes IS NOT NULL
     AND p_estimated_arrival_minutes < 0 THEN
    RAISE EXCEPTION
      'Estimated arrival minutes cannot be negative';
  END IF;


  v_pickup_area := p_proposed_pickup_area;

  IF v_pickup_area IS NOT NULL THEN
    v_pickup_area := trim(v_pickup_area);

    IF v_pickup_area = '' THEN
      v_pickup_area := NULL;
    END IF;

    IF length(v_pickup_area) > 200 THEN
      RAISE EXCEPTION
        'Proposed pickup area must be 200 characters or fewer';
    END IF;
  END IF;


  v_dropoff_area := p_proposed_dropoff_area;

  IF v_dropoff_area IS NOT NULL THEN
    v_dropoff_area := trim(v_dropoff_area);

    IF v_dropoff_area = '' THEN
      v_dropoff_area := NULL;
    END IF;

    IF length(v_dropoff_area) > 200 THEN
      RAISE EXCEPTION
        'Proposed dropoff area must be 200 characters or fewer';
    END IF;
  END IF;


  -- =======================================================
  -- Offer and private authorization are one transaction
  -- =======================================================

  INSERT INTO public.movement_offers (
    movement_need_id,
    offering_member_id,
    vehicle_id,
    seats_offered,
    proposed_pickup_area,
    proposed_dropoff_area,
    estimated_arrival_minutes,
    status,
    created_at,
    updated_at
  )
  VALUES (
    v_need_record.id,
    v_member_id,
    p_vehicle_id,
    p_seats_offered,
    v_pickup_area,
    v_dropoff_area,
    p_estimated_arrival_minutes,
    'pending',
    NOW(),
    NOW()
  )
  RETURNING
    public.movement_offers.id,
    public.movement_offers.status,
    public.movement_offers.created_at
  INTO
    v_offer_id,
    v_offer_status,
    v_created_at;


  INSERT INTO private.movement_offer_route_match_bindings (
    movement_offer_id,
    movement_need_id,
    offering_member_id,
    offering_movement_intent_id,
    route_match_evidence_id,
    route_match_evidence_version,
    binding_schema_version,
    bound_at
  )
  VALUES (
    v_offer_id,
    v_need_record.id,
    v_member_id,
    v_evidence.offering_movement_intent_id,
    v_evidence.id,
    v_evidence.version,
    'movement_offer_route_match_binding_v1',
    clock_timestamp()
  );


  PERFORM
    private.assert_movement_offer_route_match_binding(
      v_offer_id
    );


  SET CONSTRAINTS
    private.movement_offer_route_match_binding_complete
    IMMEDIATE;

  SET CONSTRAINTS
    private.movement_offer_route_match_binding_complete
    DEFERRED;


  RETURN QUERY
  SELECT
    v_offer_id,
    v_offer_status,
    v_created_at;
END;
$create_trusted_movement_offer$;


REVOKE ALL
ON FUNCTION public.create_movement_offer(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  integer
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION public.create_movement_offer(
  uuid,
  uuid,
  uuid,
  integer,
  text,
  text,
  integer
)
TO authenticated;


-- =========================================================
-- Revalidate trusted authorization at offer acceptance
-- =========================================================
--
-- The public signature stays unchanged.
--
-- A pending offer is not sufficient evidence by itself.
-- Its exact trusted route-match evidence must still be current
-- and valid when the requester accepts it.

CREATE OR REPLACE FUNCTION public.accept_movement_offer(
  p_movement_offer_id uuid
)
RETURNS TABLE (
  alignment_id uuid,
  alignment_status text,
  movement_need_id uuid,
  movement_offer_id uuid,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $accept_trusted_movement_offer$
DECLARE
  v_member_id uuid;
  v_need_id uuid;

  v_offer_record
    public.movement_offers%ROWTYPE;

  v_need_record
    public.movement_needs%ROWTYPE;

  v_vehicle_record
    public.vehicles%ROWTYPE;

  v_binding
    private.movement_offer_route_match_bindings%ROWTYPE;

  v_alignment_id uuid;
  v_created_at timestamptz;

  v_confirmed_count integer;
  v_pending_count integer;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Movement offer acceptance requires READ COMMITTED';
  END IF;


  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;


  SELECT mo.movement_need_id
  INTO v_need_id
  FROM public.movement_offers AS mo
  WHERE mo.id = p_movement_offer_id;


  IF v_need_id IS NULL THEN
    RAISE EXCEPTION 'Movement offer not found';
  END IF;


  -- Preserve the existing need -> offer lock order.

  SELECT *
  INTO v_need_record
  FROM public.movement_needs AS mn
  WHERE mn.id = v_need_id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement need not found';
  END IF;


  SELECT *
  INTO v_offer_record
  FROM public.movement_offers AS mo
  WHERE mo.id = p_movement_offer_id
    AND mo.movement_need_id = v_need_record.id
  FOR UPDATE;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement offer not found';
  END IF;


  IF v_offer_record.status <> 'pending' THEN
    RAISE EXCEPTION 'Movement offer is not pending';
  END IF;


  IF v_need_record.status <> 'discoverable' THEN
    RAISE EXCEPTION 'Movement need is not discoverable';
  END IF;


  IF v_need_record.member_id <> v_member_id THEN
    RAISE EXCEPTION
      'Only the movement need owner may accept an offer';
  END IF;


  IF v_need_record.member_id =
       v_offer_record.offering_member_id THEN
    RAISE EXCEPTION
      'The offering member cannot accept their own offer';
  END IF;


  -- =======================================================
  -- Trusted offer authorization must exist and still validate
  -- =======================================================

  SELECT b.*
  INTO v_binding
  FROM private.movement_offer_route_match_bindings b
  WHERE b.movement_offer_id = v_offer_record.id;


  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement offer does not have trusted route-match authorization';
  END IF;


  IF v_binding.movement_need_id
       IS DISTINCT FROM v_need_record.id
     OR v_binding.offering_member_id
       IS DISTINCT FROM v_offer_record.offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement offer trusted route-match authorization does not match';
  END IF;


  PERFORM
    private.assert_movement_offer_route_match_binding(
      v_offer_record.id
    );


  -- =======================================================
  -- Existing vehicle/access/capacity behavior
  -- =======================================================

  IF NOT EXISTS (
    SELECT 1
    FROM public.member_vehicle_access AS mva
    WHERE mva.member_id =
            v_offer_record.offering_member_id
      AND mva.vehicle_id =
            v_offer_record.vehicle_id
      AND mva.active = TRUE
  ) THEN
    RAISE EXCEPTION
      'The offering member no longer has active access to this vehicle';
  END IF;


  SELECT *
  INTO v_vehicle_record
  FROM public.vehicles AS v
  WHERE v.id = v_offer_record.vehicle_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;


  IF v_offer_record.seats_offered >
       v_vehicle_record.seat_capacity THEN
    RAISE EXCEPTION
      'This offer now exceeds the vehicle seat capacity';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM public.alignments AS a
    WHERE a.movement_need_id = v_need_record.id
      AND a.status IN (
        'awaiting_activation_payment',
        'activated',
        'in_progress',
        'completed'
      )
  ) THEN
    RAISE EXCEPTION
      'This movement need already has an active or completed alignment';
  END IF;


  -- =======================================================
  -- Existing group-completeness behavior
  -- =======================================================

  SELECT COUNT(*)
  INTO v_confirmed_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = v_need_record.id
    AND mp.status = 'confirmed';


  SELECT COUNT(*)
  INTO v_pending_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = v_need_record.id
    AND mp.status = 'invited';


  IF v_confirmed_count <>
       v_need_record.people_count THEN
    RAISE EXCEPTION
      'All declared travellers must be confirmed before accepting an offer';
  END IF;


  IF v_pending_count > 0 THEN
    RAISE EXCEPTION
      'Pending traveller invitations must be resolved before accepting an offer';
  END IF;


  IF v_offer_record.seats_offered <
       v_need_record.people_count THEN
    RAISE EXCEPTION
      'This offer does not provide enough seats for the confirmed movement group';
  END IF;


  -- Revalidate immediately before the operational alignment
  -- write. The movement-need lock prevents concurrent trusted
  -- route-match replacement while this transaction proceeds.

  PERFORM
    private.assert_movement_offer_route_match_binding(
      v_offer_record.id
    );


  INSERT INTO public.alignments (
    movement_need_id,
    movement_offer_id,
    member_needing_movement_id,
    offering_member_id,
    activation_fee_minor,
    activation_currency,
    status,
    activated_at,
    created_at,
    updated_at
  )
  VALUES (
    v_need_record.id,
    v_offer_record.id,
    v_member_id,
    v_offer_record.offering_member_id,
    NULL,
    'NGN',
    'awaiting_activation_payment',
    NULL,
    NOW(),
    NOW()
  )
  RETURNING
    public.alignments.id,
    public.alignments.created_at
  INTO
    v_alignment_id,
    v_created_at;


  UPDATE public.movement_offers AS mo
  SET
    status = 'accepted',
    updated_at = NOW()
  WHERE mo.id = v_offer_record.id;


  UPDATE public.movement_needs AS mn
  SET
    status = 'closed',
    updated_at = NOW()
  WHERE mn.id = v_need_record.id;


  UPDATE public.movement_offers AS mo
  SET
    status = 'rejected',
    updated_at = NOW()
  WHERE mo.movement_need_id = v_need_record.id
    AND mo.id <> v_offer_record.id
    AND mo.status = 'pending';


  RETURN QUERY
  SELECT
    v_alignment_id,
    'awaiting_activation_payment'::text,
    v_need_record.id,
    v_offer_record.id,
    v_created_at;
END;
$accept_trusted_movement_offer$;


REVOKE ALL
ON FUNCTION public.accept_movement_offer(uuid)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION public.accept_movement_offer(uuid)
TO authenticated;


COMMIT;