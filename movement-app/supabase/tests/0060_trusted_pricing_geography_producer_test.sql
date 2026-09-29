BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


CREATE TEMP TABLE pg_temp.pricing_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.pricing_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.pricing_results(
    test_name,
    passed,
    diagnostic
  )
  VALUES (
    p_name,
    coalesce(p_passed, false),
    p_diagnostic
  );
END;
$check$;


CREATE FUNCTION pg_temp.make_state_endpoint(
  p_owner_member_id uuid,
  p_label text,
  p_provider_place_reference text,
  p_latitude numeric,
  p_longitude numeric,
  p_state_provider_reference text,
  p_state_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $endpoint$
DECLARE
  v_source_id uuid;
  v_target_id uuid;
  v_evidence_id uuid;
  v_now timestamptz;
BEGIN
  v_now := clock_timestamp();

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    provider_namespace,
    provider_place_reference,
    created_at
  )
  VALUES (
    p_owner_member_id,
    p_label,
    'member_selected',
    'unresolved',
    'test-provider',
    p_provider_place_reference,
    v_now
  )
  RETURNING id
  INTO v_source_id;


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
    created_at
  )
  VALUES (
    p_owner_member_id,
    p_label,
    'provider_resolved',
    'resolved',
    p_latitude,
    p_longitude,
    'test-provider',
    p_provider_place_reference,
    'test-resolution-v1',
    v_now,
    v_now
  )
  RETURNING id
  INTO v_target_id;


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
  VALUES (
    v_source_id,
    v_target_id,
    1,
    gen_random_uuid(),
    'test-geocoder',
    'v1',
    'movement_location_resolution_v1',
    NULL,
    v_now
  )
  RETURNING id
  INTO v_evidence_id;


  INSERT INTO private.trusted_location_state_evidence(
    resolution_evidence_id,
    resolved_location_reference_id,
    provider_namespace,
    state_provider_reference,
    state_name,
    state_key,
    recorded_at
  )
  VALUES (
    v_evidence_id,
    v_target_id,
    'test-provider',
    p_state_provider_reference,
    p_state_name,
    private.canonical_nigerian_state_key(
      p_state_name
    ),
    clock_timestamp()
  );


  RETURN v_target_id;
END;
$endpoint$;


CREATE FUNCTION pg_temp.make_route(
  p_offering_member_id uuid,
  p_origin_id uuid,
  p_destination_id uuid,
  p_route_reference text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $route$
DECLARE
  v_intent_id uuid;
  v_route_id uuid;
  v_now timestamptz;
  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
BEGIN
  v_now := clock_timestamp();

  SELECT *
  INTO STRICT v_origin
  FROM private.movement_location_references
  WHERE id=p_origin_id;

  SELECT *
  INTO STRICT v_destination
  FROM private.movement_location_references
  WHERE id=p_destination_id;


  INSERT INTO private.offering_movement_intents(
    offering_member_id,
    intent_key,
    version,
    earliest_departure_at,
    latest_departure_at,
    created_at,
    expires_at,
    status
  )
  VALUES (
    p_offering_member_id,
    gen_random_uuid(),
    1,
    v_now + interval '1 hour',
    v_now + interval '2 hours',
    v_now,
    v_now + interval '3 hours',
    'current'
  )
  RETURNING id
  INTO v_intent_id;


  INSERT INTO private.offering_movement_intent_locations(
    intent_id,
    role,
    location_reference_id
  )
  VALUES
    (
      v_intent_id,
      'origin',
      p_origin_id
    ),
    (
      v_intent_id,
      'destination',
      p_destination_id
    );


  INSERT INTO private.offering_route_evidence(
    offering_movement_intent_id,
    offering_member_id,
    origin_location_reference_id,
    destination_location_reference_id,
    version,
    evidence_schema_version,
    provider_namespace,
    provider_product,
    provider_version,
    provider_route_reference,
    route_shape_format,
    route_shape,
    route_distance_meters,
    route_duration_seconds,
    generated_at,
    created_at,
    expires_at,
    status
  )
  VALUES (
    v_intent_id,
    p_offering_member_id,
    p_origin_id,
    p_destination_id,
    1,
    'offering_route_evidence_v1',
    'test-router',
    'directions',
    'v1',
    p_route_reference,
    'geojson_linestring_v1',
    jsonb_build_object(
      'type',
      'LineString',
      'coordinates',
      jsonb_build_array(
        jsonb_build_array(
          v_origin.longitude,
          v_origin.latitude
        ),
        jsonb_build_array(
          v_destination.longitude,
          v_destination.latitude
        )
      )
    ),
    15000,
    1200,
    v_now,
    v_now,
    v_now + interval '2 hours',
    'current'
  )
  RETURNING id
  INTO v_route_id;


  -- Validate this fixture explicitly without changing the
  -- transaction-wide mode of the existing deferred constraint
  -- triggers. Later make_route() calls must still be able to
  -- insert the intent before its two endpoint bindings.
  PERFORM private.assert_offering_movement_intent(
    v_intent_id
  );

  PERFORM private.assert_offering_route_evidence(
    v_route_id
  );


  RETURN v_route_id;
END;
$route$;



-- Each probe uses a subtransaction, including successful probes. Source lifecycle
-- changes and rejected attempts cannot contaminate later assertions.
CREATE FUNCTION pg_temp.probe(p_name text,p_sql text,p_state text DEFAULT '00000')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text := '00000'; detail text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION USING ERRCODE='ZT059',MESSAGE='successful probe rollback';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE,detail=MESSAGE_TEXT;
    IF actual='ZT059' THEN actual:='00000'; detail:=NULL; END IF;
  END;
  PERFORM pg_temp.pricing_check(p_name,actual=p_state,concat('expected ',p_state,', actual ',actual,' ',detail));
END;
$$;

CREATE TEMP TABLE fixture(label text PRIMARY KEY,match_id uuid) ON COMMIT DROP;
DO $fixtures$
DECLARE req uuid; off_id uuid; a uuid; b uuid; c uuid; d uuid; route_id uuid; intent_id uuid; need_id uuid; match_id uuid; i integer;
BEGIN
  FOR i IN 1..2 LOOP
    req:=gen_random_uuid(); off_id:=gen_random_uuid();
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@0060.invalid',clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
    FROM unnest(ARRAY[req,off_id]) id;
    a:=pg_temp.make_state_endpoint(req,'request origin','0060-ro-'||i,6.43,3.52,'region-lagos','Lagos');
    b:=pg_temp.make_state_endpoint(req,'request destination','0060-rd-'||i,6.60,3.35,'region-lagos','Lagos');
    c:=pg_temp.make_state_endpoint(off_id,'offer origin','0060-oo-'||i,6.42,3.42,'region-lagos','Lagos');
    d:=pg_temp.make_state_endpoint(off_id,'offer destination','0060-od-'||i,6.52,3.37,'region-lagos','Lagos');
    route_id:=pg_temp.make_route(off_id,c,d,'0060-route-'||i);
    SELECT offering_movement_intent_id INTO intent_id FROM private.offering_route_evidence WHERE id=route_id;
    PERFORM set_config('request.jwt.claim.sub',req::text,true);
    PERFORM set_config('request.jwt.claim.role','authenticated',true);
    SELECT x.movement_need_id INTO need_id FROM public.create_movement_need(gen_random_uuid(),a,b,
      clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours',1) x;
    SELECT x.route_match_evidence_id INTO match_id FROM public.record_trusted_route_match_evidence_for_server(
      need_id,intent_id,route_id,1,10,20,10000,100,9000,6.43,3.52,6.60,3.35,clock_timestamp(),NULL) x;
    INSERT INTO fixture VALUES(i::text,match_id);
  END LOOP;
END;
$fixtures$;
SET CONSTRAINTS ALL IMMEDIATE;

-- Fingerprint ALL existing application/auth rows after legitimate fixture setup.
-- Only the new evidence table may change during the tests below.
CREATE FUNCTION pg_temp.source_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_object_agg(n.nspname||'.'||c.relname,
 query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')
 AND c.oid<>'private.pricing_geography_evidence'::regclass
$$;
CREATE TEMP TABLE source_before AS SELECT pg_temp.source_state() AS state;


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
DO $tests$
DECLARE m private.trusted_route_match_evidence%ROWTYPE; other private.trusted_route_match_evidence%ROWTYPE;
 eid uuid; retry uuid; newer uuid; original jsonb; entry record; k text; role_name text; base text; d bigint;
BEGIN
 SELECT x.* INTO m FROM private.trusted_route_match_evidence x JOIN fixture f ON f.match_id=x.id WHERE f.label='1';
 SELECT x.* INTO other FROM private.trusted_route_match_evidence x JOIN fixture f ON f.match_id=x.id WHERE f.label='2';
 eid:=pg_temp.record_result(m.id);
 SELECT to_jsonb(x) INTO original FROM private.pricing_geography_evidence x WHERE id=eid;
 PERFORM private.assert_pricing_geography_evidence(eid);
 PERFORM pg_temp.pricing_check('valid live trusted recording',true);
 PERFORM pg_temp.pricing_check('corridor 12000 differs from provider route 15000',(original->>'pricing_corridor_distance_meters')::bigint=12000 AND (SELECT route_distance_meters=15000 FROM private.offering_route_evidence WHERE id=m.route_evidence_id));
 FOR entry IN SELECT * FROM jsonb_each(jsonb_build_object('route_match_evidence_id',m.id,'route_match_evidence_version',m.version,
 'movement_need_id',m.movement_need_id,'requesting_member_id',m.requesting_member_id,'offering_member_id',m.offering_member_id,
 'offering_movement_intent_id',m.offering_movement_intent_id,'offering_intent_version',m.offering_intent_version,
 'route_evidence_id',m.route_evidence_id,'route_evidence_version',m.route_evidence_version,'state_location_reference_id',m.requester_origin_location_reference_id)) LOOP
 PERFORM pg_temp.pricing_check('derived binding '||entry.key,original->entry.key=entry.value);
 END LOOP;
 PERFORM pg_temp.pricing_check('derived lifecycle schema version timestamps and expiry',original->>'status'='current' AND original->>'version'='1' AND original->>'evidence_schema_version'='pricing_geography_evidence_v1' AND (original->>'generated_at')::timestamptz>=m.calculated_at AND original->>'generated_at'=original->>'created_at' AND (original->>'expires_at')::timestamptz=least(m.expires_at,(SELECT coalesce(latest_departure_at,earliest_departure_at) FROM public.movement_needs WHERE id=m.movement_need_id)));
 retry:=pg_temp.record_result(m.id);
 PERFORM pg_temp.pricing_check('exact retry returns same id and unchanged full record',retry=eid AND original=(SELECT to_jsonb(x) FROM private.pricing_geography_evidence x WHERE id=eid));
 base:=format('SELECT pg_temp.record_result(%L,',other.id);
 FOREACH d IN ARRAY ARRAY[99999,100000,100001]::bigint[] LOOP
 PERFORM pg_temp.probe('distance boundary '||d,base||quote_literal(jsonb_build_object('distance',d))||'); DO $b$ BEGIN IF NOT EXISTS(SELECT 1 FROM private.pricing_geography_evidence WHERE pricing_corridor_distance_meters='||d||' AND pricing_range_supported='||(d<=100000)::text||') THEN RAISE EXCEPTION ''incorrect support''; END IF; END $b$;');
 END LOOP;
 FOR entry IN SELECT * FROM (VALUES
 ('empty','[]','00000'),('core','[{"event_type":"core_stage_entry","position_meters":0}]','00000'),
 ('transition','[{"event_type":"major_transport_transition","position_meters":12000}]','00000'),
 ('ordered multiple','[{"event_type":"core_stage_entry","position_meters":0},{"event_type":"major_transport_transition","position_meters":12000}]','00000'),
 ('unknown','[{"event_type":"continuous_corridor","position_meters":0}]','23514'),('JSON null','null','23514'),('scalar','2','23514'),
 ('extra keys','[{"event_type":"core_stage_entry","position_meters":0,"amount":10}]','23514'),
 ('missing position','[{"event_type":"core_stage_entry"}]','23514'),
 ('fraction','[{"event_type":"core_stage_entry","position_meters":0.5}]','23514'),
 ('reversed','[{"event_type":"core_stage_entry","position_meters":2},{"event_type":"major_transport_transition","position_meters":1}]','23514'),
 ('duplicate','[{"event_type":"core_stage_entry","position_meters":1},{"event_type":"core_stage_entry","position_meters":1}]','23514')) x(label,events,code) LOOP
 PERFORM pg_temp.probe('events '||entry.label,base||quote_literal(jsonb_build_object('events',entry.events::jsonb))||')',entry.code);
 END LOOP;
 FOR entry IN SELECT * FROM (VALUES
 ('zero distance','{"distance":0}','23514'),('negative distance','{"distance":-1}','23514'),('null distance','{"distance":null}','22004'),
 ('fraction distance','{"distance":1.5}','22P02'),('stale match version','{"match_version":2}','23514'),('stale route version','{"route_version":2}','23514'),
 ('missing match','{"match_id":"00000000-0000-0000-0000-000000000000"}','23514'),('wrong route','{"route_id":"00000000-0000-0000-0000-000000000000"}','23514'),
 ('invalid classifier','{"classifier":" invalid"}','23514'),('invalid dataset','{"dataset":""}','23514'),('missing provenance','{"classifier_version":null}','22004')) x(label,payload,code) LOOP
 PERFORM pg_temp.probe(entry.label,base||quote_literal(entry.payload::jsonb)||')',entry.code);
 END LOOP;
 PERFORM pg_temp.probe('mismatched retry distance',format('SELECT pg_temp.record_result(%L,''{"distance":12001}'')',m.id),'23514');
 PERFORM pg_temp.probe('mismatched retry events',format('SELECT pg_temp.record_result(%L,''{"events":[{"event_type":"core_stage_entry","position_meters":0}]}'')',m.id),'23514');
 PERFORM pg_temp.probe('retry does not duplicate current',format('SELECT pg_temp.record_result(%L); SELECT pg_temp.record_result(%L); DO $c$ BEGIN IF (SELECT count(*) FROM private.pricing_geography_evidence WHERE movement_need_id=%L)<>1 THEN RAISE EXCEPTION ''duplicate''; END IF; END $c$;',m.id,m.id,m.movement_need_id));
 PERFORM pg_temp.probe('new classifier version yields one current and preserves history',format('SELECT pg_temp.record_result(%L,''{"classifier_version":"v2"}''); DO $c$ BEGIN IF (SELECT count(*) FROM private.pricing_geography_evidence WHERE movement_need_id=%L AND status=''current'' AND version=2)<>1 OR NOT EXISTS(SELECT 1 FROM private.pricing_geography_evidence WHERE id=%L AND status=''superseded'') THEN RAISE EXCEPTION ''version history invalid''; END IF; END $c$;',m.id,m.movement_need_id,eid));
 PERFORM pg_temp.probe('terminal retry cannot reopen',format('SELECT pg_temp.record_result(%L,''{"dataset":"test-v2"}''); SELECT pg_temp.record_result(%L)',m.id,m.id),'23514');
 PERFORM pg_temp.probe('history immutable',format('UPDATE private.pricing_geography_evidence SET pricing_corridor_distance_meters=1 WHERE id=%L',eid),'23514');
 PERFORM pg_temp.probe('history cannot delete',format('DELETE FROM private.pricing_geography_evidence WHERE id=%L',eid),'23514');
 -- Actual route writer changes only lifecycle/history through supported boundary.
 base:=format('DO $r$ DECLARE r private.offering_route_evidence%%ROWTYPE; BEGIN SELECT * INTO r FROM private.offering_route_evidence WHERE id=%L; PERFORM public.record_offering_route_evidence_for_server(r.offering_movement_intent_id,r.provider_namespace,r.provider_product,r.provider_version,''0060-replacement'',r.route_shape,r.route_distance_meters,r.route_duration_seconds,clock_timestamp(),r.expires_at); END $r$;',m.route_evidence_id);
 PERFORM pg_temp.probe('legitimate route replacement fixture',base);
 PERFORM pg_temp.probe('replaced source rejects exact retry',base||format('SELECT pg_temp.record_result(%L)',m.id),'23514');
 PERFORM pg_temp.probe('replaced source rejects new classifier',base||format('SELECT pg_temp.record_result(%L,''{"classifier_version":"v2"}'')',m.id),'23514');

 PERFORM pg_temp.probe('SQL null events rejected',format('SELECT * FROM public.record_pricing_geography_evidence_for_server(%L,1,%L,1,12000,NULL,''test-classifier'',''v1'',''test-v1'')',m.id,m.route_evidence_id),'22004');
 PERFORM pg_temp.probe('existing wrong match identity cannot substitute context',format('SELECT pg_temp.record_result(%L,%L)',m.id,jsonb_build_object('match_id',other.id)),'23514');
 base:=base||format('DO $m$ DECLARE r private.offering_route_evidence%%ROWTYPE; BEGIN SELECT * INTO STRICT r FROM private.offering_route_evidence WHERE offering_movement_intent_id=%L AND status=''current''; PERFORM public.record_trusted_route_match_evidence_for_server(%L,%L,r.id,r.version,10,20,10000,100,9000,6.43,3.52,6.60,3.35,clock_timestamp(),NULL); END $m$;',m.offering_movement_intent_id,m.movement_need_id,m.offering_movement_intent_id);
 PERFORM pg_temp.probe('legitimate route and match replacement fixture',base);
 PERFORM pg_temp.probe('superseded exact match rejected',base||format('SELECT pg_temp.record_result(%L)',m.id),'23514');
 PERFORM pg_temp.probe('new exact match allocates version two without rebinding history',base||format('SELECT pg_temp.record_result((SELECT id FROM private.trusted_route_match_evidence WHERE movement_need_id=%L AND status=''current'')); DO $n$ BEGIN IF NOT EXISTS(SELECT 1 FROM private.pricing_geography_evidence WHERE movement_need_id=%L AND status=''current'' AND version=2 AND route_match_evidence_id<>%L AND route_evidence_id<>%L) OR NOT EXISTS(SELECT 1 FROM private.pricing_geography_evidence WHERE id=%L AND status=''superseded'' AND route_match_evidence_id=%L AND route_evidence_id=%L) THEN RAISE EXCEPTION ''incorrect new source history''; END IF; END $n$;',m.movement_need_id,m.movement_need_id,m.id,m.route_evidence_id,eid,m.id,m.route_evidence_id));
 PERFORM pg_temp.probe('closed need rejects retry',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.record_result(%L)',m.movement_need_id,m.id),'23514');
 PERFORM pg_temp.probe('terminal own evidence rejects retry',format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L; SELECT pg_temp.record_result(%L)',eid,m.id),'23514');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 base:=format('SET LOCAL ROLE %I; SELECT * FROM public.record_pricing_geography_evidence_for_server(%L,1,%L,1,12000,''[]'',''test-classifier'',''v1'',''test-v1'');',role_name,other.id,other.route_evidence_id);
 PERFORM pg_temp.probe(role_name||' RPC access',base,CASE WHEN role_name='service_role' THEN '00000' ELSE '42501' END);
 FOREACH k IN ARRAY ARRAY['INSERT INTO private.pricing_geography_evidence DEFAULT VALUES','UPDATE private.pricing_geography_evidence SET status=''superseded''','DELETE FROM private.pricing_geography_evidence'] LOOP
 PERFORM pg_temp.probe(role_name||' direct '||split_part(k,' ',1)||' denied',format('SET LOCAL ROLE %I; ',role_name)||k,'42501');
 END LOOP;
 END LOOP;
 PERFORM pg_temp.pricing_check('RLS preserved and no client policies',(SELECT relrowsecurity FROM pg_class WHERE oid='private.pricing_geography_evidence'::regclass) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.pricing_geography_evidence'::regclass));
 PERFORM pg_temp.pricing_check('all source financial alignment payment settlement auth rows unchanged',(SELECT state=pg_temp.source_state() FROM source_before));
END;
$tests$;
SELECT test_number,test_name,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,diagnostic FROM pg_temp.pricing_results ORDER BY test_number;
SELECT count(*) AS total,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.pricing_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.pricing_results WHERE NOT passed) THEN RAISE EXCEPTION '0060 behavioral assertions failed'; END IF; END $$;
ROLLBACK;
