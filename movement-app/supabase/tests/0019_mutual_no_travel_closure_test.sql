BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0019.
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
  driver uuid; primary_member uuid; traveller uuid; declined uuid; removed uuid; invited uuid; outsider uuid;
  need uuid; alignment uuid; vehicle uuid; offer uuid;
  actor uuid; sub uuid; media uuid; ref text; payment uuid; journey uuid; r jsonb;
  scenario integer; label text; old_payment jsonb; old_activation timestamptz;
  old_request timestamptz; consent timestamptz; audit_before jsonb; rejected boolean; signature text; payment_gate_ok boolean;
  old_roster jsonb; old_face_history jsonb;
BEGIN
 FOR scenario IN 1..4 LOOP
  label:='scenario '||scenario||' ';
  driver:=gen_random_uuid(); primary_member:=gen_random_uuid(); traveller:=gen_random_uuid();
  declined:=gen_random_uuid(); removed:=gen_random_uuid(); invited:=gen_random_uuid(); outsider:=gen_random_uuid();
  need:=gen_random_uuid(); alignment:=gen_random_uuid(); vehicle:=gen_random_uuid(); offer:=gen_random_uuid();
  old_request:=NULL;
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0019.invalid','{}'::jsonb,'{}'::jsonb,now(),now()
    FROM unnest(ARRAY[driver,primary_member,traveller,declined,removed,invited,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Lexus','Blue',4,'TEST-0019');
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
  -- Deliberately inconsistent administrator fixture: a not-started journey
  -- exists before payment. No production function/trigger is replaced.
  INSERT INTO public.journeys(alignment_id,vehicle_id) VALUES(alignment,vehicle) RETURNING id INTO journey;
  PERFORM pg_temp.meeting_denied(label||'preactivation request denied','authenticated',driver,
    format('SELECT * FROM public.request_movement_end(%L)',journey),'P0001','Movement is not in a state that allows mutual ending');
  UPDATE public.journeys SET end_requested_by_member_id=driver,end_requested_at=now() WHERE id=journey;
  PERFORM pg_temp.meeting_denied(label||'preactivation confirmation denied','authenticated',primary_member,
    format('SELECT * FROM public.confirm_movement_end(%L)',journey),'P0001','Movement is not in a state that allows mutual ending');
  PERFORM pg_temp.meeting_check(label||'preactivation produces no closure or settlement',
    NOT EXISTS(SELECT 1 FROM private.mutual_no_travel_closures WHERE journey_id=journey)
    AND NOT EXISTS(SELECT 1 FROM private.movement_settlements WHERE journey_id=journey));
  DELETE FROM public.journeys WHERE id=journey;

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

  SELECT to_jsonb(p) INTO STRICT old_payment FROM private.alignment_activation_payments p WHERE p.id=payment;
  SELECT activated_at INTO old_activation FROM public.alignments WHERE id=alignment;
  SELECT jsonb_agg(to_jsonb(mp) ORDER BY mp.id) INTO old_roster
    FROM public.movement_participants mp WHERE mp.movement_need_id=need;
  SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) INTO old_face_history
    FROM private.alignment_face_verifications f WHERE f.alignment_id=alignment;
  -- Decline is not consent, completion, or cancellation.
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.request_movement_end(%L)',journey));
  PERFORM pg_temp.meeting_check(label||'first End succeeds pending',r->>'ok'='true' AND r#>>'{rows,0,end_status}'='awaiting_other_member');
  PERFORM pg_temp.meeting_check(label||'first End leaves lifecycle active',(SELECT status='not_started' AND started_at IS NULL AND completed_at IS NULL FROM public.journeys WHERE id=journey) AND (SELECT status='activated' FROM public.alignments WHERE id=alignment));
  r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.decline_movement_end(%L)',journey));
  PERFORM pg_temp.meeting_check(label||'decline clears only pending intent',r->>'ok'='true' AND (SELECT status='not_started' AND end_requested_at IS NULL FROM public.journeys WHERE id=journey));
  PERFORM pg_temp.meeting_check(label||'decline creates neither closure nor settlement',NOT EXISTS(SELECT 1 FROM private.mutual_no_travel_closures WHERE journey_id=journey) AND NOT EXISTS(SELECT 1 FROM private.movement_settlements WHERE journey_id=journey));
  FOREACH actor IN ARRAY ARRAY[traveller,outsider,declined,removed,invited] LOOP
   PERFORM pg_temp.meeting_denied(label||'nonprincipal request denied '||actor,'authenticated',actor,format('SELECT * FROM public.request_movement_end(%L)',journey),'P0001','Only principal movement members may end the movement');
   PERFORM pg_temp.meeting_denied(label||'nonprincipal confirm denied '||actor,'authenticated',actor,format('SELECT * FROM public.confirm_movement_end(%L)',journey),'P0001','Only principal movement members may confirm movement end');
   PERFORM pg_temp.meeting_denied(label||'nonprincipal decline denied '||actor,'authenticated',actor,format('SELECT * FROM public.decline_movement_end(%L)',journey),'P0001','Only principal movement members may decline movement end');
  END LOOP;
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.request_movement_end(%L)',journey));
  SELECT end_requested_at INTO consent FROM public.journeys WHERE id=journey;
  r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.request_movement_end(%L)',journey));
  PERFORM pg_temp.meeting_check(label||'same principal retry stays pending',r->>'ok'='true' AND r#>>'{rows,0,end_status}'='awaiting_other_member' AND (SELECT end_requested_at=consent AND end_confirmed_at IS NULL FROM public.journeys WHERE id=journey));
  PERFORM pg_temp.meeting_denied(label||'cannot confirm own consent','authenticated',driver,format('SELECT * FROM public.confirm_movement_end(%L)',journey),'P0001','You cannot confirm your own end request');
  IF scenario>=2 THEN
   r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Bus stop'',NULL)',need));
   IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Meeting fixture failed: %',r; END IF;
   r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.request_my_movement_start(%L)',need));
   IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Start fixture failed: %',r; END IF;
   SELECT start_requested_at INTO old_request FROM public.journeys WHERE id=journey;
   PERFORM pg_temp.meeting_check(label||'pending start is not actual start',old_request IS NOT NULL AND (SELECT status='not_started' AND started_at IS NULL FROM public.journeys WHERE id=journey));
  END IF;
  IF scenario>=3 THEN
   -- Start wins the serial ordering, including when an End intent already exists.
   r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.confirm_my_movement_start(%L)',need));
   PERFORM pg_temp.meeting_check(label||'start wins before second consent',r->>'ok'='true' AND (SELECT status='in_progress' AND started_at IS NOT NULL FROM public.journeys WHERE id=journey) AND (SELECT status='in_progress' FROM public.alignments WHERE id=alignment));
  END IF;
  IF scenario<=2 THEN
   -- Invalid evidence exists only within this deliberately rolled-back fixture
   -- subtransaction. PL/pgSQL variables retain the observation after rollback.
   payment_gate_ok:=false;
   BEGIN
    UPDATE private.alignment_activation_payments SET status='failed' WHERE id=payment;
    IF scenario=1 THEN
     r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.request_movement_end(%L)',journey));
    ELSE
     r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.confirm_movement_end(%L)',journey));
    END IF;
    payment_gate_ok:=r->>'ok'='false' AND r->>'state'='P0001' AND r->>'message'='Successful activation payment required'
      AND NOT EXISTS(SELECT 1 FROM private.mutual_no_travel_closures WHERE journey_id=journey)
      AND (SELECT status='not_started' FROM public.journeys WHERE id=journey);
    RAISE EXCEPTION USING ERRCODE='ZX019',MESSAGE='rollback invalid payment fixture';
   EXCEPTION WHEN SQLSTATE 'ZX019' THEN NULL;
   END;
   PERFORM pg_temp.meeting_check(label||'no-travel requires succeeded payment evidence',payment_gate_ok);
  END IF;
  IF scenario IN (1,4) THEN
   r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.request_movement_end(%L)',journey));
  ELSE
   r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.confirm_movement_end(%L)',journey));
  END IF;
  PERFORM pg_temp.meeting_check(label||'second consent RPC succeeds',r->>'ok'='true');
  IF scenario<=2 THEN
   PERFORM pg_temp.meeting_check(label||'legacy RPC returns no travel',r#>>'{rows,0,end_status}'='mutual_no_travel');
   PERFORM pg_temp.meeting_check(label||'journey cancelled without fabricated times',(SELECT status='cancelled' AND started_at IS NULL AND completed_at IS NULL FROM public.journeys WHERE id=journey));
   PERFORM pg_temp.meeting_check(label||'alignment cancelled',(SELECT status='cancelled' FROM public.alignments WHERE id=alignment));
   PERFORM pg_temp.meeting_check(label||'no normal settlement',NOT EXISTS(SELECT 1 FROM private.movement_settlements WHERE journey_id=journey OR alignment_id=alignment));
   PERFORM pg_temp.meeting_check(label||'exactly one audit row',(SELECT count(*)=1 FROM private.mutual_no_travel_closures WHERE journey_id=journey));
   SELECT to_jsonb(c) INTO STRICT audit_before FROM private.mutual_no_travel_closures c WHERE c.journey_id=journey;
   PERFORM pg_temp.meeting_check(label||'consents and invalidated start preserved',(SELECT first_principal_id=driver AND second_principal_id=primary_member AND first_consented_at=consent AND closed_at>=consent AND invalidated_start_requested_at IS NOT DISTINCT FROM old_request AND reason='mutual_no_travel_after_activation' FROM private.mutual_no_travel_closures WHERE journey_id=journey));
   PERFORM pg_temp.meeting_check(label||'pending start cleared',(SELECT start_requested_at IS NULL FROM public.journeys WHERE id=journey));
   r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',need));
   PERFORM pg_temp.meeting_check(label||'cancelled coordination exposes no start capability',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
   PERFORM pg_temp.meeting_denied(label||'cancelled cannot create payment','service_role',NULL,
     format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',alignment),'P0001','Alignment is not awaiting activation payment');
   PERFORM pg_temp.meeting_denied(label||'payment replay cannot reactivate','service_role',NULL,
     format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L)',payment),'P0001','Payment is not pending');
   PERFORM pg_temp.meeting_denied(label||'legacy start cannot reopen','authenticated',primary_member,format('SELECT * FROM public.confirm_journey_start(%L)',journey),'P0001','Journey is not in not_started state');
   PERFORM pg_temp.meeting_denied(label||'movement start cannot reopen','authenticated',primary_member,format('SELECT * FROM public.confirm_my_movement_start(%L)',need));
   PERFORM pg_temp.meeting_denied(label||'terminal decline rejected','authenticated',primary_member,format('SELECT * FROM public.decline_movement_end(%L)',journey),'P0001','Movement is already terminal');
   r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.get_post_activation_people(%L)',need));
   PERFORM pg_temp.meeting_check(label||'person reveal stays closed',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
   r:=pg_temp.meeting_as('authenticated',primary_member,format('SELECT * FROM public.get_post_activation_vehicle(%L)',need));
   PERFORM pg_temp.meeting_check(label||'plate reveal stays closed',r->>'ok'='true' AND r->'rows'='[]'::jsonb);
   -- Administrative invalid transition still cannot rewrite terminal history.
   rejected:=false;
   BEGIN UPDATE public.journeys SET status='in_progress',started_at=now() WHERE id=journey;
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Mutual no-travel closure is terminal'; END;
   PERFORM pg_temp.meeting_check(label||'terminal journey protected',rejected);
   rejected:=false;
   BEGIN UPDATE public.alignments SET status='completed' WHERE id=alignment;
   EXCEPTION WHEN raise_exception THEN rejected:=SQLERRM='Mutual no-travel closure is terminal'; END;
   PERFORM pg_temp.meeting_check(label||'terminal alignment protected',rejected);
  ELSE
   PERFORM pg_temp.meeting_check(label||'ordinary completion preserved',r#>>'{rows,0,end_status}'='completed' AND (SELECT status='completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND end_method='mutual_user_end' FROM public.journeys WHERE id=journey) AND (SELECT status='completed' FROM public.alignments WHERE id=alignment));
   PERFORM pg_temp.meeting_check(label||'ordinary settlement preserved',(SELECT count(*)=1 AND bool_and(beneficiary_member_id=driver AND status='pending_amount') FROM private.movement_settlements WHERE journey_id=journey));
   PERFORM pg_temp.meeting_check(label||'no no-travel audit for completion',NOT EXISTS(SELECT 1 FROM private.mutual_no_travel_closures WHERE journey_id=journey));
   PERFORM pg_temp.meeting_denied(label||'completed decline rejected','authenticated',primary_member,format('SELECT * FROM public.decline_movement_end(%L)',journey),'P0001','Movement is already terminal');
  END IF;
  FOREACH actor IN ARRAY ARRAY[driver,primary_member] LOOP
   r:=pg_temp.meeting_as('authenticated',actor,format('SELECT * FROM public.request_movement_end(%L)',journey));
   PERFORM pg_temp.meeting_check(label||'terminal request retry '||actor,r->>'ok'='true' AND r#>>'{rows,0,end_status}'=CASE WHEN scenario<=2 THEN 'mutual_no_travel' ELSE 'completed' END);
   r:=pg_temp.meeting_as('authenticated',actor,format('SELECT * FROM public.confirm_movement_end(%L)',journey));
   PERFORM pg_temp.meeting_check(label||'terminal confirmation retry '||actor,r->>'ok'='true' AND r#>>'{rows,0,end_status}'=CASE WHEN scenario<=2 THEN 'mutual_no_travel' ELSE 'completed' END);
  END LOOP;
  PERFORM pg_temp.meeting_check(label||'retry entitlement count unchanged',(SELECT count(*)=CASE WHEN scenario<=2 THEN 0 ELSE 1 END FROM private.movement_settlements WHERE journey_id=journey));
  IF scenario<=2 THEN
   PERFORM pg_temp.meeting_check(label||'audit remains unchanged after retries',(SELECT to_jsonb(c)=audit_before FROM private.mutual_no_travel_closures c WHERE c.journey_id=journey));
   r:=pg_temp.meeting_as('authenticated',driver,format('SELECT * FROM public.get_my_movement_end_status(%L)',journey));
   PERFORM pg_temp.meeting_check(label||'status shows terminal without action',r->>'ok'='true' AND r#>>'{rows,0,end_status}'='mutual_no_travel' AND r#>>'{rows,0,action_required_from_me}'='false');
  END IF;
  PERFORM pg_temp.meeting_check(label||'payment history unchanged',(SELECT to_jsonb(p)=old_payment FROM private.alignment_activation_payments p WHERE p.id=payment));
  PERFORM pg_temp.meeting_check(label||'activation timestamp unchanged',(SELECT activated_at=old_activation FROM public.alignments WHERE id=alignment));
  PERFORM pg_temp.meeting_check(label||'participant history unchanged',old_roster IS NOT DISTINCT FROM
    (SELECT jsonb_agg(to_jsonb(mp) ORDER BY mp.id) FROM public.movement_participants mp WHERE mp.movement_need_id=need));
  PERFORM pg_temp.meeting_check(label||'face verification history unchanged',old_face_history IS NOT DISTINCT FROM
    (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM private.alignment_face_verifications f WHERE f.alignment_id=alignment));
 END LOOP;
 PERFORM pg_temp.meeting_denied('raw audit denied','authenticated',driver,'SELECT * FROM private.mutual_no_travel_closures');
 PERFORM pg_temp.meeting_denied('helper denied','authenticated',driver,format('SELECT private.close_mutual_no_travel(%L)',journey));
 FOREACH signature IN ARRAY ARRAY['request_movement_end(uuid,text)','confirm_movement_end(uuid)','decline_movement_end(uuid)','get_my_movement_end_status(uuid)'] LOOP
  PERFORM pg_temp.meeting_check('safe ACL '||signature,has_function_privilege('authenticated','public.'||signature,'EXECUTE') AND NOT has_function_privilege('anon','public.'||signature,'EXECUTE'));
 END LOOP;
 PERFORM pg_temp.meeting_check('audit service read only',has_table_privilege('service_role','private.mutual_no_travel_closures','SELECT') AND NOT has_table_privilege('service_role','private.mutual_no_travel_closures','UPDATE') AND NOT has_table_privilege('authenticated','private.mutual_no_travel_closures','SELECT'));
 PERFORM pg_temp.meeting_check('exact legacy signatures with no alternate overloads',
   (SELECT array_agg(p.proname||'('||replace(oidvectortypes(p.proargtypes),' ','')||')' ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('request_movement_end','confirm_movement_end','decline_movement_end','get_my_movement_end_status'))
   = ARRAY['confirm_movement_end(uuid)','decline_movement_end(uuid)','get_my_movement_end_status(uuid)','request_movement_end(uuid,text)']);
 PERFORM pg_temp.meeting_check('no PUBLIC execute on changed or new functions',NOT EXISTS (
   SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
   LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
   WHERE ((n.nspname='public' AND p.proname IN ('request_movement_end','confirm_movement_end','decline_movement_end','get_my_movement_end_status'))
     OR (n.nspname='private' AND p.proname IN ('close_mutual_no_travel','protect_no_travel_journey','protect_no_travel_alignment')))
     AND acl.grantee=0 AND acl.privilege_type='EXECUTE'));
 PERFORM pg_temp.meeting_check('old one-sided completion remains revoked',
   NOT has_function_privilege('authenticated','public.request_journey_completion(uuid)','EXECUTE')
   AND NOT has_function_privilege('authenticated','public.confirm_journey_completion(uuid)','EXECUTE'));
 PERFORM pg_temp.meeting_denied('anonymous End forbidden','anon',NULL,format('SELECT * FROM public.request_movement_end(%L)',journey));
 PERFORM pg_temp.meeting_denied('missing authenticated identity forbidden','authenticated',NULL,format('SELECT * FROM public.request_movement_end(%L)',journey),'P0001','Authentication required');
 PERFORM pg_temp.meeting_check('service cannot mutate audit',
   NOT has_table_privilege('service_role','private.mutual_no_travel_closures','INSERT')
   AND NOT has_table_privilege('service_role','private.mutual_no_travel_closures','DELETE')
   AND NOT has_table_privilege('service_role','private.mutual_no_travel_closures','TRUNCATE'));
END;
$test$;
SELECT pg_temp.meeting_check('test does not replace functions or permissions',NOT EXISTS (
 SELECT 1 FROM pg_temp.meeting_function_snapshot s JOIN pg_proc p ON p.oid=s.oid
 WHERE s.definition_hash<>md5(pg_get_functiondef(p.oid)) OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text
));
SELECT test_name,passed FROM pg_temp.meeting_test_results ORDER BY check_number;
ROLLBACK;
