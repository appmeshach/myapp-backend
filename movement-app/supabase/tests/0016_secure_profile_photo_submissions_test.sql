BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0016.
-- No real users, Storage objects, external providers, or network calls are used.
-- All fixtures, temporary helpers, role/JWT settings and results roll back.
-- This file does not replace functions, disable triggers/RLS, or grant app rights.
-- Uses the same local role/JWT harness as the 0014 rollback test.
-- Pattern: transaction-local SET ROLE + JWT claims, actual RPC calls, named
-- boolean results. Run to the final ROLLBACK even if any result is FALSE.
-- Unexpected fixture/setup errors abort the transaction; issue ROLLBACK if your
-- SQL client stops on error. Do not change ROLLBACK to COMMIT.

CREATE TEMP TABLE face_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE face_function_snapshot ON COMMIT DROP AS
SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS definition_hash,
  p.proacl::text AS acl, p.proconfig::text AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f';

CREATE FUNCTION pg_temp.face_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO pg_temp.face_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness, NOT an application SECURITY DEFINER RPC.
-- Role switching must succeed BEFORE the error-catching subtransaction so a
-- harness permission failure cannot masquerade as an expected app denial.
-- SQL arguments below are fixed test SQL or format('%L', fixture values).
CREATE FUNCTION pg_temp.face_as(p_role text, p_member uuid, p_sql text)
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

CREATE FUNCTION pg_temp.face_denied(
  p_name text, p_role text, p_member uuid, p_sql text,
  p_state text DEFAULT '42501', p_message text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.face_as(p_role, p_member, p_sql);
  PERFORM pg_temp.face_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND (p_message IS NULL OR r->>'message' = p_message));
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.face_check(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.face_as(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.face_denied(text, text, uuid, text, text, text) FROM PUBLIC;


-- DML variant of the same invoker harness; permission errors are distinguished
-- from zero-row RLS updates. Never grants privileges or disables enforcement.
CREATE FUNCTION pg_temp.face_write_as(p_role text,p_member uuid,p_sql text)
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
REVOKE ALL ON FUNCTION pg_temp.face_write_as(text,uuid,text) FROM PUBLIC;

-- Current 0042 offer authorization requires the offerer's own trusted movement
-- intent, trusted route and trusted route-match evidence before an offer exists.
-- Only resolved location rows below are administrator fixtures; movement intake,
-- offering intent, route evidence and route-match evidence use the real RPCs.
CREATE FUNCTION pg_temp.face_trusted_need(
  p_requester uuid,
  p_driver uuid,
  p_label text,
  p_people_count integer
)
RETURNS TABLE (
  need_id uuid,
  match_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  requester_origin uuid := gen_random_uuid();
  requester_destination uuid := gen_random_uuid();
  driver_origin uuid := gen_random_uuid();
  driver_destination uuid := gen_random_uuid();
  intent_id uuid;
  route_id uuid;
  r jsonb;
  t timestamptz := clock_timestamp();
  departure_earliest timestamptz := statement_timestamp() + interval '1 hour';
  departure_latest timestamptz := statement_timestamp() + interval '2 hours';
BEGIN
  INSERT INTO private.movement_location_references(
    id,
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    created_at,
    resolved_at,
    expires_at
  )
  SELECT
    id,
    member_id,
    area,
    'provider_resolved',
    'resolved',
    lat,
    lon,
    'test-provider',
    '0016-' || id::text,
    'test-resolution-v1',
    t,
    t,
    t + interval '4 hours'
  FROM (
    VALUES
      (requester_origin, p_requester, p_label || ' origin', 6.4300, 3.5200),
      (requester_destination, p_requester, p_label || ' destination', 6.4310, 3.4430),
      (driver_origin, p_driver, 'Ajah, Lagos', 6.4698, 3.5852),
      (driver_destination, p_driver, 'Victoria Island, Lagos', 6.4281, 3.4219)
  ) locations(id, member_id, area, lat, lon);

  r := pg_temp.face_as('authenticated', p_requester, format(
    'SELECT * FROM public.create_movement_need(
      %L::uuid,
      %L::uuid,
      %L::uuid,
      %L::timestamptz,
      %L::timestamptz,
      %L::integer
    )',
    gen_random_uuid(),
    requester_origin,
    requester_destination,
    departure_earliest,
    departure_latest,
    p_people_count
  ));

  need_id := (r#>>'{rows,0,movement_need_id}')::uuid;

  IF r->>'ok' IS DISTINCT FROM 'true' OR need_id IS NULL THEN
    RAISE EXCEPTION '0016 % trusted need setup failed: %', p_label, r;
  END IF;

  r := pg_temp.face_as('authenticated', p_driver, format(
    'SELECT * FROM public.create_offering_movement_intent(
      %L::uuid,
      %L::uuid,
      %L::uuid,
      %L::timestamptz,
      %L::timestamptz
    )',
    gen_random_uuid(),
    driver_origin,
    driver_destination,
    departure_earliest,
    departure_latest
  ));

  intent_id := (r#>>'{rows,0,offering_movement_intent_id}')::uuid;

  IF r->>'ok' IS DISTINCT FROM 'true' OR intent_id IS NULL THEN
    RAISE EXCEPTION '0016 % trusted driver intent setup failed: %', p_label, r;
  END IF;

  t := clock_timestamp();

  r := pg_temp.face_as('service_role', NULL, format(
    'SELECT * FROM public.record_offering_route_evidence_for_server(
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
    intent_id,
    '0016-' || intent_id::text,
    '{"type":"LineString","coordinates":[[3.5852,6.4698],[3.5200,6.4300],[3.4900,6.4320],[3.4430,6.4310],[3.4219,6.4281]]}',
    t,
    t + interval '3 hours'
  ));

  route_id := (r#>>'{rows,0,route_evidence_id}')::uuid;

  IF r->>'ok' IS DISTINCT FROM 'true'
    OR route_id IS NULL
    OR r#>>'{rows,0,route_evidence_status}' IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION '0016 % trusted route setup failed: %', p_label, r;
  END IF;

  t := clock_timestamp();

  r := pg_temp.face_as('service_role', NULL, format(
    'SELECT * FROM public.record_trusted_route_match_evidence_for_server(
      %L::uuid,
      %L::uuid,
      %L::uuid,
      1,
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
    need_id,
    intent_id,
    route_id,
    t,
    t + interval '2 hours'
  ));

  match_id := (r#>>'{rows,0,route_match_evidence_id}')::uuid;

  IF r->>'ok' IS DISTINCT FROM 'true'
    OR match_id IS NULL
    OR r#>>'{rows,0,route_match_evidence_status}' IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION '0016 % trusted route-match setup failed: %', p_label, r;
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.face_trusted_need(uuid,uuid,text,integer) FROM PUBLIC;

DO $test$
DECLARE
  driver uuid:=gen_random_uuid(); requester uuid:=gen_random_uuid(); traveller uuid:=gen_random_uuid();
  outsider uuid:=gen_random_uuid(); declined uuid:=gen_random_uuid(); removed uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid();
  need uuid; need2 uuid; need_match uuid; need2_match uuid; vehicle uuid; offer uuid; alignment uuid; alignment2 uuid;
  payment uuid; payment2 uuid; submission uuid; session_id uuid; driver_session uuid;
  actor uuid; media uuid; driver_media uuid; requester_media uuid; replacement uuid; token text;
  audit_before jsonb; audit_after jsonb; audit_session uuid; audit_need uuid; audit_match uuid; audit_alignment uuid;
  expiry_shift interval; attempt_order uuid[];
  r jsonb; s jsonb; role_name text; signature text; cols text[]; expected_message text:='Fresh face verification required for every movement participant';
BEGIN
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT id,'authenticated','authenticated',id::text||'@test-0016.invalid',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
  FROM unnest(ARRAY[driver,requester,traveller,outsider,declined,removed,pending]) ids(id);
  UPDATE public.members SET first_name='FaceTest',identity_verified=true
    WHERE id IN (driver,requester,traveller);

  r:=pg_temp.face_as('authenticated',driver,
    'SELECT * FROM public.register_vehicle_with_plate(''Lexus'',''RX350'',2025,''Blue'',4,''TEST-0016'')');
  vehicle:=(r#>>'{rows,0,vehicle_id}')::uuid;
  IF vehicle IS NULL THEN RAISE EXCEPTION 'Vehicle fixture failed: %',r; END IF;
  SELECT need_id, match_id
  INTO STRICT need, need_match
  FROM pg_temp.face_trusted_need(requester, driver, 'Test', 2);

  INSERT INTO public.movement_participants(movement_need_id,member_id,role,status)
    VALUES (need,traveller,'invited_participant','confirmed'),(need,declined,'invited_participant','declined'),
      (need,removed,'invited_participant','removed'),(need,pending,'invited_participant','invited');

  PERFORM pg_temp.face_denied('0013 excessive vehicle capacity remains blocked','authenticated',driver,
    format(
      'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,5)',
      need,need_match,vehicle
    ),
    'P0001',
    'Seats offered cannot exceed the vehicle seat capacity');

  PERFORM pg_temp.face_denied('0013 undersized group offer remains blocked','authenticated',driver,
    format(
      'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
      need,need_match,vehicle
    ),
    'P0001',
    'Seats offered are fewer than the travellers declared for this movement');

  r:=pg_temp.face_as('authenticated',driver,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,2)',
    need,need_match,vehicle));
  offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;
  IF offer IS NULL THEN RAISE EXCEPTION 'Offer fixture failed: %',r; END IF;
  PERFORM pg_temp.face_denied('0013 pending invitation still blocks acceptance','authenticated',requester,
    format('SELECT * FROM public.accept_movement_offer(%L)',offer),'P0001',
    'Pending traveller invitations must be resolved before accepting an offer');
  UPDATE public.movement_participants SET status='removed' WHERE movement_need_id=need AND member_id=pending;
  r:=pg_temp.face_as('authenticated',requester,format('SELECT * FROM public.accept_movement_offer(%L)',offer));
  alignment:=(r#>>'{rows,0,alignment_id}')::uuid;
  IF alignment IS NULL THEN RAISE EXCEPTION 'Acceptance fixture failed: %',r; END IF;
  PERFORM pg_temp.face_check('normal group acceptance remains available',r->>'ok'='true');
  BEGIN
    UPDATE public.alignments SET member_needing_movement_id=outsider WHERE id=alignment;
    PERFORM pg_temp.face_check('alignment cannot rebind participant after acceptance',false);
  EXCEPTION WHEN raise_exception THEN
    PERFORM pg_temp.face_check('alignment cannot rebind participant after acceptance',
      SQLERRM='Alignment participant and offer bindings are immutable');
  END;
  PERFORM pg_temp.face_check('required set is offering member and exactly confirmed travellers',
    (SELECT count(*)=3 AND bool_and(member_id IN (driver,requester,traveller)) FROM private.required_face_members(alignment)));

  FOREACH actor IN ARRAY ARRAY[outsider,declined,removed,pending] LOOP
    PERFORM pg_temp.face_denied('excluded member cannot start session: '||CASE actor WHEN outsider THEN 'unrelated'
      WHEN declined THEN 'declined' WHEN removed THEN 'removed' ELSE 'unconfirmed invitation removed before acceptance' END,
      'service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L)',
        alignment,actor,gen_random_uuid()::text),'P0001','Face verification unavailable');
    r:=pg_temp.face_as('authenticated',actor,format('SELECT * FROM public.get_my_alignment_face_verification_status(%L)',need));
    PERFORM pg_temp.face_check('excluded member safe status empty: '||actor::text,r->>'ok'='true' AND r->'rows'='[]'::jsonb);
  END LOOP;
  -- Even a reopened need cannot be used to mutate the accepted roster.
  UPDATE public.movement_needs SET status='discoverable' WHERE id=need;
  r:=pg_temp.face_as('authenticated',requester,format('SELECT * FROM public.remove_movement_participant(%L)',
    (SELECT id FROM public.movement_participants WHERE movement_need_id=need AND member_id=traveller)));
  PERFORM pg_temp.face_check('reopening need cannot remove required traveller',r->>'state'='P0001' AND r->>'message'='Accepted movement roster is frozen');
  UPDATE public.movement_needs SET status='closed' WHERE id=need;

  -- Historical/manual media and a legacy pending session are deliberately
  -- injected as administrator fixtures. No success/verification is fabricated.
  INSERT INTO public.member_media(member_id,media_type,storage_path,verified,is_current)
    VALUES (driver,'photo',gen_random_uuid()::text||'/unprepared.png',false,true) RETURNING id INTO media;
  PERFORM pg_temp.face_denied('unprepared current photo cannot start a session','service_role',NULL,
    format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L)',alignment,driver,gen_random_uuid()::text),
    'P0001','Prepared current face photo required');
  INSERT INTO private.alignment_face_verifications(alignment_id,member_id,media_id,provider,provider_reference,started_at,expires_at)
    VALUES (alignment,driver,media,'test',gen_random_uuid()::text,now(),now()+interval '10 minutes') RETURNING id INTO session_id;
  PERFORM pg_temp.face_denied('legacy unprepared session cannot verify media on completion','service_role',NULL,
    format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,media),
    'P0001','Face verification unavailable');
  PERFORM pg_temp.face_check('unprepared completion leaves media and member unverified',
    NOT (SELECT verified FROM public.member_media WHERE id=media)
    AND NOT (SELECT profile_media_verified FROM public.members WHERE id=driver)
    AND (SELECT status='pending' FROM private.alignment_face_verifications WHERE id=session_id));

  FOREACH actor IN ARRAY ARRAY[driver,requester,traveller] LOOP
    r:=pg_temp.face_as('service_role',NULL,format(
      'SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original.png'));
    submission:=(r#>>'{rows,0,id}')::uuid;
    IF submission IS NULL THEN RAISE EXCEPTION 'Submission fixture failed: %',r; END IF;
    PERFORM pg_temp.face_check('submission alone creates no verified media: '||actor::text,
      NOT EXISTS(SELECT 1 FROM public.member_media WHERE member_id=actor AND verified));
    r:=pg_temp.face_as('service_role',NULL,format(
      'SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',submission,gen_random_uuid()::text||'/processed.png'));
    media:=(r#>>'{rows,0,id}')::uuid;
    IF media IS NULL THEN RAISE EXCEPTION 'Prepared media fixture failed: %',r; END IF;
    PERFORM pg_temp.face_check('prepared current photo starts unverified: '||actor::text,
      (SELECT is_current AND NOT verified FROM public.member_media WHERE id=media)
      AND NOT (SELECT profile_media_verified FROM public.members WHERE id=actor));
    IF actor=driver THEN driver_media:=media; END IF;
    IF actor=requester THEN requester_media:=media; END IF;
  END LOOP;

  FOREACH role_name IN ARRAY ARRAY['authenticated','anon'] LOOP
    PERFORM pg_temp.face_denied(role_name||' cannot manufacture successful face result',role_name,driver,
      format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',gen_random_uuid(),driver_media));
    r:=pg_temp.face_write_as(role_name,driver,format('UPDATE public.member_media SET verified=true WHERE id=%L',driver_media));
    PERFORM pg_temp.face_check(role_name||' cannot mark media verified',r->>'state'='42501');
    r:=pg_temp.face_write_as(role_name,driver,format('UPDATE public.members SET profile_media_verified=true WHERE id=%L',driver));
    PERFORM pg_temp.face_check(role_name||' cannot mark profile verified',r->>'state'='42501' OR (r->>'ok'='true' AND r->>'count'='0'));
    PERFORM pg_temp.face_denied(role_name||' cannot read raw media',role_name,driver,'SELECT * FROM public.member_media');
  END LOOP;
  PERFORM pg_temp.face_check('failed client mutations did not verify media',
    NOT (SELECT verified FROM public.member_media WHERE id=driver_media)
    AND NOT (SELECT profile_media_verified FROM public.members WHERE id=driver));

  PERFORM pg_temp.face_denied('payment creation blocked without face checks','service_role',NULL,
    format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',alignment),'P0001',expected_message);
  PERFORM pg_temp.face_check('missing checks create no payment record',
    NOT EXISTS(SELECT 1 FROM private.alignment_activation_payments WHERE alignment_id=alignment));
  r:=pg_temp.face_write_as('service_role',NULL,format(
    'INSERT INTO private.alignment_activation_payments(alignment_id,payer_member_id,amount_minor) VALUES (%L,%L,100)',alignment,driver));
  PERFORM pg_temp.face_check('direct server insertion cannot bypass face gate',r->>'state'='P0001'
    AND NOT EXISTS(SELECT 1 FROM private.alignment_activation_payments WHERE alignment_id=alignment));
  PERFORM pg_temp.face_check('failed initiation leaves fee unset alignment awaiting and no journey',
    (SELECT status='awaiting_activation_payment' AND activated_at IS NULL AND activation_fee_minor IS NULL FROM public.alignments WHERE id=alignment)
    AND NOT EXISTS(SELECT 1 FROM public.journeys WHERE alignment_id=alignment));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.get_alignment_face_readiness_for_server(%L) AS ready',alignment));
  PERFORM pg_temp.face_check('server preflight reports missing checks',r->>'ok'='true' AND r#>>'{rows,0,ready}'='false');

  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment,driver,gen_random_uuid()::text));
  driver_session:=(r#>>'{rows,0,id}')::uuid;
  IF driver_session IS NULL THEN RAISE EXCEPTION 'Session fixture failed: %',r; END IF;
  -- Simulate provenance corruption after legitimate session creation. Restore
  -- only fixture metadata afterward, never bypassing a successful live check.
  UPDATE private.profile_photo_submissions SET status='pending' WHERE media_id=driver_media;
  PERFORM pg_temp.face_denied('completion rechecks ready provenance','service_role',NULL,
    format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',driver_session,driver_media),
    'P0001','Face verification unavailable');
  UPDATE private.profile_photo_submissions SET status='ready',member_id=outsider WHERE media_id=driver_media;
  PERFORM pg_temp.face_denied('completion rejects wrong-member provenance','service_role',NULL,
    format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',driver_session,driver_media),
    'P0001','Face verification unavailable');
  UPDATE private.profile_photo_submissions SET member_id=driver WHERE media_id=driver_media;
  PERFORM pg_temp.face_denied('wrong member media cannot be verified','service_role',NULL,
    format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',driver_session,requester_media),
    'P0001','Face verification unavailable');
  PERFORM pg_temp.face_check('wrong-media attempt did not verify either photo',
    NOT EXISTS(SELECT 1 FROM public.member_media WHERE id IN (driver_media,requester_media) AND verified));
  -- Clock fixtures only: move this real pending session into the past. No
  -- verification flags, trigger or RLS are changed to manufacture success.
  UPDATE private.alignment_face_verifications SET started_at=clock_timestamp()-interval '20 minutes',
    expires_at=clock_timestamp()-interval '11 minutes' WHERE id=driver_session;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',driver_session,driver_media));
  PERFORM pg_temp.face_check('expired live result does not verify profile',r->>'ok'='true'
    AND (SELECT status='expired' FROM private.alignment_face_verifications WHERE id=driver_session)
    AND NOT (SELECT verified FROM public.member_media WHERE id=driver_media));
  PERFORM pg_temp.face_denied('expired session cannot initiate payment','service_role',NULL,
    format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment),'P0001',expected_message);

  FOR i IN 1..2 LOOP
    r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment,driver,gen_random_uuid()::text));
    driver_session:=(r#>>'{rows,0,id}')::uuid;
    r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,%L,%L)',driver_session,driver_media,i<>1,i<>2));
    PERFORM pg_temp.face_check(CASE i WHEN 1 THEN 'liveness failure' ELSE 'face-match failure' END||' records failure without verifying media',
      r->>'ok'='true' AND (SELECT status='failed' FROM private.alignment_face_verifications WHERE id=driver_session)
      AND NOT (SELECT verified FROM public.member_media WHERE id=driver_media));
    PERFORM pg_temp.face_denied(CASE i WHEN 1 THEN 'liveness failure' ELSE 'face-match failure' END||' cannot initiate payment','service_role',NULL,
      format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment),'P0001',expected_message);
    PERFORM pg_temp.face_denied('failed session cannot be resurrected '||i,'service_role',NULL,
      format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',driver_session,driver_media),
      'P0001','Face verification is not pending');
  END LOOP;

  FOREACH actor IN ARRAY ARRAY[driver,requester,traveller] LOOP
    SELECT id INTO media FROM public.member_media WHERE member_id=actor AND media_type='photo' AND is_current;
    r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment,actor,gen_random_uuid()::text));
    session_id:=(r#>>'{rows,0,id}')::uuid;
    IF session_id IS NULL THEN RAISE EXCEPTION 'Successful session fixture failed: %',r; END IF;
    IF actor=driver THEN driver_session:=session_id; END IF;
    r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,media));
    PERFORM pg_temp.face_check('successful first live check verifies exact current photo: '||actor::text,
      r->>'ok'='true' AND (SELECT verified AND is_current FROM public.member_media WHERE id=media)
      AND (SELECT profile_media_verified AND identity_verified FROM public.members WHERE id=actor));
    IF actor=requester THEN
      PERFORM pg_temp.face_denied('missing confirmed invited traveller blocks payment creation','service_role',NULL,
        format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment),'P0001',expected_message);
      PERFORM pg_temp.face_check('partial group success still creates no payment',
        NOT EXISTS(SELECT 1 FROM private.alignment_activation_payments WHERE alignment_id=alignment));
    END IF;
  END LOOP;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',driver_session,driver_media));
  PERFORM pg_temp.face_check('identical successful callback retry is idempotent',r->>'ok'='true');
  PERFORM pg_temp.face_check('live verification preserves ready provenance for reuse',
    (SELECT status='ready' AND member_id=driver AND processed_at IS NOT NULL
      FROM private.profile_photo_submissions WHERE media_id=driver_media));
  r:=pg_temp.face_as('authenticated',driver,format('SELECT * FROM public.get_my_alignment_face_verification_status(%L)',need));
  SELECT array_agg(k ORDER BY k) INTO cols FROM jsonb_object_keys(r#>'{rows,0}') k;
  PERFORM pg_temp.face_check('own face status contains only safe fields',r->>'ok'='true' AND cols=ARRAY['completed_at','expires_at','ready_for_activation','status']);
  PERFORM pg_temp.face_check('own status indicates readiness',r#>>'{rows,0,ready_for_activation}'='true');
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.get_alignment_face_readiness_for_server(%L) AS ready',alignment));
  PERFORM pg_temp.face_check('server preflight reports complete group checks',r->>'ok'='true' AND r#>>'{rows,0,ready}'='true');
  r:=pg_temp.face_as('authenticated',driver,'SELECT * FROM public.get_my_profile_photo_submission_status()');
  SELECT array_agg(k ORDER BY k) INTO cols FROM jsonb_object_keys(r#>'{rows,0}') k;
  PERFORM pg_temp.face_check('own submission status contains only safe fields',r->>'ok'='true' AND cols=ARRAY['current_photo_verified','processed_at','status','submitted_at']);
  r:=pg_temp.face_as('authenticated',outsider,'SELECT * FROM public.get_my_profile_photo_submission_status()');
  PERFORM pg_temp.face_check('own submission status does not expose other members',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',alignment));
  payment:=(r#>>'{rows,0,payment_id}')::uuid;
  IF payment IS NULL THEN RAISE EXCEPTION 'Verified payment fixture failed: %',r; END IF;
  PERFORM pg_temp.face_check('all required checks allow payment creation',r->>'ok'='true'
    AND (SELECT status='pending' FROM private.alignment_activation_payments WHERE id=payment));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,200,''NGN'',''retry'')',alignment));
  PERFORM pg_temp.face_check('valid initiation retry returns same payment and original amount',r->>'ok'='true'
    AND (r#>>'{rows,0,payment_id}')::uuid=payment AND r#>>'{rows,0,amount_minor}'='100'
    AND (SELECT count(*)=1 FROM private.alignment_activation_payments WHERE alignment_id=alignment));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,''test-capture'')',payment));
  PERFORM pg_temp.face_check('all required face checks permit paid activation',r->>'ok'='true' AND r#>>'{rows,0,alignment_status}'='activated');
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,''test-capture'')',payment));
  PERFORM pg_temp.face_check('payment retry creates exactly one journey',r->>'ok'='true' AND (SELECT count(*)=1 FROM public.journeys WHERE alignment_id=alignment));

  r:=pg_temp.face_as('authenticated',requester,format('SELECT * FROM public.get_post_activation_people(%L)',need));
  token:=r#>>'{rows,0,profile_photo_token}';
  PERFORM pg_temp.face_check('existing 0014 reveal issues photo token after activation',r->>'ok'='true' AND token IS NOT NULL AND r#>>'{rows,0,verified}'='true');
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.resolve_post_activation_photo_for_server(%L,%L)',token,requester));
  PERFORM pg_temp.face_check('0014 server resolver works for newly verified photo',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1);

  SELECT need_id, match_id
  INTO STRICT need2, need2_match
  FROM pg_temp.face_trusted_need(requester, driver, 'Next', 1);

  r:=pg_temp.face_as('authenticated',driver,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
    need2,need2_match,vehicle));

  offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;

  IF offer IS NULL THEN
    RAISE EXCEPTION 'Later movement offer fixture failed: %',r;
  END IF;

  r:=pg_temp.face_as('authenticated',requester,format(
    'SELECT * FROM public.accept_movement_offer(%L::uuid)',offer));

  alignment2:=(r#>>'{rows,0,alignment_id}')::uuid;

  IF alignment2 IS NULL THEN
    RAISE EXCEPTION 'Later movement fixture failed: %',r;
  END IF;
  PERFORM pg_temp.face_denied('verified profiles and earlier alignment checks cannot initiate later payment','service_role',NULL,
    format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment2),'P0001',expected_message);
  PERFORM pg_temp.face_check('later movement needs new checks before any payment row',
    NOT EXISTS(SELECT 1 FROM private.alignment_activation_payments WHERE alignment_id=alignment2));

  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment2,driver,gen_random_uuid()::text));
  session_id:=(r#>>'{rows,0,id}')::uuid;
  PERFORM pg_temp.face_check('later alignment binds same verified prepared photo without upload',r->>'ok'='true'
    AND (SELECT media_id=driver_media FROM private.alignment_face_verifications WHERE id=session_id)
    AND (SELECT verified AND is_current FROM public.member_media WHERE id=driver_media));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,driver_media));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Audit success fixture failed: %',r; END IF;
  audit_session:=session_id;
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) INTO audit_before
    FROM private.alignment_face_verifications f WHERE f.member_id=driver AND f.status='succeeded';
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment2,driver,gen_random_uuid()::text));
  session_id:=(r#>>'{rows,0,id}')::uuid;
  PERFORM pg_temp.face_check('new attempt retains success but disables its authorization',r->>'ok'='true'
    AND (SELECT status='succeeded' FROM private.alignment_face_verifications WHERE id=audit_session)
    AND NOT private.has_current_alignment_face_check(alignment2,driver,clock_timestamp()));
  UPDATE public.member_media SET is_current=false WHERE id=driver_media;
  INSERT INTO public.member_media(member_id,media_type,storage_path,verified,is_current)
    VALUES (driver,'photo',gen_random_uuid()::text||'/unprepared-replacement.png',false,true);
  PERFORM pg_temp.face_denied('unprepared replacement cannot start fresh verification','service_role',NULL,
    format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L)',alignment2,driver,gen_random_uuid()::text),
    'P0001','Prepared current face photo required');
  PERFORM pg_temp.face_denied('replacement cannot reuse old exact-media session','service_role',NULL,
    format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,driver_media),
    'P0001','Face verification unavailable');
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',driver,gen_random_uuid()::text||'/new-original.png'));
  submission:=(r#>>'{rows,0,id}')::uuid;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',submission,gen_random_uuid()::text||'/replacement.png'));
  replacement:=(r#>>'{rows,0,id}')::uuid;
  PERFORM pg_temp.face_check('replacement does not inherit verification',r->>'ok'='true'
    AND (SELECT is_current AND NOT verified FROM public.member_media WHERE id=replacement)
    AND NOT (SELECT profile_media_verified FROM public.members WHERE id=driver));
  PERFORM pg_temp.face_check('replacement retires old current photo',NOT (SELECT is_current FROM public.member_media WHERE id=driver_media));
  PERFORM pg_temp.face_check('replacement invalidates outstanding session',
    (SELECT status='superseded' FROM private.alignment_face_verifications WHERE id=session_id));
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) INTO audit_after
    FROM private.alignment_face_verifications f WHERE f.member_id=driver AND f.status='succeeded';
  PERFORM pg_temp.face_check('replacement preserves full activated and awaiting successful audit rows',
    audit_before IS NOT NULL AND audit_before=audit_after);
  PERFORM pg_temp.face_check('historical success remains but old media cannot authorize after replacement',
    (SELECT status='succeeded' AND media_id=driver_media FROM private.alignment_face_verifications WHERE id=audit_session)
    AND NOT (SELECT is_current FROM public.member_media WHERE id=driver_media)
    AND NOT private.has_current_alignment_face_check(alignment2,driver,clock_timestamp()));
  PERFORM pg_temp.face_denied('replacement requires new verification before payment','service_role',NULL,
    format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment2),'P0001',expected_message);
  PERFORM pg_temp.face_denied('stale callback cannot verify replacement','service_role',NULL,
    format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,driver_media),'P0001','Face verification unavailable');
  PERFORM pg_temp.face_check('replacement deletes stale reveal tokens',NOT EXISTS(SELECT 1 FROM private.post_activation_photo_tokens pt WHERE pt.subject_member_id=driver));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.resolve_post_activation_photo_for_server(%L,%L)',token,requester));
  PERFORM pg_temp.face_check('old photo token no longer resolves',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
  BEGIN
    INSERT INTO public.member_media(member_id,media_type,storage_path,verified,is_current) VALUES (driver,'photo','duplicate-test.png',false,true);
    PERFORM pg_temp.face_check('unique index prevents two current photos',false);
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.face_check('unique index prevents two current photos',true);
  END;
  PERFORM pg_temp.face_check('exactly one current photo survives replacement',
    (SELECT count(*)=1 FROM public.member_media WHERE member_id=driver AND media_type='photo' AND is_current));

  -- A new live check is required against the replacement, and both members
  -- need fresh sessions for the later alignment even with persistent verification.
  FOREACH actor IN ARRAY ARRAY[driver,requester] LOOP
    SELECT id INTO media FROM public.member_media WHERE member_id=actor AND media_type='photo' AND is_current;
    r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment2,actor,gen_random_uuid()::text));
    session_id:=(r#>>'{rows,0,id}')::uuid;
    IF actor=driver THEN driver_session:=session_id; END IF;
    r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,media));
    PERFORM pg_temp.face_check('fresh later movement check succeeds: '||actor::text,r->>'ok'='true');
  END LOOP;
  PERFORM pg_temp.face_check('replacement becomes verified only after its own live check',
    (SELECT verified AND is_current FROM public.member_media WHERE id=replacement));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment2));
  payment2:=(r#>>'{rows,0,payment_id}')::uuid;
  IF payment2 IS NULL THEN RAISE EXCEPTION 'Later verified payment fixture failed: %',r; END IF;
  PERFORM pg_temp.face_check('later payment created while all checks are valid',r->>'ok'='true');
  -- Translate the ENTIRE member/alignment timeline by one interval. Backdating
  -- only driver_session would promote a preserved older attempt to latest.
  -- Preserve ordering, duration constraints, results and all non-clock evidence.
  SELECT array_agg(id ORDER BY started_at DESC,id DESC),
    max(expires_at)-clock_timestamp()+interval '1 minute'
    INTO attempt_order,expiry_shift FROM private.alignment_face_verifications
    WHERE alignment_id=alignment2 AND member_id=driver;
  IF attempt_order[1] IS DISTINCT FROM driver_session THEN
    RAISE EXCEPTION 'Expiry fixture must start with the intended latest attempt';
  END IF;
  SELECT jsonb_agg(to_jsonb(f)-'started_at'-'completed_at'-'expires_at' ORDER BY f.id)
    INTO audit_before FROM private.alignment_face_verifications f
    WHERE f.alignment_id=alignment2 AND f.member_id=driver;
  UPDATE private.alignment_face_verifications SET
    started_at=started_at-expiry_shift, completed_at=completed_at-expiry_shift,
    expires_at=expires_at-expiry_shift WHERE alignment_id=alignment2 AND member_id=driver;
  PERFORM pg_temp.face_check('expiry fixture preserves complete attempt ordering',
    attempt_order=(SELECT array_agg(id ORDER BY started_at DESC,id DESC)
      FROM private.alignment_face_verifications WHERE alignment_id=alignment2 AND member_id=driver));
  SELECT jsonb_agg(to_jsonb(f)-'started_at'-'completed_at'-'expires_at' ORDER BY f.id)
    INTO audit_after FROM private.alignment_face_verifications f
    WHERE f.alignment_id=alignment2 AND f.member_id=driver;
  PERFORM pg_temp.face_check('expiry fixture preserves results and non-clock audit evidence',audit_before=audit_after);
  PERFORM pg_temp.face_check('latest success is expired and cannot authorize',
    (SELECT status='succeeded' AND expires_at<clock_timestamp() FROM private.alignment_face_verifications WHERE id=driver_session)
    AND NOT private.has_current_alignment_face_check(alignment2,driver,clock_timestamp()));
  PERFORM pg_temp.face_denied('expired checks block reuse of existing pending payment','service_role',NULL,
    format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',alignment2),'P0001',expected_message);
  PERFORM pg_temp.face_denied('successful but expired result cannot activate','service_role',NULL,
    format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,''must-roll-back'')',payment2),'P0001',expected_message);
  PERFORM pg_temp.face_check('expiry after initiation rolls back payment success and provider reference',
    (SELECT status='pending' AND succeeded_at IS NULL AND provider_reference IS NULL FROM private.alignment_activation_payments WHERE id=payment2));
  PERFORM pg_temp.face_check('expiry after initiation rolls back activation and creates no journey',
    (SELECT status='awaiting_activation_payment' AND activated_at IS NULL FROM public.alignments WHERE id=alignment2)
    AND NOT EXISTS(SELECT 1 FROM public.journeys WHERE alignment_id=alignment2));
  r:=pg_temp.face_as('authenticated',driver,format('SELECT * FROM public.get_my_alignment_face_verification_status(%L)',need2));
  PERFORM pg_temp.face_check('safe status reports expired success as not ready',r->>'ok'='true'
    AND r#>>'{rows,0,status}'='expired' AND r#>>'{rows,0,ready_for_activation}'='false');
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment2,driver,gen_random_uuid()::text));
  session_id:=(r#>>'{rows,0,id}')::uuid;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,replacement));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Fresh retry fixture failed: %',r; END IF;
  -- A still-valid success cannot authorize once a newer pending/failed attempt
  -- exists. Exercise actual RPCs, preserving the older full successful record.
  audit_session:=session_id;
  SELECT to_jsonb(f) INTO audit_before FROM private.alignment_face_verifications f WHERE id=audit_session;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment2,driver,gen_random_uuid()::text));
  session_id:=(r#>>'{rows,0,id}')::uuid;
  IF session_id IS NULL THEN RAISE EXCEPTION 'New pending fixture failed: %',r; END IF;
  r:=pg_temp.face_as('authenticated',driver,format('SELECT * FROM public.get_my_alignment_face_verification_status(%L)',need2));
  PERFORM pg_temp.face_check('new pending status and readiness agree and block older valid success',
    r->>'ok'='true' AND r#>>'{rows,0,status}'='pending' AND r#>>'{rows,0,ready_for_activation}'='false'
    AND NOT private.has_current_alignment_face_check(alignment2,driver,clock_timestamp()));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,false,true)',session_id,replacement));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Failed attempt fixture failed: %',r; END IF;
  r:=pg_temp.face_as('authenticated',driver,format('SELECT * FROM public.get_my_alignment_face_verification_status(%L)',need2));
  PERFORM pg_temp.face_check('new failed status and readiness agree and block older valid success',
    r->>'ok'='true' AND r#>>'{rows,0,status}'='failed' AND r#>>'{rows,0,ready_for_activation}'='false'
    AND NOT private.has_current_alignment_face_check(alignment2,driver,clock_timestamp()));
  PERFORM pg_temp.face_check('new pending and failed attempts preserve older full successful row',
    audit_before=(SELECT to_jsonb(f) FROM private.alignment_face_verifications f WHERE id=audit_session));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',alignment2,driver,gen_random_uuid()::text));
  session_id:=(r#>>'{rows,0,id}')::uuid;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',session_id,replacement));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Final successful fixture failed: %',r; END IF;
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L)',payment2));
  PERFORM pg_temp.face_check('fresh replacement check allows later activation',r->>'ok'='true'
    AND (SELECT count(*)=1 FROM public.journeys WHERE alignment_id=alignment2));
  r:=pg_temp.face_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L)',payment2));
  PERFORM pg_temp.face_check('retry after recovered activation still creates exactly one journey',r->>'ok'='true'
    AND (SELECT count(*)=1 FROM public.journeys WHERE alignment_id=alignment2)
    AND (SELECT count(*)=1 FROM private.alignment_activation_payments WHERE alignment_id=alignment2 AND status='succeeded'));
  -- Add an awaiting movement with real successful and pending sessions before
  -- revocation, alongside the already-activated movement evidence above.
  SELECT need_id, match_id
  INTO STRICT audit_need, audit_match
  FROM pg_temp.face_trusted_need(requester, driver, 'Audit', 1);

  r:=pg_temp.face_as('authenticated',driver,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
    audit_need,audit_match,vehicle));

  offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;

  IF offer IS NULL THEN
    RAISE EXCEPTION 'Revocation audit offer fixture failed: %',r;
  END IF;

  r:=pg_temp.face_as('authenticated',requester,format(
    'SELECT * FROM public.accept_movement_offer(%L::uuid)',offer));

  audit_alignment:=(r#>>'{rows,0,alignment_id}')::uuid;

  IF audit_alignment IS NULL THEN
    RAISE EXCEPTION 'Revocation audit alignment fixture failed: %',r;
  END IF;

  r:=pg_temp.face_as('service_role',NULL,format(
    'SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',
    audit_alignment,driver,gen_random_uuid()::text));

  audit_session:=(r#>>'{rows,0,id}')::uuid;

  IF audit_session IS NULL THEN
    RAISE EXCEPTION 'Revocation audit session fixture failed: %',r;
  END IF;

  r:=pg_temp.face_as('service_role',NULL,format(
    'SELECT public.complete_alignment_face_verification_for_server(%L,%L,true,true)',
    audit_session,replacement));

  IF r->>'ok'<>'true' THEN
    RAISE EXCEPTION 'Revocation audit fixture failed: %',r;
  END IF;
  PERFORM pg_temp.face_check('awaiting success authorizes own readiness before revocation',
    private.has_current_alignment_face_check(audit_alignment,driver,clock_timestamp()));
  -- Another member's pending session on this movement is not affected.
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',audit_alignment,requester,gen_random_uuid()::text));
  session_id:=(r#>>'{rows,0,id}')::uuid;
  -- Driver's pending attempt on the original awaiting alignment is unnecessary:
  -- create a new attempt here while preserving the successful audit record.
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test'',%L) AS id',audit_alignment,driver,gen_random_uuid()::text));
  driver_session:=(r#>>'{rows,0,id}')::uuid;
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) INTO audit_before
    FROM private.alignment_face_verifications f WHERE f.member_id=driver AND f.status='succeeded';
  r:=pg_temp.face_as('service_role',NULL,format('SELECT public.revoke_current_profile_photo_for_server(%L)',driver));
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) INTO audit_after
    FROM private.alignment_face_verifications f WHERE f.member_id=driver AND f.status='succeeded';
  PERFORM pg_temp.face_check('revocation preserves all successful evidence including full media results timestamps provider references',
    r->>'ok'='true' AND audit_before IS NOT NULL AND audit_before=audit_after);
  PERFORM pg_temp.face_check('revocation supersedes own pending sessions only',
    (SELECT status='superseded' FROM private.alignment_face_verifications WHERE id=driver_session)
    AND (SELECT status='pending' FROM private.alignment_face_verifications WHERE id=session_id));
  PERFORM pg_temp.face_check('revoked successful media cannot authorize awaiting activation',
    (SELECT status='succeeded' AND media_id=replacement FROM private.alignment_face_verifications WHERE id=audit_session)
    AND NOT private.has_current_alignment_face_check(audit_alignment,driver,clock_timestamp()));
  PERFORM pg_temp.face_denied('revocation blocks future payment creation','service_role',NULL,
    format('SELECT * FROM public.create_alignment_activation_payment(%L,100)',audit_alignment),'P0001',expected_message);
  PERFORM pg_temp.face_check('revocation clears current photo and persistent verification',r->>'ok'='true'
    AND NOT EXISTS(SELECT 1 FROM public.member_media WHERE member_id=driver AND is_current AND media_type='photo')
    AND NOT (SELECT profile_media_verified FROM public.members WHERE id=driver));

  FOREACH signature IN ARRAY ARRAY[
    'public.create_profile_photo_submission_for_server(uuid,text,text,bigint)',
    'public.prepare_profile_photo_submission_for_server(uuid,text)',
    'public.fail_profile_photo_submission_for_server(uuid)',
    'public.start_alignment_face_verification_for_server(uuid,uuid,text,text)',
    'public.complete_alignment_face_verification_for_server(uuid,uuid,boolean,boolean)',
    'public.revoke_current_profile_photo_for_server(uuid)',
    'public.get_alignment_face_readiness_for_server(uuid)',
    'public.create_alignment_activation_payment(uuid,bigint,text,text)',
    'public.mark_alignment_activation_payment_succeeded(uuid,text)',
    'public.resolve_post_activation_photo_for_server(text,uuid)'
  ] LOOP
    PERFORM pg_temp.face_check('server-only permissions: '||signature,
      NOT has_function_privilege('authenticated',signature,'EXECUTE')
      AND NOT has_function_privilege('anon',signature,'EXECUTE')
      AND has_function_privilege('service_role',signature,'EXECUTE'));
  END LOOP;
  PERFORM pg_temp.face_check('0013 raw UUID invitation remains revoked',
    NOT has_function_privilege('authenticated','public.invite_movement_participant(uuid,uuid)','EXECUTE'));
  PERFORM pg_temp.face_check('0012 raw journeys and one-sided completion remain blocked',
    NOT has_table_privilege('authenticated','public.journeys','SELECT')
    AND NOT has_function_privilege('authenticated','public.confirm_journey_completion(uuid)','EXECUTE'));
  PERFORM pg_temp.face_check('0014 ordinary vehicles still hide plate',
    NOT has_column_privilege('authenticated','public.vehicles','plate_number','SELECT'));
  PERFORM pg_temp.face_check('both photo buckets remain private',
    (SELECT count(*)=2 AND bool_and(NOT public) FROM storage.buckets WHERE id IN ('profile-photo-submissions','verified-profile-photos')));
  PERFORM pg_temp.face_check('both photo buckets retain restrictive client policies',
    (SELECT count(*)=4 AND bool_and(NOT p.polpermissive) FROM pg_policy p WHERE p.polname IN (
      'profile_photo_submissions_no_direct_client_objects','profile_photo_submissions_no_direct_client_bucket',
      'verified_profile_photos_no_direct_client_objects','verified_profile_photos_no_direct_client_bucket')));
  PERFORM pg_temp.face_check('private verification tables unavailable to clients',
    NOT has_table_privilege('authenticated','private.alignment_face_verifications','SELECT')
    AND NOT has_table_privilege('anon','private.profile_photo_submissions','SELECT'));
END;
$test$;

SELECT pg_temp.face_check('test did not replace functions or change permissions',
  NOT EXISTS (SELECT 1 FROM pg_temp.face_function_snapshot s JOIN pg_proc p ON p.oid=s.oid
    WHERE s.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
      OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text));
SELECT test_name,passed FROM pg_temp.face_test_results ORDER BY check_number;
ROLLBACK;
