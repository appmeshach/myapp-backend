BEGIN;

-- WE DO NOT CREATE JOURNEYS. Monetary-neutral, private evidence only.
-- No operational classifier, writer, quotation or financial integration.
CREATE TABLE private.pricing_geography_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_match_evidence_id uuid NOT NULL REFERENCES private.trusted_route_match_evidence(id),
  route_match_evidence_version integer NOT NULL CHECK (route_match_evidence_version>=1),
  -- Like 0037, no need FK: deleting a declaration must not delete history.
  movement_need_id uuid NOT NULL,
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  offering_intent_version integer NOT NULL CHECK (offering_intent_version>=1),
  route_evidence_id uuid NOT NULL REFERENCES private.offering_route_evidence(id),
  route_evidence_version integer NOT NULL CHECK (route_evidence_version>=1),
  -- Immutable provider-backed state anchor, never a client-supplied state name.
  -- The existing matching assertion verifies all four endpoints share its state.
  state_location_reference_id uuid NOT NULL
    REFERENCES private.trusted_location_state_evidence(resolved_location_reference_id),
  version integer NOT NULL CHECK (version>=1),
  evidence_schema_version text NOT NULL CHECK (evidence_schema_version='pricing_geography_evidence_v1'),
  classifier_name text NOT NULL CHECK (classifier_name ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'),
  classifier_version text NOT NULL CHECK (classifier_version ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'),
  transport_geography_version text NOT NULL CHECK (transport_geography_version ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'),
  pricing_corridor_distance_meters bigint NOT NULL CHECK (pricing_corridor_distance_meters>0),
  pricing_range_supported boolean NOT NULL,
  geographic_events jsonb NOT NULL,
  generated_at timestamptz NOT NULL CHECK (isfinite(generated_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','expired')),
  UNIQUE (movement_need_id,offering_movement_intent_id,version),
  CHECK (requesting_member_id<>offering_member_id),
  CHECK (pricing_range_supported = (pricing_corridor_distance_meters<=100000)),
  CHECK (generated_at<=created_at AND expires_at>created_at)
);
CREATE UNIQUE INDEX pricing_geography_evidence_one_current
  ON private.pricing_geography_evidence(movement_need_id,offering_movement_intent_id)
  WHERE status='current';
ALTER TABLE private.pricing_geography_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pricing_geography_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.pricing_geography_evidence TO service_role;

-- Array order is traversal order along this pricing corridor, not the provider's
-- entire route. Equal positions may contain distinct event types in classifier
-- order. An identical type/position cannot recur. No counts are duplicated.
CREATE FUNCTION private.assert_pricing_geography_events(p_events jsonb,p_distance bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE event jsonb; event_position numeric; previous_position numeric:=-1; seen jsonb:='[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_events) IS DISTINCT FROM 'array' OR p_distance IS NULL OR p_distance<=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid pricing geography event sequence';
  END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF jsonb_typeof(event) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid pricing geography event';
    END IF;
    IF jsonb_typeof(event->'event_type') IS DISTINCT FROM 'string'
      OR jsonb_typeof(event->'position_meters') IS DISTINCT FROM 'number'
      OR (event-'event_type'-'position_meters')<>'{}'::jsonb
      OR event->>'event_type' NOT IN ('core_stage_entry','major_transport_transition') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid pricing geography event fields';
    END IF;
    event_position:=(event->>'position_meters')::numeric;
    IF event_position<>trunc(event_position) OR event_position<0 OR event_position>p_distance
      OR event_position<previous_position OR seen @> jsonb_build_array(event) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid pricing geography event order or position';
    END IF;
    previous_position:=event_position;
    seen:=seen||jsonb_build_array(event);
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_pricing_geography_events(jsonb,bigint) FROM PUBLIC, anon, authenticated, service_role;

-- Used BEFORE INSERT (before FK locks), and by the live consumer assertion.
-- The need UPDATE lock matches 0038's serialization boundary; the authoritative
-- assertion supplies requester endpoints -> intent -> route order and 0050/0052
-- same-state/deadline checks. Match locks are taken only after that context.
CREATE FUNCTION private.assert_pricing_geography_context(p private.pricing_geography_evidence)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m private.trusted_route_match_evidence%ROWTYPE; deadline timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Pricing geography evidence requires READ COMMITTED';
  END IF;
  PERFORM 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography movement need unavailable';
  END IF;
  -- Check the immutable need binding before entering the canonical context, so
  -- malformed input cannot make it acquire a second, differently ordered need.
  SELECT e.* INTO STRICT m FROM private.trusted_route_match_evidence e WHERE e.id=p.route_match_evidence_id;
  IF m.movement_need_id IS DISTINCT FROM p.movement_need_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography context mismatch';
  END IF;
  PERFORM private.assert_trusted_route_match_evidence(m.id);
  SELECT e.* INTO STRICT m FROM private.trusted_route_match_evidence e WHERE e.id=p.route_match_evidence_id FOR SHARE;
  IF ROW(p.route_match_evidence_version,p.requesting_member_id,p.offering_member_id,
      p.offering_movement_intent_id,p.offering_intent_version,p.route_evidence_id,p.route_evidence_version,p.state_location_reference_id)
    IS DISTINCT FROM ROW(m.version,m.requesting_member_id,m.offering_member_id,
      m.offering_movement_intent_id,m.offering_intent_version,m.route_evidence_id,m.route_evidence_version,m.requester_origin_location_reference_id)
    OR m.status<>'current' OR (m.expires_at IS NOT NULL AND m.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography context mismatch or stale match';
  END IF;
  SELECT coalesce(n.latest_departure_at,n.earliest_departure_at) INTO STRICT deadline
    FROM public.movement_needs n WHERE n.id=p.movement_need_id;
  IF p.status IS DISTINCT FROM 'current' OR p.expires_at IS NULL
    OR NOT isfinite(p.expires_at) OR p.expires_at<=clock_timestamp()
    OR p.expires_at>deadline OR (m.expires_at IS NOT NULL AND p.expires_at>m.expires_at)
    OR p.generated_at IS NULL OR NOT isfinite(p.generated_at)
    OR p.generated_at<m.calculated_at OR p.generated_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence time or lifecycle invalid';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_pricing_geography_context(private.pricing_geography_evidence) FROM PUBLIC, anon, authenticated, service_role;

-- A persisted current flag is NOT a live eligibility guarantee. Future consumers
-- must call this in the same transaction before using the evidence. It rejects
-- superseded routes/matches and changed/closed/elapsed requester context.
CREATE FUNCTION private.assert_pricing_geography_evidence(p_evidence_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE e private.pricing_geography_evidence%ROWTYPE;
BEGIN
  SELECT x.* INTO STRICT e FROM private.pricing_geography_evidence x WHERE x.id=p_evidence_id;
  PERFORM private.assert_pricing_geography_context(e);
  -- Lock and re-read only after dependencies; a concurrent lifecycle transition
  -- cannot be mistaken for a current evidence row.
  SELECT x.* INTO STRICT e FROM private.pricing_geography_evidence x WHERE x.id=p_evidence_id FOR SHARE;
  IF e.status<>'current' OR e.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence is not current and unexpired';
  END IF;
  -- Recheck deadlines after any evidence-row wait, using already held context locks.
  PERFORM private.assert_pricing_geography_context(e);
  PERFORM private.assert_pricing_geography_events(e.geographic_events,e.pricing_corridor_distance_meters);
END;
$$;
REVOKE ALL ON FUNCTION private.assert_pricing_geography_evidence(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.protect_pricing_geography_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'current' OR NEW.created_at>clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence must start current with valid timestamps';
    END IF;
    PERFORM private.assert_pricing_geography_context(NEW);
    PERFORM private.assert_pricing_geography_events(NEW.geographic_events,NEW.pricing_corridor_distance_meters);
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence facts are immutable';
  END IF;
  IF OLD.status<>'current' OR NEW.status NOT IN ('superseded','expired') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence lifecycle cannot reopen or change terminal state';
  END IF;
  IF NEW.status='expired' AND NEW.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence expiry has not elapsed';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_pricing_geography_evidence() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER protect_pricing_geography_evidence BEFORE INSERT OR UPDATE OR DELETE
  ON private.pricing_geography_evidence FOR EACH ROW EXECUTE FUNCTION private.protect_pricing_geography_evidence();

COMMIT;
