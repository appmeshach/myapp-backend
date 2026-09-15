BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0018.
-- No real users, Storage objects, external providers, or network calls are used.
-- All fixtures, temporary helpers, role/JWT settings and results roll back.
-- This file does not replace functions, disable triggers/RLS, or grant app rights.
-- Uses the same local role/JWT harness as the 0014 rollback test.
-- Pattern: transaction-local SET ROLE + JWT claims, actual RPC calls, named
-- boolean results. Run to the final ROLLBACK even if any result is FALSE.
-- Unexpected fixture/setup errors abort the transaction; issue ROLLBACK if your
-- SQL client stops on error. Do not change ROLLBACK to COMMIT.

CREATE TEMP TABLE meeting_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE meeting_function_snapshot ON COMMIT DROP AS
SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS definition_hash,
  p.proacl::text AS acl, p.proconfig::text AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f';

CREATE FUNCTION pg_temp.meeting_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO pg_temp.meeting_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness, NOT an application SECURITY DEFINER RPC.
-- Role switching must succeed BEFORE the error-catching subtransaction so a
-- harness permission failure cannot masquerade as an expected app denial.
-- SQL arguments below are fixed test SQL or format('%L', fixture values).
CREATE FUNCTION pg_temp.meeting_as(p_role text, p_member uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  previous_role text := current_setting('role');
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  previous_claims text := current_setting('request.jwt.claims', true);
  previous_jwt_role text := current_setting('request.jwt.claim.role', true);
  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_member::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_member, 'role', p_role)::text, true);
  PERFORM set_config('role', p_role, true);
  BEGIN
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM ('
      || p_sql || ') AS q' INTO rows_json;
    result_json := jsonb_build_object('ok', true, 'rows', rows_json);
  EXCEPTION WHEN OTHERS THEN
    -- The failed query's writes roll back. Do not accept arbitrary errors as a pass.
    result_json := jsonb_build_object('ok', false, 'state', SQLSTATE, 'message', SQLERRM);
  END;
  PERFORM set_config('role', previous_role, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(previous_jwt_role, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(previous_claims, '{}'), true);
  RETURN result_json;
END;
$$;

CREATE FUNCTION pg_temp.meeting_denied(
  p_name text, p_role text, p_member uuid, p_sql text,
  p_state text DEFAULT '42501', p_message text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.meeting_as(p_role, p_member, p_sql);
  PERFORM pg_temp.meeting_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND (p_message IS NULL OR r->>'message' = p_message));
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.meeting_check(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.meeting_as(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.meeting_denied(text, text, uuid, text, text, text) FROM PUBLIC;



DO $test$
DECLARE
  driver uuid:=gen_random_uuid(); primary_member uuid:=gen_random_uuid(); traveller uuid:=gen_random_uuid();
  declined uuid:=gen_random_uuid(); removed uuid:=gen_random_uuid(); invited uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  need uuid:=gen_random_uuid(); alignment uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); offer uuid:=gen_random_uuid();
  actor uuid; sub uuid; media uuid; ref text; payment uuid; journey uuid; r jsonb; invalid_text text; rejected boolean; before_request text; before_started text; signature text;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0018.invalid','{}'::jsonb,'{}'::jsonb,now(),now()
    FROM unnest(ARRAY[driver,primary_member,traveller,declined,removed,invited,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Lexus','Blue',4,'TEST-0018');
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,people_count)
    VALUES(need,primary_member,'A','B',now()+interval '1 day',2);
  INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES
    (need,traveller,'invited_participant','confirmed'),(need,declined,'invited_participant','declined'),
    (need,removed,'invited_participant','removed'),(need,invited,'invited_participant','invited');
  -- Historical roster fixture as in 0017: the unconfirmed invite cannot pass
  -- ordinary 0013 acceptance, but must never gain reveal/edit authority either.
  INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
    VALUES(offer,need,driver,vehicle,2,'accepted');
  INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
    VALUES(alignment,need,offer,primary_member,driver);
  UPDATE public.movement_needs SET status='closed' WHERE id=need;
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('no preactivation status',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
  PERFORM pg_temp.meeting_denied('no preactivation editing','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Bus stop'',NULL)',need));
  FOREACH actor IN ARRAY ARRAY[driver,primary_member,traveller] LOOP
    r:=pg_temp.meeting_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original'));
    sub:=(r#>>'{rows,0,id}')::uuid;
    r:=pg_temp.meeting_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',sub,gen_random_uuid()::text||'/processed'));
    media:=(r#>>'{rows,0,id}')::uuid; ref:=gen_random_uuid()::text;
    r:=pg_temp.meeting_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,actor,ref));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Face fixture failed: %',r; END IF;
    r:=pg_temp.meeting_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,media));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Face completion failed: %',r; END IF;
  END LOOP;
  r:=pg_temp.meeting_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',alignment));
  payment:=(r#>>'{rows,0,payment_id}')::uuid;
  r:=pg_temp.meeting_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,''test-ref'')',payment));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Activation fixture failed: %',r; END IF;
  SELECT id INTO STRICT journey FROM public.journeys WHERE alignment_id=alignment;
  FOREACH actor IN ARRAY ARRAY[declined,removed,invited,outsider] LOOP
    r:=pg_temp.meeting_as('authenticated',actor,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
    PERFORM pg_temp.meeting_check('nonparticipant read denied '||actor,r->>'ok'='true' AND r->'rows'='[]'::jsonb);
    PERFORM pg_temp.meeting_denied('nonparticipant edit denied '||actor,'authenticated',actor,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Bus stop'',NULL)',need));
  END LOOP;
  PERFORM pg_temp.meeting_denied('start requires meeting point','authenticated',driver,format('SELECT * FROM public.request_my_movement_start(%L)',need),'22023');
  PERFORM pg_temp.meeting_denied('legacy start cannot bypass meeting requirement','authenticated',driver,format('SELECT * FROM public.request_journey_start(%L)',journey),'22023');
  -- Test constraints as administrator without disabling or changing them.
  FOREACH invalid_text IN ARRAY ARRAY['', '   ', E'\t\n', repeat('x',201)] LOOP
    rejected:=false;
    BEGIN
      INSERT INTO private.journey_meeting_points(journey_id,place_text,revision) VALUES(journey,invalid_text,1);
    EXCEPTION WHEN check_violation THEN rejected:=true;
    END;
    PERFORM pg_temp.meeting_check('stored invalid text rejected '||quote_literal(invalid_text),rejected);
    IF NOT rejected THEN RAISE EXCEPTION 'Invalid fixture unexpectedly inserted'; END IF;
  END LOOP;
  PERFORM pg_temp.meeting_denied('first creation rejects zero expected revision','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Bus stop'',0)',need),'40001');
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('no point means edit allowed but start forbidden',r->>'ok'='true' AND r#>>'{rows,0,can_edit_meeting_point}'='true' AND r#>>'{rows,0,can_request_start}'='false');
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''  Chevron bus stop  '',NULL)',need));
  PERFORM pg_temp.meeting_check('offering sets trimmed first revision after activation',r->>'ok'='true' AND r#>>'{rows,0,meeting_point_text}'='Chevron bus stop' AND r#>>'{rows,0,meeting_point_revision}'='1' AND r#>>'{rows,0,can_edit_meeting_point}'='true');
  PERFORM pg_temp.meeting_denied('replayed first creation cannot create another revision','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Chevron bus stop'',NULL)',need),'40001');
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('offering capability matches valid start eligibility',r#>>'{rows,0,can_request_start}'='true' AND r#>>'{rows,0,can_confirm_start}'='false');
  r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Front of Circle Mall'',1)',need));
  PERFORM pg_temp.meeting_check('requester edits before start request',r->>'ok'='true' AND r#>>'{rows,0,meeting_point_revision}'='2');
  PERFORM pg_temp.meeting_denied('replayed update cannot increment again','authenticated',primary_member,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Front of Circle Mall'',1)',need),'40001');
  PERFORM pg_temp.meeting_denied('stale revision rejected','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Stale'',1)',need),'40001');
  PERFORM pg_temp.meeting_check('stale write left latest value intact',(SELECT place_text='Front of Circle Mall' AND revision=2 FROM private.journey_meeting_points WHERE journey_id=journey));
  PERFORM pg_temp.meeting_denied('blank text rejected','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''   '',2)',need),'22023');
  PERFORM pg_temp.meeting_denied('excessive text rejected','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,%L,2)',need,repeat('x',201)),'22023');
  r:=pg_temp.meeting_as('authenticated',traveller,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('extra traveller reads with no authority',r->>'ok'='true' AND r#>>'{rows,0,meeting_point_text}'='Front of Circle Mall' AND r#>>'{rows,0,can_edit_meeting_point}'='false' AND r#>>'{rows,0,can_request_start}'='false' AND r#>>'{rows,0,can_confirm_start}'='false');
  PERFORM pg_temp.meeting_check('exact safe result keys',(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r#>'{rows,0}') k)=ARRAY['can_confirm_start','can_edit_meeting_point','can_request_start','journey_state','meeting_point_revision','meeting_point_text','start_requested_at','started_at']);
  PERFORM pg_temp.meeting_denied('extra traveller cannot edit','authenticated',traveller,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''No'',2)',need));
  FOREACH actor IN ARRAY ARRAY[primary_member,traveller] LOOP
    PERFORM pg_temp.meeting_denied('nonoffering cannot request start '||actor,'authenticated',actor,format('SELECT * FROM public.request_my_movement_start(%L)',need));
  END LOOP;
  FOREACH actor IN ARRAY ARRAY[driver,traveller] LOOP
    PERFORM pg_temp.meeting_denied('nonrequester cannot confirm '||actor,'authenticated',actor,format('SELECT * FROM public.confirm_my_movement_start(%L)',need));
  END LOOP;
  PERFORM pg_temp.meeting_denied('no confirmation without request','authenticated',primary_member,format('SELECT * FROM public.confirm_my_movement_start(%L)',need));
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.request_my_movement_start(%L)',need));
  before_request:=r#>>'{rows,0,start_requested_at}';
  PERFORM pg_temp.meeting_check('request freezes without starting',r->>'ok'='true' AND before_request IS NOT NULL AND r#>>'{rows,0,journey_state}'='not_started' AND r#>>'{rows,0,can_edit_meeting_point}'='false');
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.request_my_movement_start(%L)',need));
  PERFORM pg_temp.meeting_check('repeat request idempotent',r->>'ok'='true' AND r#>>'{rows,0,start_requested_at}'=before_request);
  FOREACH actor IN ARRAY ARRAY[driver,primary_member] LOOP
    PERFORM pg_temp.meeting_denied('frozen edit denied '||actor,'authenticated',actor,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''No'',2)',need));
  END LOOP;
  r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('requester can confirm stable request',r#>>'{rows,0,can_confirm_start}'='true' AND r#>>'{rows,0,can_edit_meeting_point}'='false');
  r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.confirm_my_movement_start(%L)',need));
  before_started:=r#>>'{rows,0,started_at}';
  PERFORM pg_temp.meeting_check('confirmation starts both records',r->>'ok'='true' AND r#>>'{rows,0,journey_state}'='in_progress' AND before_started IS NOT NULL AND (SELECT status='in_progress' FROM public.alignments WHERE id=alignment));
  r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.confirm_my_movement_start(%L)',need));
  PERFORM pg_temp.meeting_check('repeat confirm idempotent',r->>'ok'='true' AND r#>>'{rows,0,started_at}'=before_started);
  PERFORM pg_temp.meeting_check('exactly one journey',(SELECT count(*)=1 FROM public.journeys WHERE alignment_id=alignment));
  -- Exercise inactive lifecycle denial without disabling any production trigger.
  UPDATE public.journeys SET status='cancelled' WHERE id=journey;
  UPDATE public.alignments SET status='cancelled' WHERE id=alignment;
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('cancelled movement hides meeting point',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
  PERFORM pg_temp.meeting_denied('cancelled movement cannot edit','authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''No'',2)',need));
  UPDATE public.journeys SET status='failed' WHERE id=journey;
  UPDATE public.alignments SET status='failed' WHERE id=alignment;
  r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_check('failed movement hides meeting point',r->>'ok'='true' AND r->'rows'='[]'::jsonb);

  PERFORM pg_temp.meeting_denied('raw meeting table blocked','authenticated',driver,'SELECT * FROM private.journey_meeting_points');
  FOREACH signature IN ARRAY ARRAY['get_my_movement_coordination_status(uuid)','set_my_movement_meeting_point(uuid,text,bigint)','request_my_movement_start(uuid)','confirm_my_movement_start(uuid)'] LOOP
    PERFORM pg_temp.meeting_check('safe RPC ACL '||signature,has_function_privilege('authenticated','public.'||signature,'EXECUTE') AND NOT has_function_privilege('anon','public.'||signature,'EXECUTE'));
  END LOOP;
  PERFORM pg_temp.meeting_denied('anonymous status RPC denied','anon',NULL,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
  PERFORM pg_temp.meeting_denied('authenticated cannot execute context helper','authenticated',driver,format('SELECT * FROM private.movement_coordination_context(%L,true)',need));
  PERFORM pg_temp.meeting_check('no public execute on new functions',NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE ((n.nspname='public' AND p.proname IN ('get_my_movement_coordination_status','set_my_movement_meeting_point','request_my_movement_start','confirm_my_movement_start'))
      OR (n.nspname='private' AND p.proname IN ('movement_coordination_context','require_meeting_point_on_start_request')))
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
  ));
  PERFORM pg_temp.meeting_check('exact four client signatures and no alternate overloads',(SELECT count(*)=4 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('get_my_movement_coordination_status','set_my_movement_meeting_point','request_my_movement_start','confirm_my_movement_start')));
  PERFORM pg_temp.meeting_check('helper private',NOT has_function_privilege('authenticated','private.movement_coordination_context(uuid,boolean)','EXECUTE'));
  PERFORM pg_temp.meeting_check('no coordinate columns',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='journey_meeting_points' AND column_name IN ('latitude','longitude','lat','lng')));
END;
$test$;
SELECT pg_temp.meeting_check('functions and permissions unchanged by rollback test',NOT EXISTS (
 SELECT 1 FROM pg_temp.meeting_function_snapshot s JOIN pg_proc p ON p.oid=s.oid
 WHERE s.definition_hash<>md5(pg_get_functiondef(p.oid)) OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text
));
SELECT test_name,passed FROM pg_temp.meeting_test_results ORDER BY check_number;
ROLLBACK;
