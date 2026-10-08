BEGIN;

-- Do not fabricate departure history for an already-started modern graph.
DO $preflight$
BEGIN
 IF EXISTS (
  SELECT 1 FROM public.journeys j JOIN public.alignments a ON a.id=j.alignment_id
  JOIN private.movement_offer_availability_bindings b ON b.movement_offer_id=a.movement_offer_id
  WHERE j.start_requested_at IS NOT NULL OR j.started_at IS NOT NULL
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',
   MESSAGE='0091 preflight: availability-backed starts require deliberate roster-freeze remediation';
 END IF;
END;
$preflight$;

CREATE TABLE private.offering_movement_roster_freezes (
 availability_id uuid PRIMARY KEY REFERENCES private.offering_movement_availability(id),
 offering_movement_intent_id uuid NOT NULL UNIQUE REFERENCES private.offering_movement_intents(id),
 offering_member_id uuid NOT NULL REFERENCES public.members(id),
 initiating_alignment_id uuid NOT NULL REFERENCES public.alignments(id),
 initiating_movement_offer_id uuid NOT NULL REFERENCES public.movement_offers(id),
 initiating_journey_id uuid NOT NULL REFERENCES public.journeys(id),
 start_authority text NOT NULL CHECK(start_authority IN ('funded','legacy')),
 funded_start_request_alignment_id uuid REFERENCES private.funded_movement_start_requests(alignment_id),
 initiating_requested_at timestamptz NOT NULL CHECK(isfinite(initiating_requested_at)),
 frozen_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK(isfinite(frozen_at)),
 schema_version text NOT NULL DEFAULT 'offering_movement_roster_freeze_v1'
  CHECK(schema_version='offering_movement_roster_freeze_v1'),
 CHECK((start_authority='funded' AND funded_start_request_alignment_id=initiating_alignment_id)
    OR (start_authority='legacy' AND funded_start_request_alignment_id IS NULL)),
 CHECK(start_authority<>'funded' OR funded_start_request_alignment_id IS NOT NULL)
);
ALTER TABLE private.offering_movement_roster_freezes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.offering_movement_roster_freezes FROM PUBLIC,anon,authenticated,service_role;

-- Historical graph checks deliberately have no live eligibility or time-order test.
CREATE FUNCTION private.assert_offering_movement_roster_freeze(p_availability_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $history$
DECLARE f private.offering_movement_roster_freezes%ROWTYPE;
BEGIN
 SELECT x.* INTO STRICT f FROM private.offering_movement_roster_freezes x WHERE x.availability_id=p_availability_id;
 IF NOT EXISTS (
  SELECT 1 FROM private.offering_movement_availability av
  JOIN private.offering_movement_intents i ON i.id=av.offering_movement_intent_id
  JOIN private.offering_route_evidence r ON r.id=av.route_evidence_id
  JOIN private.movement_offer_availability_bindings b ON b.availability_id=av.id
  JOIN public.movement_offers o ON o.id=b.movement_offer_id
  JOIN private.movement_offer_route_match_bindings rb ON rb.movement_offer_id=o.id
  JOIN private.trusted_route_match_evidence e ON e.id=rb.route_match_evidence_id
  JOIN public.alignments a ON a.movement_offer_id=o.id
  JOIN public.movement_needs n ON n.id=a.movement_need_id
  JOIN public.journeys j ON j.alignment_id=a.id
  WHERE av.id=f.availability_id AND av.status<>'open'
   AND i.id=f.offering_movement_intent_id AND i.offering_member_id=f.offering_member_id
   AND av.offering_member_id=f.offering_member_id
   AND r.offering_movement_intent_id=i.id AND r.offering_member_id=f.offering_member_id
   AND r.version=av.route_evidence_version
   AND b.offering_movement_intent_id=i.id AND b.offering_member_id=f.offering_member_id
   AND b.movement_need_id=a.movement_need_id AND o.movement_need_id=a.movement_need_id
   AND n.member_id=a.member_needing_movement_id AND e.requesting_member_id=a.member_needing_movement_id
   AND o.offering_member_id=f.offering_member_id AND a.offering_member_id=f.offering_member_id
   AND o.vehicle_id=av.vehicle_id AND o.status='accepted'
   AND rb.movement_need_id=a.movement_need_id AND rb.offering_member_id=f.offering_member_id
   AND rb.offering_movement_intent_id=i.id AND rb.route_match_evidence_version=e.version
   AND e.movement_need_id=a.movement_need_id AND e.offering_member_id=f.offering_member_id
   AND e.offering_movement_intent_id=i.id AND e.route_evidence_id=r.id AND e.route_evidence_version=r.version
   AND a.id=f.initiating_alignment_id AND o.id=f.initiating_movement_offer_id
   AND j.id=f.initiating_journey_id AND j.start_requested_at=f.initiating_requested_at
   AND ( (f.start_authority='funded' AND EXISTS (
      SELECT 1 FROM private.funded_movement_start_requests sr
      WHERE sr.alignment_id=a.id AND sr.journey_id=j.id AND sr.requested_at=f.initiating_requested_at
     ) AND private.is_financial_alignment(a.id))
     OR (f.start_authority='legacy' AND NOT private.is_financial_alignment(a.id)))
 ) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact immutable roster freeze graph required';
 END IF;
END;
$history$;

-- The caller already owns its start graph. No sibling graph locks are taken.
CREATE FUNCTION private.lock_start_roster_parent(p_alignment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $parent$
DECLARE b private.movement_offer_availability_bindings%ROWTYPE; av private.offering_movement_availability%ROWTYPE;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Roster freeze requires READ COMMITTED'; END IF;
 SELECT x.* INTO b FROM private.movement_offer_availability_bindings x
 JOIN public.alignments a ON a.movement_offer_id=x.movement_offer_id WHERE a.id=p_alignment_id;
 IF NOT FOUND THEN RETURN NULL; END IF; -- genuinely unbound historical legacy
 SELECT x.* INTO STRICT av FROM private.offering_movement_availability x WHERE x.id=b.availability_id;
 PERFORM 1 FROM private.offering_movement_intents i WHERE i.id=av.offering_movement_intent_id FOR UPDATE;
 PERFORM 1 FROM private.offering_route_evidence r WHERE r.id=av.route_evidence_id FOR UPDATE;
 SELECT x.* INTO STRICT av FROM private.offering_movement_availability x WHERE x.id=b.availability_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.alignments a JOIN public.movement_offers o ON o.id=a.movement_offer_id
  WHERE a.id=p_alignment_id AND o.id=b.movement_offer_id AND o.status='accepted'
   AND a.movement_need_id=b.movement_need_id AND o.movement_need_id=b.movement_need_id
   AND a.offering_member_id=b.offering_member_id AND o.offering_member_id=b.offering_member_id
   AND av.offering_member_id=b.offering_member_id AND av.offering_movement_intent_id=b.offering_movement_intent_id
   AND av.vehicle_id=o.vehicle_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact accepted roster parent required'; END IF;
 RETURN av.id;
END;
$parent$;

CREATE FUNCTION private.construct_offering_movement_roster_freeze(p_parent uuid,p_alignment uuid,p_journey uuid,p_authority text,p_requested timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $construct$
DECLARE av private.offering_movement_availability%ROWTYPE; a public.alignments%ROWTYPE;
BEGIN
 IF p_parent IS NULL THEN RETURN; END IF;
 IF private.lock_start_roster_parent(p_alignment) IS DISTINCT FROM p_parent THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact accepted roster parent required'; END IF;
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
 IF EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes WHERE availability_id=p_parent) THEN
  PERFORM private.assert_offering_movement_roster_freeze(p_parent); RETURN; END IF;
 SELECT x.* INTO STRICT av FROM private.offering_movement_availability x WHERE x.id=p_parent;
 INSERT INTO private.offering_movement_roster_freezes(availability_id,offering_movement_intent_id,offering_member_id,
  initiating_alignment_id,initiating_movement_offer_id,initiating_journey_id,start_authority,
  funded_start_request_alignment_id,initiating_requested_at)
 VALUES(av.id,av.offering_movement_intent_id,av.offering_member_id,a.id,a.movement_offer_id,p_journey,p_authority,
  CASE WHEN p_authority='funded' THEN a.id END,p_requested);
 IF av.status='open' THEN
  UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=av.id;
 END IF;
END;
$construct$;

CREATE FUNCTION private.protect_offering_movement_roster_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $protect$
DECLARE a public.alignments%ROWTYPE; parent uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Roster freeze history is immutable'; END IF;
 -- Construction locks also apply to direct trusted insertion, never to historical reads.
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.initiating_alignment_id FOR UPDATE;
 PERFORM 1 FROM public.journeys j WHERE j.id=NEW.initiating_journey_id AND j.alignment_id=a.id
  AND j.status='not_started' AND j.started_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact immutable roster freeze graph required'; END IF;
 parent:=private.lock_start_roster_parent(a.id);
 IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
 IF a.status<>'activated' OR parent IS DISTINCT FROM NEW.availability_id OR NEW.offering_member_id IS DISTINCT FROM a.offering_member_id
  OR NEW.initiating_movement_offer_id IS DISTINCT FROM a.movement_offer_id THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact immutable roster freeze graph required'; END IF;
 NEW.frozen_at:=clock_timestamp(); -- finite server metadata; never chronology authority
 RETURN NEW;
END;
$protect$;
CREATE TRIGGER protect_offering_movement_roster_freeze BEFORE INSERT OR UPDATE OR DELETE
 ON private.offering_movement_roster_freezes FOR EACH ROW EXECUTE FUNCTION private.protect_offering_movement_roster_freeze();
CREATE TRIGGER protect_offering_movement_roster_freeze_truncate BEFORE TRUNCATE
 ON private.offering_movement_roster_freezes FOR EACH STATEMENT EXECUTE FUNCTION private.protect_offering_movement_roster_freeze();

CREATE FUNCTION private.validate_roster_start_completeness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $complete$
DECLARE parent uuid; alignment uuid;
BEGIN
 IF TG_TABLE_NAME='offering_movement_roster_freezes' THEN
  PERFORM private.assert_offering_movement_roster_freeze(NEW.availability_id);
 ELSIF TG_TABLE_NAME='offering_movement_availability' THEN
  IF EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes WHERE availability_id=NEW.id) THEN
   PERFORM private.assert_offering_movement_roster_freeze(NEW.id); END IF;
 ELSE
  alignment:=NEW.alignment_id;
  IF EXISTS(SELECT 1 FROM public.journeys j WHERE j.alignment_id=alignment AND j.start_requested_at IS NOT NULL) THEN
   SELECT b.availability_id INTO parent FROM private.movement_offer_availability_bindings b
    JOIN public.alignments a ON a.movement_offer_id=b.movement_offer_id WHERE a.id=alignment;
   IF parent IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes WHERE availability_id=parent) THEN
     RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Availability-backed start requires roster freeze'; END IF;
    PERFORM private.assert_offering_movement_roster_freeze(parent);
   END IF;
  END IF;
 END IF;
 RETURN NULL;
END;
$complete$;
CREATE CONSTRAINT TRIGGER roster_freeze_complete AFTER INSERT ON private.offering_movement_roster_freezes
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_roster_start_completeness();
CREATE CONSTRAINT TRIGGER roster_availability_complete AFTER UPDATE ON private.offering_movement_availability
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_roster_start_completeness();
CREATE CONSTRAINT TRIGGER roster_journey_complete AFTER INSERT OR UPDATE ON public.journeys
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_roster_start_completeness();
CREATE CONSTRAINT TRIGGER roster_funded_request_complete AFTER INSERT ON private.funded_movement_start_requests
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_roster_start_completeness();

-- Direct trusted acceptance must take the same parent serialization gate.
-- Lifecycle UPDATEs of already-accepted alignments never call live eligibility.
CREATE FUNCTION private.guard_new_roster_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $admission$
DECLARE b private.movement_offer_availability_bindings%ROWTYPE; offer_id uuid; actor uuid;
BEGIN
 IF TG_TABLE_NAME='journeys' THEN
  IF NEW.start_requested_at IS NULL AND (TG_OP='INSERT' OR OLD.start_requested_at IS NULL) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND NEW.start_requested_at IS NOT DISTINCT FROM OLD.start_requested_at THEN RETURN NEW; END IF;
  -- Funded row guards already require the exact actor-owned immutable request
  -- receipt. Preserve their existing authority and error contract unchanged.
  IF private.is_financial_alignment(NEW.alignment_id) THEN RETURN NEW; END IF;
  SELECT x.* INTO b FROM private.movement_offer_availability_bindings x
   JOIN public.alignments a ON a.movement_offer_id=x.movement_offer_id WHERE a.id=NEW.alignment_id;
  IF NOT FOUND THEN RETURN NEW; END IF; -- no fabricated provenance for old unbound legacy
  SELECT a.offering_member_id INTO STRICT actor FROM public.alignments a WHERE a.id=NEW.alignment_id;
  IF auth.uid() IS DISTINCT FROM actor THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
  IF (TG_OP='UPDATE' AND OLD.start_requested_at IS NOT NULL) OR NEW.start_requested_at IS NULL
   OR NOT isfinite(NEW.start_requested_at) OR NEW.status<>'not_started' OR NEW.started_at IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM public.alignments a WHERE a.id=NEW.alignment_id AND a.status='activated') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pre-start roster graph required'; END IF;
  PERFORM private.lock_start_roster_parent(NEW.alignment_id);
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='movement_offers' THEN
  IF NEW.status<>'accepted' OR OLD.status='accepted' THEN RETURN NEW; END IF;
  offer_id:=NEW.id;
 ELSE offer_id:=NEW.movement_offer_id;
 END IF;
 SELECT x.* INTO b FROM private.movement_offer_availability_bindings x WHERE x.movement_offer_id=offer_id;
 IF FOUND THEN
  PERFORM private.lock_offer_availability_intent(b.movement_need_id,b.offering_movement_intent_id);
  -- Acceptance may already have consumed the last place. Only the freeze cut
  -- is checked here; existing acceptance assertions retain capacity authority.
  IF EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes WHERE availability_id=b.availability_id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Availability is not open and eligible'; END IF;
 END IF;
 RETURN NEW;
END;
$admission$;
CREATE TRIGGER guard_new_roster_alignment BEFORE INSERT ON public.alignments
 FOR EACH ROW EXECUTE FUNCTION private.guard_new_roster_admission();
CREATE TRIGGER guard_new_roster_offer BEFORE UPDATE ON public.movement_offers
 FOR EACH ROW EXECUTE FUNCTION private.guard_new_roster_admission();
CREATE TRIGGER guard_roster_start_actor BEFORE INSERT OR UPDATE ON public.journeys
 FOR EACH ROW EXECUTE FUNCTION private.guard_new_roster_admission();

CREATE OR REPLACE FUNCTION private.protect_offering_movement_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'open' OR NEW.remaining_places<>NEW.total_places
      OR NOT isfinite(NEW.created_at) OR NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability must start open with its declared capacity';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'remaining_places'-'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD)-'status'-'remaining_places'-'updated_at') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability bindings and total capacity are immutable';
  END IF;
  IF OLD.status<>'open' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Terminal availability cannot reopen or change';
  END IF;
  IF NEW.remaining_places>OLD.remaining_places
    OR (NEW.remaining_places<>OLD.remaining_places AND NEW.status NOT IN ('open','full')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability capacity transition is invalid';
  END IF;
  IF OLD.status='open' AND NEW.status='unavailable' AND (
    NEW.remaining_places<>OLD.remaining_places OR NOT EXISTS(
     SELECT 1 FROM private.offering_movement_roster_freezes f WHERE f.availability_id=OLD.id
    )) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Availability closure requires exact roster freeze';
  END IF;
  IF NEW.status='expired' AND OLD.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability expiry has not elapsed';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_offering_movement_availability(p_availability_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $assert$
DECLARE
  a private.offering_movement_availability%ROWTYPE;
  i private.offering_movement_intents%ROWTYPE;
  e private.offering_route_evidence%ROWTYPE;
  v_capacity integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Availability validation requires READ COMMITTED';
  END IF;
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=p_availability_id;
  SELECT x.* INTO STRICT i FROM private.offering_movement_intents x
    WHERE x.id=a.offering_movement_intent_id FOR UPDATE;
  PERFORM private.assert_offering_movement_intent(i.id);
  SELECT x.* INTO STRICT e FROM private.offering_route_evidence x WHERE x.id=a.route_evidence_id FOR UPDATE;
  PERFORM private.assert_offering_route_evidence(e.id);
  SELECT x.* INTO STRICT a FROM private.offering_movement_availability x WHERE x.id=p_availability_id FOR UPDATE;
  IF a.offering_member_id IS DISTINCT FROM i.offering_member_id
    OR e.offering_movement_intent_id IS DISTINCT FROM i.id
    OR e.offering_member_id IS DISTINCT FROM a.offering_member_id
    OR e.version IS DISTINCT FROM a.route_evidence_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability trusted movement binding does not match';
  END IF;
  SELECT v.seat_capacity INTO STRICT v_capacity FROM public.vehicles v WHERE v.id=a.vehicle_id FOR SHARE;
  PERFORM 1 FROM public.member_vehicle_access mva
    WHERE mva.vehicle_id=a.vehicle_id AND mva.member_id=a.offering_member_id AND mva.active FOR SHARE;
  IF NOT FOUND OR a.total_places>v_capacity THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability requires active vehicle access and sufficient capacity';
  END IF;
  -- Stop discovery at earliest declared departure; there is no independent
  -- departure event in this foundation and no inference from GPS.
  IF EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes f WHERE f.availability_id=a.id)
    OR a.status<>'open' OR a.remaining_places<1 OR a.expires_at<=clock_timestamp()
    OR i.earliest_departure_at<=clock_timestamp()
    OR a.expires_at>LEAST(i.earliest_departure_at,i.expires_at,e.expires_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability is not open and eligible';
  END IF;
END;
$assert$;

CREATE OR REPLACE FUNCTION
public.get_trusted_matching_context_for_server(
  p_movement_need_id uuid,
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid
)
RETURNS TABLE (
  movement_need_id uuid,
  requesting_member_id uuid,

  requester_origin_location_reference_id uuid,
  requester_origin_latitude numeric,
  requester_origin_longitude numeric,

  requester_destination_location_reference_id uuid,
  requester_destination_latitude numeric,
  requester_destination_longitude numeric,

  requester_earliest_departure_at timestamptz,
  requester_latest_departure_at timestamptz,

  offering_movement_intent_id uuid,
  offering_member_id uuid,
  offering_intent_version integer,

  offering_earliest_departure_at timestamptz,
  offering_latest_departure_at timestamptz,

  route_evidence_id uuid,
  route_evidence_version integer,
  route_shape_format text,
  route_shape jsonb,
  route_distance_meters bigint,
  route_duration_seconds bigint,
  route_generated_at timestamptz,
  route_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trusted_matching_context$
DECLARE
  v_need public.movement_needs%ROWTYPE;

  v_requester_origin_id uuid;
  v_requester_destination_id uuid;

  v_requester_origin
    private.movement_location_references%ROWTYPE;

  v_requester_destination
    private.movement_location_references%ROWTYPE;

  v_intent
    private.offering_movement_intents%ROWTYPE;

  v_evidence
    private.offering_route_evidence%ROWTYPE;

  v_now timestamptz;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Trusted matching context requires READ COMMITTED';
  END IF;


  -- =======================================================
  -- Required identities
  -- =======================================================

  IF p_movement_need_id IS NULL
     OR p_offering_movement_intent_id IS NULL
     OR p_offering_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Movement need, offering intent and offering member are required';
  END IF;


  -- =======================================================
  -- Requester movement need
  --
  -- Lock the need first. Future matching/materialization
  -- writers must preserve this lock order.
  -- =======================================================

  SELECT n.*
  INTO v_need
  FROM public.movement_needs n
  WHERE n.id = p_movement_need_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Movement need not found';
  END IF;

  IF v_need.status <> 'discoverable' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need is not available for matching';
  END IF;

  IF v_need.member_id = p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering member cannot match their own movement need';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.alignments a
    WHERE a.movement_need_id = v_need.id
      AND a.status IN (
        'awaiting_activation_payment',
        'activated',
        'in_progress',
        'completed'
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need already has an active or completed alignment';
  END IF;


  -- =======================================================
  -- Trusted requester endpoint bindings
  -- =======================================================

  SELECT l.location_reference_id
  INTO v_requester_origin_id
  FROM private.movement_need_locations l
  WHERE l.movement_need_id = v_need.id
    AND l.role = 'origin';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted origin is unavailable';
  END IF;


  SELECT l.location_reference_id
  INTO v_requester_destination_id
  FROM private.movement_need_locations l
  WHERE l.movement_need_id = v_need.id
    AND l.role = 'destination';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted destination is unavailable';
  END IF;


  IF v_requester_origin_id
       = v_requester_destination_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoints must be distinct';
  END IF;


  IF (
    SELECT count(*)
    FROM private.movement_need_locations l
    WHERE l.movement_need_id = v_need.id
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need must have exactly two trusted endpoints';
  END IF;


  SELECT lr.*
  INTO STRICT v_requester_origin
  FROM private.movement_location_references lr
  WHERE lr.id = v_requester_origin_id
  FOR SHARE;


  SELECT lr.*
  INTO STRICT v_requester_destination
  FROM private.movement_location_references lr
  WHERE lr.id = v_requester_destination_id
  FOR SHARE;


  v_now := clock_timestamp();

  IF v_requester_origin.owner_member_id
       <> v_need.member_id
     OR v_requester_destination.owner_member_id
       <> v_need.member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoint ownership is invalid';
  END IF;


  IF v_requester_origin.resolution_status
       <> 'resolved'
     OR v_requester_destination.resolution_status
       <> 'resolved'
     OR v_requester_origin.source_kind
       <> 'provider_resolved'
     OR v_requester_destination.source_kind
       <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need requires resolved provider endpoints';
  END IF;


  IF v_requester_origin.latitude IS NULL
     OR v_requester_origin.longitude IS NULL
     OR v_requester_destination.latitude IS NULL
     OR v_requester_destination.longitude IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted coordinates are incomplete';
  END IF;


  IF NOT (
       v_requester_origin.latitude BETWEEN -90 AND 90
     )
     OR NOT (
       v_requester_origin.longitude BETWEEN -180 AND 180
     )
     OR NOT (
       v_requester_destination.latitude BETWEEN -90 AND 90
     )
     OR NOT (
       v_requester_destination.longitude BETWEEN -180 AND 180
     )
     OR v_requester_origin.latitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_origin.longitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_destination.latitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_destination.longitude::text
       IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted coordinates are invalid';
  END IF;


  IF (
       v_requester_origin.expires_at IS NOT NULL
       AND v_requester_origin.expires_at <= v_now
     )
     OR (
       v_requester_destination.expires_at IS NOT NULL
       AND v_requester_destination.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoint has expired';
  END IF;


  -- =======================================================
  -- Offerer's independently established movement intent
  -- =======================================================

  SELECT i.*
  INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Offering movement intent not found';
  END IF;


  -- Fresh statement after the intent wait: serialize service matching with departure.
  IF EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes f
    WHERE f.offering_movement_intent_id=p_offering_movement_intent_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Availability is not open and eligible';
  END IF;

  IF v_intent.offering_member_id
       <> p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Offering movement intent does not belong to member';
  END IF;


  v_now := clock_timestamp();

  IF v_intent.status <> 'current'
     OR (
       v_intent.expires_at IS NOT NULL
       AND v_intent.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering movement intent is not current and unexpired';
  END IF;


  PERFORM
    private.assert_offering_movement_intent(
      v_intent.id
    );


  -- =======================================================
  -- Exact current trusted route evidence
  --
  -- This is selected only after the offering-intent lock.
  -- The route producer uses the intent as its serialization
  -- boundary, so a competing route replacement cannot race
  -- this context read.
  -- =======================================================

  SELECT e.*
  INTO v_evidence
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id
          = v_intent.id
    AND e.status = 'current'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Current trusted offering route evidence is unavailable';
  END IF;


  v_now := clock_timestamp();

  IF v_evidence.offering_member_id
       <> p_offering_member_id
     OR v_evidence.status <> 'current'
     OR (
       v_evidence.expires_at IS NOT NULL
       AND v_evidence.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence is not eligible for matching';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM private.offering_movement_intent_locations il
    WHERE il.intent_id = v_intent.id
      AND il.role = 'origin'
      AND il.location_reference_id
            = v_evidence.origin_location_reference_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM private.offering_movement_intent_locations il
    WHERE il.intent_id = v_intent.id
      AND il.role = 'destination'
      AND il.location_reference_id
            = v_evidence.destination_location_reference_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints do not match intent';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      v_evidence.origin_location_reference_id,
      v_evidence.destination_location_reference_id
    )
      AND (
        lr.owner_member_id <> p_offering_member_id
        OR lr.resolution_status <> 'resolved'
        OR lr.source_kind <> 'provider_resolved'
        OR lr.latitude IS NULL
        OR lr.longitude IS NULL
        OR (
          lr.expires_at IS NOT NULL
          AND lr.expires_at <= v_now
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints are not eligible for matching';
  END IF;


  IF (
    SELECT count(*)
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      v_evidence.origin_location_reference_id,
      v_evidence.destination_location_reference_id
    )
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints are unavailable';
  END IF;


  IF v_evidence.route_shape_format
       <> 'geojson_linestring_v1' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence shape format is unsupported';
  END IF;


  PERFORM
    private.assert_geojson_linestring_v1(
      v_evidence.route_shape
    );


  IF v_evidence.route_distance_meters <= 0
     OR v_evidence.route_duration_seconds <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence distance or duration is invalid';
  END IF;


  -- =======================================================
  -- Hard state-bound matching invariant
  --
  -- This runs only after the mature trusted-context checks
  -- above have succeeded and while their locks remain held.
  -- =======================================================

  PERFORM private.assert_state_bound_matching_context(
    v_requester_origin.id,
    v_requester_destination.id,
    v_evidence.id
  );


  -- =======================================================
  -- Return private matching inputs only to the trusted
  -- server caller.
  -- =======================================================

  RETURN QUERY
  SELECT
    v_need.id,
    v_need.member_id,

    v_requester_origin.id,
    v_requester_origin.latitude,
    v_requester_origin.longitude,

    v_requester_destination.id,
    v_requester_destination.latitude,
    v_requester_destination.longitude,

    v_need.earliest_departure_at,
    v_need.latest_departure_at,

    v_intent.id,
    v_intent.offering_member_id,
    v_intent.version,

    v_intent.earliest_departure_at,
    v_intent.latest_departure_at,

    v_evidence.id,
    v_evidence.version,
    v_evidence.route_shape_format,
    v_evidence.route_shape,
    v_evidence.route_distance_meters,
    v_evidence.route_duration_seconds,
    v_evidence.generated_at,
    v_evidence.expires_at;
END;
$trusted_matching_context$;

CREATE OR REPLACE FUNCTION public.request_my_funded_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
 start_requested_at timestamptz, started_at timestamptz,
 can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean, start_authority text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_request$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; mp private.journey_meeting_points%ROWTYPE; stamp timestamptz; parent uuid;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 -- Historical exact replay performs no operational or evidence writes.
 IF EXISTS(SELECT 1 FROM private.funded_movement_start_requests WHERE alignment_id=a.id) THEN
  SELECT b.availability_id INTO parent FROM private.movement_offer_availability_bindings b WHERE b.movement_offer_id=a.movement_offer_id;
  IF parent IS NOT NULL THEN PERFORM private.assert_offering_movement_roster_freeze(parent); END IF;
  RETURN QUERY SELECT * FROM public.get_my_movement_start_status(p_movement_need_id); RETURN;
 END IF;
 IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pre-start coordination required'; END IF;
 SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id FOR SHARE;
 IF mp.journey_id IS NULL OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Valid meeting point required'; END IF;
 -- All graph/journey/meeting-point waits and revalidation precede this instant.
 parent:=private.lock_start_roster_parent(a.id);
 IF parent IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact accepted roster parent required'; END IF;
 stamp:=clock_timestamp();
 BEGIN
  SET CONSTRAINTS private.funded_start_request_complete,private.funded_start_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete DEFERRED;
  SET CONSTRAINTS private.roster_freeze_complete,private.roster_availability_complete,public.roster_journey_complete,private.roster_funded_request_complete DEFERRED;
  INSERT INTO private.funded_movement_start_requests VALUES(a.id,j.id,stamp,mp.revision);
  -- The exact request exists before its FK-backed parent receipt. This also
  -- works when the caller selected SET CONSTRAINTS ALL IMMEDIATE.
  PERFORM private.construct_offering_movement_roster_freeze(parent,a.id,j.id,'funded',stamp);
  UPDATE public.journeys x SET start_requested_at=stamp,updated_at=stamp WHERE x.id=j.id;
  PERFORM private.assert_funded_coordination_entry(a.id);
  SET CONSTRAINTS private.roster_freeze_complete,private.roster_availability_complete,public.roster_journey_complete,private.roster_funded_request_complete IMMEDIATE;
  SET CONSTRAINTS private.funded_start_request_complete,private.funded_start_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete IMMEDIATE;
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 RETURN QUERY SELECT * FROM public.get_my_movement_start_status(p_movement_need_id);
END;
$start_request$;

CREATE OR REPLACE FUNCTION public.request_journey_start(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  start_requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_timestamp timestamptz;
  v_parent uuid;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  -- Caller must be the offering member
  IF v_alignment_record.offering_member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the offering member may request journey start';
  END IF;

  -- Alignment must be activated
  IF v_alignment_record.status <> 'activated' THEN
    RAISE EXCEPTION 'Alignment is not activated';
  END IF;

  -- Journey must be not_started
  IF v_journey_record.status <> 'not_started' THEN
    RAISE EXCEPTION 'Journey is not in not_started state';
  END IF;

  -- Journey must not be completed, cancelled, or failed
  IF v_journey_record.status IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Journey is in a terminal state';
  END IF;

  -- Idempotency: if start_requested_at already exists and journey is still not_started, return existing
  IF v_journey_record.start_requested_at IS NOT NULL THEN
    v_returned_timestamp := v_journey_record.start_requested_at;
    SELECT b.availability_id INTO v_parent FROM private.movement_offer_availability_bindings b
     WHERE b.movement_offer_id=v_alignment_record.movement_offer_id;
    IF v_parent IS NOT NULL THEN PERFORM private.assert_offering_movement_roster_freeze(v_parent); END IF;
  ELSE
    v_parent:=private.lock_start_roster_parent(v_alignment_record.id);
    SET CONSTRAINTS private.roster_freeze_complete,private.roster_availability_complete,public.roster_journey_complete,private.roster_funded_request_complete DEFERRED;
    v_returned_timestamp:=clock_timestamp();
    PERFORM private.construct_offering_movement_roster_freeze(v_parent,v_alignment_record.id,p_journey_id,'legacy',v_returned_timestamp);
    -- Set server metadata only after parent waits
    UPDATE public.journeys j
    SET start_requested_at = v_returned_timestamp, updated_at = v_returned_timestamp
    WHERE j.id = p_journey_id
    RETURNING j.start_requested_at
    INTO v_returned_timestamp;
    SET CONSTRAINTS private.roster_freeze_complete,private.roster_availability_complete,public.roster_journey_complete,private.roster_funded_request_complete IMMEDIATE;
  END IF;

  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'not_started'::text AS journey_status,
    v_returned_timestamp AS start_requested_at;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_offering_movement_roster_freeze(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.lock_start_roster_parent(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.construct_offering_movement_roster_freeze(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.protect_offering_movement_roster_freeze() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.validate_roster_start_completeness() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_new_roster_admission() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
