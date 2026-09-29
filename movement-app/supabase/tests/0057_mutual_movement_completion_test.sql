BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.completion_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.completion_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.completion_results(
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


REVOKE ALL
ON FUNCTION pg_temp.completion_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.completion_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $as_member$
DECLARE
  previous_role text;
  previous_sub text;
  previous_jwt_role text;
  previous_claims text;

  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN (
    'authenticated',
    'anon',
    'service_role'
  ) THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;


  previous_role :=
    current_setting('role');

  previous_sub :=
    current_setting(
      'request.jwt.claim.sub',
      true
    );

  previous_jwt_role :=
    current_setting(
      'request.jwt.claim.role',
      true
    );

  previous_claims :=
    current_setting(
      'request.jwt.claims',
      true
    );


  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member_id::text, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    p_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      p_member_id,
      'role',
      p_role
    )::text,
    true
  );

  PERFORM set_config(
    'role',
    p_role,
    true
  );


  BEGIN
    EXECUTE
      'SELECT coalesce(
         jsonb_agg(to_jsonb(q)),
         ''[]''::jsonb
       )
       FROM (' || p_sql || ') AS q'
    INTO rows_json;

    result_json :=
      jsonb_build_object(
        'ok',
        true,
        'rows',
        rows_json
      );

  EXCEPTION
    WHEN OTHERS THEN
      result_json :=
        jsonb_build_object(
          'ok',
          false,
          'state',
          SQLSTATE,
          'message',
          SQLERRM
        );
  END;


  PERFORM set_config(
    'role',
    previous_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(previous_sub, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    coalesce(previous_jwt_role, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    coalesce(previous_claims, '{}'),
    true
  );


  RETURN result_json;
END;
$as_member$;


REVOKE ALL
ON FUNCTION pg_temp.completion_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
CREATE FUNCTION pg_temp.completion_requester_fixture(
  p_label text,
  p_people_count integer DEFAULT 1,
  p_member uuid DEFAULT NULL
)
RETURNS TABLE (
  member_id uuid,
  movement_need_id uuid
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  m uuid := coalesce(p_member,gen_random_uuid());

  source_id uuid;
  resolved_id uuid;

  endpoints uuid[] := ARRAY[]::uuid[];

  n integer;
  place text;

  r jsonb;
  need_id uuid;
BEGIN
  IF p_member IS NULL THEN
  INSERT INTO auth.users(
    id,
    aud,
    role,
    email,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    m,
    'authenticated',
    'authenticated',
    m::text || '@test-0057-requester.invalid',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );


  END IF;
  FOR n IN 1..2 LOOP
    place :=
      p_label || '-requester-' || n;


    SELECT x.location_reference_id
    INTO source_id
    FROM public.record_verified_selected_location_for_server(
      m,
      gen_random_uuid(),
      'Precise private address ' || place,
      'test_provider',
      place,
      'selection_proof_v1',
      clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '4 hours'
    ) x;


    SELECT x.resolved_location_reference_id
    INTO resolved_id
    FROM public.record_attested_location_resolution_for_server(
      m,
      source_id,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      place,
      'resolution_v1',
      CASE n
        WHEN 1 THEN 'Ologolo, Lagos'
        ELSE 'Ikeja, Lagos'
      END,
      CASE n
        WHEN 1 THEN 6.4300
        ELSE 6.6018
      END,
      CASE n
        WHEN 1 THEN 3.5200
        ELSE 3.3515
      END,
      clock_timestamp(),
      NULL
    ) x;


    endpoints :=
      array_append(
        endpoints,
        resolved_id
      );
  END LOOP;


  r :=
    pg_temp.completion_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.create_movement_need(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz,
           %s
         )',
        gen_random_uuid(),
        endpoints[1],
        endpoints[2],
        clock_timestamp() + interval '2 seconds',
        clock_timestamp() + interval '3 seconds',
        p_people_count
      )
    );


  need_id :=
    (
      r #>>
      '{rows,0,movement_need_id}'
    )::uuid;


  IF need_id IS NULL THEN
    RAISE EXCEPTION
      '0057 requester fixture need failed: %',
      r;
  END IF;


  RETURN QUERY
  SELECT
    m,
    need_id;
END;
$fixture$;

CREATE FUNCTION pg_temp.completion_call(actor uuid, action text, need uuid)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.completion_as('authenticated',actor,format('SELECT * FROM public.%I(%L::uuid)',action,need));
$$;
DO $test$
DECLARE
  driver uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); requester uuid;
  vehicle uuid:=gen_random_uuid(); f record; need_ids uuid[]:=ARRAY[]::uuid[]; alignment_ids uuid[]:=ARRAY[]::uuid[];
  offer uuid; aid uuid; i integer; actor uuid; other_actor uuid; r jsonb; state text; action text;
  sub uuid; media uuid; ref text; payment uuid; jid uuid;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0057.invalid','{}','{}',now(),now()
    FROM unnest(ARRAY[driver,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Test','Blue',4,'TEST0057');
  FOR i IN 1..3 LOOP
    SELECT * INTO f FROM pg_temp.completion_requester_fixture('active-'||i,1,requester);
    requester:=f.member_id; need_ids:=array_append(need_ids,f.movement_need_id);
    UPDATE public.movement_needs SET status='closed',origin_area='PRIVATE exact address' WHERE id=f.movement_need_id;
    offer:=gen_random_uuid(); aid:=gen_random_uuid(); alignment_ids:=array_append(alignment_ids,aid);
    INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
      VALUES(offer,f.movement_need_id,driver,vehicle,1,'accepted');
    INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
      VALUES(aid,f.movement_need_id,offer,requester,driver);
    PERFORM pg_temp.completion_check('awaiting activation cannot request '||i,pg_temp.completion_call(driver,'request_my_movement_end',f.movement_need_id)->>'ok'='false');
    FOREACH actor IN ARRAY ARRAY[driver,requester] LOOP
      r:=pg_temp.completion_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original'));
      sub:=(r#>>'{rows,0,id}')::uuid;
      r:=pg_temp.completion_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',sub,gen_random_uuid()::text||'/processed'));
      media:=(r#>>'{rows,0,id}')::uuid; ref:=gen_random_uuid()::text;
      r:=pg_temp.completion_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',f.movement_need_id,actor,ref));
      IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'face start: %',r; END IF;
      r:=pg_temp.completion_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,media));
      IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'face complete: %',r; END IF;
    END LOOP;
    r:=pg_temp.completion_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',aid));
    payment:=(r#>>'{rows,0,payment_id}')::uuid;
    r:=pg_temp.completion_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,%L)',payment,gen_random_uuid()::text));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'payment: %',r; END IF;
    IF i<3 THEN
    r:=pg_temp.completion_as('authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Test meeting place'',NULL)',f.movement_need_id));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'meeting: %',r; END IF;
    r:=pg_temp.completion_as('authenticated',driver,format('SELECT * FROM public.request_my_movement_start(%L)',f.movement_need_id));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'request start: %',r; END IF;
    r:=pg_temp.completion_as('authenticated',requester,format('SELECT * FROM public.confirm_my_movement_start(%L)',f.movement_need_id));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'confirm start: %',r; END IF;
    END IF;
  END LOOP;

  FOREACH action IN ARRAY ARRAY['get_my_movement_end_status_by_need','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end'] LOOP
    PERFORM pg_temp.completion_check(action||' missing auth',pg_temp.completion_call(NULL,action,need_ids[1])->>'state'='42501');
    PERFORM pg_temp.completion_check(action||' nonexistent member',pg_temp.completion_call(gen_random_uuid(),action,need_ids[1])->>'state'='42501');
    PERFORM pg_temp.completion_check(action||' outsider',pg_temp.completion_call(outsider,action,need_ids[1])->>'state'='42501');
    PERFORM pg_temp.completion_check(action||' zero mapping',pg_temp.completion_call(driver,action,gen_random_uuid())->>'state'='42501');
    FOREACH state IN ARRAY ARRAY['anon','service_role'] LOOP
      r:=pg_temp.completion_as(state,driver,format('SELECT * FROM public.%I(%L)',action,need_ids[1]));
      PERFORM pg_temp.completion_check(action||' denies '||state,r->>'state'='42501');
    END LOOP;
  END LOOP;
  FOR i IN 1..2 LOOP
    actor:=CASE i WHEN 1 THEN requester ELSE driver END;
    other_actor:=CASE i WHEN 1 THEN driver ELSE requester END;
    SELECT id INTO STRICT jid FROM public.journeys WHERE alignment_id=alignment_ids[i];
    r:=pg_temp.completion_call(actor,'get_my_movement_end_status_by_need',need_ids[i]);
    PERFORM pg_temp.completion_check('initial principal '||i,r#>>'{rows,0,end_status}'='no_pending_end_request' AND r#>>'{rows,0,journey_state}'='in_progress');
    PERFORM pg_temp.completion_check('other read '||i,pg_temp.completion_call(other_actor,'get_my_movement_end_status_by_need',need_ids[i])=r);
    r:=pg_temp.completion_call(actor,'request_my_movement_end',need_ids[i]);
    PERFORM pg_temp.completion_check('request only '||i,r#>>'{rows,0,end_status}'='awaiting_other_member'
      AND (SELECT status='in_progress' AND completed_at IS NULL FROM public.journeys WHERE id=jid)
      AND (SELECT status='in_progress' FROM public.alignments WHERE id=alignment_ids[i])
      AND NOT EXISTS(SELECT 1 FROM private.movement_settlements WHERE journey_id=jid));
    PERFORM pg_temp.completion_check('repeat own request '||i,pg_temp.completion_call(actor,'request_my_movement_end',need_ids[i])=r);
    PERFORM pg_temp.completion_check('self confirm rejected '||i,pg_temp.completion_call(actor,'confirm_my_movement_end',need_ids[i])->>'ok'='false');
    PERFORM pg_temp.completion_check('self decline rejected '||i,pg_temp.completion_call(actor,'decline_my_movement_end',need_ids[i])->>'ok'='false');
    PERFORM pg_temp.completion_check('opposite request cannot confirm '||i,pg_temp.completion_call(other_actor,'request_my_movement_end',need_ids[i])->>'ok'='false'
      AND (SELECT status='in_progress' FROM public.journeys WHERE id=jid));
    r:=pg_temp.completion_call(other_actor,'get_my_movement_end_status_by_need',need_ids[i]);
    PERFORM pg_temp.completion_check('other action required '||i,r#>>'{rows,0,end_status}'='action_required_from_me' AND r#>>'{rows,0,action_required_from_me}'='true');
    r:=pg_temp.completion_call(other_actor,'decline_my_movement_end',need_ids[i]);
    PERFORM pg_temp.completion_check('decline resets active '||i,r#>>'{rows,0,end_status}'='no_pending_end_request' AND r#>>'{rows,0,journey_state}'='in_progress'
      AND (SELECT end_requested_by_member_id IS NULL AND end_requested_at IS NULL FROM public.journeys WHERE id=jid)
      AND (SELECT status='in_progress' FROM public.alignments WHERE id=alignment_ids[i]));
    r:=pg_temp.completion_call(actor,'request_my_movement_end',need_ids[i]);
    PERFORM pg_temp.completion_check('fresh request '||i,r#>>'{rows,0,end_status}'='awaiting_other_member');
    r:=pg_temp.completion_call(other_actor,'confirm_my_movement_end',need_ids[i]);
    PERFORM pg_temp.completion_check('mutual completion '||i,r#>>'{rows,0,end_status}'='completed' AND r#>>'{rows,0,completed_at}' IS NOT NULL
      AND (SELECT status='completed' AND completed_at IS NOT NULL FROM public.journeys WHERE id=jid)
      AND (SELECT status='completed' FROM public.alignments WHERE id=alignment_ids[i]));
    PERFORM pg_temp.completion_check('one offerer entitlement '||i,(SELECT count(*)=1 AND bool_and(beneficiary_member_id=driver AND status='pending_amount') FROM private.movement_settlements WHERE journey_id=jid AND alignment_id=alignment_ids[i]));
    PERFORM pg_temp.completion_check('repeat confirmation '||i,pg_temp.completion_call(other_actor,'confirm_my_movement_end',need_ids[i])=r);
    PERFORM pg_temp.completion_check('completed cannot decline '||i,pg_temp.completion_call(other_actor,'decline_my_movement_end',need_ids[i])->>'ok'='false');
    PERFORM pg_temp.completion_check('exact safe fields '||i,(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r#>'{rows,0}') k)=ARRAY['action_required_from_me','completed_at','end_status','journey_state','requested_at','requested_by_me']);
    PERFORM pg_temp.completion_check('completed absent from active recovery '||i,NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.completion_as('authenticated',actor,'SELECT * FROM public.list_my_active_movement_continuations()')->'rows') x WHERE x->>'movement_need_id'=need_ids[i]::text));
  END LOOP;
  SELECT id INTO STRICT jid FROM public.journeys WHERE alignment_id=alignment_ids[3];
  r:=pg_temp.completion_call(driver,'request_my_movement_end',need_ids[3]);
  PERFORM pg_temp.completion_check('not started request alone',r#>>'{rows,0,journey_state}'='not_started' AND r#>>'{rows,0,end_status}'='awaiting_other_member');
  r:=pg_temp.completion_call(requester,'confirm_my_movement_end',need_ids[3]);
  PERFORM pg_temp.completion_check('no travel closure',r#>>'{rows,0,end_status}'='mutual_no_travel' AND r#>>'{rows,0,journey_state}'='cancelled'
    AND (SELECT status='cancelled' AND started_at IS NULL AND completed_at IS NULL FROM public.journeys WHERE id=jid)
    AND (SELECT status='cancelled' FROM public.alignments WHERE id=alignment_ids[3])
    AND EXISTS(SELECT 1 FROM private.mutual_no_travel_closures WHERE journey_id=jid));
  PERFORM pg_temp.completion_check('no travel has no settlement',NOT EXISTS(SELECT 1 FROM private.movement_settlements WHERE journey_id=jid));
  PERFORM pg_temp.completion_check('both can read no travel',pg_temp.completion_call(driver,'get_my_movement_end_status_by_need',need_ids[3])=r
    AND pg_temp.completion_call(requester,'get_my_movement_end_status_by_need',need_ids[3])=r);
  PERFORM pg_temp.completion_check('no travel confirm idempotent',pg_temp.completion_call(requester,'confirm_my_movement_end',need_ids[3])=r);
  PERFORM pg_temp.completion_check('no travel decline rejected',pg_temp.completion_call(requester,'decline_my_movement_end',need_ids[3])->>'ok'='false');
  FOREACH state IN ARRAY ARRAY['cancelled','failed'] LOOP
    BEGIN
      UPDATE public.journeys SET status=state WHERE alignment_id=alignment_ids[1];
      UPDATE public.alignments SET status=state WHERE id=alignment_ids[1];
      r:=pg_temp.completion_call(driver,'confirm_my_movement_end',need_ids[1]);
      RAISE SQLSTATE 'ZT057';
    EXCEPTION WHEN SQLSTATE 'ZT057' THEN NULL;
    END;
    PERFORM pg_temp.completion_check('terminal cannot complete '||state,r->>'ok'='false');
  END LOOP;
  BEGIN
    offer:=gen_random_uuid(); aid:=gen_random_uuid();
    INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
      VALUES(offer,need_ids[1],driver,vehicle,1,'accepted');
    INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
      VALUES(aid,need_ids[1],offer,requester,driver);
    INSERT INTO public.journeys(alignment_id,vehicle_id) VALUES(aid,vehicle);
    FOREACH action IN ARRAY ARRAY['get_my_movement_end_status_by_need','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end'] LOOP
      r:=pg_temp.completion_call(driver,action,need_ids[1]);
      IF r->>'state' IS DISTINCT FROM '42501' THEN RAISE EXCEPTION 'Ambiguous wrapper failed closed test: %',action; END IF;
    END LOOP;
    RAISE SQLSTATE 'ZT057';
  EXCEPTION WHEN SQLSTATE 'ZT057' THEN NULL;
  END;
  PERFORM pg_temp.completion_check('ambiguous fails closed',r->>'state'='42501');
END;
$test$;
SELECT test_number,test_name,passed FROM pg_temp.completion_results ORDER BY test_number;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.completion_results WHERE NOT passed) OR (SELECT count(*) FROM pg_temp.completion_results)<>68 THEN RAISE EXCEPTION '0057 behavioral checks failed'; END IF;
END $$;
SELECT count(*) AS passed_checks FROM pg_temp.completion_results WHERE passed;
ROLLBACK;
