BEGIN;

-- WE DO NOT CREATE JOURNEYS.
-- Construct immutable movement-context evidence from an already-existing,
-- still-pending and fully trusted movement offer.
-- No offer acceptance, capacity consumption, alignment, journey, pricing,
-- payment or financial consent occurs here.

-- 0022 introduced snapshots without a production writer. There must therefore
-- be no historical rows whose exact producer provenance would need fabrication.
LOCK TABLE private.movement_context_snapshots IN ACCESS EXCLUSIVE MODE;

DO $precondition$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM private.movement_context_snapshots
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = '0072 requires empty movement context snapshot history; never fabricate producer provenance';
  END IF;
END;
$precondition$;

-- Historical source binding.
-- This validates immutable copied facts against the movement offer and its
-- private authorization history. It does not require the offer to remain
-- pending forever; live eligibility is checked separately during construction.
CREATE FUNCTION private.assert_movement_context_snapshot_offer_binding(
  p private.movement_context_snapshots
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  o public.movement_offers%ROWTYPE;
  rb private.movement_offer_route_match_bindings%ROWTYPE;
  ab private.movement_offer_availability_bindings%ROWTYPE;
  m private.trusted_route_match_evidence%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  e private.offering_route_evidence%ROWTYPE;
BEGIN
  IF p.movement_offer_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Produced movement snapshot requires exact movement offer provenance';
  END IF;

  SELECT x.*
  INTO o
  FROM public.movement_offers x
  WHERE x.id = p.movement_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot offer provenance unavailable';
  END IF;

  SELECT x.*
  INTO rb
  FROM private.movement_offer_route_match_bindings x
  WHERE x.movement_offer_id = o.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot requires route-match authorization provenance';
  END IF;

  SELECT x.*
  INTO ab
  FROM private.movement_offer_availability_bindings x
  WHERE x.movement_offer_id = o.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot requires availability authorization provenance';
  END IF;

  SELECT x.*
  INTO STRICT m
  FROM private.trusted_route_match_evidence x
  WHERE x.id = rb.route_match_evidence_id;

  SELECT x.*
  INTO STRICT a
  FROM private.offering_movement_availability x
  WHERE x.id = ab.availability_id;

  SELECT x.*
  INTO STRICT e
  FROM private.offering_route_evidence x
  WHERE x.id = a.route_evidence_id;

  IF ROW(
      o.movement_need_id,
      o.offering_member_id,
      o.vehicle_id,
      o.seats_offered,
      o.proposed_pickup_area,
      o.proposed_dropoff_area,
      o.estimated_arrival_minutes
    )
    IS DISTINCT FROM ROW(
      p.movement_need_id,
      p.offering_member_id,
      p.vehicle_id,
      p.seats_offered,
      p.proposed_pickup_area,
      p.proposed_dropoff_area,
      p.declared_arrival_minutes
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot facts do not match exact movement offer';
  END IF;

  IF ROW(
      rb.movement_need_id,
      rb.offering_member_id,
      rb.offering_movement_intent_id,
      rb.route_match_evidence_version
    )
    IS DISTINCT FROM ROW(
      p.movement_need_id,
      p.offering_member_id,
      p.offering_movement_intent_id,
      m.version
    )
    OR m.id IS DISTINCT FROM rb.route_match_evidence_id
    OR m.requesting_member_id IS DISTINCT FROM p.requesting_member_id
    OR m.offering_intent_version IS DISTINCT FROM p.offering_intent_version
    OR m.requester_origin_location_reference_id
         IS DISTINCT FROM p.requester_origin_location_id
    OR m.requester_destination_location_reference_id
         IS DISTINCT FROM p.requester_destination_location_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot route-match provenance does not match';
  END IF;

  IF ROW(
      ab.movement_need_id,
      ab.offering_member_id,
      ab.offering_movement_intent_id,
      a.id,
      a.vehicle_id,
      a.route_evidence_id,
      a.route_evidence_version
    )
    IS DISTINCT FROM ROW(
      p.movement_need_id,
      p.offering_member_id,
      p.offering_movement_intent_id,
      ab.availability_id,
      p.vehicle_id,
      m.route_evidence_id,
      m.route_evidence_version
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot availability provenance does not match';
  END IF;

  IF ROW(
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.version,
      e.origin_location_reference_id,
      e.destination_location_reference_id
    )
    IS DISTINCT FROM ROW(
      p.offering_member_id,
      p.offering_movement_intent_id,
      m.route_evidence_version,
      p.offering_origin_location_id,
      p.offering_destination_location_id
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot offering route provenance does not match';
  END IF;

  IF p.created_at < o.created_at
    OR p.expires_at IS NULL
    OR p.expires_at > a.expires_at
    OR (
      m.expires_at IS NOT NULL
      AND p.expires_at > m.expires_at
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot lifetime exceeds trusted source lifetime';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION
  private.assert_movement_context_snapshot_offer_binding(
    private.movement_context_snapshots
  )
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.protect_produced_movement_context_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_movement_context_snapshot_offer_binding(NEW);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION
  private.protect_produced_movement_context_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_produced_movement_context_snapshot
BEFORE INSERT ON private.movement_context_snapshots
FOR EACH ROW
EXECUTE FUNCTION private.protect_produced_movement_context_snapshot();

CREATE FUNCTION public.record_movement_context_snapshot_for_server(
  p_movement_offer_id uuid
)
RETURNS TABLE (
  snapshot_id uuid,
  snapshot_version integer,
  snapshot_created_at timestamptz,
  snapshot_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  o public.movement_offers%ROWTYPE;
  n public.movement_needs%ROWTYPE;
  rb private.movement_offer_route_match_bindings%ROWTYPE;
  ab private.movement_offer_availability_bindings%ROWTYPE;
  m private.trusted_route_match_evidence%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  e private.offering_route_evidence%ROWTYPE;
  i private.offering_movement_intents%ROWTYPE;
  v public.vehicles%ROWTYPE;
  existing_snapshot private.movement_context_snapshots%ROWTYPE;
  s private.movement_context_snapshots%ROWTYPE;
  next_version bigint;
  confirmed_count bigint;
  invited_count bigint;
  created_now timestamptz;
  effective_expires_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE = 'Movement context snapshot producer requires READ COMMITTED';
  END IF;

  IF p_movement_offer_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Movement offer identity required';
  END IF;

  -- Preliminary reads discover the canonical need and immutable authorization
  -- selectors only. No lock is taken before the need identity is known.
  SELECT x.*
  INTO o
  FROM public.movement_offers x
  WHERE x.id = p_movement_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Exact movement offer unavailable';
  END IF;

  SELECT x.*
  INTO rb
  FROM private.movement_offer_route_match_bindings x
  WHERE x.movement_offer_id = o.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement offer lacks trusted route-match authorization';
  END IF;

  SELECT x.*
  INTO ab
  FROM private.movement_offer_availability_bindings x
  WHERE x.movement_offer_id = o.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement offer lacks trusted availability authorization';
  END IF;

  -- Preserve the reviewed operational order: need -> offer -> requester
  -- endpoints -> offering intent -> route -> availability -> vehicle/access.
  SELECT x.*
  INTO STRICT n
  FROM public.movement_needs x
  WHERE x.id = o.movement_need_id
  FOR UPDATE;

  SELECT x.*
  INTO STRICT o
  FROM public.movement_offers x
  WHERE x.id = p_movement_offer_id
    AND x.movement_need_id = n.id
  FOR UPDATE;

  -- 0045 owns the deeper lock order and complete trusted authorization checks.
  PERFORM private.assert_movement_offer_availability_binding(o.id);

  -- Re-read immutable bindings and sources after validation.
  SELECT x.*
  INTO STRICT rb
  FROM private.movement_offer_route_match_bindings x
  WHERE x.movement_offer_id = o.id;

  SELECT x.*
  INTO STRICT ab
  FROM private.movement_offer_availability_bindings x
  WHERE x.movement_offer_id = o.id;

  SELECT x.*
  INTO STRICT m
  FROM private.trusted_route_match_evidence x
  WHERE x.id = rb.route_match_evidence_id;

  SELECT x.*
  INTO STRICT a
  FROM private.offering_movement_availability x
  WHERE x.id = ab.availability_id;

  SELECT x.*
  INTO STRICT e
  FROM private.offering_route_evidence x
  WHERE x.id = a.route_evidence_id;

  SELECT x.*
  INTO STRICT i
  FROM private.offering_movement_intents x
  WHERE x.id = rb.offering_movement_intent_id;

  SELECT x.*
  INTO STRICT v
  FROM public.vehicles x
  WHERE x.id = o.vehicle_id;

  IF o.status IS DISTINCT FROM 'pending'
    OR n.status IS DISTINCT FROM 'discoverable' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement context snapshot requires a pending offer for an available need';
  END IF;

  IF ROW(
      rb.movement_need_id,
      rb.offering_member_id,
      ab.movement_need_id,
      ab.offering_member_id,
      ab.offering_movement_intent_id
    )
    IS DISTINCT FROM ROW(
      n.id,
      o.offering_member_id,
      n.id,
      o.offering_member_id,
      rb.offering_movement_intent_id
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement offer authorization identities do not agree';
  END IF;

  SELECT count(*)
  INTO confirmed_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = n.id
    AND mp.status = 'confirmed';

  SELECT count(*)
  INTO invited_count
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = n.id
    AND mp.status = 'invited';

  IF confirmed_count IS DISTINCT FROM n.people_count::bigint
    OR invited_count <> 0
    OR NOT EXISTS (
      SELECT 1
      FROM public.movement_participants mp
      WHERE mp.movement_need_id = n.id
        AND mp.member_id = n.member_id
        AND mp.role = 'primary_requester'
        AND mp.status = 'confirmed'
    )
    OR EXISTS (
      SELECT 1
      FROM public.movement_participants mp
      WHERE mp.movement_need_id = n.id
        AND mp.status = 'confirmed'
        AND (
          mp.member_id = o.offering_member_id
          OR
          (mp.role = 'primary_requester')
            IS DISTINCT FROM (mp.member_id = n.member_id)
        )
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement context snapshot requires the exact confirmed requester roster';
  END IF;

  -- The need UPDATE lock serializes snapshot history and participant mutation.
  PERFORM x.id
  FROM private.movement_context_snapshots x
  WHERE x.movement_need_id = n.id
    AND x.offering_member_id = o.offering_member_id
  ORDER BY x.version
  FOR UPDATE;

  SELECT x.*
  INTO existing_snapshot
  FROM private.movement_context_snapshots x
  WHERE x.movement_need_id = n.id
    AND x.offering_member_id = o.offering_member_id
    AND x.status = 'current';

  IF FOUND THEN
    IF existing_snapshot.movement_offer_id IS NOT DISTINCT FROM o.id THEN
      PERFORM private.assert_movement_context_snapshot_offer_binding(
        existing_snapshot
      );

      PERFORM private.assert_movement_context_snapshot(
        existing_snapshot.id
      );

      RETURN QUERY
      SELECT
        existing_snapshot.id,
        existing_snapshot.version,
        existing_snapshot.created_at,
        existing_snapshot.expires_at;

      RETURN;
    END IF;

    UPDATE private.movement_context_snapshots x
    SET status = 'superseded'
    WHERE x.id = existing_snapshot.id;
  END IF;

  SELECT coalesce(max(x.version)::bigint, 0) + 1
  INTO next_version
  FROM private.movement_context_snapshots x
  WHERE x.movement_need_id = n.id
    AND x.offering_member_id = o.offering_member_id;

  IF next_version > 2147483647 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement context snapshot version exhausted';
  END IF;

  created_now := clock_timestamp();

  effective_expires_at := a.expires_at;

  IF m.expires_at IS NOT NULL
    AND m.expires_at < effective_expires_at THEN
    effective_expires_at := m.expires_at;
  END IF;

  IF effective_expires_at <= created_now THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement context snapshot sources expired before construction';
  END IF;

  INSERT INTO private.movement_context_snapshots (
    movement_need_id,
    requesting_member_id,
    offering_member_id,
    offering_movement_intent_id,
    offering_intent_version,
    vehicle_id,
    movement_offer_id,
    version,
    context_schema_version,
    people_count,
    seats_offered,
    vehicle_seat_capacity,
    requester_origin_area,
    requester_destination_area,
    requester_earliest_departure_at,
    requester_latest_departure_at,
    offering_earliest_departure_at,
    offering_latest_departure_at,
    requester_origin_location_id,
    requester_destination_location_id,
    offering_origin_location_id,
    offering_destination_location_id,
    proposed_pickup_area,
    proposed_dropoff_area,
    declared_arrival_minutes,
    created_at,
    expires_at,
    status
  )
  VALUES (
    n.id,
    n.member_id,
    o.offering_member_id,
    rb.offering_movement_intent_id,
    m.offering_intent_version,
    o.vehicle_id,
    o.id,
    next_version::integer,
    'movement_context_v1',
    n.people_count,
    o.seats_offered,
    v.seat_capacity,
    n.origin_area,
    n.destination_area,
    n.earliest_departure_at,
    n.latest_departure_at,
    i.earliest_departure_at,
    i.latest_departure_at,
    m.requester_origin_location_reference_id,
    m.requester_destination_location_reference_id,
    e.origin_location_reference_id,
    e.destination_location_reference_id,
    o.proposed_pickup_area,
    o.proposed_dropoff_area,
    o.estimated_arrival_minutes,
    created_now,
    effective_expires_at,
    'current'
  )
  RETURNING *
  INTO s;

  INSERT INTO private.movement_context_snapshot_travellers (
    snapshot_id,
    member_id,
    movement_participant_id,
    role
  )
  SELECT
    s.id,
    mp.member_id,
    mp.id,
    mp.role
  FROM public.movement_participants mp
  WHERE mp.movement_need_id = n.id
    AND mp.status = 'confirmed'
  ORDER BY mp.id;

  -- Force complete validation inside this trusted RPC rather than waiting only
  -- for the existing deferred transaction-end checks.
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);

  RETURN QUERY
  SELECT
    s.id,
    s.version,
    s.created_at,
    s.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION
  public.record_movement_context_snapshot_for_server(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.record_movement_context_snapshot_for_server(uuid)
  TO service_role;

COMMIT;