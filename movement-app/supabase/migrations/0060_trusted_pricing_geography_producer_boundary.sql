BEGIN;

-- WE DO NOT CREATE JOURNEYS. Record normalized classification only.
CREATE FUNCTION public.record_pricing_geography_evidence_for_server(
  p_route_match_evidence_id uuid,
  p_expected_route_match_evidence_version integer,
  p_expected_route_evidence_id uuid,
  p_expected_route_evidence_version integer,
  p_pricing_corridor_distance_meters bigint,
  p_geographic_events jsonb,
  p_classifier_name text,
  p_classifier_version text,
  p_transport_geography_version text
)
RETURNS TABLE (
  pricing_geography_evidence_id uuid,
  pricing_geography_evidence_version integer,
  pricing_geography_evidence_status text,
  pricing_geography_evidence_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m private.trusted_route_match_evidence%ROWTYPE;
  e private.pricing_geography_evidence%ROWTYPE;
  previous private.pricing_geography_evidence%ROWTYPE;
  deadline timestamptz;
  replay_count integer;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Pricing geography producer requires READ COMMITTED';
  END IF;
  IF p_route_match_evidence_id IS NULL OR p_expected_route_match_evidence_version IS NULL
    OR p_expected_route_evidence_id IS NULL OR p_expected_route_evidence_version IS NULL
    OR p_pricing_corridor_distance_meters IS NULL OR p_geographic_events IS NULL
    OR p_classifier_name IS NULL OR p_classifier_version IS NULL
    OR p_transport_geography_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete normalized pricing geography result required';
  END IF;
  IF p_expected_route_match_evidence_version<1 OR p_expected_route_evidence_version<1
    OR p_pricing_corridor_distance_meters<=0
    OR p_classifier_name !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    OR p_classifier_version !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    OR p_transport_geography_version !~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid pricing geography result or provenance';
  END IF;
  PERFORM private.assert_pricing_geography_events(p_geographic_events,p_pricing_corridor_distance_meters);

  -- Preliminary read discovers immutable need identity only. Never lock the
  -- match before its authoritative need/endpoints/intent/route dependencies.
  SELECT x.* INTO m FROM private.trusted_route_match_evidence x WHERE x.id=p_route_match_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact trusted route-match evidence unavailable';
  END IF;
  PERFORM 1 FROM public.movement_needs n WHERE n.id=m.movement_need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Pricing geography movement need unavailable';
  END IF;
  SELECT x.* INTO STRICT m FROM private.trusted_route_match_evidence x WHERE x.id=p_route_match_evidence_id;
  IF ROW(m.version,m.route_evidence_id,m.route_evidence_version)
    IS DISTINCT FROM ROW(p_expected_route_match_evidence_version,p_expected_route_evidence_id,p_expected_route_evidence_version) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Classified source identity or version mismatch';
  END IF;
  SELECT coalesce(n.latest_departure_at,n.earliest_departure_at) INTO STRICT deadline
    FROM public.movement_needs n WHERE n.id=m.movement_need_id;

  e.id:=gen_random_uuid();
  e.route_match_evidence_id:=m.id;
  e.route_match_evidence_version:=m.version;
  e.movement_need_id:=m.movement_need_id;
  e.requesting_member_id:=m.requesting_member_id;
  e.offering_member_id:=m.offering_member_id;
  e.offering_movement_intent_id:=m.offering_movement_intent_id;
  e.offering_intent_version:=m.offering_intent_version;
  e.route_evidence_id:=m.route_evidence_id;
  e.route_evidence_version:=m.route_evidence_version;
  e.state_location_reference_id:=m.requester_origin_location_reference_id;
  e.evidence_schema_version:='pricing_geography_evidence_v1';
  e.classifier_name:=p_classifier_name;
  e.classifier_version:=p_classifier_version;
  e.transport_geography_version:=p_transport_geography_version;
  e.pricing_corridor_distance_meters:=p_pricing_corridor_distance_meters;
  e.pricing_range_supported:=(p_pricing_corridor_distance_meters<=100000);
  e.geographic_events:=p_geographic_events;
  e.generated_at:=clock_timestamp();
  e.created_at:=e.generated_at;
  e.expires_at:=least(deadline,m.expires_at);
  e.status:='current';
  -- 0059 acquires/revalidates canonical context, then match SHARE. Only after
  -- that may this producer lock pricing history. No weaker matching validator.
  PERFORM private.assert_pricing_geography_context(e);
  PERFORM x.id FROM private.pricing_geography_evidence x
    WHERE x.movement_need_id=e.movement_need_id
      AND x.offering_movement_intent_id=e.offering_movement_intent_id
    ORDER BY x.version FOR UPDATE;
  -- Fresh eligibility after any pricing-history lock wait.
  PERFORM private.assert_pricing_geography_context(e);

  -- Replay identity is exact match + classifier name/version + dataset version.
  -- Scan terminal history too: an old result must never reopen after supersession.
  SELECT count(*) INTO replay_count FROM private.pricing_geography_evidence x
    WHERE x.route_match_evidence_id=m.id AND x.classifier_name=p_classifier_name
      AND x.classifier_version=p_classifier_version
      AND x.transport_geography_version=p_transport_geography_version;
  IF replay_count>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ambiguous pricing geography replay history';
  END IF;
  IF replay_count=1 THEN
    SELECT x.* INTO STRICT previous FROM private.pricing_geography_evidence x
      WHERE x.route_match_evidence_id=m.id AND x.classifier_name=p_classifier_name
        AND x.classifier_version=p_classifier_version
        AND x.transport_geography_version=p_transport_geography_version;
    IF (to_jsonb(previous)-ARRAY['id','version','generated_at','created_at','expires_at','status'])
      IS DISTINCT FROM (to_jsonb(e)-ARRAY['id','version','generated_at','created_at','expires_at','status']) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Pricing geography replay payload mismatch';
    END IF;
    -- Retain original timestamps/expiry, and fail if the evidence is terminal,
    -- expired or no longer within live dependency bounds. Never refresh a retry.
    PERFORM private.assert_pricing_geography_evidence(previous.id);
    RETURN QUERY SELECT previous.id,previous.version,previous.status,previous.expires_at;
    RETURN;
  END IF;

  SELECT coalesce(max(x.version),0)+1 INTO e.version FROM private.pricing_geography_evidence x
    WHERE x.movement_need_id=e.movement_need_id
      AND x.offering_movement_intent_id=e.offering_movement_intent_id;
  UPDATE private.pricing_geography_evidence x SET status='superseded'
    WHERE x.movement_need_id=e.movement_need_id
      AND x.offering_movement_intent_id=e.offering_movement_intent_id AND x.status='current';
  -- Generated time here means normalized evidence recording, not the future
  -- classifier's computation time. Bindings pin the classified source instead.
  e.generated_at:=clock_timestamp();
  e.created_at:=e.generated_at;
  INSERT INTO private.pricing_geography_evidence SELECT e.*;
  PERFORM private.assert_pricing_geography_evidence(e.id);
  RETURN QUERY SELECT e.id,e.version,e.status,e.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pricing_geography_evidence_for_server(uuid,integer,uuid,integer,bigint,jsonb,text,text,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_pricing_geography_evidence_for_server(uuid,integer,uuid,integer,bigint,jsonb,text,text,text)
  TO service_role;

COMMIT;
