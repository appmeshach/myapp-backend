BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';

CREATE TEMP TABLE pg_temp.snapshot_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.snapshot_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO pg_temp.snapshot_results(
    test_name,
    passed,
    diagnostic
  )
  VALUES(
    p_name,
    coalesce(p_passed,false),
    p_diagnostic
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_check(text,boolean,text)
FROM PUBLIC;


-- Execute one SELECT using one of the API/database roles.
CREATE FUNCTION pg_temp.snapshot_select_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  previous_role text;
  previous_sub text;
  previous_jwt_role text;
  previous_claims text;
  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated','anon','service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  previous_role := current_setting('role');
  previous_sub := current_setting('request.jwt.claim.sub',true);
  previous_jwt_role := current_setting('request.jwt.claim.role',true);
  previous_claims := current_setting('request.jwt.claims',true);

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member_id::text,''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    p_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      p_member_id,
      'role',
      p_role
    )::text,
    true
  );

  PERFORM set_config('role',p_role,true);

  BEGIN
    EXECUTE
      'SELECT coalesce(
         jsonb_agg(to_jsonb(q)),
         ''[]''::jsonb
       )
       FROM (' || p_sql || ') AS q'
    INTO rows_json;

    result_json := jsonb_build_object(
      'ok',true,
      'rows',rows_json
    );
  EXCEPTION
    WHEN OTHERS THEN
      result_json := jsonb_build_object(
        'ok',false,
        'state',SQLSTATE,
        'message',SQLERRM
      );
  END;

  PERFORM set_config('role',previous_role,true);
  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(previous_sub,''),
    true
  );
  PERFORM set_config(
    'request.jwt.claim.role',
    coalesce(previous_jwt_role,''),
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    coalesce(previous_claims,'{}'),
    true
  );

  RETURN result_json;
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_select_as(text,uuid,text)
FROM PUBLIC;


-- Build the same provider-resolved + trusted-state endpoint shape used by the
-- later same-state movement system. Directly inserting a resolved location is
-- insufficient because route matching requires authoritative state evidence.
CREATE FUNCTION pg_temp.snapshot_state_endpoint(
  p_owner_member_id uuid,
  p_label text,
  p_provider_place_reference text,
  p_latitude numeric,
  p_longitude numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  source_id uuid;
  target_id uuid;
  resolution_evidence_id uuid;
  t timestamptz := clock_timestamp();
BEGIN
  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    provider_namespace,
    provider_place_reference,
    created_at
  )
  VALUES(
    p_owner_member_id,
    p_label,
    'member_selected',
    'unresolved',
    'test-provider',
    p_provider_place_reference,
    t
  )
  RETURNING id
  INTO source_id;

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    resolved_at,
    created_at,
    expires_at
  )
  VALUES(
    p_owner_member_id,
    p_label,
    'provider_resolved',
    'resolved',
    p_latitude,
    p_longitude,
    'test-provider',
    p_provider_place_reference,
    'test-resolution-v1',
    t,
    t,
    t + interval '4 hours'
  )
  RETURNING id
  INTO target_id;

  INSERT INTO private.movement_location_resolution_evidence(
    source_location_reference_id,
    resolved_location_reference_id,
    version,
    producer_request_id,
    provider_product,
    provider_version,
    resolution_schema_version,
    requested_expires_at,
    recorded_at
  )
  VALUES(
    source_id,
    target_id,
    1,
    gen_random_uuid(),
    'test-geocoder',
    'v1',
    'movement_location_resolution_v1',
    t + interval '4 hours',
    t
  )
  RETURNING id
  INTO resolution_evidence_id;

  INSERT INTO private.trusted_location_state_evidence(
    resolution_evidence_id,
    resolved_location_reference_id,
    provider_namespace,
    state_provider_reference,
    state_name,
    state_key,
    recorded_at
  )
  VALUES(
    resolution_evidence_id,
    target_id,
    'test-provider',
    'region-lagos',
    'Lagos',
    private.canonical_nigerian_state_key('Lagos'),
    clock_timestamp()
  );

  RETURN target_id;
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_state_endpoint(
  uuid,
  text,
  text,
  numeric,
  numeric
)
FROM PUBLIC;


-- Trusted server-side route fixture.
CREATE FUNCTION pg_temp.snapshot_route(
  p_intent uuid,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  t timestamptz := clock_timestamp();
BEGIN
  RETURN pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_offering_route_evidence_for_server(
         %L::uuid,
         ''test-router'',
         ''directions'',
         ''v1'',
         %L,
         %L::jsonb,
         18000,
         2400,
         %L::timestamptz,
         %L::timestamptz
       )',
      p_intent,
      p_reference,
      '{"type":"LineString","coordinates":[[3.5852,6.4698],[3.5200,6.4300],[3.4900,6.4320],[3.4430,6.4310],[3.4219,6.4281]]}',
      t,
      t + interval '3 hours'
    )
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_route(uuid,text)
FROM PUBLIC;


CREATE FUNCTION pg_temp.snapshot_match(
  p_need uuid,
  p_intent uuid,
  p_route uuid,
  p_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  t timestamptz := clock_timestamp();
BEGIN
  RETURN pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_trusted_route_match_evidence_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::integer,
         250000,
         400000,
         18000,
         1000,
         12000,
         6.4300,
         3.5200,
         6.4310,
         3.4430,
         %L::timestamptz,
         %L::timestamptz
       )',
      p_need,
      p_intent,
      p_route,
      p_version,
      t,
      t + interval '2 hours'
    )
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_match(uuid,uuid,uuid,integer)
FROM PUBLIC;


CREATE TEMP TABLE pg_temp.snapshot_fixture (
  requester uuid NOT NULL,
  offerer uuid NOT NULL,
  traveller uuid NOT NULL,
  vehicle uuid NOT NULL,
  need uuid NOT NULL,
  intent uuid NOT NULL,
  route uuid NOT NULL,
  match_evidence uuid NOT NULL,
  availability uuid NOT NULL,
  movement_offer uuid NOT NULL
) ON COMMIT DROP;


DO $fixture$
DECLARE
  requester uuid := gen_random_uuid();
  offerer uuid := gen_random_uuid();
  traveller uuid := gen_random_uuid();
  vehicle uuid := gen_random_uuid();

  requester_origin uuid;
  requester_destination uuid;
  offerer_origin uuid;
  offerer_destination uuid;

  need uuid;
  intent uuid;
  route uuid;
  match_evidence uuid;
  availability uuid;
  movement_offer uuid;

  loc record;
  location_id uuid;
  r jsonb;
  t timestamptz;
BEGIN
  t := clock_timestamp();

  INSERT INTO auth.users(
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  SELECT
    id,
    'authenticated',
    'authenticated',
    id::text || '@test-0072.invalid',
    t,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    t,
    t
  FROM unnest(ARRAY[
    requester,
    offerer,
    traveller
  ]) ids(id);

  requester_origin :=
    pg_temp.snapshot_state_endpoint(
      requester,
      'Agungi, Lagos',
      '0072-requester-origin',
      6.4300,
      3.5200
    );

  requester_destination :=
    pg_temp.snapshot_state_endpoint(
      requester,
      'Oniru, Lagos',
      '0072-requester-destination',
      6.4310,
      3.4430
    );

  offerer_origin :=
    pg_temp.snapshot_state_endpoint(
      offerer,
      'Ajah, Lagos',
      '0072-offerer-origin',
      6.4698,
      3.5852
    );

  offerer_destination :=
    pg_temp.snapshot_state_endpoint(
      offerer,
      'Victoria Island, Lagos',
      '0072-offerer-destination',
      6.4281,
      3.4219
    );

  r := pg_temp.snapshot_select_as(
    'authenticated',
    requester,
    format(
      'SELECT *
       FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin,
      requester_destination,
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    )
  );

  need := (r#>>'{rows,0,movement_need_id}')::uuid;

  IF need IS NULL THEN
    RAISE EXCEPTION '0072 requester fixture failed: %',r;
  END IF;

  -- Make this a two-person confirmed requester group.
  UPDATE public.movement_needs
  SET people_count=2
  WHERE id=need;

  INSERT INTO public.movement_participants(
    movement_need_id,
    member_id,
    role,
    status
  )
  VALUES(
    need,
    traveller,
    'invited_participant',
    'confirmed'
  );

  r := pg_temp.snapshot_select_as(
    'authenticated',
    offerer,
    format(
      'SELECT *
       FROM public.create_offering_movement_intent(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz
       )',
      gen_random_uuid(),
      offerer_origin,
      offerer_destination,
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    )
  );

  intent :=
    (r#>>'{rows,0,offering_movement_intent_id}')::uuid;

  IF intent IS NULL THEN
    RAISE EXCEPTION '0072 offering intent fixture failed: %',r;
  END IF;

  r := pg_temp.snapshot_route(
    intent,
    '0072-main-route'
  );

  route :=
    (r#>>'{rows,0,route_evidence_id}')::uuid;

  IF route IS NULL THEN
    RAISE EXCEPTION '0072 route fixture failed: %',r;
  END IF;

  r := pg_temp.snapshot_match(
    need,
    intent,
    route,
    1
  );

  match_evidence :=
    (r#>>'{rows,0,route_match_evidence_id}')::uuid;

  IF match_evidence IS NULL THEN
    RAISE EXCEPTION '0072 route-match fixture failed: %',r;
  END IF;

  INSERT INTO public.vehicles(
    id,
    make,
    model,
    color,
    seat_capacity,
    plate_number
  )
  VALUES(
    vehicle,
    'Lexus',
    'RX350',
    'Blue',
    4,
    'T0072-' || left(vehicle::text,8)
  );

  INSERT INTO public.member_vehicle_access(
    member_id,
    vehicle_id,
    active
  )
  VALUES(
    offerer,
    vehicle,
    true
  );

  r := pg_temp.snapshot_select_as(
    'authenticated',
    offerer,
    format(
      'SELECT *
       FROM public.open_offering_movement_availability(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         3
       )',
      gen_random_uuid(),
      intent,
      vehicle
    )
  );

  availability :=
    (r#>>'{rows,0,availability_id}')::uuid;

  IF availability IS NULL THEN
    RAISE EXCEPTION '0072 availability fixture failed: %',r;
  END IF;

  r := pg_temp.snapshot_select_as(
    'authenticated',
    offerer,
    format(
      'SELECT *
       FROM public.create_movement_offer(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         3,
         ''Chevron pickup'',
         ''Oniru dropoff'',
         18
       )',
      need,
      match_evidence,
      availability
    )
  );

  movement_offer :=
    (r#>>'{rows,0,movement_offer_id}')::uuid;

  IF movement_offer IS NULL THEN
    RAISE EXCEPTION '0072 movement offer fixture failed: %',r;
  END IF;

  INSERT INTO pg_temp.snapshot_fixture
  VALUES(
    requester,
    offerer,
    traveller,
    vehicle,
    need,
    intent,
    route,
    match_evidence,
    availability,
    movement_offer
  );
END;
$fixture$;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;


CREATE FUNCTION pg_temp.record_result(p_match uuid,p_overrides jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE m private.trusted_route_match_evidence%ROWTYPE; args jsonb; result_id uuid;
BEGIN
 SELECT * INTO STRICT m FROM private.trusted_route_match_evidence WHERE id=p_match;
 args:=jsonb_build_object('match_id',m.id,'match_version',m.version,'route_id',m.route_evidence_id,'route_version',m.route_evidence_version,
 'distance',12000,'events','[]'::jsonb,'classifier','test-classifier','classifier_version','v1','dataset','test-v1')||p_overrides;
 SELECT pricing_geography_evidence_id INTO result_id FROM public.record_pricing_geography_evidence_for_server(
 (args->>'match_id')::uuid,(args->>'match_version')::integer,(args->>'route_id')::uuid,(args->>'route_version')::integer,
 (args->>'distance')::bigint,args->'events',args->>'classifier',args->>'classifier_version',args->>'dataset');
 RETURN result_id;
END;
$$;


-- 0073 fixtures reuse the reviewed 0072 trusted endpoint/route/offer setup.
-- Owner-only test helpers below are NEVER installed by the migration.
CREATE TEMP TABLE pg_temp.binding_fixture(snapshot_id uuid,quote_id uuid) ON COMMIT DROP;
DO $$ DECLARE f record; s uuid; g uuid; q uuid; BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT snapshot_id INTO s FROM public.record_movement_context_snapshot_for_server(f.movement_offer);
 g:=pg_temp.record_result(f.match_evidence);
 SELECT quote_id INTO q FROM public.record_pricing_quote_for_server(g,1,'trusted_server_result_infrastructure_v1',12345);
 INSERT INTO pg_temp.binding_fixture VALUES(s,q);
END $$;

CREATE FUNCTION pg_temp.binding_sources() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; h text; result text:=''; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')
    AND c.relname NOT IN ('financial_proposals','financial_proposal_travellers')
  ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',r.nspname,r.relname) INTO h;
  result:=result||r.nspname||'.'||r.relname||':'||h;
 END LOOP;
 RETURN md5(result);
END $$;
CREATE TEMP TABLE pg_temp.binding_before AS SELECT pg_temp.binding_sources() AS fingerprint;

CREATE FUNCTION pg_temp.proposal_record(p_overrides jsonb DEFAULT '{}')
RETURNS private.financial_proposals LANGUAGE plpgsql AS $$
DECLARE s private.movement_context_snapshots%ROWTYPE; q private.pricing_quotes%ROWTYPE; v integer;
BEGIN
 SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
 SELECT x.* INTO STRICT q FROM private.pricing_quotes x JOIN pg_temp.binding_fixture f ON f.quote_id=x.id;
 SELECT coalesce(max(version),0)+1 INTO v FROM private.financial_proposals WHERE movement_need_id=s.movement_need_id AND offering_member_id=s.offering_member_id;
 RETURN jsonb_populate_record(NULL::private.financial_proposals,jsonb_build_object(
  'id',gen_random_uuid(),'version',v,'movement_need_id',s.movement_need_id,'member_needing_movement_id',s.requesting_member_id,
  'offering_member_id',s.offering_member_id,'vehicle_id',s.vehicle_id,
  'financial_model_version','shared_platform_fee_v1','platform_fee_allocation_policy_version','equal_split_requester_remainder_v1',
  'pricing_policy_version',q.pricing_policy_version,'currency',q.currency,
  'quoted_platform_fee_total_minor',17,'quoted_movement_contribution_minor',83,
  'origin_area',s.requester_origin_area,'destination_area',s.requester_destination_area,
  'earliest_departure_at',s.requester_earliest_departure_at,'latest_departure_at',s.requester_latest_departure_at,
  'people_count',s.people_count,'seats_offered',s.seats_offered,'vehicle_seat_capacity',s.vehicle_seat_capacity,
  'proposed_pickup_area',s.proposed_pickup_area,'proposed_dropoff_area',s.proposed_dropoff_area,
  'estimated_arrival_minutes',s.declared_arrival_minutes,'created_at',clock_timestamp(),
  'expires_at',least(s.expires_at,q.expires_at),'status','current',
  'pricing_quote_id',q.id,'pricing_quote_version',q.version,
  'movement_context_snapshot_id',s.id,'movement_context_snapshot_version',s.version)||p_overrides);
END $$;

CREATE FUNCTION pg_temp.construct(p_overrides jsonb DEFAULT '{}',p_roster text DEFAULT 'exact')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p private.financial_proposals%ROWTYPE; source_offer uuid;
BEGIN
 SET CONSTRAINTS ALL DEFERRED;
 p:=pg_temp.proposal_record(p_overrides);
 SELECT movement_offer_id INTO STRICT source_offer FROM private.movement_context_snapshots WHERE id=(SELECT snapshot_id FROM pg_temp.binding_fixture);
 -- Dependencies first, then existing proposal history. Normal triggers remain on.
 PERFORM private.assert_movement_offer_availability_binding(source_offer);
 PERFORM private.assert_pricing_quote((SELECT quote_id FROM pg_temp.binding_fixture));
 PERFORM private.assert_movement_context_snapshot((SELECT snapshot_id FROM pg_temp.binding_fixture));
 PERFORM id FROM private.financial_proposals WHERE movement_need_id=p.movement_need_id ORDER BY offering_member_id,version FOR UPDATE;
 UPDATE private.financial_proposals SET status='superseded' WHERE movement_need_id=p.movement_need_id AND offering_member_id=p.offering_member_id AND status='current';
 INSERT INTO private.financial_proposals SELECT p.*;
 INSERT INTO private.financial_proposal_travellers(proposal_id,member_id,participant_id,role)
 SELECT p.id,CASE WHEN p_roster='member' AND t.role='invited_participant' THEN p.offering_member_id ELSE t.member_id END,
  CASE WHEN p_roster='participant' AND t.role='invited_participant' THEN gen_random_uuid() ELSE t.movement_participant_id END,
  CASE WHEN p_roster='role' AND t.role='invited_participant' THEN 'primary_requester' ELSE t.role END
 FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id
  AND (p_roster<>'missing' OR t.role='primary_requester');
 IF p_roster='extra' THEN
  INSERT INTO private.financial_proposal_travellers VALUES(p.id,p.offering_member_id,gen_random_uuid(),'invited_participant');
 END IF;
 SET CONSTRAINTS private.financial_proposal_movement_context_complete,private.financial_proposal_snapshot_roster_complete IMMEDIATE;
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN p.id;
END $$;

-- Every probe rolls back its work even on success, preserving the valid baseline.
CREATE FUNCTION pg_temp.probe(p_name text,p_sql text,p_state text DEFAULT '00000',p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text:='00000'; detail text;
BEGIN
 BEGIN
  EXECUTE p_sql;
  RAISE EXCEPTION USING ERRCODE='Z7300',MESSAGE='rollback successful probe';
 EXCEPTION WHEN SQLSTATE 'Z7300' THEN NULL;
 WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE,detail=MESSAGE_TEXT;
 END;
 PERFORM pg_temp.snapshot_check(p_name,actual=p_state
  AND (p_message IS NULL OR position(p_message IN coalesce(detail,''))>0),actual||': '||coalesce(detail,''));
END $$;

CREATE FUNCTION pg_temp.assert_history(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p private.financial_proposals%ROWTYPE; BEGIN
 SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=p_id;
 PERFORM private.assert_financial_proposal_quote_binding(p);
 PERFORM private.assert_financial_proposal_movement_context_binding(p);
 PERFORM private.assert_financial_proposal_source_compatibility(p);
 PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
END $$;

-- Materialization fixture exercises existing lifecycle, never a production issuer.
CREATE FUNCTION pg_temp.materialize(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p private.financial_proposals%ROWTYPE; s private.movement_context_snapshots%ROWTYPE;
 a uuid; g uuid; consent timestamptz;
BEGIN
 SET CONSTRAINTS ALL DEFERRED;
 SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=p_id;
 SELECT * INTO STRICT s FROM private.movement_context_snapshots WHERE id=p.movement_context_snapshot_id;
 PERFORM set_config('request.jwt.claim.sub',p.member_needing_movement_id::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.accept_movement_offer(s.movement_offer_id);
 RESET ROLE;
 SELECT id INTO STRICT a FROM public.alignments WHERE movement_offer_id=s.movement_offer_id;
 INSERT INTO private.financial_agreements(alignment_id,offering_member_id,member_needing_movement_id,version,
  financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,currency,quoted_platform_fee_total_minor)
 VALUES(a,p.offering_member_id,p.member_needing_movement_id,1,p.financial_model_version,p.pricing_policy_version,
  p.platform_fee_allocation_policy_version,p.currency,p.quoted_platform_fee_total_minor) RETURNING id INTO g;
 INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id)
 VALUES(g,'offering_platform_share',8,p.offering_member_id,'platform',NULL),
 (g,'requester_platform_share',9,p.member_needing_movement_id,'platform',NULL),
 (g,'movement_contribution',83,p.member_needing_movement_id,'member',p.offering_member_id);
 consent:=clock_timestamp();
 UPDATE private.financial_agreements SET offering_accepted_at=consent,requester_accepted_at=consent WHERE id=g;
 UPDATE private.financial_proposals SET offering_accepted_at=consent,requester_accepted_at=consent,
  movement_offer_id=s.movement_offer_id,alignment_id=a,financial_agreement_id=g,materialized_at=consent WHERE id=p.id;
 SET CONSTRAINTS ALL IMMEDIATE;
 PERFORM pg_temp.assert_history(p.id);
END $$;

SET CONSTRAINTS ALL IMMEDIATE;

-- Genuine source replacements; no protected source row is rewritten or trigger disabled.
CREATE FUNCTION pg_temp.compatibility_probe(p_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; i private.offering_movement_intents%ROWTYPE; intent_id uuid; route_id uuid;
 result jsonb; match_id uuid; geography_id uuid; quote_id uuid; route_version integer;
 p private.financial_proposals%ROWTYPE;
BEGIN
 SET CONSTRAINTS ALL DEFERRED;
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 intent_id:=f.intent;
 IF p_kind='intent' THEN
  SELECT * INTO STRICT i FROM private.offering_movement_intents WHERE id=f.intent;
  i.id:=gen_random_uuid();i.intent_key:=gen_random_uuid();i.created_at:=clock_timestamp();
  INSERT INTO private.offering_movement_intents SELECT i.*;
  INSERT INTO private.offering_movement_intent_locations SELECT i.id,role,location_reference_id FROM private.offering_movement_intent_locations WHERE private.offering_movement_intent_locations.intent_id=f.intent;
  intent_id:=i.id;
 END IF;
 IF p_kind IN ('intent','route') THEN
  result:=pg_temp.snapshot_route(intent_id,'0073-replacement-'||gen_random_uuid()::text);
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'replacement route failed: %',result; END IF;
  route_id:=(result#>>'{rows,0,route_evidence_id}')::uuid;
  SELECT version INTO STRICT route_version FROM private.offering_route_evidence WHERE id=route_id;
 ELSE
  route_id:=f.route;route_version:=1;
 END IF;
 IF p_kind='match' THEN
  -- 0037's unique need/route/algorithm prevents a second match for this route.
  -- Independently versioned pricing classification is the valid independent source.
  match_id:=f.match_evidence;
 ELSE
  result:=pg_temp.snapshot_match(f.need,intent_id,route_id,route_version);
  IF result->>'ok'<>'true' THEN RAISE EXCEPTION 'replacement match failed: %',result; END IF;
  match_id:=(result#>>'{rows,0,route_match_evidence_id}')::uuid;
 END IF;
 geography_id:=pg_temp.record_result(match_id,'{"classifier_version":"0073-v2"}');
 SELECT x.quote_id INTO quote_id FROM public.record_pricing_quote_for_server(geography_id,
  (SELECT version FROM private.pricing_geography_evidence WHERE id=geography_id),'trusted_server_result_infrastructure_v1',12345) x;
 p:=pg_temp.proposal_record(jsonb_build_object('pricing_quote_id',quote_id,
  'pricing_quote_version',(SELECT version FROM private.pricing_quotes WHERE id=quote_id),'created_at',clock_timestamp(),
  'expires_at',least((SELECT expires_at FROM private.pricing_quotes WHERE id=quote_id),
   (SELECT expires_at FROM private.movement_context_snapshots WHERE id=(SELECT snapshot_id FROM pg_temp.binding_fixture)))));
 -- Historical compatibility accepts independently versioned pricing geography
 -- on the same immutable route/endpoints; it does not compare classifier IDs.
 IF p_kind IN ('intent','route') THEN
  -- Exercise the real BEFORE INSERT boundary, not just a directly called helper.
  INSERT INTO private.financial_proposals SELECT p.*;
 ELSE
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
 END IF;
END $$;

CREATE FUNCTION pg_temp.new_offer(p_nullable boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE f record; i record; r jsonb; fresh_intent uuid; fresh_route uuid;
 fresh_match uuid; fresh_availability uuid; route_version integer; result_id uuid; BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.*,
  (SELECT location_reference_id FROM private.offering_movement_intent_locations WHERE intent_id=x.id AND role='origin') AS origin_id,
  (SELECT location_reference_id FROM private.offering_movement_intent_locations WHERE intent_id=x.id AND role='destination') AS destination_id
 INTO STRICT i FROM private.offering_movement_intents x WHERE x.id=f.intent;
 -- Availability is immutable, unique per intent, and bound to its original route.
 -- A fresh route on f.intent would invalidate f.availability. Use a new genuine
 -- intent with the same owner, locations and departure window instead; this also
 -- respects the one-current-match-per-need/intent rule without rewriting history.
 -- construct() and the outer baseline leave completeness constraints IMMEDIATE.
 -- Intake inserts the parent before its two locations: defer only the parent
 -- check until the normal producer completes. The location check stays immediate
 -- because both children are inserted together. Drain and restore IMMEDIATE
 -- before proceeding; this exception block rolls back the mode change on failure,
 -- including failures returned as JSON by snapshot_select_as().
 BEGIN
  SET CONSTRAINTS private.offering_intent_complete DEFERRED;
  r:=pg_temp.snapshot_select_as('authenticated',f.offerer,format(
   'SELECT * FROM public.create_offering_movement_intent(%L,%L,%L,%L,%L)',
   gen_random_uuid(),i.origin_id,i.destination_id,i.earliest_departure_at,i.latest_departure_at));
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Fresh intent failed: %',r; END IF;
  SET CONSTRAINTS private.offering_intent_complete IMMEDIATE;
 EXCEPTION WHEN OTHERS THEN
  RAISE;
 END;
 fresh_intent:=(r#>>'{rows,0,offering_movement_intent_id}')::uuid;
 r:=pg_temp.snapshot_route(fresh_intent,'0073-new-offer-'||gen_random_uuid()::text);
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Fresh route failed: %',r; END IF;
 fresh_route:=(r#>>'{rows,0,route_evidence_id}')::uuid;
 SELECT version INTO STRICT route_version FROM private.offering_route_evidence WHERE id=fresh_route;
 r:=pg_temp.snapshot_match(f.need,fresh_intent,fresh_route,route_version);
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Fresh match failed: %',r; END IF;
 fresh_match:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
 r:=pg_temp.snapshot_select_as('authenticated',f.offerer,format(
  'SELECT * FROM public.open_offering_movement_availability(%L,%L,%L,3)',
  gen_random_uuid(),fresh_intent,f.vehicle));
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'Fresh availability failed: %',r; END IF;
 fresh_availability:=(r#>>'{rows,0,availability_id}')::uuid;
 PERFORM set_config('request.jwt.claim.sub',f.offerer::text,true);
 SET LOCAL ROLE authenticated;
 SELECT movement_offer_id INTO STRICT result_id FROM public.create_movement_offer(f.need,fresh_match,fresh_availability,3,
  CASE WHEN p_nullable THEN NULL ELSE 'Chevron pickup' END,
  CASE WHEN p_nullable THEN NULL ELSE 'Oniru dropoff' END,
  CASE WHEN p_nullable THEN NULL ELSE 18 END);
 RESET ROLE;
 RETURN result_id;
END $$;

CREATE FUNCTION pg_temp.short_source(p_source text,p_seconds numeric DEFAULT 0.5) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s private.movement_context_snapshots%ROWTYPE; q private.pricing_quotes%ROWTYPE; old_id uuid;
BEGIN
 SET CONSTRAINTS ALL DEFERRED;
 IF p_source='snapshot' THEN
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
  old_id:=s.id;
  UPDATE private.financial_proposals SET status='superseded' WHERE movement_context_snapshot_id=s.id AND status='current';
  UPDATE private.movement_context_snapshots SET status='superseded' WHERE id=s.id;
  s.id:=gen_random_uuid();s.version:=s.version+1;s.created_at:=clock_timestamp();s.expires_at:=s.created_at+make_interval(secs=>p_seconds::double precision);
  INSERT INTO private.movement_context_snapshots SELECT s.*;
  INSERT INTO private.movement_context_snapshot_travellers
   SELECT s.id,t.member_id,t.movement_participant_id,t.role FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=old_id;
  UPDATE pg_temp.binding_fixture SET snapshot_id=s.id;
 ELSE
  SELECT x.* INTO STRICT q FROM private.pricing_quotes x JOIN pg_temp.binding_fixture f ON f.quote_id=x.id;
  UPDATE private.pricing_quotes SET status='superseded' WHERE id=q.id;
  q.id:=gen_random_uuid();q.version:=q.version+1;q.created_at:=clock_timestamp();q.expires_at:=q.created_at+make_interval(secs=>p_seconds::double precision);
  INSERT INTO private.pricing_quotes SELECT q.*;
  UPDATE pg_temp.binding_fixture SET quote_id=q.id;
 END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
END $$;

-- BINDING_0073_TESTS: concurrency runner uses only the fixture/helper prefix.
DO $tests$
DECLARE p uuid; s private.movement_context_snapshots%ROWTYPE; q private.pricing_quotes%ROWTYPE;
 bad jsonb; r text; fn text;
BEGIN
 SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
 SELECT x.* INTO STRICT q FROM private.pricing_quotes x JOIN pg_temp.binding_fixture f ON f.quote_id=x.id;
 p:=pg_temp.construct();
 PERFORM pg_temp.snapshot_check('exact valid construction with shorter source expiry',
  EXISTS(SELECT 1 FROM private.financial_proposals WHERE id=p AND expires_at=least(s.expires_at,q.expires_at)
   AND movement_offer_id IS NULL AND offering_accepted_at IS NULL AND requester_accepted_at IS NULL));
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('movement_context_snapshot_id',gen_random_uuid()),'{"movement_context_snapshot_id":null}'::jsonb,
  '{"movement_context_snapshot_version":2}'::jsonb,'{"movement_context_snapshot_version":0}'::jsonb,
  '{"movement_context_snapshot_version":null}'::jsonb,
  jsonb_build_object('movement_need_id',gen_random_uuid()),jsonb_build_object('member_needing_movement_id',s.offering_member_id),
  jsonb_build_object('offering_member_id',s.requesting_member_id),jsonb_build_object('vehicle_id',gen_random_uuid()),
  '{"people_count":1}'::jsonb,'{"seats_offered":2}'::jsonb,'{"vehicle_seat_capacity":5}'::jsonb,
  '{"origin_area":"different"}'::jsonb,'{"destination_area":"different"}'::jsonb,
  jsonb_build_object('earliest_departure_at',s.requester_earliest_departure_at+interval '1 second'),
  jsonb_build_object('latest_departure_at',NULL),'{"proposed_pickup_area":null}'::jsonb,
  '{"proposed_dropoff_area":"different"}'::jsonb,'{"estimated_arrival_minutes":null}'::jsonb,
  jsonb_build_object('created_at',s.created_at-interval '1 second'),
  jsonb_build_object('expires_at',s.expires_at+interval '1 second'),jsonb_build_object('expires_at',q.expires_at+interval '1 second'),
  '{"created_at":"-infinity"}'::jsonb,'{"expires_at":"infinity"}'::jsonb,'{"expires_at":null}'::jsonb,
  jsonb_build_object('movement_offer_id',s.movement_offer_id)
 )) LOOP
  PERFORM pg_temp.probe('reject movement/lifetime override '||bad::text,format('SELECT pg_temp.construct(%L::jsonb)',bad),'23514');
 END LOOP;
 FOREACH r IN ARRAY ARRAY['missing','extra','participant','role','member'] LOOP
  PERFORM pg_temp.probe('reject roster '||r,format('SELECT pg_temp.construct(''{}'',%L)',r),'23514');
 END LOOP;
 PERFORM pg_temp.probe('live roster changed since snapshot',format('UPDATE public.movement_participants SET status=''invited'' WHERE movement_need_id=%L AND role=''invited_participant''; SELECT pg_temp.construct()',s.movement_need_id),'23514');
 PERFORM pg_temp.probe('snapshot ID immutable',format('UPDATE private.financial_proposals SET movement_context_snapshot_id=gen_random_uuid() WHERE id=%L',p),'23514');
 PERFORM pg_temp.probe('snapshot version immutable',format('UPDATE private.financial_proposals SET movement_context_snapshot_version=2 WHERE id=%L',p),'23514');
 PERFORM pg_temp.probe('current proposal pins snapshot',format('UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=%L',s.id),'23514');
 PERFORM pg_temp.probe('superseded proposal releases snapshot with history preserved',format('UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=%L; SELECT pg_temp.assert_history(%L); SET CONSTRAINTS ALL IMMEDIATE',p,s.id,p));
 PERFORM pg_temp.probe('later exact offer link and valid offering consent',format('UPDATE private.financial_proposals SET movement_offer_id=%L,offering_accepted_at=clock_timestamp() WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE',s.movement_offer_id,p));
 PERFORM pg_temp.probe('offer link without consent remains forbidden',format('UPDATE private.financial_proposals SET movement_offer_id=%L WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE',s.movement_offer_id,p),'23514');
 PERFORM pg_temp.probe('different operational offer rejected',format('UPDATE private.financial_proposals SET movement_offer_id=gen_random_uuid(),offering_accepted_at=clock_timestamp() WHERE id=%L',p),'23514');
 PERFORM pg_temp.probe('different genuine offer with identical terms rejected',format('UPDATE private.financial_proposals SET movement_offer_id=pg_temp.new_offer(),offering_accepted_at=clock_timestamp() WHERE id=%L',p),'23514','Proposal operational offer must equal its historical snapshot source');
 PERFORM pg_temp.probe('NULL optional offer declarations match exactly',format('DO $x$ DECLARE o uuid; s uuid; g uuid; q uuid; BEGIN
  UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L;
  o:=pg_temp.new_offer(true);
  -- The baseline is IMMEDIATE; allow the normal producer to finish its parent
  -- and traveller inserts before completeness checks, then drain and restore.
  -- The exception subtransaction rolls back the mode change on producer failure.
  BEGIN
   SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete DEFERRED;
   SELECT snapshot_id INTO s FROM public.record_movement_context_snapshot_for_server(o);
   SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN
   RAISE;
  END;
  SELECT pg_temp.record_result(route_match_evidence_id) INTO g FROM private.movement_offer_route_match_bindings WHERE movement_offer_id=o;
  SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g,
   (SELECT version FROM private.pricing_geography_evidence WHERE id=g),''trusted_server_result_infrastructure_v1'',12345) x;
  UPDATE pg_temp.binding_fixture SET snapshot_id=s,quote_id=q; PERFORM pg_temp.construct(); END $x$',p));
 PERFORM pg_temp.probe('historical validation after quote and offer terminal transitions',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; UPDATE public.movement_offers SET status=''withdrawn'' WHERE id=%L; UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.assert_history(%L); UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE',q.id,s.movement_offer_id,s.movement_need_id,p,p));
 PERFORM pg_temp.probe('existing lifecycle materializes exact source',format('SELECT pg_temp.materialize(%L)',p));
 PERFORM pg_temp.probe('materialized current proposal permanently pins snapshot',format('SELECT pg_temp.materialize(%L); UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=%L',p,s.id),'23514');
 PERFORM pg_temp.probe('materialized proposal cannot release pin',format('SELECT pg_temp.materialize(%L); UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L',p,p),'23514');
 FOREACH fn IN ARRAY ARRAY[
  'private.assert_financial_proposal_movement_context_binding(private.financial_proposals)',
  'private.assert_financial_proposal_source_compatibility(private.financial_proposals)',
  'private.assert_financial_proposal_snapshot_roster(uuid)',
  'private.validate_financial_proposal_movement_context_binding()',
  'private.protect_proposal_bound_movement_context_snapshot()',
  'private.protect_financial_proposal()'] LOOP
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.snapshot_check(r||' cannot execute '||fn,NOT has_function_privilege(r,fn,'EXECUTE'));
  END LOOP;
  PERFORM pg_temp.snapshot_check('PUBLIC cannot execute '||fn,NOT EXISTS(
   SELECT 1 FROM pg_proc f,LATERAL aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) acl
   WHERE f.oid=fn::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'));
 END LOOP;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.probe(r||' direct proposal writes denied',format('SET LOCAL ROLE %I; INSERT INTO private.financial_proposals DEFAULT VALUES',r),'42501');
 END LOOP;
 PERFORM pg_temp.snapshot_check('live validation changes no source finance or operational rows',pg_temp.binding_sources()=(SELECT fingerprint FROM pg_temp.binding_before));
END $tests$;
SELECT pg_temp.probe('different intent for same need and members rejected', 'SELECT pg_temp.compatibility_probe(''intent'')','23514','movement identities differ');
SELECT pg_temp.probe('different exact route provenance rejected', 'SELECT pg_temp.compatibility_probe(''route'')','23514','route or endpoint provenance differs');
SELECT pg_temp.probe('independent pricing geography on same route accepted historically', 'SELECT pg_temp.compatibility_probe(''match'')');
SELECT pg_temp.probe('second independent match identity for same route is prevented upstream', 'DO $x$ DECLARE m private.trusted_route_match_evidence%ROWTYPE; BEGIN
 SELECT x.* INTO STRICT m FROM private.trusted_route_match_evidence x JOIN pg_temp.snapshot_fixture f ON f.match_evidence=x.id;
 UPDATE private.trusted_route_match_evidence SET status=''superseded'' WHERE id=m.id;
 m.id:=gen_random_uuid();m.version:=m.version+1; INSERT INTO private.trusted_route_match_evidence SELECT m.*; END $x$','23505');
SELECT pg_temp.probe('exact shorter snapshot expiry accepted', 'SELECT pg_temp.short_source(''snapshot'',2); SELECT pg_temp.construct()');
SELECT pg_temp.probe('exact shorter quote expiry accepted', 'SELECT pg_temp.short_source(''quote'',2); SELECT pg_temp.construct()');
SELECT pg_temp.probe('snapshot creation bound independently enforced', 'SELECT pg_temp.short_source(''snapshot'',2); SELECT pg_temp.construct(jsonb_build_object(''created_at'',(SELECT created_at-interval ''0.001 second'' FROM private.movement_context_snapshots WHERE id=(SELECT snapshot_id FROM pg_temp.binding_fixture))))','23514');
SELECT pg_temp.probe('expiry exceeds shorter snapshot only', 'SELECT pg_temp.short_source(''snapshot'',2); SELECT pg_temp.construct(jsonb_build_object(''expires_at'',(SELECT expires_at FROM private.pricing_quotes WHERE id=(SELECT quote_id FROM pg_temp.binding_fixture))))','23514');
SELECT pg_temp.probe('expiry exceeds shorter quote only', 'SELECT pg_temp.short_source(''quote'',2); SELECT pg_temp.construct(jsonb_build_object(''expires_at'',(SELECT expires_at FROM private.movement_context_snapshots WHERE id=(SELECT snapshot_id FROM pg_temp.binding_fixture))))','23514');
SELECT pg_temp.probe('expired current proposal still pins snapshot and historical checks survive expiry', 'DO $x$ DECLARE p uuid; BEGIN
 PERFORM pg_temp.short_source(''snapshot'',0.5); p:=pg_temp.construct(); PERFORM pg_sleep(0.6); PERFORM pg_temp.assert_history(p);
 UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=(SELECT snapshot_id FROM pg_temp.binding_fixture); END $x$','23514','Current financial proposal pins');
-- Upstream immutable endpoint/state contracts prevent these forged deeper bindings.
SELECT pg_temp.probe('forged state anchor rejected upstream', 'DO $x$ DECLARE q private.pricing_quotes%ROWTYPE; BEGIN
 SELECT x.* INTO STRICT q FROM private.pricing_quotes x JOIN pg_temp.binding_fixture f ON f.quote_id=x.id;
 q.id:=gen_random_uuid();q.version:=q.version+1;q.state_location_reference_id:=gen_random_uuid();
 INSERT INTO private.pricing_quotes SELECT q.*; END $x$','23514');
SELECT pg_temp.probe('forged requester origin endpoint rejected upstream', 'DO $x$ DECLARE s private.movement_context_snapshots%ROWTYPE; BEGIN
 SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
 s.id:=gen_random_uuid();s.version:=s.version+1;s.requester_origin_location_id:=gen_random_uuid();
 INSERT INTO private.movement_context_snapshots SELECT s.*; END $x$','23514');
SELECT pg_temp.probe('forged requester destination endpoint rejected upstream', 'DO $x$ DECLARE s private.movement_context_snapshots%ROWTYPE; BEGIN
 SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
 s.id:=gen_random_uuid();s.version:=s.version+1;s.requester_destination_location_id:=gen_random_uuid();
 INSERT INTO private.movement_context_snapshots SELECT s.*; END $x$','23514');
SELECT pg_temp.probe('forged version of same route identity rejected upstream', 'DO $x$ DECLARE g private.pricing_geography_evidence%ROWTYPE; BEGIN
 SELECT x.* INTO STRICT g FROM private.pricing_geography_evidence x JOIN private.pricing_quotes q ON q.pricing_geography_evidence_id=x.id JOIN pg_temp.binding_fixture f ON f.quote_id=q.id;
 g.id:=gen_random_uuid();g.version:=g.version+1;g.route_evidence_version:=g.route_evidence_version+1;
 INSERT INTO private.pricing_geography_evidence SELECT g.*; END $x$','23514');
-- MIGRATION_PRECONDITION_PROBE
SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN
 RAISE EXCEPTION '0073 behavioral checks failed'; END IF; END $$;
ROLLBACK;
