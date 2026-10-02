BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';


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
  FOR i IN 1..8 LOOP
    req:=gen_random_uuid(); off_id:=gen_random_uuid();
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@0069.invalid',clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
    FROM unnest(ARRAY[req,off_id]) id;
    a:=pg_temp.make_state_endpoint(req,'request origin','0069-ro-'||i,6.43,3.52,'region-lagos','Lagos');
    b:=pg_temp.make_state_endpoint(req,'request destination','0069-rd-'||i,6.60,3.35,'region-lagos','Lagos');
    c:=pg_temp.make_state_endpoint(off_id,'offer origin','0069-oo-'||i,6.42,3.42,'region-lagos','Lagos');
    d:=pg_temp.make_state_endpoint(off_id,'offer destination','0069-od-'||i,6.52,3.37,'region-lagos','Lagos');
    route_id:=pg_temp.make_route(off_id,c,d,'0069-route-'||i);
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
 AND c.oid<>'private.pricing_quotes'::regclass
$$;



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

CREATE TEMP TABLE geography(label text PRIMARY KEY,id uuid) ON COMMIT DROP;
INSERT INTO geography SELECT label,pg_temp.record_result(match_id,jsonb_build_object('distance',CASE label WHEN '2' THEN 100000 WHEN '3' THEN 100001 ELSE 12000 END)) FROM fixture ORDER BY label;
CREATE TEMP TABLE source_before AS SELECT pg_temp.source_state() AS state;

-- Owner-only test fixture constructor derives copied fields from exact evidence.
-- Production 0069 exposes no operational writer. Normal triggers stay enabled.
CREATE FUNCTION pg_temp.add_quote(p_evidence uuid,p_overrides jsonb DEFAULT '{}') RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE e private.pricing_geography_evidence%ROWTYPE; q private.pricing_quotes%ROWTYPE;
BEGIN
 SELECT * INTO STRICT e FROM private.pricing_geography_evidence WHERE id=p_evidence;
 q:=jsonb_populate_record(NULL::private.pricing_quotes,jsonb_build_object(
 'id',gen_random_uuid(),'version',1,'pricing_geography_evidence_id',e.id,'pricing_geography_evidence_version',e.version,
 'movement_need_id',e.movement_need_id,'requesting_member_id',e.requesting_member_id,'offering_member_id',e.offering_member_id,
 'offering_movement_intent_id',e.offering_movement_intent_id,'offering_intent_version',e.offering_intent_version,
 'state_location_reference_id',e.state_location_reference_id,'pricing_policy_version','opaque-test-policy:v1',
 'currency','NGN','seat_price_minor',155037,'status','current','created_at',clock_timestamp(),'expires_at',e.expires_at)||p_overrides);
 INSERT INTO private.pricing_quotes SELECT q.*;
 RETURN q.id;
END;
$$;
-- Short-lived evidence uses the owner/private foundation boundary, still subject
-- to every 0059 trigger/check. It is used only in rolled-back expiry probes.
CREATE FUNCTION pg_temp.short_evidence(p_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE e private.pricing_geography_evidence%ROWTYPE;
BEGIN
 SELECT * INTO STRICT e FROM private.pricing_geography_evidence WHERE id=p_id;
 UPDATE private.pricing_geography_evidence SET status='superseded' WHERE id=e.id;
 e.id:=gen_random_uuid();e.version:=e.version+1;e.generated_at:=clock_timestamp();e.created_at:=e.generated_at;
 e.expires_at:=e.created_at+interval '0.3 seconds';
 INSERT INTO private.pricing_geography_evidence SELECT e.*;
 RETURN e.id;
END;
$$;

-- 0069 tests follow; preceding fixture builders preserve normal source triggers.
CREATE FUNCTION pg_temp.publish(p_id uuid,p_amount numeric DEFAULT 12345,
  p_policy text DEFAULT 'trusted_server_result_infrastructure_v1') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb; v integer;
BEGIN
  SELECT version INTO STRICT v FROM private.pricing_geography_evidence WHERE id=p_id;
  SET LOCAL ROLE service_role;
  SELECT to_jsonb(r) INTO result FROM public.record_pricing_quote_for_server(p_id,v,p_policy,p_amount) r;
  RESET ROLE;
  RETURN result;
END $$;
DO $tests$
DECLARE e private.pricing_geography_evidence%ROWTYPE; other private.pricing_geography_evidence%ROWTYPE;
  q private.pricing_quotes%ROWTYPE; original jsonb; replay jsonb; cmd text; bad text; role_name text;
  fn oid := 'public.record_pricing_quote_for_server(uuid,integer,text,numeric)'::regprocedure;
BEGIN
  SELECT x.* INTO STRICT e FROM private.pricing_geography_evidence x JOIN geography g ON g.id=x.id WHERE g.label='1';
  SELECT x.* INTO STRICT other FROM private.pricing_geography_evidence x JOIN geography g ON g.id=x.id WHERE g.label='2';
  original:=pg_temp.publish(e.id);
  SELECT * INTO STRICT q FROM private.pricing_quotes WHERE id=(original->>'quote_id')::uuid;
  PERFORM pg_temp.pricing_check('service-role valid creation',q.id IS NOT NULL);
  PERFORM pg_temp.pricing_check('all canonical bindings derived',
    ROW(q.pricing_geography_evidence_id,q.pricing_geography_evidence_version,q.movement_need_id,q.requesting_member_id,q.offering_member_id,q.offering_movement_intent_id,q.offering_intent_version,q.state_location_reference_id)
    IS NOT DISTINCT FROM ROW(e.id,e.version,e.movement_need_id,e.requesting_member_id,e.offering_member_id,e.offering_movement_intent_id,e.offering_intent_version,e.state_location_reference_id));
  PERFORM pg_temp.pricing_check('fixed NGN and exact positive amount',q.currency='NGN' AND q.seat_price_minor=12345);
  PERFORM pg_temp.pricing_check('first canonical version',q.version=1);
  PERFORM pg_temp.pricing_check('finite authoritative expiry',isfinite(q.expires_at) AND q.expires_at=e.expires_at AND q.expires_at>q.created_at);
  PERFORM pg_sleep(0.01);
  replay:=pg_temp.publish(e.id);
  PERFORM pg_temp.pricing_check('exact replay returns identical ID version and timestamps',replay=original);
  PERFORM pg_temp.pricing_check('replay creates no row and refreshes nothing',
    (SELECT count(*)=1 FROM private.pricing_quotes WHERE movement_need_id=e.movement_need_id)
    AND (SELECT to_jsonb(x)=to_jsonb(q) FROM private.pricing_quotes x WHERE x.id=q.id));
  PERFORM pg_temp.probe('conflicting replay amount',format('SELECT pg_temp.publish(%L,12346)',e.id),'23514');
  PERFORM pg_temp.pricing_check('PUBLIC has no EXECUTE',NOT EXISTS(
    SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=fn AND a.grantee=0 AND a.privilege_type='EXECUTE'));
  PERFORM pg_temp.pricing_check('service_role EXECUTE',has_function_privilege('service_role',fn,'EXECUTE'));
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.pricing_check(role_name||' no execute grant',NOT has_function_privilege(role_name,fn,'EXECUTE'));
    PERFORM pg_temp.probe(role_name||' execution denied',format('SET LOCAL ROLE %I; SELECT * FROM public.record_pricing_quote_for_server(%L,1,''trusted_server_result_infrastructure_v1'',12345)',role_name,e.id),'42501');
  END LOOP;
  PERFORM pg_temp.pricing_check('service role has no direct table write privileges',NOT has_table_privilege('service_role','private.pricing_quotes','INSERT,UPDATE,DELETE,TRUNCATE'));
  PERFORM pg_temp.probe('service direct INSERT denied','SET LOCAL ROLE service_role; INSERT INTO private.pricing_quotes DEFAULT VALUES','42501');
  PERFORM pg_temp.probe('service direct UPDATE denied','SET LOCAL ROLE service_role; UPDATE private.pricing_quotes SET status=''superseded''','42501');
  PERFORM pg_temp.probe('service direct DELETE denied','SET LOCAL ROLE service_role; DELETE FROM private.pricing_quotes','42501');
  FOREACH bad IN ARRAY ARRAY['0','-1','0.5','1.5','9223372036854775808','NaN','Infinity','-Infinity'] LOOP
    PERFORM pg_temp.probe('invalid exact numeric '||bad,format('SELECT pg_temp.publish(%L,%L::numeric)',other.id,bad),'23514');
  END LOOP;
  FOREACH bad IN ARRAY ARRAY['','production_v1','trusted_server_result_infrastructure_v1 '] LOOP
    PERFORM pg_temp.probe('unapproved policy '||quote_literal(bad),format('SELECT pg_temp.publish(%L,12345,%L)',other.id,bad),'23514');
  END LOOP;
  PERFORM pg_temp.probe('null amount',format('SELECT pg_temp.publish(%L,NULL)',other.id),'22004');
  PERFORM pg_temp.probe('null policy',format('SELECT pg_temp.publish(%L,12345,NULL)',other.id),'22004');
  PERFORM pg_temp.probe('null source','SELECT * FROM public.record_pricing_quote_for_server(NULL,1,''trusted_server_result_infrastructure_v1'',12345)','22004');
  PERFORM pg_temp.probe('null source version',format('SELECT * FROM public.record_pricing_quote_for_server(%L,NULL,''trusted_server_result_infrastructure_v1'',12345)',e.id),'22004');
  PERFORM pg_temp.probe('wrong source version',format('SELECT * FROM public.record_pricing_quote_for_server(%L,2,''trusted_server_result_infrastructure_v1'',12345)',e.id),'23514');
  PERFORM pg_temp.probe('invalid source version',format('SELECT * FROM public.record_pricing_quote_for_server(%L,0,''trusted_server_result_infrastructure_v1'',12345)',e.id),'23514');
  PERFORM pg_temp.probe('nonexistent exact source','SELECT * FROM public.record_pricing_quote_for_server(gen_random_uuid(),1,''trusted_server_result_infrastructure_v1'',12345)','23514');
  PERFORM pg_temp.probe('bigint maximum preserved exactly',format('DO $x$ DECLARE r jsonb; BEGIN r:=pg_temp.publish(%L,9223372036854775807); IF (SELECT seat_price_minor FROM private.pricing_quotes WHERE id=(r->>''quote_id'')::uuid)<>9223372036854775807 THEN RAISE EXCEPTION ''amount changed''; END IF; END $x$',other.id));
  PERFORM pg_temp.probe('unsupported corridor rejected',format('SELECT pg_temp.publish(%L)',(SELECT id FROM geography WHERE label='3')),'23514');
  PERFORM pg_temp.probe('terminal quote replay rejected',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.publish(%L)',q.id,e.id),'23514');
  PERFORM pg_temp.probe('ambiguous replay rejected',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.add_quote(%L,''{"version":2,"pricing_policy_version":"trusted_server_result_infrastructure_v1","seat_price_minor":12345}''); SELECT pg_temp.publish(%L)',q.id,e.id,e.id),'23514');
  PERFORM pg_temp.probe('source superseded replay rejected',format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L; SELECT pg_temp.publish(%L)',e.id,e.id),'23514');
  PERFORM pg_temp.probe('expired geography rejected',format('DO $x$ DECLARE id uuid; BEGIN id:=pg_temp.short_evidence(%L); PERFORM pg_sleep(0.35); PERFORM pg_temp.publish(id); END $x$',other.id),'23514');
  PERFORM pg_temp.probe('expired replay does not refresh',format('DO $x$ DECLARE id uuid; BEGIN id:=pg_temp.short_evidence(%L); PERFORM pg_temp.publish(id); PERFORM pg_sleep(0.35); PERFORM pg_temp.publish(id); END $x$',other.id),'23514');
  PERFORM pg_temp.probe('expired quote with live geography rejected',format('SELECT pg_temp.add_quote(%L,jsonb_build_object(''pricing_policy_version'',''trusted_server_result_infrastructure_v1'',''seat_price_minor'',12345,''expires_at'',clock_timestamp()+interval ''0.3 seconds'')); SELECT pg_sleep(0.35); SELECT pg_temp.publish(%L)',other.id,other.id),'23514');
  PERFORM pg_temp.probe('closed need rejected after live revalidation',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.publish(%L)',e.movement_need_id,e.id),'23514');
  cmd:=format('DO $x$ DECLARE id uuid; result jsonb; BEGIN id:=pg_temp.record_result(%L,''{"classifier_version":"v2"}''); result:=pg_temp.publish(id,23456); IF result->>''quote_version''<>''2'' OR NOT EXISTS(SELECT 1 FROM private.pricing_quotes x WHERE x.id=%L AND x.status=''superseded'') OR (SELECT count(*) FROM private.pricing_quotes WHERE movement_need_id=%L AND status=''current'')<>1 THEN RAISE EXCEPTION ''non-atomic versioning''; END IF; END $x$',e.route_match_evidence_id,q.id,e.movement_need_id);
  PERFORM pg_temp.probe('new exact source creates version 2 and supersedes version 1',cmd);
  PERFORM pg_temp.probe('failed new-source publication preserves prior current quote',format('DO $x$ DECLARE id uuid; BEGIN BEGIN id:=pg_temp.record_result(%L,''{"classifier_version":"v2"}''); PERFORM pg_temp.publish(id,-1); EXCEPTION WHEN check_violation THEN NULL; END; IF NOT EXISTS(SELECT 1 FROM private.pricing_quotes x WHERE x.id=%L AND x.status=''current'') THEN RAISE EXCEPTION ''lost prior quote''; END IF; END $x$',e.route_match_evidence_id,q.id));
  PERFORM pg_temp.pricing_check('all nonquote rows unchanged including finance wallet offer alignment and geography',pg_temp.source_state()=(SELECT state FROM source_before));
END;
$tests$;
SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.pricing_results;
SELECT count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.pricing_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.pricing_results WHERE NOT passed) THEN RAISE EXCEPTION '0069 behavioral checks failed'; END IF; END $$;
ROLLBACK;
