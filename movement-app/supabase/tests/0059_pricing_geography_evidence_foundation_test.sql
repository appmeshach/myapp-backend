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
    10000,
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

CREATE FUNCTION pg_temp.add_pricing(p_match uuid,p_overrides jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE m private.trusted_route_match_evidence%ROWTYPE;
  e private.pricing_geography_evidence%ROWTYPE; stamp timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO STRICT m FROM private.trusted_route_match_evidence WHERE id=p_match;
  e:=jsonb_populate_record(NULL::private.pricing_geography_evidence,jsonb_build_object(
    'id',gen_random_uuid(),'route_match_evidence_id',m.id,'route_match_evidence_version',m.version,
    'movement_need_id',m.movement_need_id,'requesting_member_id',m.requesting_member_id,
    'offering_member_id',m.offering_member_id,'offering_movement_intent_id',m.offering_movement_intent_id,
    'offering_intent_version',m.offering_intent_version,'route_evidence_id',m.route_evidence_id,
    'route_evidence_version',m.route_evidence_version,'state_location_reference_id',m.requester_origin_location_reference_id,
    'version',1,'evidence_schema_version','pricing_geography_evidence_v1',
    'classifier_name','test-classifier','classifier_version','v1','transport_geography_version','test-v1',
    'pricing_corridor_distance_meters',100000,'pricing_range_supported',true,
    'geographic_events','[]'::jsonb,'generated_at',stamp,'created_at',stamp,
    'expires_at',stamp+interval '10 minutes','status','current')||p_overrides);
  INSERT INTO private.pricing_geography_evidence SELECT e.*;
  RETURN e.id;
END;
$$;

CREATE TEMP TABLE fixture(label text PRIMARY KEY,match_id uuid) ON COMMIT DROP;
DO $fixtures$
DECLARE req uuid; off_id uuid; a uuid; b uuid; c uuid; d uuid; route_id uuid; intent_id uuid; need_id uuid; match_id uuid; i integer;
BEGIN
  FOR i IN 1..2 LOOP
    req:=gen_random_uuid(); off_id:=gen_random_uuid();
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@0059.invalid',clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
    FROM unnest(ARRAY[req,off_id]) id;
    a:=pg_temp.make_state_endpoint(req,'request origin','0059-ro-'||i,6.43,3.52,'region-lagos','Lagos');
    b:=pg_temp.make_state_endpoint(req,'request destination','0059-rd-'||i,6.60,3.35,'region-lagos','Lagos');
    c:=pg_temp.make_state_endpoint(off_id,'offer origin','0059-oo-'||i,6.42,3.42,'region-lagos','Lagos');
    d:=pg_temp.make_state_endpoint(off_id,'offer destination','0059-od-'||i,6.52,3.37,'region-lagos','Lagos');
    route_id:=pg_temp.make_route(off_id,c,d,'0059-route-'||i);
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

DO $tests$
DECLARE m private.trusted_route_match_evidence%ROWTYPE; other private.trusted_route_match_evidence%ROWTYPE;
 e private.pricing_geography_evidence%ROWTYPE; eid uuid; value jsonb; field text; role_name text; fn record;
 base text; replacement jsonb; distance bigint; entry record; expid uuid;
BEGIN
 SELECT x.* INTO m FROM private.trusted_route_match_evidence x JOIN fixture f ON f.match_id=x.id WHERE f.label='1';
 SELECT x.* INTO other FROM private.trusted_route_match_evidence x JOIN fixture f ON f.match_id=x.id WHERE f.label='2';
 eid:=pg_temp.add_pricing(m.id,'{"geographic_events":[{"event_type":"core_stage_entry","position_meters":0},{"event_type":"major_transport_transition","position_meters":100000}]}');
 SELECT * INTO e FROM private.pricing_geography_evidence WHERE id=eid;
 PERFORM private.assert_pricing_geography_evidence(eid);
 PERFORM pg_temp.pricing_check('A live assertion accepts valid trusted chain',true);
 FOR entry IN SELECT * FROM jsonb_each(jsonb_build_object(
 'movement_need_id',m.movement_need_id,'requesting_member_id',m.requesting_member_id,'offering_member_id',m.offering_member_id,
 'offering_movement_intent_id',m.offering_movement_intent_id,'offering_intent_version',m.offering_intent_version,
 'route_evidence_id',m.route_evidence_id,'route_evidence_version',m.route_evidence_version,
 'route_match_evidence_id',m.id,'route_match_evidence_version',m.version,'state_location_reference_id',m.requester_origin_location_reference_id)) LOOP
   PERFORM pg_temp.pricing_check('A exact '||entry.key, to_jsonb(e)->entry.key=entry.value);
 END LOOP;
 PERFORM pg_temp.pricing_check('A authoritative state evidence retained',EXISTS(SELECT 1 FROM private.trusted_location_state_evidence WHERE resolved_location_reference_id=e.state_location_reference_id AND state_key='lagos'));
 PERFORM pg_temp.pricing_check('A positive distance and supported boundary',e.pricing_corridor_distance_meters=100000 AND e.pricing_range_supported);
 PERFORM pg_temp.pricing_check('A schema and classifier provenance',e.evidence_schema_version='pricing_geography_evidence_v1' AND e.classifier_name='test-classifier' AND e.classifier_version='v1' AND e.transport_geography_version='test-v1');
 PERFORM pg_temp.pricing_check('A ordered event sequence preserved',e.geographic_events='[{"event_type":"core_stage_entry","position_meters":0},{"event_type":"major_transport_transition","position_meters":100000}]'::jsonb);
 PERFORM pg_temp.pricing_check('A current lifecycle and timestamps',e.status='current' AND e.generated_at>=m.calculated_at AND e.generated_at<=e.created_at AND e.expires_at>e.created_at AND e.expires_at<=m.expires_at);
 -- All insertion probes retire the original in a rolled-back subtransaction.
 base:=format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L; SELECT pg_temp.add_pricing(%L,',eid,m.id);
 FOREACH distance IN ARRAY ARRAY[99999,100000,100001]::bigint[] LOOP
   PERFORM pg_temp.probe('B exact distance '||distance,base||quote_literal(jsonb_build_object('version',2,'pricing_corridor_distance_meters',distance,'pricing_range_supported',distance<=100000))||'); DO $v$ BEGIN IF NOT EXISTS(SELECT 1 FROM private.pricing_geography_evidence WHERE status=''current'' AND pricing_corridor_distance_meters='||distance||' AND pricing_range_supported='||(distance<=100000)::text||') THEN RAISE EXCEPTION ''distance changed''; END IF; END $v$;');
 END LOOP;
 FOR entry IN SELECT * FROM (VALUES ('zero','0'::jsonb,'23514'),('negative','-1'::jsonb,'23514'),('null','null'::jsonb,'23514'),('fraction','1.5'::jsonb,'22P02'),('overflow','9223372036854775808'::jsonb,'22003')) x(label,val,code) LOOP
   PERFORM pg_temp.probe('C distance rejects '||entry.label,base||quote_literal(jsonb_build_object('version',2,'pricing_corridor_distance_meters',entry.val))||')',entry.code);
 END LOOP;
 FOR entry IN SELECT * FROM (VALUES
 ('empty','[]','00000'),('core','[{"event_type":"core_stage_entry","position_meters":10}]','00000'),
 ('transition','[{"event_type":"major_transport_transition","position_meters":10}]','00000'),
 ('ordered','[{"event_type":"core_stage_entry","position_meters":0},{"event_type":"major_transport_transition","position_meters":100000}]','00000'),
 ('distinct types same position','[{"event_type":"core_stage_entry","position_meters":10},{"event_type":"major_transport_transition","position_meters":10}]','00000'),
 ('unknown','[{"event_type":"unknown","position_meters":10}]','23514'),('SQL null',NULL,'23514'),('scalar','42','23514'),('object','{}','23514'),('null item','[null]','23514'),
 ('missing key','[{"event_type":"core_stage_entry"}]','23514'),('extra key','[{"event_type":"core_stage_entry","position_meters":10,"extra":true}]','23514'),
 ('duplicate','[{"event_type":"core_stage_entry","position_meters":10},{"event_type":"core_stage_entry","position_meters":10}]','23514'),
 ('fraction','[{"event_type":"core_stage_entry","position_meters":1.5}]','23514'),('negative','[{"event_type":"core_stage_entry","position_meters":-1}]','23514'),
 ('past corridor','[{"event_type":"core_stage_entry","position_meters":100001}]','23514'),('string position','[{"event_type":"core_stage_entry","position_meters":"10"}]','23514'),
 ('null position','[{"event_type":"core_stage_entry","position_meters":null}]','23514'),
 ('reversed','[{"event_type":"core_stage_entry","position_meters":20},{"event_type":"major_transport_transition","position_meters":10}]','23514')
 ) x(label,val,code) LOOP
   PERFORM pg_temp.probe('D events '||entry.label,base||quote_literal(jsonb_build_object('version',2,'geographic_events',entry.val::jsonb))||')',entry.code);
 END LOOP;
 PERFORM pg_temp.probe('D JSON null rejected by actual event helper','SELECT private.assert_pricing_geography_events(''null''::jsonb,100000)','23514');
 FOR entry IN SELECT * FROM jsonb_each(jsonb_build_object(
 'movement_need_id',other.movement_need_id,'requesting_member_id',other.requesting_member_id,'offering_member_id',other.offering_member_id,
 'offering_movement_intent_id',other.offering_movement_intent_id,'offering_intent_version',2,
 'route_evidence_id',other.route_evidence_id,'route_evidence_version',2,'route_match_evidence_id',other.id,
 'route_match_evidence_version',2,'state_location_reference_id',other.requester_origin_location_reference_id)) LOOP
   PERFORM pg_temp.probe('E false binding '||entry.key,base||quote_literal(jsonb_build_object('version',2,entry.key,entry.value))||')','23514');
 END LOOP;
 FOR entry IN SELECT * FROM (VALUES
 ('match',format('UPDATE private.trusted_route_match_evidence SET status=''superseded'' WHERE id=%L;',m.id)),
 ('route',format('UPDATE private.offering_route_evidence SET status=''superseded'' WHERE id=%L;',m.route_evidence_id)),
 ('intent',format('UPDATE private.offering_movement_intents SET status=''superseded'' WHERE id=%L;',m.offering_movement_intent_id)),
 ('need',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L;',m.movement_need_id))) x(label,stmt) LOOP
   PERFORM pg_temp.probe('F legal upstream transition '||entry.label,entry.stmt);
   PERFORM pg_temp.probe('F stale '||entry.label||' rejects live assertion',entry.stmt||format('SELECT private.assert_pricing_geography_evidence(%L)',eid),'23514');
 END LOOP;
 PERFORM pg_temp.probe('F state evidence cannot be rewritten',format('UPDATE private.trusted_location_state_evidence SET state_name=''Ogun'' WHERE resolved_location_reference_id=%L',e.state_location_reference_id),'23514');
 PERFORM pg_temp.probe('G current can supersede',format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L',eid));
 PERFORM pg_temp.probe('G premature expiration denied',format('UPDATE private.pricing_geography_evidence SET status=''expired'' WHERE id=%L',eid),'23514');
 PERFORM pg_temp.probe('G terminal cannot reopen',format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L; UPDATE private.pricing_geography_evidence SET status=''current'' WHERE id=%L',eid,eid),'23514');
 PERFORM pg_temp.probe('G terminal cannot change again',format('UPDATE private.pricing_geography_evidence SET status=''superseded'' WHERE id=%L; UPDATE private.pricing_geography_evidence SET status=''expired'' WHERE id=%L',eid,eid),'23514');
 PERFORM pg_temp.probe('G no-op status forbidden',format('UPDATE private.pricing_geography_evidence SET status=status WHERE id=%L',eid),'23514');
 PERFORM pg_temp.probe('G history delete forbidden',format('DELETE FROM private.pricing_geography_evidence WHERE id=%L',eid),'23514');
 -- NULL is distinguishable for every NOT NULL factual field; BEFORE trigger must
 -- report immutability (23514), rather than the table NOT NULL check (23502).
 FOR field IN SELECT key FROM jsonb_each(to_jsonb(e)-'status') LOOP
   PERFORM pg_temp.probe('G immutable '||field,format('UPDATE private.pricing_geography_evidence SET %I=NULL WHERE id=%L',field,eid),'23514');
 END LOOP;
 PERFORM pg_temp.probe('H two current versions denied',format('SELECT pg_temp.add_pricing(%L,''{"version":2}'')',m.id),'23505');
 PERFORM pg_temp.probe('H historical version reuse denied',base||'''{}'')','23505');
 PERFORM pg_temp.probe('H zero version denied',base||'''{"version":0}'')','23514');
 PERFORM pg_temp.probe('H negative version denied',base||'''{"version":-1}'')','23514');
 PERFORM pg_temp.probe('H historical and current coexist',base||'''{"version":2}'')');
 PERFORM pg_temp.probe('G insert terminal denied',base||'''{"version":2,"status":"superseded"}'')','23514');
 -- Retain true elapsed history, never change an immutable expiry to fake time.
 UPDATE private.pricing_geography_evidence SET status='superseded' WHERE id=eid;
 expid:=pg_temp.add_pricing(m.id,jsonb_build_object('version',2,'expires_at',clock_timestamp()+interval '1 second'));
 PERFORM pg_sleep(1.05);
 PERFORM pg_temp.probe('G elapsed evidence rejects live use',format('SELECT private.assert_pricing_geography_evidence(%L)',expid),'23514');
 UPDATE private.pricing_geography_evidence SET status='expired' WHERE id=expid;
 PERFORM pg_temp.pricing_check('G elapsed current can expire',EXISTS(SELECT 1 FROM private.pricing_geography_evidence WHERE id=expid AND status='expired'));
 PERFORM pg_temp.probe('G expired cannot reopen',format('UPDATE private.pricing_geography_evidence SET status=''current'' WHERE id=%L',expid),'23514');
 PERFORM pg_temp.add_pricing(m.id,'{"version":3}');
 PERFORM pg_temp.pricing_check('H superseded expired and current history coexist',(SELECT count(*)=3 AND count(*) FILTER(WHERE status='current')=1 FROM private.pricing_geography_evidence WHERE movement_need_id=m.movement_need_id));
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.probe('I '||role_name||' SELECT',format('SET LOCAL ROLE %I; SELECT * FROM private.pricing_geography_evidence',role_name),CASE WHEN role_name='service_role' THEN '00000' ELSE '42501' END);
   FOREACH field IN ARRAY ARRAY['INSERT INTO private.pricing_geography_evidence DEFAULT VALUES','UPDATE private.pricing_geography_evidence SET status=''superseded''','DELETE FROM private.pricing_geography_evidence','TRUNCATE private.pricing_geography_evidence'] LOOP
     PERFORM pg_temp.probe('I '||role_name||' denied '||split_part(field,' ',1),format('SET LOCAL ROLE %I; ',role_name)||field,'42501');
   END LOOP;
   FOR fn IN SELECT p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN ('assert_pricing_geography_events','assert_pricing_geography_context','assert_pricing_geography_evidence','protect_pricing_geography_evidence') LOOP
     PERFORM pg_temp.pricing_check('I '||role_name||' no execute '||fn.proname,NOT has_function_privilege(role_name,fn.oid,'EXECUTE'));
   END LOOP;
   PERFORM pg_temp.probe('I '||role_name||' actual helper call denied',format('SET LOCAL ROLE %I; SELECT private.assert_pricing_geography_evidence(%L)',role_name,eid),'42501');
 END LOOP;
 PERFORM pg_temp.pricing_check('I RLS enabled with no policies',(SELECT relrowsecurity FROM pg_class WHERE oid='private.pricing_geography_evidence'::regclass) AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.pricing_geography_evidence'::regclass));
 PERFORM pg_temp.pricing_check('I no public pricing geography writer',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%pricing_geography%'));
 PERFORM pg_temp.pricing_check('J all nonpricing source financial operational and auth rows unchanged',(SELECT state=pg_temp.source_state() FROM source_before));
END;
$tests$;
SELECT test_number,test_name,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,diagnostic FROM pg_temp.pricing_results ORDER BY test_number;
SELECT count(*) AS total,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.pricing_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.pricing_results WHERE NOT passed) THEN RAISE EXCEPTION '0059 behavioral assertions failed'; END IF; END $$;
ROLLBACK;
