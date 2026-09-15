BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0017.
-- No real users, Storage objects, external providers, or network calls are used.
-- All fixtures, temporary helpers, role/JWT settings and results roll back.
-- This file does not replace functions, disable triggers/RLS, or grant app rights.
-- Uses the same local role/JWT harness as the 0014 rollback test.
-- Pattern: transaction-local SET ROLE + JWT claims, actual RPC calls, named
-- boolean results. Run to the final ROLLBACK even if any result is FALSE.
-- Unexpected fixture/setup errors abort the transaction; issue ROLLBACK if your
-- SQL client stops on error. Do not change ROLLBACK to COMMIT.

CREATE TEMP TABLE orchestration_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE orchestration_function_snapshot ON COMMIT DROP AS
SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS definition_hash,
  p.proacl::text AS acl, p.proconfig::text AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f';

CREATE FUNCTION pg_temp.orchestration_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO pg_temp.orchestration_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness, NOT an application SECURITY DEFINER RPC.
-- Role switching must succeed BEFORE the error-catching subtransaction so a
-- harness permission failure cannot masquerade as an expected app denial.
-- SQL arguments below are fixed test SQL or format('%L', fixture values).
CREATE FUNCTION pg_temp.orchestration_as(p_role text, p_member uuid, p_sql text)
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

CREATE FUNCTION pg_temp.orchestration_denied(
  p_name text, p_role text, p_member uuid, p_sql text,
  p_state text DEFAULT '42501', p_message text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.orchestration_as(p_role, p_member, p_sql);
  PERFORM pg_temp.orchestration_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND (p_message IS NULL OR r->>'message' = p_message));
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.orchestration_check(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.orchestration_as(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.orchestration_denied(text, text, uuid, text, text, text) FROM PUBLIC;


-- DML variant of the same invoker harness; permission errors are distinguished
-- from zero-row RLS updates. Never grants privileges or disables enforcement.
CREATE FUNCTION pg_temp.orchestration_write_as(p_role text,p_member uuid,p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_role text:=current_setting('role'); old_claims text:=current_setting('request.jwt.claims',true);
  old_sub text:=current_setting('request.jwt.claim.sub',true); n bigint; r jsonb;
BEGIN
  IF p_role NOT IN ('authenticated','anon','service_role') THEN RAISE EXCEPTION 'Unsupported role'; END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_member,'role',p_role)::text,true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(p_member::text,''),true);
  PERFORM set_config('role',p_role,true);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n=ROW_COUNT;
    r:=jsonb_build_object('ok',true,'count',n);
  EXCEPTION WHEN OTHERS THEN
    r:=jsonb_build_object('ok',false,'state',SQLSTATE);
  END;
  PERFORM set_config('role',old_role,true);
  PERFORM set_config('request.jwt.claims',coalesce(old_claims,'{}'),true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
  RETURN r;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.orchestration_write_as(text,uuid,text) FROM PUBLIC;


DO $test$
DECLARE
  driver uuid:=gen_random_uuid(); primary_member uuid:=gen_random_uuid(); traveller uuid:=gen_random_uuid();
  declined uuid:=gen_random_uuid(); removed uuid:=gen_random_uuid(); invited uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  need uuid:=gen_random_uuid(); alignment uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); offer uuid:=gen_random_uuid();
  actor uuid; sub uuid; media uuid; session_id uuid; ref text; driver_ref text; driver_media uuid;
  r jsonb; original jsonb; role_name text; signature text;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0017.invalid','{}'::jsonb,'{}'::jsonb,now(),now()
    FROM unnest(ARRAY[driver,primary_member,traveller,declined,removed,invited,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Lexus','Blue',4,'TEST-0017');
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,people_count)
    VALUES(need,primary_member,'A','B',now()+interval '1 day',2);
  INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES
    (need,traveller,'invited_participant','confirmed'),(need,declined,'invited_participant','declined'),
    (need,removed,'invited_participant','removed'),(need,invited,'invited_participant','invited');
  INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
    VALUES(offer,need,driver,vehicle,2,'accepted');
  -- Legacy/malformed awaiting fixture includes an unconfirmed invitee to prove
  -- the bridge excludes it. 0013 normal acceptance would reject such a roster.
  -- No functions/triggers/RLS are replaced or disabled to construct the fixture.
  INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
    VALUES(alignment,need,offer,primary_member,driver);
  UPDATE public.movement_needs SET status='closed' WHERE id=need;

  FOREACH role_name IN ARRAY ARRAY['authenticated','anon'] LOOP
    PERFORM pg_temp.orchestration_denied(role_name||' cannot call start bridge',role_name,driver,
      format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',''ref'')',need,driver));
    PERFORM pg_temp.orchestration_denied(role_name||' cannot call callback bridge',role_name,driver,
      format('SELECT public.complete_face_verification_callback_for_server(''test'',''ref'',%L,true,true)',gen_random_uuid()));
  END LOOP;
  FOREACH actor IN ARRAY ARRAY[declined,removed,invited,outsider] LOOP
    PERFORM pg_temp.orchestration_denied('nonparticipant excluded: '||actor::text,'service_role',NULL,
      format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,actor,gen_random_uuid()::text),
      'P0001','Verification unavailable');
  END LOOP;
  PERFORM pg_temp.orchestration_denied('missing prepared media excluded','service_role',NULL,
    format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,driver,gen_random_uuid()::text),
    'P0001','Prepared current face photo required');

  FOREACH actor IN ARRAY ARRAY[driver,primary_member,traveller] LOOP
    r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original'));
    sub:=(r#>>'{rows,0,id}')::uuid;
    r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',sub,gen_random_uuid()::text||'/processed'));
    media:=(r#>>'{rows,0,id}')::uuid;
    ref:=gen_random_uuid()::text;
    r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,actor,ref));
    session_id:=(r#>>'{rows,0,session_id}')::uuid;
    IF session_id IS NULL THEN RAISE EXCEPTION 'Start fixture failed: %',r; END IF;
    PERFORM pg_temp.orchestration_check('required member gets exact-media session: '||actor::text,
      r->>'ok'='true' AND (r#>>'{rows,0,media_id}')::uuid=media
      AND (SELECT member_id=actor AND media_id=media AND provider_reference=ref FROM private.alignment_face_verifications WHERE id=session_id));
    IF actor=driver THEN
      driver_ref:=ref; driver_media:=media;
      PERFORM pg_temp.orchestration_denied('wrong media callback denied','service_role',NULL,
        format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,gen_random_uuid()),'P0001','Callback unavailable');
      r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true) AS status',ref,media));
      PERFORM pg_temp.orchestration_check('authenticated provider result verifies prepared media',r->>'ok'='true'
        AND r#>>'{rows,0,status}'='succeeded' AND (SELECT verified FROM public.member_media WHERE id=media));
      SELECT to_jsonb(f) INTO original FROM private.alignment_face_verifications f WHERE id=session_id;
      r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true) AS status',ref,media));
      PERFORM pg_temp.orchestration_check('identical success retry preserves full event',r->>'ok'='true'
        AND original=(SELECT to_jsonb(f) FROM private.alignment_face_verifications f WHERE id=session_id));
      PERFORM pg_temp.orchestration_denied('conflicting success retry denied','service_role',NULL,
        format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,false,true)',ref,media),'P0001','Callback unavailable');

        -- A newer attempt must become authoritative for readiness even if an older
-- successful provider callback is replayed later.
DECLARE
  old_success_session uuid := session_id;
  old_success_ref text := ref;
  old_success_media uuid := media;
  newer_session uuid;
  newer_ref text := gen_random_uuid()::text;
  before_old jsonb;
  before_new jsonb;
BEGIN
  SELECT to_jsonb(f) INTO before_old
  FROM private.alignment_face_verifications f
  WHERE f.id=old_success_session;

  r:=pg_temp.orchestration_as(
    'service_role',
    NULL,
    format(
      'SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',
      need,
      driver,
      newer_ref
    )
  );

  newer_session:=(r#>>'{rows,0,session_id}')::uuid;

  IF newer_session IS NULL THEN
    RAISE EXCEPTION 'Newer-attempt fixture failed: %',r;
  END IF;

  SELECT to_jsonb(f) INTO before_new
  FROM private.alignment_face_verifications f
  WHERE f.id=newer_session;

  PERFORM pg_temp.orchestration_check(
    'newer pending attempt becomes latest authority',
    (SELECT status='pending'
       FROM private.alignment_face_verifications
      WHERE id=newer_session)
    AND NOT private.has_current_alignment_face_check(
      alignment,
      driver,
      clock_timestamp()
    )
  );

  r:=pg_temp.orchestration_as(
    'service_role',
    NULL,
    format(
      'SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true) AS status',
      old_success_ref,
      old_success_media
    )
  );

  PERFORM pg_temp.orchestration_check(
    'old successful callback replay is acknowledged but does not restore readiness',
    r->>'ok'='true'
    AND r#>>'{rows,0,status}'='succeeded'
    AND NOT private.has_current_alignment_face_check(
      alignment,
      driver,
      clock_timestamp()
    )
  );

  PERFORM pg_temp.orchestration_check(
    'old successful callback replay preserves both attempt records',
    before_old=(
      SELECT to_jsonb(f)
      FROM private.alignment_face_verifications f
      WHERE f.id=old_success_session
    )
    AND before_new=(
      SELECT to_jsonb(f)
      FROM private.alignment_face_verifications f
      WHERE f.id=newer_session
    )
    AND (
      SELECT status='succeeded'
      FROM private.alignment_face_verifications
      WHERE id=old_success_session
    )
    AND (
      SELECT status='pending'
      FROM private.alignment_face_verifications
      WHERE id=newer_session
    )
  );
END;
    ELSIF actor=primary_member THEN
      UPDATE private.alignment_face_verifications SET started_at=now()-interval '20 minutes',expires_at=now()-interval '11 minutes' WHERE id=session_id;
      r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true) AS status',ref,media));
      PERFORM pg_temp.orchestration_check('expired callback cannot verify media',r->>'ok'='true'
        AND r#>>'{rows,0,status}'='expired' AND NOT (SELECT verified FROM public.member_media WHERE id=media));
    ELSE
      r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,false,true) AS status',ref,media));
      PERFORM pg_temp.orchestration_check('failed callback records failure',r->>'ok'='true' AND r#>>'{rows,0,status}'='failed');
      r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,false,true) AS status',ref,media));
      PERFORM pg_temp.orchestration_check('identical failed callback is idempotent',r->>'ok'='true' AND r#>>'{rows,0,status}'='failed');
      PERFORM pg_temp.orchestration_denied('conflicting failed callback denied','service_role',NULL,
        format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,media),'P0001','Callback unavailable');
    END IF;
  END LOOP;
  ref:=gen_random_uuid()::text;
  r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,driver,ref));
  session_id:=(r#>>'{rows,0,session_id}')::uuid;
  r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,driver,gen_random_uuid()::text));
  PERFORM pg_temp.orchestration_denied('superseded callback cannot become successful','service_role',NULL,
    format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,driver_media),'P0001','Callback unavailable');
  PERFORM pg_temp.orchestration_denied('unrecognized reference denied','service_role',NULL,
    format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',gen_random_uuid()::text,driver_media),'P0001','Callback unavailable');
  UPDATE public.alignments SET status='cancelled' WHERE id=alignment;
  PERFORM pg_temp.orchestration_denied('non-awaiting alignment excluded','service_role',NULL,
    format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',need,driver,gen_random_uuid()::text),'P0001','Verification unavailable');
  r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.revoke_current_profile_photo_for_server(%L)',driver));
  r:=pg_temp.orchestration_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true) AS status',driver_ref,driver_media));
  PERFORM pg_temp.orchestration_check('historical duplicate after revocation never restores media verification',r->>'ok'='true'
    AND r#>>'{rows,0,status}'='succeeded' AND NOT (SELECT verified FROM public.member_media WHERE id=driver_media)
    AND NOT (SELECT profile_media_verified FROM public.members WHERE id=driver));
  FOREACH signature IN ARRAY ARRAY['public.start_movement_face_verification_for_server(uuid,uuid,text,text)',
    'public.complete_face_verification_callback_for_server(text,text,uuid,boolean,boolean)'] LOOP
    PERFORM pg_temp.orchestration_check('server-only ACL: '||signature,
      has_function_privilege('service_role',signature,'EXECUTE') AND NOT has_function_privilege('authenticated',signature,'EXECUTE')
      AND NOT has_function_privilege('anon',signature,'EXECUTE'));
  END LOOP;
  PERFORM pg_temp.orchestration_check('raw media and verification remain private',
    NOT has_table_privilege('authenticated','public.member_media','SELECT')
    AND NOT has_table_privilege('authenticated','private.alignment_face_verifications','SELECT'));
END;
$test$;
SELECT pg_temp.orchestration_check('test preserves production function definitions and permissions',
  NOT EXISTS (SELECT 1 FROM pg_temp.orchestration_function_snapshot s JOIN pg_proc p ON p.oid=s.oid
    WHERE s.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid)) OR s.acl IS DISTINCT FROM p.proacl::text));
SELECT test_name,passed FROM pg_temp.orchestration_test_results ORDER BY check_number;
ROLLBACK;
