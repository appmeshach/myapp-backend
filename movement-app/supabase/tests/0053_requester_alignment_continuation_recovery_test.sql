BEGIN;
-- Administrator-only fixtures and actual role/JWT RPC calls; everything rolls back.
CREATE FUNCTION pg_temp.continuation_as(p_role text, p_member uuid, p_sql text)
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


REVOKE ALL ON FUNCTION pg_temp.continuation_as(text, uuid, text) FROM PUBLIC;
CREATE FUNCTION pg_temp.continuation_check(label text, passed boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Failed: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.continuation_check(text, boolean) FROM PUBLIC;

DO $test$
DECLARE
  requester uuid := gen_random_uuid(); driver uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  vehicle uuid := gen_random_uuid(); needs uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  offers uuid[] := ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  fixture_alignment_ids uuid[] := ARRAY['00530000-0000-4000-8000-000000000003'::uuid,
    '00530000-0000-4000-8000-000000000001'::uuid,'00530000-0000-4000-8000-000000000002'::uuid];
  query text := 'SELECT * FROM public.get_my_requester_movement_continuation()';
  r jsonb; i integer; actor uuid; submission uuid; media uuid; ref text; payment uuid; state text;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0053.invalid','{}','{}',now(),now()
    FROM unnest(ARRAY[requester,driver,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number)
    VALUES(vehicle,'Test','Blue',4,'TEST-0053');
  r := pg_temp.continuation_as('authenticated',requester,query);
  PERFORM pg_temp.continuation_check('zero matches',r = '{"ok":true,"rows":[]}'::jsonb);
  r := pg_temp.continuation_as('authenticated',NULL,query);
  PERFORM pg_temp.continuation_check('missing auth rejected',r->>'state'='P0001' AND r->>'message'='Authentication required');
  FOREACH state IN ARRAY ARRAY['anon','service_role'] LOOP
    r := pg_temp.continuation_as(state,requester,query);
    PERFORM pg_temp.continuation_check(state||' cannot execute',r->>'state'='42501');
  END LOOP;
  PERFORM pg_temp.continuation_check('PUBLIC has no execution grant',NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.get_my_requester_movement_continuation()'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'));
  FOR i IN 1..3 LOOP
    INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,people_count,status)
      VALUES(needs[i],requester,'A','B',clock_timestamp()+interval '1 second',1,'closed');
    INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
      VALUES(offers[i],needs[i],driver,vehicle,1,'accepted');
    INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id,created_at)
      VALUES(fixture_alignment_ids[i],needs[i],offers[i],requester,driver,now() - CASE WHEN i=1 THEN interval '2 hours' ELSE interval '1 hour' END);
  END LOOP;
  PERFORM pg_sleep(1.1);
  r := pg_temp.continuation_as('authenticated',requester,query);
  PERFORM pg_temp.continuation_check('closed and elapsed need; newest timestamp then ID; exact one-field shape',
    r=jsonb_build_object('ok',true,'rows',jsonb_build_array(jsonb_build_object('movement_need_id',needs[3]))));
  FOREACH actor IN ARRAY ARRAY[driver,outsider] LOOP
    r := pg_temp.continuation_as('authenticated',actor,query);
    PERFORM pg_temp.continuation_check('other requester and offering participant excluded',r='{"ok":true,"rows":[]}'::jsonb);
  END LOOP;
  UPDATE public.alignments SET status='failed' WHERE id IN (fixture_alignment_ids[1],fixture_alignment_ids[2]);
  -- Use existing server face/payment APIs to establish activated fixture, preserving triggers.
  FOREACH actor IN ARRAY ARRAY[driver,requester] LOOP
    r := pg_temp.continuation_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original'));
    submission := (r#>>'{rows,0,id}')::uuid;
    r := pg_temp.continuation_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',submission,gen_random_uuid()::text||'/processed'));
    media := (r#>>'{rows,0,id}')::uuid; ref := gen_random_uuid()::text;
    r := pg_temp.continuation_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',needs[3],actor,ref));
    PERFORM pg_temp.continuation_check('face fixture starts',r->>'ok'='true');
    r := pg_temp.continuation_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,media));
    PERFORM pg_temp.continuation_check('face fixture completes',r->>'ok'='true');
  END LOOP;
  r := pg_temp.continuation_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',fixture_alignment_ids[3]));
  payment := (r#>>'{rows,0,payment_id}')::uuid;
  r := pg_temp.continuation_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,''test-0053'')',payment));
  PERFORM pg_temp.continuation_check('payment fixture activates',r->>'ok'='true');
  r := pg_temp.continuation_as('authenticated',requester,query);
  PERFORM pg_temp.continuation_check('activated recovers only need',
    r=jsonb_build_object('ok',true,'rows',jsonb_build_array(jsonb_build_object('movement_need_id',needs[3]))));
  FOREACH state IN ARRAY ARRAY['in_progress','completed','cancelled','failed'] LOOP
    UPDATE public.alignments SET status=state WHERE id=fixture_alignment_ids[3];
    r := pg_temp.continuation_as('authenticated',requester,query);
    PERFORM pg_temp.continuation_check(state||' excluded',r='{"ok":true,"rows":[]}'::jsonb);
  END LOOP;
END;
$test$;
ROLLBACK;
