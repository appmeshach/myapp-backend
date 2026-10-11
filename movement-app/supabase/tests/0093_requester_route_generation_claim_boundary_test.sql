BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
CREATE TEMP TABLE requester_claim_results(name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_claim(name text,passed boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO requester_claim_results VALUES(name,coalesce(passed,false));
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION '0093 check failed: %',name; END IF;
END;
$$;
CREATE FUNCTION pg_temp.reject_claim(name text,command text,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false;
BEGIN
  BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>expected THEN RAISE; END IF; rejected:=true;
  END;
  PERFORM pg_temp.check_claim(name,rejected);
END;
$$;
CREATE FUNCTION pg_temp.fixture_claim(p_status text DEFAULT 'discoverable',p_expiry timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE member uuid:=gen_random_uuid(); need uuid:=gen_random_uuid(); origin uuid:=gen_random_uuid(); destination uuid:=gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(member,'authenticated','authenticated',member::text||'@test-0093.invalid','{}','{}',clock_timestamp(),clock_timestamp());
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,status)
    VALUES(need,member,'Origin','Destination',clock_timestamp()+interval '1 hour',p_status);
  INSERT INTO private.movement_location_references(id,owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,provider_namespace,provider_place_reference,resolution_version,created_at,resolved_at,expires_at)
    VALUES(origin,member,'Origin','provider_resolved','resolved',6.4,3.4,'test-location','origin','v1',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',p_expiry),
    (destination,member,'Destination','provider_resolved','resolved',6.5,3.5,'test-location','destination','v1',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',p_expiry);
  INSERT INTO private.movement_need_locations VALUES(need,'origin',origin),(need,'destination',destination);
  RETURN jsonb_build_object('member',member,'need',need,'origin',origin,'destination',destination);
END;
$$;
CREATE FUNCTION pg_temp.acquire_claim(f jsonb,p_version text DEFAULT 'profile-undecided-v1') RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(r) FROM public.claim_requester_route_generation_for_server((f->>'need')::uuid,(f->>'member')::uuid,'test-requester','directions',p_version) r;
$$;
CREATE FUNCTION pg_temp.publish_claim(f jsonb,c jsonb,p_generated timestamptz,p_distance bigint DEFAULT 1000,p_expiry timestamptz DEFAULT NULL,p_reference text DEFAULT 'route-v1') RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(r) FROM public.record_claimed_requester_route_evidence_for_server((f->>'need')::uuid,(f->>'member')::uuid,(c->>'generation_claim_token')::uuid,
    (f->>'origin')::uuid,(f->>'destination')::uuid,'requester_route_evidence_v1','geojson_linestring_v1','test-requester','directions','profile-undecided-v1',p_reference,
    '{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}',p_distance,300,p_generated,p_expiry) r;
$$;
DO $$
DECLARE f jsonb; c jsonb; r jsonb; again jsonb; generated timestamptz; need uuid; evidence uuid; alternate jsonb; state text;
BEGIN
  f:=pg_temp.fixture_claim(); c:=pg_temp.acquire_claim(f);
  PERFORM pg_temp.check_claim('first acquisition grants claim',c->>'generation_state'='claimed');
  PERFORM pg_temp.check_claim('acquisition response contains only approved private metadata',
    c-ARRAY['generation_state','generation_claim_token','retry_after_seconds','route_evidence_id','route_evidence_version','origin_location_reference_id','destination_location_reference_id','lease_expires_at']='{}'::jsonb);
  need:=(f->>'need')::uuid;
  PERFORM pg_temp.check_claim('fixed thirty-second lease',(SELECT lease_expires_at=claimed_at+interval '30 seconds' FROM private.requester_route_generation_claims WHERE movement_need_id=need));
  PERFORM pg_temp.check_claim('claim alone writes no evidence',NOT EXISTS(SELECT 1 FROM private.requester_route_evidence WHERE movement_need_id=need));
  again:=pg_temp.acquire_claim(f);
  PERFORM pg_temp.check_claim('active attempt returns in progress',again->>'generation_state'='in_progress');
  PERFORM pg_temp.check_claim('busy result discloses no token or endpoints',again->>'generation_claim_token' IS NULL AND again->>'origin_location_reference_id' IS NULL AND again->>'destination_location_reference_id' IS NULL);
  PERFORM pg_temp.reject_claim('no same-token lease renewal',format('UPDATE private.requester_route_generation_claims SET claimed_at=claimed_at+interval ''1 second'',lease_expires_at=lease_expires_at+interval ''1 second'' WHERE movement_need_id=%L',need));
  PERFORM pg_temp.reject_claim('no active-token replacement',format('UPDATE private.requester_route_generation_claims SET claim_token=gen_random_uuid() WHERE movement_need_id=%L',need));
  PERFORM pg_temp.reject_claim('no direct claim release',format('DELETE FROM private.requester_route_generation_claims WHERE movement_need_id=%L',need));
  alternate:=pg_temp.fixture_claim();
  PERFORM pg_temp.reject_claim('requester mismatch',format('SELECT pg_temp.acquire_claim(%L::jsonb)',jsonb_set(f,'{member}',alternate->'member')),'42501');
  PERFORM pg_temp.reject_claim('invalid schema fails closed',format('SELECT * FROM public.claim_requester_route_generation_for_server(%L,%L,''test-requester'',''directions'',''v1'',''wrong'')',need,f->>'member'));
  generated:=clock_timestamp();
  PERFORM pg_temp.reject_claim('wrong token rejected',format('SELECT pg_temp.publish_claim(%L,%L,%L)',f,jsonb_set(c,'{generation_claim_token}',to_jsonb(gen_random_uuid())),generated));
  PERFORM pg_temp.reject_claim('swapped endpoint rejected',format('SELECT pg_temp.publish_claim(%L,%L,%L)',jsonb_set(f,'{origin}',f->'destination'),c,generated));
  PERFORM pg_temp.reject_claim('negative payload rolls back',format('SELECT pg_temp.publish_claim(%L,%L,%L,-1)',f,c,generated));
  PERFORM pg_temp.check_claim('failed publication leaves claim incomplete',(SELECT completed_at IS NULL FROM private.requester_route_generation_claims WHERE movement_need_id=need));
  r:=pg_temp.publish_claim(f,c,generated);
  evidence:=(r->>'route_evidence_id')::uuid;
  PERFORM pg_temp.check_claim('valid publication',r->>'publication_state'='published' AND (r->>'route_evidence_version')::integer=1);
  PERFORM pg_temp.check_claim('publication response has no geometry',r-ARRAY['publication_state','route_evidence_id','route_evidence_version']='{}'::jsonb);
  PERFORM pg_temp.check_claim('publication and completion atomic',(SELECT completed_route_evidence_id=evidence AND completion_kind='published' FROM private.requester_route_generation_claims WHERE movement_need_id=need));
  again:=pg_temp.publish_claim(f,c,generated);
  PERFORM pg_temp.check_claim('lost-response exact replay returns original',again=r);
  PERFORM pg_temp.reject_claim('changed payload replay rejected',format('SELECT pg_temp.publish_claim(%L,%L,%L,1001)',f,c,generated));
  PERFORM pg_temp.reject_claim('changed generation time replay rejected',format('SELECT pg_temp.publish_claim(%L,%L,clock_timestamp())',f,c));
  PERFORM pg_temp.check_claim('replay does not allocate version',(SELECT count(*)=1 FROM private.requester_route_evidence WHERE movement_need_id=need));
  again:=pg_temp.acquire_claim(f);
  PERFORM pg_temp.check_claim('evidence reuse beats active completed slot',again->>'generation_state'='reuse_existing' AND again->>'route_evidence_id'=evidence::text);
  PERFORM pg_temp.check_claim('reuse has no token or endpoint disclosure',again->>'generation_claim_token' IS NULL AND again->>'origin_location_reference_id' IS NULL);
  again:=pg_temp.acquire_claim(f,'another-profile');
  PERFORM pg_temp.check_claim('provider version mismatch is not reusable',again->>'generation_state'='in_progress');
  UPDATE public.movement_needs SET status='paused' WHERE id=need;
  PERFORM private.assert_requester_route_evidence(evidence);
  PERFORM pg_temp.check_claim('paused need still structurally valid',(pg_temp.acquire_claim(f))->>'generation_state'='reuse_existing');
  UPDATE public.movement_needs SET status='closed' WHERE id=need;
  PERFORM private.assert_requester_route_evidence(evidence);
  PERFORM pg_temp.check_claim('closed need still structurally valid',(pg_temp.acquire_claim(f))->>'generation_state'='reuse_existing');
  -- Past departure is a fixture-only UPDATE that does not change evidence inputs.
  ALTER TABLE public.movement_needs DISABLE TRIGGER enforce_movement_need_planning_horizon;
  UPDATE public.movement_needs SET earliest_departure_at=clock_timestamp()-interval '1 hour' WHERE id=need;
  ALTER TABLE public.movement_needs ENABLE TRIGGER enforce_movement_need_planning_horizon;
  PERFORM private.assert_requester_route_evidence(evidence);
  PERFORM pg_temp.check_claim('past departure remains separate',(pg_temp.acquire_claim(f))->>'generation_state'='reuse_existing');
  PERFORM pg_temp.reject_claim('evidence preserves need deletion restriction',format('DELETE FROM public.movement_needs WHERE id=%L',need),'23503');
  UPDATE private.requester_route_evidence SET status='superseded' WHERE id=evidence;
  PERFORM pg_temp.reject_claim('superseded assertion fails closed',format('SELECT private.assert_requester_route_evidence(%L)',evidence));
  PERFORM pg_temp.check_claim('superseded evidence is not reusable',(pg_temp.acquire_claim(f))->>'generation_state'='in_progress');
  PERFORM pg_temp.check_claim('history preserved',EXISTS(SELECT 1 FROM private.requester_route_evidence WHERE id=evidence AND status='superseded'));
  f:=pg_temp.fixture_claim(); c:=pg_temp.acquire_claim(f); need:=(f->>'need')::uuid;
  DELETE FROM public.movement_needs WHERE id=need;
  PERFORM pg_temp.check_claim('claim-only deletion cascades',NOT EXISTS(SELECT 1 FROM private.requester_route_generation_claims WHERE movement_need_id=need));
  PERFORM pg_temp.reject_claim('deleted need cannot acquire',format('SELECT pg_temp.acquire_claim(%L)',f),'42501');
  PERFORM pg_temp.reject_claim('deleted need cannot publish',format('SELECT pg_temp.publish_claim(%L,%L,clock_timestamp())',f,c),'42501');
  f:=pg_temp.fixture_claim(); need:=(f->>'need')::uuid;
  INSERT INTO private.requester_route_evidence(movement_need_id,requesting_member_id,origin_location_reference_id,destination_location_reference_id,version,evidence_schema_version,provider_namespace,provider_product,provider_version,provider_route_reference,route_shape_format,route_shape,route_distance_meters,route_duration_seconds,generated_at)
    VALUES(need,(f->>'member')::uuid,(f->>'origin')::uuid,(f->>'destination')::uuid,1,'requester_route_evidence_v1','test-requester','directions','profile-undecided-v1','preexisting','geojson_linestring_v1','{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}',1000,300,clock_timestamp());
  PERFORM pg_temp.check_claim('reusable evidence beats first claim creation',(pg_temp.acquire_claim(f))->>'generation_state'='reuse_existing' AND NOT EXISTS(SELECT 1 FROM private.requester_route_generation_claims WHERE movement_need_id=need));
  f:=pg_temp.fixture_claim('expired',clock_timestamp()+interval '0.2 seconds');
  c:=pg_temp.acquire_claim(f);
  PERFORM pg_temp.check_claim('persisted expired need can have valid generation context',c->>'generation_state'='claimed');
  PERFORM pg_sleep(0.25);
  PERFORM pg_temp.reject_claim('expired endpoints block acquisition',format('SELECT pg_temp.acquire_claim(%L)',f));
  PERFORM pg_temp.reject_claim('expired endpoints block publication',format('SELECT pg_temp.publish_claim(%L,%L,clock_timestamp())',f,c));
  PERFORM pg_temp.check_claim('claim table RLS enabled',(SELECT relrowsecurity FROM pg_class WHERE oid='private.requester_route_generation_claims'::regclass));
  PERFORM pg_temp.check_claim('claim table has no policies',NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.requester_route_generation_claims'::regclass));
  FOREACH state IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    PERFORM pg_temp.check_claim(state||' no direct claim access',NOT has_table_privilege(state,'private.requester_route_generation_claims','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'));
  END LOOP;
  PERFORM pg_temp.check_claim('only service executes acquisition',has_function_privilege('service_role','public.claim_requester_route_generation_for_server(uuid,uuid,text,text,text,text,text)','EXECUTE')
    AND NOT has_function_privilege('anon','public.claim_requester_route_generation_for_server(uuid,uuid,text,text,text,text,text)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.claim_requester_route_generation_for_server(uuid,uuid,text,text,text,text,text)','EXECUTE'));
  PERFORM pg_temp.check_claim('only service executes publication',has_function_privilege('service_role','public.record_claimed_requester_route_evidence_for_server(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)','EXECUTE')
    AND NOT has_function_privilege('anon','public.record_claimed_requester_route_evidence_for_server(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.record_claimed_requester_route_evidence_for_server(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,jsonb,bigint,bigint,timestamptz,timestamptz)','EXECUTE'));
  PERFORM pg_temp.check_claim('claim stores no geometry or coordinates',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='requester_route_generation_claims' AND (column_name LIKE '%latitude%' OR column_name LIKE '%longitude%' OR column_name='route_shape')));
  PERFORM pg_temp.check_claim('all boundary functions definer empty search path',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname IN
    ('protect_requester_route_generation_claim','lock_requester_route_generation_context','assert_requester_route_evidence','validate_requester_generation_contract','reusable_requester_route_evidence','claim_requester_route_generation_for_server','record_claimed_requester_route_evidence_for_server') AND (NOT p.prosecdef OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""'])));
  PERFORM pg_temp.check_claim('private helpers owner-only',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname IN
    ('protect_requester_route_generation_claim','lock_requester_route_generation_context','assert_requester_route_evidence','validate_requester_generation_contract','reusable_requester_route_evidence')
    AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))));
  f:=pg_temp.fixture_claim();
  PERFORM set_config('test0093.need',f->>'need',true); PERFORM set_config('test0093.member',f->>'member',true);
END;
$$;
-- Exercise actual role permission failures, not just catalog introspection.
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN PERFORM public.claim_requester_route_generation_for_server(NULL,NULL,'x','x','x'); RAISE EXCEPTION 'client acquired claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM private.requester_route_generation_claims; RAISE EXCEPTION 'client read claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.record_claimed_requester_route_evidence_for_server(NULL,NULL,NULL,NULL,NULL,'x','x','x','x','x','x',NULL,1,1,clock_timestamp()); RAISE EXCEPTION 'client published'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM public.claim_requester_route_generation_for_server(NULL,NULL,'x','x','x'); RAISE EXCEPTION 'anon acquired claim'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.record_claimed_requester_route_evidence_for_server(NULL,NULL,NULL,NULL,NULL,'x','x','x','x','x','x',NULL,1,1,clock_timestamp()); RAISE EXCEPTION 'anon published'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END; $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ DECLARE result text; BEGIN
  SELECT generation_state INTO result FROM public.claim_requester_route_generation_for_server(current_setting('test0093.need')::uuid,current_setting('test0093.member')::uuid,'test-requester','directions','profile-undecided-v1');
  IF result<>'claimed' THEN RAISE EXCEPTION 'Service claim failed'; END IF;
END; $$;
RESET ROLE;
SELECT count(*) AS tests,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM requester_claim_results;
SELECT name,passed FROM requester_claim_results ORDER BY name;
ROLLBACK;
