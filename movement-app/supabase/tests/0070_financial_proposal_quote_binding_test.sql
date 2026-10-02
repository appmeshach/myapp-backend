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
    SELECT id,'authenticated','authenticated',id::text||'@0070.invalid',clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,clock_timestamp(),clock_timestamp()
    FROM unnest(ARRAY[req,off_id]) id;
    a:=pg_temp.make_state_endpoint(req,'request origin','0070-ro-'||i,6.43,3.52,'region-lagos','Lagos');
    b:=pg_temp.make_state_endpoint(req,'request destination','0070-rd-'||i,6.60,3.35,'region-lagos','Lagos');
    c:=pg_temp.make_state_endpoint(off_id,'offer origin','0070-oo-'||i,6.42,3.42,'region-lagos','Lagos');
    d:=pg_temp.make_state_endpoint(off_id,'offer destination','0070-od-'||i,6.52,3.37,'region-lagos','Lagos');
    route_id:=pg_temp.make_route(off_id,c,d,'0070-route-'||i);
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
-- Only proposal parent/roster rows are excluded from the fingerprint.
CREATE FUNCTION pg_temp.source_state() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_object_agg(n.nspname||'.'||c.relname,
 query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')
 AND c.oid NOT IN ('private.financial_proposals'::regclass,'private.financial_proposal_travellers'::regclass)
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


-- Owner-only test fixture constructor derives copied fields from exact evidence.
-- Production 0070 exposes no operational writer. Normal triggers stay enabled.
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


-- Test-only constructors; never installed by the migration.
CREATE TEMP TABLE proposal_fixture(label text PRIMARY KEY,quote_id uuid,vehicle_id uuid) ON COMMIT DROP;
DO $$ DECLARE g record; q uuid; v uuid; off_id uuid; BEGIN
 FOR g IN SELECT * FROM geography WHERE label<>'3' ORDER BY label LOOP
  SELECT x.quote_id INTO q FROM public.record_pricing_quote_for_server(g.id,1,'trusted_server_result_infrastructure_v1',12345) x;
  SELECT offering_member_id INTO off_id FROM private.pricing_quotes WHERE id=q;
  INSERT INTO public.vehicles(make,color,seat_capacity,plate_number) VALUES('Test','Blue',4,'TEST-0070-'||g.label) RETURNING id INTO v;
  INSERT INTO public.member_vehicle_access(member_id,vehicle_id) VALUES(off_id,v);
  INSERT INTO proposal_fixture VALUES(g.label,q,v);
 END LOOP;
END $$;
CREATE FUNCTION pg_temp.proposal_record(p_quote uuid,p_overrides jsonb DEFAULT '{}')
RETURNS private.financial_proposals LANGUAGE plpgsql AS $$
DECLARE q private.pricing_quotes%ROWTYPE; n public.movement_needs%ROWTYPE; v uuid;
BEGIN
 SELECT * INTO STRICT q FROM private.pricing_quotes WHERE id=p_quote;
 SELECT * INTO STRICT n FROM public.movement_needs WHERE id=q.movement_need_id;
 SELECT vehicle_id INTO STRICT v FROM proposal_fixture WHERE quote_id=q.id;
 RETURN jsonb_populate_record(NULL::private.financial_proposals,jsonb_build_object(
  'id',gen_random_uuid(),'movement_need_id',n.id,'member_needing_movement_id',q.requesting_member_id,
  'offering_member_id',q.offering_member_id,'vehicle_id',v,'version',1,
  'financial_model_version','shared_platform_fee_v1','pricing_policy_version',q.pricing_policy_version,
  'platform_fee_allocation_policy_version','equal_split_requester_remainder_v1','currency',q.currency,
  'quoted_platform_fee_total_minor',17,'quoted_movement_contribution_minor',83,
  'origin_area',n.origin_area,'destination_area',n.destination_area,'earliest_departure_at',n.earliest_departure_at,
  'latest_departure_at',n.latest_departure_at,'people_count',n.people_count,'seats_offered',n.people_count,
  'vehicle_seat_capacity',4,'created_at',clock_timestamp(),'expires_at',q.expires_at,'status','current',
  'pricing_quote_id',q.id,'pricing_quote_version',q.version)||p_overrides);
END $$;
CREATE FUNCTION pg_temp.construct(p_quote uuid,p_overrides jsonb DEFAULT '{}',p_roster boolean DEFAULT true)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p private.financial_proposals%ROWTYPE;
BEGIN
 p:=pg_temp.proposal_record(p_quote,p_overrides);
 SET CONSTRAINTS ALL DEFERRED;
 INSERT INTO private.financial_proposals SELECT p.*;
 IF p_roster THEN
  INSERT INTO private.financial_proposal_travellers(proposal_id,member_id,participant_id,role)
   SELECT p.id,m.member_id,m.id,m.role FROM public.movement_participants m
   WHERE m.movement_need_id=p.movement_need_id AND m.status='confirmed';
 END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN p.id;
END $$;
CREATE TEMP TABLE source_before AS SELECT pg_temp.source_state() AS state;
-- 0070 tests follow; fixture prefix also runs only inside a disposable database.
DO $tests$
DECLARE q uuid; other uuid; p uuid; before_row jsonb; bad jsonb; r text; fn oid;
BEGIN
 SELECT quote_id INTO q FROM proposal_fixture WHERE label='1';
 SELECT quote_id INTO other FROM proposal_fixture WHERE label='2';
 p:=pg_temp.construct(q);
 SELECT to_jsonb(x) INTO before_row FROM private.financial_proposals x WHERE id=p;
 PERFORM pg_temp.pricing_check('valid exact binding',before_row->>'pricing_quote_id'=q::text AND before_row->>'pricing_quote_version'='1');
 PERFORM pg_temp.pricing_check('opaque totals unchanged',before_row->>'quoted_platform_fee_total_minor'='17' AND before_row->>'quoted_movement_contribution_minor'='83');
 PERFORM pg_temp.pricing_check('unaccepted unbound unmaterialized',NOT EXISTS(SELECT 1 FROM private.financial_proposals WHERE id=p AND (offering_accepted_at IS NOT NULL OR requester_accepted_at IS NOT NULL OR movement_offer_id IS NOT NULL OR alignment_id IS NOT NULL OR financial_agreement_id IS NOT NULL OR materialized_at IS NOT NULL)));
 FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('pricing_quote_id',gen_random_uuid()),jsonb_build_object('pricing_quote_id',NULL),
  '{"pricing_quote_version":2}'::jsonb,'{"pricing_quote_version":0}'::jsonb,'{"pricing_quote_version":null}'::jsonb,
  jsonb_build_object('movement_need_id',gen_random_uuid()),jsonb_build_object('member_needing_movement_id',gen_random_uuid()),
  jsonb_build_object('offering_member_id',gen_random_uuid()),'{"currency":"USD"}'::jsonb,'{"pricing_policy_version":"wrong_v1"}'::jsonb,
  jsonb_build_object('expires_at',(SELECT expires_at+interval '1 second' FROM private.pricing_quotes WHERE id=other)),
  jsonb_build_object('created_at',(SELECT created_at-interval '1 second' FROM private.pricing_quotes WHERE id=other)),
  '{"expires_at":null}'::jsonb,'{"expires_at":"infinity"}'::jsonb,'{"created_at":"-infinity"}'::jsonb,
  jsonb_build_object('route_evidence_id',gen_random_uuid()),'{"origin_area":"wrong snapshot"}'::jsonb,
  '{"vehicle_seat_capacity":3}'::jsonb,jsonb_build_object('offering_accepted_at',clock_timestamp())
 )) LOOP
  PERFORM pg_temp.probe('reject '||bad::text,format('SELECT pg_temp.construct(%L,%L::jsonb)',other,bad),'23514');
 END LOOP;
 PERFORM pg_temp.probe('missing roster still rejected',format('SELECT pg_temp.construct(%L,''{}'',false)',other),'23514');
 PERFORM pg_temp.probe('superseded quote rejected on construction',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.construct(%L)',other,other),'23514');
 PERFORM pg_temp.probe('closed need rejected on construction',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=(SELECT movement_need_id FROM private.pricing_quotes WHERE id=%L); SELECT pg_temp.construct(%L)',other,other),'23514');
 PERFORM pg_temp.probe('quote ID immutable',format('UPDATE private.financial_proposals SET pricing_quote_id=%L WHERE id=%L',other,p),'23514');
 PERFORM pg_temp.probe('quote version immutable',format('UPDATE private.financial_proposals SET pricing_quote_version=2 WHERE id=%L',p),'23514');
 PERFORM pg_temp.probe('traveller immutable',format('UPDATE private.financial_proposal_travellers SET role=''invited_participant'' WHERE proposal_id=%L',p),'23514');
 PERFORM pg_temp.probe('historical supersession preserves provenance',format('DO $x$ DECLARE original jsonb; BEGIN SELECT to_jsonb(x) INTO original FROM private.financial_proposals x WHERE id=%L; UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; PERFORM private.assert_financial_proposal_quote_binding(x) FROM private.financial_proposals x WHERE id=%L; UPDATE private.financial_proposals SET status=''current'' WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE; IF (SELECT to_jsonb(x) FROM private.financial_proposals x WHERE id=%L) IS DISTINCT FROM original THEN RAISE EXCEPTION ''provenance changed''; END IF; END $x$',p,q,p,p,p));
 PERFORM pg_temp.probe('closed movement preserves historical assertion',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=(SELECT movement_need_id FROM private.pricing_quotes WHERE id=%L); SELECT private.assert_financial_proposal_quote_binding(x) FROM private.financial_proposals x WHERE id=%L',q,p));
 fn:='private.assert_financial_proposal_quote_binding(private.financial_proposals)'::regprocedure;
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.pricing_check(r||' no helper execution',NOT has_function_privilege(r,fn,'EXECUTE'));
  PERFORM pg_temp.probe(r||' no direct INSERT',format('SET LOCAL ROLE %I; INSERT INTO private.financial_proposals DEFAULT VALUES',r),'42501');
  PERFORM pg_temp.probe(r||' no direct UPDATE',format('SET LOCAL ROLE %I; UPDATE private.financial_proposals SET pricing_quote_version=2',r),'42501');
 END LOOP;
 PERFORM pg_temp.pricing_check('no public proposal RPC',NOT EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='public' AND f.proname LIKE '%financial_proposal%'));
 PERFORM pg_temp.pricing_check('RLS remains enabled', (SELECT relrowsecurity FROM pg_class WHERE oid='private.financial_proposals'::regclass));
 PERFORM pg_temp.pricing_check('all nonproposal rows unchanged',pg_temp.source_state()=(SELECT state FROM source_before));
END $tests$;
-- Genuine short-lived quote with live upstream evidence; no clock mocking.
DO $$ DECLARE e uuid; q uuid; v uuid; p uuid; original jsonb; BEGIN
 SELECT id INTO e FROM geography WHERE label='4';
 UPDATE private.pricing_quotes SET status='superseded' WHERE id=(SELECT quote_id FROM proposal_fixture WHERE label='4');
 q:=pg_temp.add_quote(e,jsonb_build_object('version',2,'expires_at',clock_timestamp()+interval '0.5 seconds'));
 UPDATE proposal_fixture SET quote_id=q WHERE label='4';
 p:=pg_temp.construct(q);
 SELECT to_jsonb(x) INTO original FROM private.financial_proposals x WHERE id=p;
 PERFORM pg_sleep(0.6);
 PERFORM pg_temp.probe('expired quote rejected on construction',format('SELECT pg_temp.construct(%L)',q),'23514');
 PERFORM private.assert_financial_proposal_quote_binding(x) FROM private.financial_proposals x WHERE id=p;
 UPDATE private.financial_proposals SET status='current' WHERE id=p;
 SET CONSTRAINTS ALL IMMEDIATE;
 PERFORM pg_temp.pricing_check('expired historical provenance remains unchanged',(SELECT to_jsonb(x)=original FROM private.financial_proposals x WHERE id=p));
END $$;
-- Runner injects the EXACT migration precondition here, against real proposal rows.
-- MIGRATION_PRECONDITION_PROBE
SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.pricing_results;
SELECT count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.pricing_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.pricing_results WHERE NOT passed) THEN RAISE EXCEPTION '0070 behavioral checks failed'; END IF; END $$;
ROLLBACK;
