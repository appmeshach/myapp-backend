BEGIN;

-- WE DO NOT CREATE JOURNEYS. This immutable history complements, rather than
-- replaces, 0042 route-match authorization. Public need/offer identifiers have
-- no FK: their established deletion behavior must not erase private history.
CREATE TABLE private.movement_offer_availability_bindings (
  movement_offer_id uuid PRIMARY KEY,
  movement_need_id uuid NOT NULL,
  availability_id uuid NOT NULL REFERENCES private.offering_movement_availability(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(bound_at))
);
ALTER TABLE private.movement_offer_availability_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.movement_offer_availability_bindings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.movement_offer_availability_bindings TO service_role;

CREATE FUNCTION private.protect_movement_offer_availability_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $protect$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Movement offer availability binding is immutable';
END;
$protect$;
REVOKE ALL ON FUNCTION private.protect_movement_offer_availability_binding()
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_movement_offer_availability_binding
BEFORE UPDATE OR DELETE ON private.movement_offer_availability_bindings
FOR EACH ROW EXECUTE FUNCTION private.protect_movement_offer_availability_binding();

-- Caller holds need (and offer on acceptance). Prelock requester endpoints
-- before intent, as in 0036. Taking UPDATE on the intent before the existing
-- route validators avoids SHARE-to-UPDATE upgrade deadlocks between competing
-- acceptances for different needs sharing one availability. No eligibility
-- decision is made here; existing assertions remain authoritative.
CREATE FUNCTION private.lock_offer_availability_intent(p_need_id uuid,p_intent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $lock$
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Offer availability requires READ COMMITTED';
  END IF;
  PERFORM 1 FROM public.movement_needs n WHERE n.id=p_need_id FOR UPDATE;
  PERFORM lr.id FROM private.movement_location_references lr
    JOIN private.movement_need_locations nl ON nl.location_reference_id=lr.id
    WHERE nl.movement_need_id=p_need_id ORDER BY lr.id FOR SHARE OF lr;
  PERFORM 1 FROM private.offering_movement_intents i WHERE i.id=p_intent_id FOR UPDATE;
END;
$lock$;
REVOKE ALL ON FUNCTION private.lock_offer_availability_intent(uuid,uuid)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_movement_offer_availability_binding(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $assert$
DECLARE
  b private.movement_offer_availability_bindings%ROWTYPE;
  rb private.movement_offer_route_match_bindings%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  e private.trusted_route_match_evidence%ROWTYPE;
  o public.movement_offers%ROWTYPE;
  n public.movement_needs%ROWTYPE;
BEGIN
  SELECT x.* INTO STRICT b FROM private.movement_offer_availability_bindings x WHERE x.movement_offer_id=p_offer_id;
  SELECT x.* INTO STRICT n FROM public.movement_needs x WHERE x.id=b.movement_need_id FOR UPDATE;
  SELECT x.* INTO STRICT o FROM public.movement_offers x WHERE x.id=p_offer_id FOR UPDATE;
  PERFORM private.lock_offer_availability_intent(n.id,b.offering_movement_intent_id);
  PERFORM private.assert_movement_offer_route_match_binding(o.id);
  SELECT x.* INTO STRICT rb FROM private.movement_offer_route_match_bindings x WHERE x.movement_offer_id=o.id;
  SELECT x.* INTO STRICT e FROM private.trusted_route_match_evidence x WHERE x.id=rb.route_match_evidence_id;
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=b.availability_id;
  IF o.movement_need_id IS DISTINCT FROM n.id
    OR o.offering_member_id IS DISTINCT FROM b.offering_member_id
    OR rb.offering_movement_intent_id IS DISTINCT FROM b.offering_movement_intent_id
    OR a.offering_movement_intent_id IS DISTINCT FROM b.offering_movement_intent_id
    OR a.offering_member_id IS DISTINCT FROM b.offering_member_id
    OR a.vehicle_id IS DISTINCT FROM o.vehicle_id
    OR a.route_evidence_id IS DISTINCT FROM e.route_evidence_id
    OR a.route_evidence_version IS DISTINCT FROM e.route_evidence_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Movement offer availability binding does not match';
  END IF;
  -- 0044 locks exact route -> availability FOR UPDATE -> vehicle/access,
  -- revalidating live route, intent, lifecycle, expiry and access eligibility.
  PERFORM private.assert_offering_movement_availability(a.id);
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=b.availability_id;
  IF o.status<>'pending' OR n.status<>'discoverable'
    OR o.seats_offered<n.people_count OR o.seats_offered>a.total_places
    OR a.remaining_places<n.people_count THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Insufficient eligible availability for the complete requester group';
  END IF;
END;
$assert$;
REVOKE ALL ON FUNCTION private.assert_movement_offer_availability_binding(uuid)
FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_movement_offer_availability_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $validate$
BEGIN
  PERFORM private.assert_movement_offer_availability_binding(NEW.movement_offer_id);
  RETURN NULL;
END;
$validate$;
REVOKE ALL ON FUNCTION private.validate_movement_offer_availability_binding()
FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_movement_offer_availability_binding
AFTER INSERT ON private.movement_offer_availability_bindings
FOR EACH ROW EXECUTE FUNCTION private.validate_movement_offer_availability_binding();

-- Replace the vehicle parameter with availability (same SQL argument types).
-- Dropping first removes the old named-argument RPC; there is no legacy writer.
REVOKE ALL ON FUNCTION public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)
FROM PUBLIC,anon,authenticated,service_role;
DROP FUNCTION public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer);

CREATE FUNCTION public.create_movement_offer(
  p_movement_need_id uuid,
  p_route_match_evidence_id uuid,
  p_availability_id uuid,
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

  v_availability private.offering_movement_availability%ROWTYPE;

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


  IF NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=v_member_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
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


  IF p_availability_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Availability is required';
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


  SELECT a.* INTO v_availability
  FROM private.offering_movement_availability a WHERE a.id=p_availability_id;
  IF NOT FOUND OR v_availability.offering_member_id IS DISTINCT FROM v_member_id THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own offering availability required';
  END IF;
  IF v_availability.offering_movement_intent_id IS DISTINCT FROM v_evidence.offering_movement_intent_id
    OR v_availability.route_evidence_id IS DISTINCT FROM v_evidence.route_evidence_id
    OR v_availability.route_evidence_version IS DISTINCT FROM v_evidence.route_evidence_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability does not match the exact trusted route-match context';
  END IF;
  PERFORM private.lock_offer_availability_intent(v_need_record.id,v_evidence.offering_movement_intent_id);

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

  PERFORM private.assert_offering_movement_availability(v_availability.id);
  SELECT a.* INTO STRICT v_availability FROM private.offering_movement_availability a WHERE a.id=p_availability_id;
  IF v_need_record.people_count>v_availability.remaining_places OR p_seats_offered>v_availability.total_places THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Insufficient eligible availability for the complete requester group';
  END IF;

  SELECT *
  INTO v_vehicle_record
  FROM public.vehicles AS v
  WHERE v.id = v_availability.vehicle_id;


  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.member_vehicle_access AS mva
    WHERE mva.member_id = v_member_id
      AND mva.vehicle_id = v_availability.vehicle_id
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
    v_availability.vehicle_id,
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


  INSERT INTO private.movement_offer_availability_bindings(
    movement_offer_id,movement_need_id,availability_id,offering_member_id,offering_movement_intent_id
  ) VALUES(v_offer_id,v_need_record.id,v_availability.id,v_member_id,v_evidence.offering_movement_intent_id);
  -- The immediate binding trigger revalidates 0042 and 0044 together.
  -- Pending offers never change remaining_places.

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

  v_availability_id uuid;
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
    private.assert_movement_offer_availability_binding(
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
    private.assert_movement_offer_availability_binding(
      v_offer_record.id
    );


  -- Need lock serializes all roster mutations (0016 freeze_aligned_face_roster).
  -- In addition to 0042 count/invitation checks, require the primary requester
  -- and exclude the offerer from the confirmed traveller roster.
  IF NOT EXISTS(SELECT 1 FROM public.movement_participants mp
      WHERE mp.movement_need_id=v_need_record.id AND mp.member_id=v_member_id
        AND mp.role='primary_requester' AND mp.status='confirmed')
    OR EXISTS(SELECT 1 FROM public.movement_participants mp
      WHERE mp.movement_need_id=v_need_record.id AND mp.status='confirmed'
        AND (mp.member_id=v_offer_record.offering_member_id
          OR (mp.role='primary_requester') IS DISTINCT FROM (mp.member_id=v_member_id))) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact confirmed requester roster required';
  END IF;

  SELECT b.availability_id INTO STRICT v_availability_id
  FROM private.movement_offer_availability_bindings b WHERE b.movement_offer_id=v_offer_record.id;
  -- The assertion holds the authoritative availability FOR UPDATE lock.
  -- Consume the whole people_count, never seats_offered. This write and every
  -- following operational transition roll back together on any error.
  UPDATE private.offering_movement_availability a
  SET remaining_places=a.remaining_places-v_need_record.people_count,
      status=CASE WHEN a.remaining_places=v_need_record.people_count THEN 'full' ELSE 'open' END
  WHERE a.id=v_availability_id AND a.status='open'
    AND a.remaining_places>=v_need_record.people_count;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Insufficient remaining places for the complete requester group';
  END IF;

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