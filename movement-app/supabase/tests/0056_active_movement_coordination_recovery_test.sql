BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.active_recovery_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.active_recovery_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.active_recovery_results(
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
ON FUNCTION pg_temp.active_recovery_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.active_recovery_as(
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
ON FUNCTION pg_temp.active_recovery_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
CREATE FUNCTION pg_temp.active_recovery_requester_fixture(
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
    m::text || '@test-0055-requester.invalid',
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
    pg_temp.active_recovery_as(
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
      '0055 requester fixture need failed: %',
      r;
  END IF;


  RETURN QUERY
  SELECT
    m,
    need_id;
END;
$fixture$;

CREATE FUNCTION pg_temp.active_recovery_list(p_member uuid, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.active_recovery_as('authenticated',p_member,
    format('SELECT * FROM public.list_my_active_movement_continuations(%L)',p_limit));
END;
$$;


DO $test$
DECLARE
  driver uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); requester uuid;
  vehicle uuid:=gen_random_uuid(); f record; need_ids uuid[]:=ARRAY[]::uuid[]; alignment_ids uuid[]:=ARRAY[]::uuid[];
  offer uuid; aid uuid; i integer; actor uuid; r jsonb; baseline jsonb; state text;
  sub uuid; media uuid; ref text; payment uuid; jid uuid;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0056.invalid','{}','{}',now(),now()
    FROM unnest(ARRAY[driver,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Test','Blue',4,'TEST0056');
  PERFORM pg_temp.active_recovery_check('empty',pg_temp.active_recovery_list(driver)='{"ok":true,"rows":[]}'::jsonb);
  PERFORM pg_temp.active_recovery_check('missing auth',pg_temp.active_recovery_list(NULL)->>'state'='42501');
  PERFORM pg_temp.active_recovery_check('nonexistent member',pg_temp.active_recovery_list(gen_random_uuid())->>'state'='42501');
  FOREACH state IN ARRAY ARRAY['anon','service_role'] LOOP
    r:=pg_temp.active_recovery_as(state,driver,'SELECT * FROM public.list_my_active_movement_continuations()');
    PERFORM pg_temp.active_recovery_check(state||' denied',r->>'state'='42501');
  END LOOP;
  PERFORM pg_temp.active_recovery_check('PUBLIC denied',NOT EXISTS(
    SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE p.oid='public.list_my_active_movement_continuations(integer)'::regprocedure AND x.grantee=0 AND x.privilege_type='EXECUTE'));
  FOR i IN 1..2 LOOP
    SELECT * INTO f FROM pg_temp.active_recovery_requester_fixture('active-'||i,1,requester);
    requester:=f.member_id; need_ids:=array_append(need_ids,f.movement_need_id);
    UPDATE public.movement_needs SET status='closed',origin_area='PRIVATE exact address' WHERE id=f.movement_need_id;
    offer:=gen_random_uuid(); aid:=gen_random_uuid(); alignment_ids:=array_append(alignment_ids,aid);
    INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
      VALUES(offer,f.movement_need_id,driver,vehicle,1,'accepted');
    INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
      VALUES(aid,f.movement_need_id,offer,requester,driver);
    r:=pg_temp.active_recovery_list(driver);
    PERFORM pg_temp.active_recovery_check('awaiting excluded '||i,NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=f.movement_need_id::text));
    FOREACH actor IN ARRAY ARRAY[driver,requester] LOOP
      r:=pg_temp.active_recovery_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original'));
      sub:=(r#>>'{rows,0,id}')::uuid;
      r:=pg_temp.active_recovery_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',sub,gen_random_uuid()::text||'/processed'));
      media:=(r#>>'{rows,0,id}')::uuid; ref:=gen_random_uuid()::text;
      r:=pg_temp.active_recovery_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',f.movement_need_id,actor,ref));
      IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'face start: %',r; END IF;
      r:=pg_temp.active_recovery_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,media));
      IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'face complete: %',r; END IF;
    END LOOP;
    r:=pg_temp.active_recovery_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',aid));
    payment:=(r#>>'{rows,0,payment_id}')::uuid;
    r:=pg_temp.active_recovery_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,%L)',payment,gen_random_uuid()::text));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'payment: %',r; END IF;
    r:=pg_temp.active_recovery_list(driver);
    PERFORM pg_temp.active_recovery_check('activated not started excluded '||i,NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=f.movement_need_id::text));
    r:=pg_temp.active_recovery_as('authenticated',driver,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Test meeting place'',NULL)',f.movement_need_id));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'meeting: %',r; END IF;
    r:=pg_temp.active_recovery_as('authenticated',driver,format('SELECT * FROM public.request_my_movement_start(%L)',f.movement_need_id));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'request start: %',r; END IF;
    PERFORM pg_temp.active_recovery_check('pending start excluded '||i,NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.active_recovery_list(driver)->'rows') x WHERE x->>'movement_need_id'=f.movement_need_id::text));
    r:=pg_temp.active_recovery_as('authenticated',requester,format('SELECT * FROM public.confirm_my_movement_start(%L)',f.movement_need_id));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'confirm start: %',r; END IF;
  END LOOP;
  PERFORM pg_sleep(3.1);
  baseline:=pg_temp.active_recovery_list(driver);
  PERFORM pg_temp.active_recovery_check('both roles recover multiple actually started elapsed movements',
    baseline->>'ok'='true' AND jsonb_array_length(baseline->'rows')=2 AND pg_temp.active_recovery_list(requester)=baseline);
  PERFORM pg_temp.active_recovery_check('equal start time uses descending need tie breaker',baseline#>>'{rows,0,movement_need_id}'=greatest(need_ids[1],need_ids[2])::text);
  PERFORM pg_temp.active_recovery_check('exact narrow shape',(SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(baseline#>'{rows,0}') k)=ARRAY['destination_area','movement_need_id','origin_area','started_at']);
  PERFORM pg_temp.active_recovery_check('trusted labels only',baseline::text NOT LIKE '%PRIVATE%' AND baseline#>>'{rows,0,origin_area}'='Ologolo, Lagos');
  PERFORM pg_temp.active_recovery_check('outsider denied',pg_temp.active_recovery_list(outsider)='{"ok":true,"rows":[]}'::jsonb);
  PERFORM pg_temp.active_recovery_check('limit one',jsonb_array_length(pg_temp.active_recovery_list(driver,1)->'rows')=1);
  PERFORM pg_temp.active_recovery_check('max limit',pg_temp.active_recovery_list(driver,50)=baseline);
  FOREACH state IN ARRAY ARRAY['NULL','0','-1','51'] LOOP
    r:=pg_temp.active_recovery_as('authenticated',driver,'SELECT * FROM public.list_my_active_movement_continuations('||state||')');
    PERFORM pg_temp.active_recovery_check('invalid limit '||state,r->>'state'='23514');
  END LOOP;
  SELECT id INTO jid FROM public.journeys WHERE alignment_id=alignment_ids[2];
  FOREACH state IN ARRAY ARRAY['completed','cancelled','failed'] LOOP
    BEGIN
      UPDATE public.alignments SET status=state WHERE id=alignment_ids[2];
      UPDATE public.journeys SET status=state WHERE id=jid;
      r:=pg_temp.active_recovery_list(driver);
      RAISE SQLSTATE 'ZT056';
    EXCEPTION WHEN SQLSTATE 'ZT056' THEN NULL;
    END;
    PERFORM pg_temp.active_recovery_check(state||' excluded',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1);
  END LOOP;
  BEGIN
    UPDATE public.journeys SET started_at=NULL WHERE id=jid;
    r:=pg_temp.active_recovery_list(driver);
    RAISE SQLSTATE 'ZT056';
  EXCEPTION WHEN SQLSTATE 'ZT056' THEN NULL;
  END;
  PERFORM pg_temp.active_recovery_check('missing actual start excluded',jsonb_array_length(r->'rows')=1);
  BEGIN
    UPDATE public.alignments SET activation_fee_minor=101 WHERE id=alignment_ids[2];
    r:=pg_temp.active_recovery_list(driver);
    RAISE SQLSTATE 'ZT056';
  EXCEPTION WHEN SQLSTATE 'ZT056' THEN NULL;
  END;
  PERFORM pg_temp.active_recovery_check('payment mismatch excluded',jsonb_array_length(r->'rows')=1);
END;
$test$;
CREATE FUNCTION pg_temp.continuation_snapshot() RETURNS jsonb LANGUAGE sql AS $snapshot$
SELECT jsonb_build_object(
  'tables', (SELECT jsonb_object_agg(n.nspname||'.'||c.relname,
    query_to_xml(format('SELECT count(*) AS rows, md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) AS hash FROM %I.%I t',n.nspname,c.relname),false,true,'')::text)
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')),
  'functions', (SELECT jsonb_agg(jsonb_build_object('oid',p.oid,'def',md5(pg_get_functiondef(p.oid)),'acl',p.proacl,'owner',p.proowner) ORDER BY p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.prokind='f')
) AS state;
$snapshot$;
REVOKE ALL ON FUNCTION pg_temp.continuation_snapshot() FROM PUBLIC;
DO $readonly$
DECLARE before_state jsonb; after_state jsonb; caller uuid;
BEGIN
  SELECT offering_member_id INTO STRICT caller FROM public.alignments
    WHERE movement_need_id IN (SELECT movement_need_id FROM private.movement_need_locations)
    AND offering_member_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-0056.invalid') LIMIT 1;
  before_state := pg_temp.continuation_snapshot();
  PERFORM pg_temp.active_recovery_list(caller);
  after_state := pg_temp.continuation_snapshot();
  PERFORM pg_temp.active_recovery_check('RPC leaves complete database and function state unchanged',before_state=after_state);
END;
$readonly$;

SELECT test_number,test_name,passed FROM pg_temp.active_recovery_results ORDER BY test_number;
DO $results$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.active_recovery_results WHERE NOT passed)
    OR (SELECT count(*) FROM pg_temp.active_recovery_results)<>29 THEN
    RAISE EXCEPTION '0056 behavioral checks failed or missing';
  END IF;
END;
$results$;
SELECT count(*) AS passed_checks FROM pg_temp.active_recovery_results WHERE passed;
ROLLBACK;
