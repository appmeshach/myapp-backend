BEGIN;

-- WE DO NOT CREATE JOURNEYS. These are private declarations and application
-- inputs, not geographic truth. No producer, operational hook or client RPC.
CREATE TABLE private.movement_location_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_member_id uuid NOT NULL REFERENCES public.members(id),
  declared_label text NOT NULL CHECK (declared_label=btrim(declared_label) AND length(declared_label) BETWEEN 1 AND 500 AND declared_label ~ '[^[:space:]]'),
  source_kind text NOT NULL CHECK (source_kind IN ('member_declared','member_selected','provider_resolved')),
  resolution_status text NOT NULL CHECK (resolution_status IN ('unresolved','resolved')),
  latitude numeric CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric CHECK (longitude BETWEEN -180 AND 180),
  provider_namespace text CHECK (provider_namespace=btrim(provider_namespace) AND length(provider_namespace) BETWEEN 1 AND 100 AND provider_namespace ~ '[^[:space:]]'),
  provider_place_reference text CHECK (provider_place_reference=btrim(provider_place_reference) AND length(provider_place_reference) BETWEEN 1 AND 500 AND provider_place_reference ~ '[^[:space:]]'),
  resolution_version text CHECK (resolution_version=btrim(resolution_version) AND length(resolution_version) BETWEEN 1 AND 100 AND resolution_version ~ '[^[:space:]]'),
  created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  resolved_at timestamptz CHECK (isfinite(resolved_at)),
  expires_at timestamptz CHECK (isfinite(expires_at)),
  CONSTRAINT movement_location_coordinate_pair CHECK ((latitude IS NULL)=(longitude IS NULL)),
  CONSTRAINT movement_location_provider_pair CHECK ((provider_namespace IS NULL)=(provider_place_reference IS NULL)),
  CONSTRAINT movement_location_resolution_shape CHECK (
    (resolution_status='unresolved' AND source_kind IN ('member_declared','member_selected')
      AND latitude IS NULL AND longitude IS NULL AND resolved_at IS NULL AND resolution_version IS NULL)
    OR (resolution_status='resolved' AND source_kind='provider_resolved'
      AND latitude IS NOT NULL AND longitude IS NOT NULL AND provider_namespace IS NOT NULL
      AND provider_place_reference IS NOT NULL AND resolved_at IS NOT NULL AND resolution_version IS NOT NULL)),
  CHECK (resolved_at IS NULL OR resolved_at<=created_at),
  CHECK (expires_at IS NULL OR expires_at>created_at)
);

-- intent_key is a stable logical identity scoped to the offering member.
-- This declaration has no requester, need, offer or operational journey binding.
CREATE TABLE private.offering_movement_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  intent_key uuid NOT NULL,
  version integer NOT NULL CHECK (version>=1),
  earliest_departure_at timestamptz NOT NULL CHECK (isfinite(earliest_departure_at)),
  latest_departure_at timestamptz CHECK (isfinite(latest_departure_at)),
  created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  expires_at timestamptz CHECK (isfinite(expires_at)),
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','withdrawn','expired')),
  UNIQUE (offering_member_id,intent_key,version),
  CHECK (latest_departure_at IS NULL OR latest_departure_at>=earliest_departure_at),
  CHECK (expires_at IS NULL OR expires_at>created_at)
);
CREATE UNIQUE INDEX offering_movement_intents_one_current
  ON private.offering_movement_intents(offering_member_id,intent_key) WHERE status='current';

CREATE TABLE private.offering_movement_intent_locations (
  intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  role text NOT NULL CHECK (role IN ('origin','destination')),
  location_reference_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  PRIMARY KEY (intent_id,role)
);

CREATE TABLE private.movement_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_need_id uuid NOT NULL REFERENCES public.movement_needs(id),
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  offering_intent_version integer NOT NULL CHECK (offering_intent_version>=1),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  movement_offer_id uuid REFERENCES public.movement_offers(id),
  version integer NOT NULL CHECK (version>=1),
  context_schema_version text NOT NULL CHECK (context_schema_version='movement_context_v1'),
  people_count integer NOT NULL CHECK (people_count>=1),
  seats_offered integer NOT NULL CHECK (seats_offered>=people_count),
  vehicle_seat_capacity integer NOT NULL CHECK (vehicle_seat_capacity BETWEEN 1 AND 12),
  requester_origin_area text NOT NULL,
  requester_destination_area text NOT NULL,
  requester_earliest_departure_at timestamptz NOT NULL CHECK (isfinite(requester_earliest_departure_at)),
  requester_latest_departure_at timestamptz CHECK (isfinite(requester_latest_departure_at)),
  offering_earliest_departure_at timestamptz NOT NULL CHECK (isfinite(offering_earliest_departure_at)),
  offering_latest_departure_at timestamptz CHECK (isfinite(offering_latest_departure_at)),
  requester_origin_location_id uuid REFERENCES private.movement_location_references(id),
  requester_destination_location_id uuid REFERENCES private.movement_location_references(id),
  offering_origin_location_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  offering_destination_location_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  -- Optional copies of existing offer declarations, never computed results.
  proposed_pickup_area text,
  proposed_dropoff_area text,
  declared_arrival_minutes integer CHECK (declared_arrival_minutes>=0),
  created_at timestamptz NOT NULL DEFAULT now() CHECK (isfinite(created_at)),
  expires_at timestamptz CHECK (isfinite(expires_at)),
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  UNIQUE (movement_need_id,offering_member_id,version),
  CHECK (requesting_member_id<>offering_member_id),
  CHECK (seats_offered<=vehicle_seat_capacity),
  CHECK (requester_latest_departure_at IS NULL OR requester_latest_departure_at>=requester_earliest_departure_at),
  CHECK (offering_latest_departure_at IS NULL OR offering_latest_departure_at>=offering_earliest_departure_at),
  CHECK (expires_at IS NULL OR expires_at>created_at),
  CHECK (movement_offer_id IS NOT NULL OR (proposed_pickup_area IS NULL AND proposed_dropoff_area IS NULL AND declared_arrival_minutes IS NULL))
);
CREATE UNIQUE INDEX movement_context_snapshots_one_current
  ON private.movement_context_snapshots(movement_need_id,offering_member_id) WHERE status='current';

CREATE TABLE private.movement_context_snapshot_travellers (
  snapshot_id uuid NOT NULL REFERENCES private.movement_context_snapshots(id),
  member_id uuid NOT NULL REFERENCES public.members(id),
  -- Historical source identity, intentionally no FK to a mutable participant row.
  movement_participant_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('primary_requester','invited_participant')),
  PRIMARY KEY (snapshot_id,member_id),
  UNIQUE (snapshot_id,movement_participant_id)
);

ALTER TABLE private.movement_location_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.offering_movement_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.offering_movement_intent_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.movement_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.movement_context_snapshot_travellers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.movement_location_references,private.offering_movement_intents,
  private.offering_movement_intent_locations,private.movement_context_snapshots,
  private.movement_context_snapshot_travellers FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.movement_location_references,private.offering_movement_intents,
  private.offering_movement_intent_locations,private.movement_context_snapshots,
  private.movement_context_snapshot_travellers TO service_role;

-- Trigger helpers need definer privileges to read private dependencies. None is
-- a callable application writer. PostgreSQL owners remain trusted administrators.
CREATE FUNCTION private.protect_movement_context_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.created_at>clock_timestamp() OR (NEW.expires_at IS NOT NULL AND NEW.expires_at<=clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context creation time or expiry is invalid';
    END IF;
    IF TG_TABLE_NAME='movement_location_references' THEN
      IF NEW.resolved_at>clock_timestamp() THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Location resolution cannot be future-dated';
      END IF;
    ELSIF NEW.status<>'current' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context versions must start current';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='movement_location_references' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Location inputs are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context fields are immutable';
  END IF;
  IF OLD.status<>'current' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context lifecycle cannot reopen or change terminal state';
  END IF;
  IF TG_TABLE_NAME='offering_movement_intents' AND NEW.status='expired' AND OLD.status='current'
    AND (NEW.expires_at IS NULL OR NEW.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Intent expiry has not elapsed';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_movement_context_record() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_movement_location_reference BEFORE INSERT OR UPDATE OR DELETE ON private.movement_location_references
  FOR EACH ROW EXECUTE FUNCTION private.protect_movement_context_record();
CREATE TRIGGER protect_offering_movement_intent BEFORE INSERT OR UPDATE OR DELETE ON private.offering_movement_intents
  FOR EACH ROW EXECUTE FUNCTION private.protect_movement_context_record();
CREATE TRIGGER protect_movement_context_snapshot BEFORE INSERT OR UPDATE OR DELETE ON private.movement_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION private.protect_movement_context_record();

CREATE FUNCTION private.protect_movement_context_child()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE parent_status text;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context relationships are immutable';
  END IF;
  IF TG_TABLE_NAME='offering_movement_intent_locations' THEN
    SELECT i.status INTO STRICT parent_status FROM private.offering_movement_intents i WHERE i.id=NEW.intent_id FOR UPDATE;
  ELSE
    SELECT s.status INTO STRICT parent_status FROM private.movement_context_snapshots s WHERE s.id=NEW.snapshot_id FOR UPDATE;
  END IF;
  IF parent_status<>'current' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context relationship requires a current parent';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_movement_context_child() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_offering_intent_location BEFORE INSERT OR UPDATE OR DELETE ON private.offering_movement_intent_locations
  FOR EACH ROW EXECUTE FUNCTION private.protect_movement_context_child();
CREATE TRIGGER protect_context_snapshot_traveller BEFORE INSERT OR UPDATE OR DELETE ON private.movement_context_snapshot_travellers
  FOR EACH ROW EXECUTE FUNCTION private.protect_movement_context_child();

CREATE FUNCTION private.assert_offering_movement_intent(p_intent_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE intent_row private.offering_movement_intents%ROWTYPE;
BEGIN
  SELECT i.* INTO STRICT intent_row FROM private.offering_movement_intents i WHERE i.id=p_intent_id FOR SHARE;
  IF intent_row.status<>'current' OR (intent_row.expires_at IS NOT NULL AND intent_row.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Offering intent is not current and unexpired';
  END IF;
  -- Role CHECK + primary key + count prove one of each role, not two origins.
  IF (SELECT count(*) FROM private.offering_movement_intent_locations il WHERE il.intent_id=p_intent_id)<>2 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Offering intent requires exactly origin and destination';
  END IF;
  IF EXISTS (SELECT 1 FROM private.offering_movement_intent_locations il
    JOIN private.movement_location_references lr ON lr.id=il.location_reference_id
    WHERE il.intent_id=p_intent_id AND (lr.owner_member_id<>intent_row.offering_member_id
      OR (lr.expires_at IS NOT NULL AND lr.expires_at<=clock_timestamp()))) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Offering intent location owner or expiry does not match';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_offering_movement_intent(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_offering_movement_intent()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='offering_movement_intents' THEN
    PERFORM private.assert_offering_movement_intent(NEW.id);
  ELSE
    PERFORM private.assert_offering_movement_intent(NEW.intent_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_offering_movement_intent() FROM PUBLIC,anon,authenticated,service_role;
CREATE CONSTRAINT TRIGGER offering_intent_complete AFTER INSERT ON private.offering_movement_intents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_offering_movement_intent();
CREATE CONSTRAINT TRIGGER offering_intent_locations_complete AFTER INSERT ON private.offering_movement_intent_locations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_offering_movement_intent();

-- Read-only eligibility check, not a public projection or production consumer.
-- Future writers must prelock need -> offer (if any) -> intent -> vehicle/access
-- before constructing snapshots/children, keep checks deferred to the last write,
-- and retry whole transactions on lock conflicts. No 0021 helper is called.
-- READ COMMITTED is required: an older repeatable-read roster snapshot is unsafe.
CREATE FUNCTION private.assert_movement_context_snapshot(p_snapshot_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE snapshot_row private.movement_context_snapshots%ROWTYPE;
  need_row public.movement_needs%ROWTYPE; intent_row private.offering_movement_intents%ROWTYPE;
  offer_row public.movement_offers%ROWTYPE; current_capacity integer;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Movement context validation requires READ COMMITTED';
  END IF;
  SELECT s.* INTO STRICT snapshot_row FROM private.movement_context_snapshots s WHERE s.id=p_snapshot_id;
  SELECT n.* INTO STRICT need_row FROM public.movement_needs n WHERE n.id=snapshot_row.movement_need_id FOR UPDATE;
  -- Reread under lock after the need: a concurrent terminal transition must not
  -- race a future consumer's eligibility check on an already stored snapshot.
  SELECT s.* INTO STRICT snapshot_row FROM private.movement_context_snapshots s WHERE s.id=p_snapshot_id FOR SHARE;
  IF snapshot_row.status<>'current' OR (snapshot_row.expires_at IS NOT NULL AND snapshot_row.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot is not current and unexpired';
  END IF;
  IF ROW(need_row.member_id,need_row.origin_area,need_row.destination_area,need_row.earliest_departure_at,need_row.latest_departure_at,need_row.people_count)
    IS DISTINCT FROM ROW(snapshot_row.requesting_member_id,snapshot_row.requester_origin_area,snapshot_row.requester_destination_area,
      snapshot_row.requester_earliest_departure_at,snapshot_row.requester_latest_departure_at,snapshot_row.people_count) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot need declarations do not match';
  END IF;
  IF need_row.status<>'discoverable' OR EXISTS (SELECT 1 FROM public.alignments existing_alignment
    WHERE existing_alignment.movement_need_id=need_row.id
      AND existing_alignment.status IN ('awaiting_activation_payment','activated','in_progress','completed')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot requires an available need';
  END IF;
  IF snapshot_row.movement_offer_id IS NOT NULL THEN
    SELECT mo.* INTO STRICT offer_row FROM public.movement_offers mo WHERE mo.id=snapshot_row.movement_offer_id FOR SHARE;
    IF offer_row.status<>'pending' OR ROW(offer_row.movement_need_id,offer_row.offering_member_id,offer_row.vehicle_id,
      offer_row.seats_offered,offer_row.proposed_pickup_area,offer_row.proposed_dropoff_area,offer_row.estimated_arrival_minutes)
      IS DISTINCT FROM ROW(snapshot_row.movement_need_id,snapshot_row.offering_member_id,snapshot_row.vehicle_id,
        snapshot_row.seats_offered,snapshot_row.proposed_pickup_area,snapshot_row.proposed_dropoff_area,snapshot_row.declared_arrival_minutes) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot offer does not match';
    END IF;
  END IF;
  PERFORM private.assert_offering_movement_intent(snapshot_row.offering_movement_intent_id);
  SELECT i.* INTO STRICT intent_row FROM private.offering_movement_intents i WHERE i.id=snapshot_row.offering_movement_intent_id;
  IF ROW(intent_row.offering_member_id,intent_row.version,intent_row.earliest_departure_at,intent_row.latest_departure_at)
    IS DISTINCT FROM ROW(snapshot_row.offering_member_id,snapshot_row.offering_intent_version,
      snapshot_row.offering_earliest_departure_at,snapshot_row.offering_latest_departure_at)
    OR NOT EXISTS (SELECT 1 FROM private.offering_movement_intent_locations il WHERE il.intent_id=intent_row.id
      AND il.role='origin' AND il.location_reference_id=snapshot_row.offering_origin_location_id)
    OR NOT EXISTS (SELECT 1 FROM private.offering_movement_intent_locations il WHERE il.intent_id=intent_row.id
      AND il.role='destination' AND il.location_reference_id=snapshot_row.offering_destination_location_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot offering intent does not match';
  END IF;
  IF EXISTS (SELECT 1 FROM private.movement_location_references lr
    WHERE lr.id IN (snapshot_row.requester_origin_location_id,snapshot_row.requester_destination_location_id)
      AND (lr.owner_member_id<>snapshot_row.requesting_member_id OR (lr.expires_at IS NOT NULL AND lr.expires_at<=clock_timestamp()))) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot requester location owner or expiry does not match';
  END IF;
  SELECT v.seat_capacity INTO STRICT current_capacity FROM public.vehicles v WHERE v.id=snapshot_row.vehicle_id FOR SHARE;
  PERFORM 1 FROM public.member_vehicle_access mva WHERE mva.member_id=snapshot_row.offering_member_id
    AND mva.vehicle_id=snapshot_row.vehicle_id AND mva.active FOR SHARE;
  IF NOT FOUND OR current_capacity<>snapshot_row.vehicle_seat_capacity OR snapshot_row.seats_offered>current_capacity THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot vehicle access or capacity does not match';
  END IF;
  IF (SELECT count(*) FROM private.movement_context_snapshot_travellers st WHERE st.snapshot_id=snapshot_row.id)<>snapshot_row.people_count
    OR (SELECT count(*) FROM public.movement_participants mp WHERE mp.movement_need_id=need_row.id AND mp.status='confirmed')<>snapshot_row.people_count
    OR EXISTS (SELECT 1 FROM public.movement_participants mp WHERE mp.movement_need_id=need_row.id AND mp.status='invited')
    OR EXISTS (SELECT 1 FROM private.movement_context_snapshot_travellers st WHERE st.snapshot_id=snapshot_row.id AND (
      st.member_id=snapshot_row.offering_member_id
      OR (st.role='primary_requester') IS DISTINCT FROM (st.member_id=snapshot_row.requesting_member_id)
      OR NOT EXISTS (SELECT 1 FROM public.movement_participants mp WHERE mp.id=st.movement_participant_id
        AND mp.movement_need_id=need_row.id AND mp.member_id=st.member_id AND mp.role=st.role AND mp.status='confirmed')))
    OR NOT EXISTS (SELECT 1 FROM private.movement_context_snapshot_travellers st WHERE st.snapshot_id=snapshot_row.id
      AND st.member_id=snapshot_row.requesting_member_id AND st.role='primary_requester') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement snapshot requires the exact confirmed roster';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_movement_context_snapshot(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_movement_context_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME='movement_context_snapshots' THEN
    PERFORM private.assert_movement_context_snapshot(NEW.id);
  ELSE
    PERFORM private.assert_movement_context_snapshot(NEW.snapshot_id);
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_movement_context_snapshot() FROM PUBLIC,anon,authenticated,service_role;
-- Only construction enqueues validation. Historical terminal transitions and
-- no-op retries never revalidate mutable sources. New consumers must explicitly
-- revalidate eligibility; a stored current flag alone is not fresh evidence.
CREATE CONSTRAINT TRIGGER movement_context_snapshot_complete AFTER INSERT ON private.movement_context_snapshots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_movement_context_snapshot();
CREATE CONSTRAINT TRIGGER movement_context_travellers_complete AFTER INSERT ON private.movement_context_snapshot_travellers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION private.validate_movement_context_snapshot();

COMMIT;
