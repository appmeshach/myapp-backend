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
  FOR i IN 1..4 LOOP
    req:=gen_random_uuid(); off_id:=gen_random_uuid();
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@0061.invalid',clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
    FROM unnest(ARRAY[req,off_id]) id;
    a:=pg_temp.make_state_endpoint(req,'request origin','0061-ro-'||i,6.43,3.52,'region-lagos','Lagos');
    b:=pg_temp.make_state_endpoint(req,'request destination','0061-rd-'||i,6.60,3.35,'region-lagos','Lagos');
    c:=pg_temp.make_state_endpoint(off_id,'offer origin','0061-oo-'||i,6.42,3.42,'region-lagos','Lagos');
    d:=pg_temp.make_state_endpoint(off_id,'offer destination','0061-od-'||i,6.52,3.37,'region-lagos','Lagos');
    route_id:=pg_temp.make_route(off_id,c,d,'0061-route-'||i);
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
-- Production 0061 exposes no operational writer. Normal triggers stay enabled.
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
DO $tests$
DECLARE e private.pricing_geography_evidence%ROWTYPE; other private.pricing_geography_evidence%ROWTYPE;
 qid uuid; original jsonb; entry record; field text; role_name text; fn record; base text; route_change text; match_change text; gid uuid;
BEGIN
 SELECT x.* INTO e FROM private.pricing_geography_evidence x JOIN geography g ON g.id=x.id WHERE g.label='1';
 SELECT x.* INTO other FROM private.pricing_geography_evidence x JOIN geography g ON g.id=x.id WHERE g.label='2';
 qid:=pg_temp.add_quote(e.id);
 SELECT to_jsonb(q) INTO original FROM private.pricing_quotes q WHERE id=qid;
 PERFORM private.assert_pricing_quote(qid);
 PERFORM pg_temp.pricing_check('valid current quote passes live assertion',true);
 PERFORM pg_temp.pricing_check('opaque 155037 kobo preserved without calculation or rounding',original->>'seat_price_minor'='155037');
 PERFORM pg_temp.pricing_check('12000 corridor and 15000 provider route distinct',(SELECT pricing_corridor_distance_meters=12000 FROM private.pricing_geography_evidence WHERE id=e.id) AND (SELECT route_distance_meters=15000 FROM private.offering_route_evidence WHERE id=e.route_evidence_id) AND original->>'pricing_geography_evidence_id'=e.id::text);
 FOR entry IN SELECT * FROM jsonb_each(jsonb_build_object('pricing_geography_evidence_id',e.id,'pricing_geography_evidence_version',e.version,
 'movement_need_id',e.movement_need_id,'requesting_member_id',e.requesting_member_id,'offering_member_id',e.offering_member_id,
 'offering_movement_intent_id',e.offering_movement_intent_id,'offering_intent_version',e.offering_intent_version,'state_location_reference_id',e.state_location_reference_id)) LOOP
 PERFORM pg_temp.pricing_check('exact copied binding '||entry.key,original->entry.key=entry.value);
 END LOOP;
 base:=format('SELECT pg_temp.add_quote(%L,',other.id);
 PERFORM pg_temp.probe('100000 metre exact supported boundary backs quote',base||'''{}'')');
 SELECT id INTO gid FROM geography WHERE label='3';
 PERFORM private.assert_pricing_geography_evidence(gid);
 PERFORM pg_temp.pricing_check('100001 metre geography remains live structurally valid',(SELECT pricing_corridor_distance_meters=100001 AND NOT pricing_range_supported FROM private.pricing_geography_evidence WHERE id=gid));
 PERFORM pg_temp.probe('unsupported 100001 metre geography cannot back quote',format('SELECT pg_temp.add_quote(%L)',gid),'23514');
 FOR entry IN SELECT * FROM jsonb_each(jsonb_build_object('pricing_geography_evidence_id',e.id,'pricing_geography_evidence_version',2,
 'movement_need_id',e.movement_need_id,'requesting_member_id',e.requesting_member_id,'offering_member_id',e.offering_member_id,
 'offering_movement_intent_id',e.offering_movement_intent_id,'offering_intent_version',2,'state_location_reference_id',e.state_location_reference_id)) LOOP
 PERFORM pg_temp.probe('false copied binding rejects '||entry.key,base||quote_literal(jsonb_build_object(entry.key,entry.value))||')','23514');
 END LOOP;
 PERFORM pg_temp.probe('missing exact evidence rejected',base||quote_literal(jsonb_build_object('pricing_geography_evidence_id',gen_random_uuid()))||')','23514');
 FOR entry IN SELECT * FROM (VALUES
 ('negative amount','{"seat_price_minor":-1}','23514'),('null amount','{"seat_price_minor":null}','23502'),('fraction bigint syntax','{"seat_price_minor":1.5}','22P02'),
 ('currency USD','{"currency":"USD"}','23514'),('empty policy','{"pricing_policy_version":""}','23514'),('invalid policy','{"pricing_policy_version":" bad"}','23514'),
 ('null version','{"version":null}','23514'),('zero version','{"version":0}','23514'),('skipped initial version','{"version":2}','23514'),
 ('terminal insert','{"status":"superseded"}','23514'),('null status','{"status":null}','23514'),('infinite creation','{"created_at":"infinity"}','23514'),
 ('infinite expiry','{"expires_at":"infinity"}','23514'),('null expiry','{"expires_at":null}','23514'),('expired quote','{"expires_at":"2000-01-01"}','23514')) x(label,payload,code) LOOP
 PERFORM pg_temp.probe(entry.label,base||quote_literal(entry.payload::jsonb)||')',entry.code);
 END LOOP;
 PERFORM pg_temp.probe('zero amount allowed as opaque nonnegative fact',base||'''{"seat_price_minor":0}'')');
 PERFORM pg_temp.probe('bigint maximum amount preserved',base||'''{"seat_price_minor":9223372036854775807}''); DO $v$ BEGIN IF NOT EXISTS(SELECT 1 FROM private.pricing_quotes WHERE seat_price_minor=9223372036854775807) THEN RAISE EXCEPTION ''amount changed''; END IF; END $v$;');
 PERFORM pg_temp.probe('expiry cannot exceed geography',base||quote_literal(jsonb_build_object('expires_at',other.expires_at+interval '1 second'))||')','23514');
 PERFORM pg_temp.probe('creation cannot predate geography',base||quote_literal(jsonb_build_object('created_at',other.created_at-interval '1 second'))||')','23514');
 PERFORM pg_temp.probe('future creation rejected',base||quote_literal(jsonb_build_object('created_at',clock_timestamp()+interval '1 day'))||')','23514');
 PERFORM pg_temp.probe('second current quote rejected',format('SELECT pg_temp.add_quote(%L,''{"version":2}'')',e.id),'23505');
 PERFORM pg_temp.probe('historical version cannot be reused',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.add_quote(%L)',qid,e.id),'23514');
 PERFORM pg_temp.probe('version gap after supersession rejected',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.add_quote(%L,''{"version":3}'')',qid,e.id),'23514');
 PERFORM pg_temp.probe('sequential history retains one current version two',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.add_quote(%L,''{"version":2}''); DO $h$ BEGIN IF (SELECT count(*) FROM private.pricing_quotes WHERE movement_need_id=%L)<>2 OR (SELECT count(*) FROM private.pricing_quotes WHERE movement_need_id=%L AND status=''current'' AND version=2)<>1 THEN RAISE EXCEPTION ''bad history''; END IF; END $h$;',qid,e.id,e.movement_need_id,e.movement_need_id));
 FOR field IN SELECT key FROM jsonb_each(original-'status') LOOP
 PERFORM pg_temp.probe('immutable field '||field,format('UPDATE private.pricing_quotes SET %I=NULL WHERE id=%L',field,qid),'23514');
 END LOOP;
 PERFORM pg_temp.probe('current can supersede',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L',qid));
 PERFORM pg_temp.probe('current no-op rejected',format('UPDATE private.pricing_quotes SET status=status WHERE id=%L',qid),'23514');
 PERFORM pg_temp.probe('superseded cannot reopen',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; UPDATE private.pricing_quotes SET status=''current'' WHERE id=%L',qid,qid),'23514');
 PERFORM pg_temp.probe('superseded no-op rejected',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; UPDATE private.pricing_quotes SET status=status WHERE id=%L',qid,qid),'23514');
 PERFORM pg_temp.probe('superseded facts cannot change',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; UPDATE private.pricing_quotes SET seat_price_minor=1 WHERE id=%L',qid,qid),'23514');
 PERFORM pg_temp.probe('superseded quote cannot be live',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT private.assert_pricing_quote(%L)',qid,qid),'23514');
 PERFORM pg_temp.probe('delete existing quote rejected',format('DELETE FROM private.pricing_quotes WHERE id=%L',qid),'23514');
 PERFORM pg_temp.probe('delete nonexistent quote rejected','DELETE FROM private.pricing_quotes WHERE false','23514');
 PERFORM pg_temp.probe('truncate quote history rejected','TRUNCATE private.pricing_quotes','23514');
 base:=format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L;',e.id);
 PERFORM pg_temp.probe('legal evidence supersession fixture',base);
 PERFORM pg_temp.probe('superseded geography rejects live quote',base||format('SELECT private.assert_pricing_quote(%L)',qid),'23514');
 PERFORM pg_temp.probe('superseded geography rejects insertion',base||format('SELECT pg_temp.add_quote(%L)',e.id),'23514');
 SELECT id INTO gid FROM geography WHERE label='4';
 PERFORM pg_temp.probe('short evidence fixture is genuinely live',format('SELECT private.assert_pricing_geography_evidence(pg_temp.short_evidence(%L))',gid));
 PERFORM pg_temp.probe('elapsed geography cannot back insertion',format('DO $x$ DECLARE id uuid; BEGIN id:=pg_temp.short_evidence(%L); PERFORM pg_sleep(0.35); PERFORM pg_temp.add_quote(id); END $x$;',gid),'23514');
 PERFORM pg_temp.probe('elapsed geography invalidates existing quote',format('DO $x$ DECLARE id uuid; q uuid; BEGIN id:=pg_temp.short_evidence(%L); q:=pg_temp.add_quote(id); PERFORM pg_sleep(0.35); PERFORM private.assert_pricing_quote(q); END $x$;',gid),'23514');
 PERFORM pg_temp.probe('elapsed quote fails while geography still live',format('DO $x$ DECLARE q uuid; BEGIN q:=pg_temp.add_quote(%L,jsonb_build_object(''expires_at'',clock_timestamp()+interval ''0.3 seconds'')); PERFORM pg_sleep(0.35); PERFORM private.assert_pricing_geography_evidence(%L); PERFORM private.assert_pricing_quote(q); END $x$;',other.id,other.id),'23514');
 base:=format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L;',e.movement_need_id);
 PERFORM pg_temp.probe('legal need closure fixture',base);
 PERFORM pg_temp.probe('closed need invalidates live quote',base||format('SELECT private.assert_pricing_quote(%L)',qid),'23514');
 route_change:=format('DO $r$ DECLARE r private.offering_route_evidence%%ROWTYPE; BEGIN SELECT * INTO STRICT r FROM private.offering_route_evidence WHERE id=%L; PERFORM public.record_offering_route_evidence_for_server(r.offering_movement_intent_id,r.provider_namespace,r.provider_product,r.provider_version,''0061-replacement'',r.route_shape,r.route_distance_meters,r.route_duration_seconds,clock_timestamp(),r.expires_at); END $r$;',e.route_evidence_id);
 PERFORM pg_temp.probe('legitimate route replacement fixture',route_change);
 PERFORM pg_temp.probe('route replacement invalidates live quote',route_change||format('SELECT private.assert_pricing_quote(%L)',qid),'23514');
 match_change:=route_change||format('DO $m$ DECLARE r private.offering_route_evidence%%ROWTYPE; BEGIN SELECT * INTO STRICT r FROM private.offering_route_evidence WHERE offering_movement_intent_id=%L AND status=''current''; PERFORM public.record_trusted_route_match_evidence_for_server(%L,%L,r.id,r.version,10,20,10000,100,9000,6.43,3.52,6.60,3.35,clock_timestamp(),NULL); END $m$;',e.offering_movement_intent_id,e.movement_need_id,e.offering_movement_intent_id);
 PERFORM pg_temp.probe('legitimate match replacement fixture',match_change);
 PERFORM pg_temp.probe('match replacement invalidates live quote',match_change||format('SELECT private.assert_pricing_quote(%L)',qid),'23514');
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
 PERFORM pg_temp.probe(role_name||' quote read',format('SET LOCAL ROLE %I; SELECT * FROM private.pricing_quotes',role_name),CASE WHEN role_name='service_role' THEN '00000' ELSE '42501' END);
 FOREACH field IN ARRAY ARRAY['INSERT INTO private.pricing_quotes DEFAULT VALUES','UPDATE private.pricing_quotes SET status=''superseded''','DELETE FROM private.pricing_quotes','TRUNCATE private.pricing_quotes'] LOOP
 PERFORM pg_temp.probe(role_name||' direct '||split_part(field,' ',1)||' denied',format('SET LOCAL ROLE %I; ',role_name)||field,'42501');
 END LOOP;
 FOR fn IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('assert_pricing_quote_context','assert_pricing_quote','protect_pricing_quote') LOOP
 PERFORM pg_temp.pricing_check(role_name||' no execute '||fn.proname,NOT has_function_privilege(role_name,fn.oid,'EXECUTE'));
 END LOOP;
 PERFORM pg_temp.probe(role_name||' actual live helper denied',format('SET LOCAL ROLE %I; SELECT private.assert_pricing_quote(%L)',role_name,qid),'42501');
 END LOOP;
 PERFORM pg_temp.pricing_check('private RLS enabled no policies',(SELECT relrowsecurity FROM pg_class WHERE oid='private.pricing_quotes'::regclass) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.pricing_quotes'::regclass));
 PERFORM pg_temp.pricing_check('all helper definer and empty search path',(SELECT count(*)=3 AND bool_and(p.prosecdef AND p.proconfig=ARRAY['search_path=""']) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('assert_pricing_quote_context','assert_pricing_quote','protect_pricing_quote')));
 PERFORM pg_temp.pricing_check('no public quote function',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%pricing_quote%'));
 PERFORM pg_temp.pricing_check('all nonquote rows unchanged including geography financial operational auth',(SELECT state=pg_temp.source_state() FROM source_before));
END;
$tests$;
SELECT test_number,test_name,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,diagnostic FROM pg_temp.pricing_results ORDER BY test_number;
SELECT count(*) AS total,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.pricing_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.pricing_results WHERE NOT passed) THEN RAISE EXCEPTION '0061 behavioral assertions failed'; END IF; END $$;
ROLLBACK;
