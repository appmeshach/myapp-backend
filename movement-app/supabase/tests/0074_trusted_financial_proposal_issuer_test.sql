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

CREATE FUNCTION pg_temp.expiring_route(
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
      t + interval '8 seconds'
    )
  );
END;
$$;

CREATE FUNCTION pg_temp.expiring_offer(p_nullable boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql AS $$
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
 r:=pg_temp.expiring_route(fresh_intent,'0073-new-offer-'||gen_random_uuid()::text);
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

CREATE FUNCTION pg_temp.issue(p_overrides jsonb DEFAULT '{}',p_role text DEFAULT 'service_role') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE q private.pricing_quotes%ROWTYPE; s private.movement_context_snapshots%ROWTYPE; a jsonb;
BEGIN
 SELECT x.* INTO STRICT q FROM private.pricing_quotes x JOIN pg_temp.binding_fixture f ON f.quote_id=x.id;
 SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
 a:=jsonb_build_object('quote',q.id,'quote_version',q.version,'snapshot',s.id,'snapshot_version',s.version)||p_overrides;
 RETURN pg_temp.snapshot_select_as(p_role,NULL,format(
  'SELECT * FROM public.issue_financial_proposal_for_server(%L,%L,%L,%L)',
  a->>'quote',a->>'quote_version',a->>'snapshot',a->>'snapshot_version'));
END $$;

CREATE FUNCTION pg_temp.issue_id() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 r:=pg_temp.issue();
 IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Issuer failed: %',r; END IF;
 RETURN (r#>>'{rows,0,proposal_id}')::uuid;
END $$;

CREATE FUNCTION pg_temp.reject_issue(p_name text,p_overrides jsonb,p_state text DEFAULT '23514',p_role text DEFAULT 'service_role')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
 r:=pg_temp.issue(p_overrides,p_role);
 PERFORM pg_temp.snapshot_check(p_name,r->>'ok'='false' AND r->>'state'=p_state,r::text);
 IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'state' IS DISTINCT FROM p_state THEN
  RAISE EXCEPTION 'Expected issuer rejection %, got %',p_state,r;
 END IF;
END $$;

CREATE FUNCTION pg_temp.bind_offer(p_offer uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s uuid; g uuid; q uuid;
BEGIN
 -- Drain earlier construction events while their snapshots are still current.
 -- Otherwise the producer supersedes the old snapshot before our later IMMEDIATE
 -- drain, and 0022 correctly rejects that old INSERT event's terminal row.
 -- Callers must separately release any current proposal pin before replacement.
 SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE;
 -- Snapshot production is a parent/roster transaction, not an immediate check.
 BEGIN
  SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete DEFERRED;
  SELECT snapshot_id INTO s FROM public.record_movement_context_snapshot_for_server(p_offer);
  SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE;
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 SELECT pg_temp.record_result(route_match_evidence_id) INTO STRICT g
  FROM private.movement_offer_route_match_bindings WHERE movement_offer_id=p_offer;
 SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g,
  (SELECT version FROM private.pricing_geography_evidence WHERE id=g),'trusted_server_result_infrastructure_v1',12345) x;
 UPDATE pg_temp.binding_fixture SET snapshot_id=s,quote_id=q;
END $$;

CREATE FUNCTION pg_temp.next_quote() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE g uuid; q uuid;
BEGIN
 g:=pg_temp.record_result((SELECT match_evidence FROM pg_temp.snapshot_fixture),
  jsonb_build_object('classifier_version','issuer-'||gen_random_uuid()::text));
 SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g,
  (SELECT version FROM private.pricing_geography_evidence WHERE id=g),'trusted_server_result_infrastructure_v1',23456) x;
 UPDATE pg_temp.binding_fixture SET quote_id=q;
 RETURN q;
END $$;

-- ISSUER_0074_TESTS:
DO $tests$
DECLARE p private.financial_proposals%ROWTYPE; q private.pricing_quotes%ROWTYPE;
 s private.movement_context_snapshots%ROWTYPE; r jsonb; prior jsonb; b jsonb;
BEGIN
 SELECT x.* INTO STRICT q FROM private.pricing_quotes x JOIN pg_temp.binding_fixture f ON f.quote_id=x.id;
 SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x JOIN pg_temp.binding_fixture f ON f.snapshot_id=x.id;
 r:=pg_temp.issue();
 IF r->>'ok'<>'true' THEN
   RAISE EXCEPTION 'Issuer failed: %',r;
 END IF;
 SELECT * INTO STRICT p
 FROM private.financial_proposals
 WHERE id=(r#>>'{rows,0,proposal_id}')::uuid;
 PERFORM pg_temp.snapshot_check('successful trusted issuance',p.status='current' AND p.version=1,p.id::text);
 PERFORM pg_temp.snapshot_check('exact source field mapping',
  ROW(p.movement_need_id,p.offering_member_id,p.member_needing_movement_id,p.vehicle_id,p.currency,p.pricing_policy_version,
   p.origin_area,p.destination_area,p.earliest_departure_at,p.latest_departure_at,p.people_count,p.seats_offered,p.vehicle_seat_capacity,
   p.proposed_pickup_area,p.proposed_dropoff_area,p.estimated_arrival_minutes,p.pricing_quote_id,p.pricing_quote_version,p.movement_context_snapshot_id,p.movement_context_snapshot_version)
  IS NOT DISTINCT FROM ROW(s.movement_need_id,s.offering_member_id,s.requesting_member_id,s.vehicle_id,q.currency,q.pricing_policy_version,
   s.requester_origin_area,s.requester_destination_area,s.requester_earliest_departure_at,s.requester_latest_departure_at,s.people_count,s.seats_offered,s.vehicle_seat_capacity,
   s.proposed_pickup_area,s.proposed_dropoff_area,s.declared_arrival_minutes,q.id,q.version,s.id,s.version),p.id::text);
 PERFORM pg_temp.snapshot_check('exact 0071 totals',p.quoted_platform_fee_total_minor=7407 AND p.quoted_movement_contribution_minor=20986,p.id::text);
 PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
 PERFORM pg_temp.snapshot_check('exact historical roster copy',
  (SELECT count(*) FROM private.financial_proposal_travellers WHERE proposal_id=p.id)=2,p.id::text);
 PERFORM pg_temp.snapshot_check('no consent or operational links',p.offering_accepted_at IS NULL AND p.requester_accepted_at IS NULL
  AND p.movement_offer_id IS NULL AND p.alignment_id IS NULL AND p.financial_agreement_id IS NULL AND p.materialized_at IS NULL AND p.route_evidence_id IS NULL,p.id::text);
 PERFORM pg_temp.snapshot_check('bounded finite lifetime',isfinite(p.expires_at) AND p.expires_at=least(q.expires_at,s.expires_at),p.id::text);
 prior:=to_jsonb(p);
 PERFORM pg_temp.snapshot_check('exact replay same identity',pg_temp.issue_id()=p.id,p.id::text);
 PERFORM pg_temp.snapshot_check('replay immutable payload and no duplicate',
  (SELECT to_jsonb(x) FROM private.financial_proposals x WHERE id=p.id)=prior AND
  (SELECT count(*) FROM private.financial_proposals WHERE movement_need_id=p.movement_need_id)=1,p.id::text);
 PERFORM pg_temp.snapshot_check('no offer acceptance capacity alignment agreement wallet ledger payment journey writes',
  pg_temp.binding_sources()=(SELECT fingerprint FROM pg_temp.binding_before),'all non-proposal public/private/auth tables unchanged');
 FOREACH b IN ARRAY ARRAY['{"quote":null}'::jsonb,'{"snapshot":null}'::jsonb,'{"quote_version":null}'::jsonb,'{"snapshot_version":null}'::jsonb] LOOP
   PERFORM pg_temp.reject_issue('NULL identity rejected '||b::text,b,'22004');
 END LOOP;
 FOREACH b IN ARRAY ARRAY['{"quote_version":0}'::jsonb,'{"snapshot_version":0}'::jsonb,'{"quote_version":99}'::jsonb,'{"snapshot_version":99}'::jsonb] LOOP
  PERFORM pg_temp.reject_issue('wrong version rejected '||b::text,b);
 END LOOP;
 PERFORM pg_temp.reject_issue('nonexistent quote rejected',jsonb_build_object('quote',gen_random_uuid()));
 PERFORM pg_temp.reject_issue('nonexistent snapshot rejected',jsonb_build_object('snapshot',gen_random_uuid()));
 PERFORM pg_temp.reject_issue('anon cannot issue','{}','42501','anon');
 PERFORM pg_temp.reject_issue('authenticated cannot issue','{}','42501','authenticated');
 PERFORM pg_temp.probe('terminal quote fails live eligibility',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.reject_issue(''terminal quote rejected'',''{}'')',q.id));
 PERFORM pg_temp.probe('terminal snapshot fails live eligibility',format('UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=%L; SELECT pg_temp.reject_issue(''terminal snapshot rejected'',''{}'')',p.id,s.id));
 PERFORM pg_temp.probe('closed need rejected',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.reject_issue(''closed need fails'',''{}'')',s.movement_need_id));
 PERFORM pg_temp.probe('withdrawn offer rejected',format('UPDATE public.movement_offers SET status=''withdrawn'' WHERE id=%L; SELECT pg_temp.reject_issue(''withdrawn offer fails'',''{}'')',s.movement_offer_id));
 PERFORM pg_temp.probe('superseded proposal replay stays historical',format('DO $x$ DECLARE v_id uuid; BEGIN
  UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; v_id:=pg_temp.issue_id();
  IF v_id<>%L OR (SELECT status FROM private.financial_proposals WHERE id=v_id)<>''superseded'' THEN RAISE EXCEPTION ''historical replay changed''; END IF;
 END $x$',p.id,p.id));
 PERFORM pg_temp.probe('new legitimate quote serializes next version and supersedes safe current',format('DO $x$ DECLARE g uuid; q uuid; n uuid; BEGIN
  g:=pg_temp.record_result((SELECT match_evidence FROM pg_temp.snapshot_fixture),''{"classifier_version":"issuer-v2"}'');
  SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g,(SELECT version FROM private.pricing_geography_evidence WHERE id=g),''trusted_server_result_infrastructure_v1'',23456) x;
  UPDATE pg_temp.binding_fixture SET quote_id=q; n:=pg_temp.issue_id();
  IF (SELECT version FROM private.financial_proposals WHERE id=n)<>2 OR (SELECT status FROM private.financial_proposals WHERE id=%L)<>''superseded'' THEN RAISE EXCEPTION ''bad supersession''; END IF;
 END $x$',p.id));
 PERFORM pg_temp.probe('new snapshot NULL optional terms uses genuine producers',format('DO $x$ DECLARE o uuid; n uuid; BEGIN
  UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L;
  o:=pg_temp.new_offer(true); PERFORM pg_temp.bind_offer(o); n:=pg_temp.issue_id();
  IF NOT EXISTS(SELECT 1 FROM private.financial_proposals WHERE id=n AND version=2 AND proposed_pickup_area IS NULL AND proposed_dropoff_area IS NULL AND estimated_arrival_minutes IS NULL) THEN RAISE EXCEPTION ''NULL mapping failed''; END IF;
 END $x$',p.id));
 PERFORM pg_temp.probe('mismatched quote snapshot movement identities fail before locking',format('DO $x$ DECLARE old_quote uuid; o uuid; BEGIN
  old_quote:=(SELECT quote_id FROM pg_temp.binding_fixture); UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L;
  o:=pg_temp.new_offer(); PERFORM pg_temp.bind_offer(o);
  PERFORM private.assert_pricing_quote(old_quote);
  PERFORM private.assert_movement_context_snapshot((SELECT snapshot_id FROM pg_temp.binding_fixture));
  PERFORM pg_temp.reject_issue(''incompatible sources rejected'',jsonb_build_object(''quote'',old_quote,''quote_version'',1));
 END $x$',p.id));
 PERFORM pg_temp.probe('progressed proposal blocks new issuance',format('DO $x$ DECLARE g uuid; q uuid; BEGIN
  UPDATE private.financial_proposals SET movement_offer_id=%L,offering_accepted_at=clock_timestamp() WHERE id=%L;
  g:=pg_temp.record_result((SELECT match_evidence FROM pg_temp.snapshot_fixture),''{"classifier_version":"consented-v2"}'');
  SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g,(SELECT version FROM private.pricing_geography_evidence WHERE id=g),''trusted_server_result_infrastructure_v1'',23456) x;
  UPDATE pg_temp.binding_fixture SET quote_id=q; PERFORM pg_temp.reject_issue(''consent prevents supersession'',''{}'');
 END $x$',s.movement_offer_id,p.id));
 PERFORM pg_temp.probe('failed transaction rolls back proposal roster and supersession',format('DO $x$ DECLARE prior text; prior_roster text; BEGIN
  prior:=(SELECT md5(string_agg(to_jsonb(x)::text,'''' ORDER BY id)) FROM private.financial_proposals x);
  prior_roster:=(SELECT md5(string_agg(to_jsonb(x)::text,'''' ORDER BY proposal_id,member_id)) FROM private.financial_proposal_travellers x);
  -- Keep the valid current snapshot; let the issuer itself supersede the old
  -- proposal using a genuinely new quote, then fail after construction succeeds.
  BEGIN PERFORM pg_temp.next_quote(); PERFORM pg_temp.issue_id();
   IF (SELECT status FROM private.financial_proposals WHERE id=%L)<>''superseded'' THEN RAISE EXCEPTION ''supersession did not occur''; END IF;
   RAISE EXCEPTION USING ERRCODE=''Z7400'';
  EXCEPTION WHEN SQLSTATE ''Z7400'' THEN NULL; END;
  IF prior IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(x)::text,'''' ORDER BY id)) FROM private.financial_proposals x) THEN RAISE EXCEPTION ''rollback failed''; END IF;
  IF prior_roster IS DISTINCT FROM (SELECT md5(string_agg(to_jsonb(x)::text,'''' ORDER BY proposal_id,member_id)) FROM private.financial_proposal_travellers x) THEN RAISE EXCEPTION ''roster rollback failed''; END IF;
  PERFORM private.assert_financial_proposal_snapshot_roster(%L);
 END $x$',p.id,p.id));
 -- Expiration is reached using real bounded producer lifetimes, never rewritten.
 PERFORM pg_temp.probe('expired quote and snapshot rejected',format('DO $x$ DECLARE o uuid; BEGIN
  UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L;
  o:=pg_temp.expiring_offer(); PERFORM pg_temp.bind_offer(o);
  PERFORM private.assert_pricing_quote((SELECT quote_id FROM pg_temp.binding_fixture));
  PERFORM private.assert_movement_context_snapshot((SELECT snapshot_id FROM pg_temp.binding_fixture));
  PERFORM pg_sleep(greatest(0,extract(epoch FROM (SELECT expires_at FROM private.pricing_quotes WHERE id=(SELECT quote_id FROM pg_temp.binding_fixture))-clock_timestamp()))+0.05);
  BEGIN
   PERFORM private.assert_pricing_quote((SELECT quote_id FROM pg_temp.binding_fixture));
   RAISE EXCEPTION ''expired quote accepted'';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
   PERFORM private.assert_movement_context_snapshot((SELECT snapshot_id FROM pg_temp.binding_fixture));
   RAISE EXCEPTION ''expired snapshot accepted'';
  EXCEPTION WHEN check_violation THEN NULL; END;
  PERFORM pg_temp.reject_issue(''expired quote and snapshot fail'',''{}'');
 END $x$',p.id));
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN
 RAISE EXCEPTION '0074 behavioral checks failed'; END IF; END $$;
ROLLBACK;
