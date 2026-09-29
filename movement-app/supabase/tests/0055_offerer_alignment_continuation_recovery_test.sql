BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.offerer_continuation_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.offerer_continuation_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.offerer_continuation_results(
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
ON FUNCTION pg_temp.offerer_continuation_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.offerer_continuation_as(
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
ON FUNCTION pg_temp.offerer_continuation_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
CREATE FUNCTION pg_temp.offerer_continuation_requester_fixture(
  p_label text,
  p_people_count integer DEFAULT 1
)
RETURNS TABLE (
  member_id uuid,
  movement_need_id uuid
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  m uuid := gen_random_uuid();

  source_id uuid;
  resolved_id uuid;

  endpoints uuid[] := ARRAY[]::uuid[];

  n integer;
  place text;

  r jsonb;
  need_id uuid;
BEGIN
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
    pg_temp.offerer_continuation_as(
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

CREATE FUNCTION pg_temp.offerer_continuation_list(p_member uuid, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.offerer_continuation_as('authenticated',p_member,
    format('SELECT * FROM public.list_my_offerer_movement_continuations(%L)',p_limit));
END;
$$;

DO $test$
DECLARE
  driver uuid := gen_random_uuid(); outsider uuid := gen_random_uuid(); vehicle uuid := gen_random_uuid();
  needs uuid[] := ARRAY[]::uuid[]; requesters uuid[] := ARRAY[]::uuid[];
  fixture_alignments uuid[] := ARRAY[]::uuid[];
  fixture record; offer_id uuid; alignment_id uuid; missing_need uuid := gen_random_uuid();
  r jsonb; baseline jsonb; i integer; actor uuid; state text; keys text[];
  submission uuid; media uuid; ref text; payment uuid; expected uuid[];
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text||'@test-0055.invalid','{}','{}',now(),now()
    FROM unnest(ARRAY[driver,outsider]) ids(id);
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number)
    VALUES(vehicle,'Test','Blue',4,'TEST-0055');
  PERFORM pg_temp.offerer_continuation_check('zero matches',pg_temp.offerer_continuation_list(driver)='{"ok":true,"rows":[]}'::jsonb);
  PERFORM pg_temp.offerer_continuation_check('missing auth rejected',pg_temp.offerer_continuation_list(NULL)->>'state'='42501');
  PERFORM pg_temp.offerer_continuation_check('nonexistent member rejected',pg_temp.offerer_continuation_list(gen_random_uuid())->>'state'='42501');
  FOREACH state IN ARRAY ARRAY['anon','service_role'] LOOP
    r := pg_temp.offerer_continuation_as(state,driver,'SELECT * FROM public.list_my_offerer_movement_continuations()');
    PERFORM pg_temp.offerer_continuation_check(state||' cannot execute',r->>'state'='42501');
  END LOOP;
  PERFORM pg_temp.offerer_continuation_check('PUBLIC cannot execute',NOT EXISTS (
    SELECT 1 FROM pg_proc p, LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    WHERE p.oid='public.list_my_offerer_movement_continuations(integer)'::regprocedure
      AND acl.grantee=0 AND acl.privilege_type='EXECUTE'));

  FOR i IN 1..3 LOOP
    SELECT * INTO fixture FROM pg_temp.offerer_continuation_requester_fixture('accepted-'||i);
    needs := array_append(needs,fixture.movement_need_id);
    requesters := array_append(requesters,fixture.member_id);
    -- Deliberately make legacy display text precise, so any fallback fails the test.
    UPDATE public.movement_needs SET status='closed',origin_area='PRIVATE exact home address',
      destination_area='PRIVATE exact destination' WHERE id=fixture.movement_need_id;
    offer_id := gen_random_uuid(); alignment_id := gen_random_uuid();
    INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
      VALUES(offer_id,needs[i],driver,vehicle,1,'accepted');
    INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id,created_at)
      VALUES(alignment_id,needs[i],offer_id,requesters[i],driver,
        now()-CASE WHEN i=1 THEN interval '2 hours' ELSE interval '1 hour' END);
    fixture_alignments := array_append(fixture_alignments,alignment_id);
  END LOOP;
  PERFORM pg_sleep(3.1);
  baseline := pg_temp.offerer_continuation_list(driver);
  PERFORM pg_temp.offerer_continuation_check('offering member recovers all awaiting alignments after closed elapsed needs',
    baseline->>'ok'='true' AND jsonb_array_length(baseline->'rows')=3
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(baseline->'rows') x WHERE x->>'alignment_status'<>'awaiting_activation_payment'),baseline::text);
  expected := ARRAY[greatest(needs[2],needs[3]),least(needs[2],needs[3]),needs[1]];
  PERFORM pg_temp.offerer_continuation_check('newest first and movement need descending tie breaker',
    (SELECT array_agg((x->>'movement_need_id')::uuid ORDER BY ord)
      FROM jsonb_array_elements(baseline->'rows') WITH ORDINALITY t(x,ord))=expected);
  SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(baseline#>'{rows,0}') k;
  PERFORM pg_temp.offerer_continuation_check('exact safe output shape',
    keys=ARRAY['alignment_status','created_at','destination_area','movement_need_id','origin_area']);
  PERFORM pg_temp.offerer_continuation_check('trusted labels only; no precise legacy fallback',
    baseline#>>'{rows,0,origin_area}'='Ologolo, Lagos' AND baseline#>>'{rows,0,destination_area}'='Ikeja, Lagos'
    AND baseline::text NOT LIKE '%PRIVATE%');
  FOREACH actor IN ARRAY ARRAY[requesters[1],outsider] LOOP
    PERFORM pg_temp.offerer_continuation_check('requester or unrelated member excluded '||actor,
      pg_temp.offerer_continuation_list(actor)='{"ok":true,"rows":[]}'::jsonb);
  END LOOP;
  r := pg_temp.offerer_continuation_list(driver,1);
  PERFORM pg_temp.offerer_continuation_check('result limit works',r->>'ok'='true'
    AND jsonb_array_length(r->'rows')=1 AND r#>>'{rows,0,movement_need_id}'=expected[1]::text);
  PERFORM pg_temp.offerer_continuation_check('maximum limit accepted',pg_temp.offerer_continuation_list(driver,50)=baseline);
  r := pg_temp.offerer_continuation_as('authenticated',driver,'SELECT * FROM public.list_my_offerer_movement_continuations()');
  PERFORM pg_temp.offerer_continuation_check('default limit accepted',r=baseline);
  FOREACH state IN ARRAY ARRAY['NULL','0','-1','51'] LOOP
    r := pg_temp.offerer_continuation_as('authenticated',driver,'SELECT * FROM public.list_my_offerer_movement_continuations('||state||')');
    PERFORM pg_temp.offerer_continuation_check('invalid limit '||state,r->>'state'='23514');
  END LOOP;

  -- Historical accepted need without trusted broad mapping must not expose legacy labels.
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,people_count,status)
    VALUES(missing_need,requesters[1],'PRIVATE missing origin','PRIVATE missing destination',clock_timestamp()+interval '1 hour',1,'closed');
  offer_id := gen_random_uuid();
  INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
    VALUES(offer_id,missing_need,driver,vehicle,1,'accepted');
  INSERT INTO public.alignments(movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
    VALUES(missing_need,offer_id,requesters[1],driver);
  PERFORM pg_temp.offerer_continuation_check('missing trusted labels fail closed before limit',pg_temp.offerer_continuation_list(driver)=baseline);

  -- Establish activation through the existing face/payment APIs, preserving every trigger.
  FOREACH actor IN ARRAY ARRAY[driver,requesters[3]] LOOP
    r := pg_temp.offerer_continuation_as('service_role',NULL,format('SELECT public.create_profile_photo_submission_for_server(%L,%L,''image/png'',128) AS id',actor,gen_random_uuid()::text||'/original'));
    submission := (r#>>'{rows,0,id}')::uuid;
    r := pg_temp.offerer_continuation_as('service_role',NULL,format('SELECT public.prepare_profile_photo_submission_for_server(%L,%L) AS id',submission,gen_random_uuid()::text||'/processed'));
    media := (r#>>'{rows,0,id}')::uuid; ref := gen_random_uuid()::text;
    r := pg_temp.offerer_continuation_as('service_role',NULL,format('SELECT * FROM public.start_movement_face_verification_for_server(%L,%L,''test'',%L)',needs[3],actor,ref));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Face fixture failed: %',r; END IF;
    r := pg_temp.offerer_continuation_as('service_role',NULL,format('SELECT public.complete_face_verification_callback_for_server(''test'',%L,%L,true,true)',ref,media));
    IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Face fixture completion failed: %',r; END IF;
  END LOOP;
  r := pg_temp.offerer_continuation_as('service_role',NULL,format('SELECT * FROM public.create_alignment_activation_payment(%L,100,''NGN'',''test'')',fixture_alignments[3]));
  payment := (r#>>'{rows,0,payment_id}')::uuid;
  r := pg_temp.offerer_continuation_as('service_role',NULL,format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L,''test-0055'')',payment));
  IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'Payment fixture failed: %',r; END IF;
  r := pg_temp.offerer_continuation_list(driver);
  PERFORM pg_temp.offerer_continuation_check('activated included alongside awaiting',
    r->>'ok'='true' AND jsonb_array_length(r->'rows')=3 AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=needs[3]::text AND x->>'alignment_status'='activated'));
  FOREACH state IN ARRAY ARRAY['in_progress','completed','cancelled','failed'] LOOP
    UPDATE public.alignments SET status=state WHERE id=fixture_alignments[3];
    r := pg_temp.offerer_continuation_list(driver);
    PERFORM pg_temp.offerer_continuation_check(state||' excluded',
      r->>'ok'='true' AND jsonb_array_length(r->'rows')=2 AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=needs[3]::text));
  END LOOP;
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
    AND offering_member_id IN (SELECT id FROM auth.users WHERE email LIKE '%@test-0055.invalid') LIMIT 1;
  before_state := pg_temp.continuation_snapshot();
  PERFORM pg_temp.offerer_continuation_list(caller);
  after_state := pg_temp.continuation_snapshot();
  PERFORM pg_temp.offerer_continuation_check('RPC leaves complete database and function state unchanged',before_state=after_state);
END;
$readonly$;

SELECT test_number,test_name,passed FROM pg_temp.offerer_continuation_results ORDER BY test_number;
DO $results$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.offerer_continuation_results WHERE NOT passed)
    OR (SELECT count(*) FROM pg_temp.offerer_continuation_results)<>26 THEN
    RAISE EXCEPTION '0055 behavioral checks failed or missing';
  END IF;
END;
$results$;
SELECT count(*) AS passed_checks FROM pg_temp.offerer_continuation_results WHERE passed;
ROLLBACK;
