BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.inbox_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.inbox_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.inbox_results(
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
ON FUNCTION pg_temp.inbox_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.inbox_as(
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
ON FUNCTION pg_temp.inbox_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Trusted offering fixture
-- =========================================================

CREATE FUNCTION pg_temp.inbox_offering_fixture(
  p_label text,
  p_total_places integer DEFAULT 3,
  p_departure interval DEFAULT interval '1 hour',
  p_member_id uuid DEFAULT NULL
)
RETURNS TABLE (
  member_id uuid,
  intent_id uuid,
  route_id uuid,
  vehicle_id uuid,
  availability_id uuid
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  m uuid := coalesce(p_member_id, gen_random_uuid());
  v uuid := gen_random_uuid();

  i uuid;
  e uuid;
  a uuid;

  source_id uuid;
  resolved_id uuid;

  endpoints uuid[] := ARRAY[]::uuid[];

  n integer;
  place text;
  r jsonb;
BEGIN
  IF p_member_id IS NULL THEN
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
    m::text || '@test-0048-offerer.invalid',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );
  END IF;


  FOR n IN 1..2 LOOP
    place :=
      p_label || '-offerer-' || n;


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
        ELSE 'Victoria Island, Lagos'
      END,
      CASE n
        WHEN 1 THEN 6.4300
        ELSE 6.4281
      END,
      CASE n
        WHEN 1 THEN 3.5200
        ELSE 3.4219
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
    pg_temp.inbox_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.create_offering_movement_intent(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz
         )',
        gen_random_uuid(),
        endpoints[1],
        endpoints[2],
        clock_timestamp() + p_departure,
        clock_timestamp() + p_departure + interval '1 hour'
      )
    );


  i :=
    (
      r #>>
      '{rows,0,offering_movement_intent_id}'
    )::uuid;


  IF i IS NULL THEN
    RAISE EXCEPTION
      '0048 offering fixture intent failed: %',
      r;
  END IF;


  SELECT x.route_evidence_id
  INTO e
  FROM public.record_offering_route_evidence_for_server(
    i,
    'test_router',
    'directions',
    'v1',
    p_label || '-route',
    '{
      "type":"LineString",
      "coordinates":[
        [3.5200,6.4300],
        [3.4900,6.4320],
        [3.4600,6.4330],
        [3.4219,6.4281]
      ]
    }'::jsonb,
    12000,
    1500,
    clock_timestamp(),
    NULL
  ) x;


  INSERT INTO public.vehicles(
    id,
    make,
    model,
    year,
    color,
    seat_capacity,
    plate_number
  )
  VALUES (
    v,
    'Test make',
    'Test model',
    2020,
    'Blue',
    greatest(p_total_places, 1),
    'T0048-' || left(v::text, 8)
  );


  INSERT INTO public.member_vehicle_access(
    member_id,
    vehicle_id,
    active
  )
  VALUES (
    m,
    v,
    true
  );


  r :=
    pg_temp.inbox_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.open_offering_movement_availability(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %s
         )',
        gen_random_uuid(),
        i,
        v,
        p_total_places
      )
    );


  a :=
    (
      r #>>
      '{rows,0,availability_id}'
    )::uuid;


  IF a IS NULL THEN
    RAISE EXCEPTION
      '0048 offering fixture availability failed: %',
      r;
  END IF;


  RETURN QUERY
  SELECT
    m,
    i,
    e,
    v,
    a;
END;
$fixture$;


-- =========================================================
-- Trusted requester fixture
-- =========================================================

CREATE FUNCTION pg_temp.inbox_requester_fixture(
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
    m::text || '@test-0048-requester.invalid',
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
    pg_temp.inbox_as(
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
        clock_timestamp() + interval '45 minutes',
        clock_timestamp() + interval '2 hours',
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
      '0048 requester fixture need failed: %',
      r;
  END IF;


  RETURN QUERY
  SELECT
    m,
    need_id;
END;
$fixture$;


-- =========================================================
-- Behavioral matrix
-- =========================================================

CREATE FUNCTION pg_temp.inbox_match(p_need uuid,p_intent uuid,p_route uuid,p_expiry timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $match$
DECLARE v_id uuid; v_version integer;
BEGIN
  SELECT version INTO STRICT v_version FROM private.offering_route_evidence WHERE id=p_route;
  SELECT route_match_evidence_id INTO v_id
  FROM public.record_trusted_route_match_evidence_for_server(
    p_need,p_intent,p_route,v_version,250000,400000,18000,1000,12000,
    6.4300,3.5200,6.4310,3.4430,clock_timestamp(),p_expiry);
  RETURN v_id;
END;
$match$;

CREATE FUNCTION pg_temp.inbox_create(p_member uuid,p_request uuid,p_need uuid,p_availability uuid,p_evidence uuid)
RETURNS jsonb LANGUAGE sql AS $call$
  SELECT pg_temp.inbox_as('authenticated',p_member,format(
    'SELECT * FROM public.create_requester_movement_interest(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    p_request,p_need,p_availability,p_evidence));
$call$;

CREATE FUNCTION pg_temp.inbox_list(p_member uuid,p_availability uuid DEFAULT NULL,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql AS $call$
  SELECT pg_temp.inbox_as('authenticated',p_member,format(
    'SELECT * FROM public.list_requester_movement_interests_for_offerer(%L::uuid,%L::integer)',p_availability,p_limit));
$call$;

-- Compare complete operational rows, including timestamps, not just counts.
CREATE FUNCTION pg_temp.inbox_operational_snapshot()
RETURNS jsonb LANGUAGE sql AS $snapshot$
  SELECT jsonb_build_object(
    'interests',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.requester_movement_interests x),
    'availability',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.offering_movement_availability x),
    'offers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.movement_offers x),
    'alignments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.alignments x),
    'journeys',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.journeys x),
    'needs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.movement_needs x),
    'participants',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.movement_participants x));
$snapshot$;

CREATE FUNCTION pg_temp.inbox_interest_fixture(p_member uuid,p_need uuid,p_availability uuid,p_evidence uuid)
RETURNS uuid LANGUAGE plpgsql AS $fixture$
DECLARE r jsonb; v_id uuid;
BEGIN
  r := pg_temp.inbox_create(p_member,gen_random_uuid(),p_need,p_availability,p_evidence);
  v_id := (r#>>'{rows,0,interest_id}')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION '0048 interest fixture failed: %',r; END IF;
  RETURN v_id;
END;
$fixture$;

DO $test$
DECLARE
  a record; b record; foreign_a record;
  n record; second_n record; no_interest_n record; tie_n record; short_n record; short_a record;
  e uuid; eb uuid; e_second uuid; e_foreign uuid; e_tie1 uuid; e_tie2 uuid; short_e uuid;
  i1 uuid; i2 uuid; i3 uuid; foreign_i uuid; tie1 uuid := gen_random_uuid(); tie2 uuid := gen_random_uuid(); short_i uuid;
  tie_time timestamptz; new_route uuid;
  r jsonb; r2 jsonb; baseline jsonb; before_rows jsonb; after_rows jsonb;
  expected_ids jsonb; actual_ids jsonb;
  scenario text; field text; command text; rejected boolean;
BEGIN
  SELECT * INTO a FROM pg_temp.inbox_offering_fixture('primary');
  SELECT * INTO b FROM pg_temp.inbox_offering_fixture('second-owned',3,interval '1 hour',a.member_id);
  SELECT * INTO foreign_a FROM pg_temp.inbox_offering_fixture('foreign');
  SELECT * INTO n FROM pg_temp.inbox_requester_fixture('primary',2);
  SELECT * INTO second_n FROM pg_temp.inbox_requester_fixture('second',1);
  SELECT * INTO no_interest_n FROM pg_temp.inbox_requester_fixture('private-only',1);
  SELECT * INTO tie_n FROM pg_temp.inbox_requester_fixture('tie',1);
  e := pg_temp.inbox_match(n.movement_need_id,a.intent_id,a.route_id);
  eb := pg_temp.inbox_match(n.movement_need_id,b.intent_id,b.route_id);
  e_second := pg_temp.inbox_match(second_n.movement_need_id,a.intent_id,a.route_id);
  e_foreign := pg_temp.inbox_match(n.movement_need_id,foreign_a.intent_id,foreign_a.route_id);
  e_tie1 := pg_temp.inbox_match(no_interest_n.movement_need_id,a.intent_id,a.route_id);
  e_tie2 := pg_temp.inbox_match(tie_n.movement_need_id,a.intent_id,a.route_id);

  r := pg_temp.inbox_list(a.member_id);
  PERFORM pg_temp.inbox_check('private route checks alone expose no requester',r->>'ok'='true' AND r->'rows'='[]',r::text);
  i1 := pg_temp.inbox_interest_fixture(n.member_id,n.movement_need_id,a.availability_id,e);
  i2 := pg_temp.inbox_interest_fixture(second_n.member_id,second_n.movement_need_id,a.availability_id,e_second);
  i3 := pg_temp.inbox_interest_fixture(n.member_id,n.movement_need_id,b.availability_id,eb);
  r := pg_temp.inbox_list(a.member_id);
  PERFORM pg_temp.inbox_check('authenticated offerer lists own actionable interests',r->>'ok'='true' AND jsonb_array_length(r->'rows')=3,r::text);
  PERFORM pg_temp.inbox_check('multiple requester needs appear',
    EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=n.movement_need_id::text)
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=second_n.movement_need_id::text));
  PERFORM pg_temp.inbox_check('same need in two caller-owned availabilities appears twice',
    (SELECT count(*)=2 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=n.movement_need_id::text));
  PERFORM pg_temp.inbox_check('unexpressed requester need stays hidden',
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'movement_need_id'=no_interest_n.movement_need_id::text));
  PERFORM pg_temp.inbox_check('return shape has exactly ten approved safe fields',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r#>'{rows,0}') k)=ARRAY[
      'availability_id','destination_area','earliest_departure_at','interest_created_at','interest_id',
      'latest_departure_at','movement_need_id','origin_area','people_count','requester_origin_distance_to_route_meters']);
  PERFORM pg_temp.inbox_check('broad trusted areas and large objective distance preserved',
    r#>>'{rows,0,origin_area}'='Ologolo, Lagos' AND r#>>'{rows,0,destination_area}'='Ikeja, Lagos'
    AND r#>>'{rows,0,requester_origin_distance_to_route_meters}'='250000',r::text);
  FOREACH field IN ARRAY ARRAY['latitude','longitude','location_reference_id','route_shape',
    'offering_movement_intent_id','route_evidence_id','route_match_evidence_id','member_id',
    'email','phone','gallery','storage_path','vehicle_id'] LOOP
    PERFORM pg_temp.inbox_check('no private output field: '||field,
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x,
        jsonb_object_keys(x) k WHERE k LIKE '%'||field||'%'));
  END LOOP;

  r := pg_temp.inbox_list(foreign_a.member_id);
  PERFORM pg_temp.inbox_check('unrelated offerer sees no interests',r->>'ok'='true' AND r->'rows'='[]',r::text);
  r := pg_temp.inbox_list(n.member_id);
  PERFORM pg_temp.inbox_check('requester cannot enumerate using offerer inbox',r->>'ok'='true' AND r->'rows'='[]',r::text);
  r := pg_temp.inbox_list(a.member_id,a.availability_id);
  PERFORM pg_temp.inbox_check('availability filter includes only owned selected availability',
    r->>'ok'='true' AND jsonb_array_length(r->'rows')=2 AND
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'availability_id'<>a.availability_id::text),r::text);
  r := pg_temp.inbox_list(a.member_id,b.availability_id);
  PERFORM pg_temp.inbox_check('second owned availability independently filterable',r#>>'{rows,0,interest_id}'=i3::text AND jsonb_array_length(r->'rows')=1,r::text);
  r := pg_temp.inbox_list(a.member_id,foreign_a.availability_id);
  r2 := pg_temp.inbox_list(a.member_id,gen_random_uuid());
  PERFORM pg_temp.inbox_check('foreign and nonexistent availability indistinguishable',r=r2 AND r->>'ok'='true' AND r->'rows'='[]',r::text);
  foreign_i := pg_temp.inbox_interest_fixture(n.member_id,n.movement_need_id,foreign_a.availability_id,e_foreign);
  r := pg_temp.inbox_list(a.member_id);
  PERFORM pg_temp.inbox_check('NULL filter lists across only caller-owned availabilities',
    jsonb_array_length(r->'rows')=3 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x
      WHERE x->>'interest_id'=foreign_i::text),r::text);

  -- Real equal timestamps exercise the id tiebreaker without modifying history
  -- or disabling insert assertions. Both rows use valid exact support.
  tie_time := clock_timestamp();
  INSERT INTO private.requester_movement_interests (
    id,request_id,movement_need_id,requesting_member_id,availability_id,offering_member_id,
    offering_movement_intent_id,route_match_evidence_id,route_match_evidence_version,created_at,expires_at
  ) SELECT tie1,gen_random_uuid(),no_interest_n.movement_need_id,no_interest_n.member_id,a.availability_id,
    a.member_id,a.intent_id,e_tie1,1,tie_time,x.expires_at FROM private.offering_movement_availability x WHERE x.id=a.availability_id;
  INSERT INTO private.requester_movement_interests (
    id,request_id,movement_need_id,requesting_member_id,availability_id,offering_member_id,
    offering_movement_intent_id,route_match_evidence_id,route_match_evidence_version,created_at,expires_at
  ) SELECT tie2,gen_random_uuid(),tie_n.movement_need_id,tie_n.member_id,a.availability_id,
    a.member_id,a.intent_id,e_tie2,1,tie_time,x.expires_at FROM private.offering_movement_availability x WHERE x.id=a.availability_id;
  r := pg_temp.inbox_list(a.member_id);
  baseline := r;
  SELECT jsonb_agg(x.id ORDER BY x.created_at,x.id) INTO expected_ids
    FROM private.requester_movement_interests x WHERE x.offering_member_id=a.member_id;
  SELECT jsonb_agg(x.value->'interest_id' ORDER BY x.ordinality) INTO actual_ids
    FROM jsonb_array_elements(r->'rows') WITH ORDINALITY x;
  PERFORM pg_temp.inbox_check('deterministic created_at ASC then id ASC including ties',actual_ids=expected_ids,r::text);
  PERFORM pg_temp.inbox_check('repeated reads retain deterministic ordering',pg_temp.inbox_list(a.member_id)=baseline);

  before_rows := pg_temp.inbox_operational_snapshot();
  r := pg_temp.inbox_list(a.member_id);
  r2 := pg_temp.inbox_list(a.member_id,a.availability_id);
  after_rows := pg_temp.inbox_operational_snapshot();
  FOREACH field IN ARRAY ARRAY['interests','availability','offers','alignments','journeys','needs','participants'] LOOP
    PERFORM pg_temp.inbox_check('inbox leaves all '||field||' rows and timestamps unchanged',
      before_rows->field IS NOT DISTINCT FROM after_rows->field);
  END LOOP;

  FOREACH scenario IN ARRAY ARRAY['withdrawn_interest','withdrawn_availability','unavailable','full',
    'group_fit','paused_need','closed_need','expired_need','superseded_match','revoked_access','vehicle_capacity','stale_intent'] LOOP
    BEGIN
      CASE scenario
        WHEN 'withdrawn_interest' THEN UPDATE private.requester_movement_interests SET status='withdrawn' WHERE id=i1;
        WHEN 'withdrawn_availability' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a.availability_id;
        WHEN 'unavailable' THEN UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=a.availability_id;
        WHEN 'full' THEN UPDATE private.offering_movement_availability SET status='full',remaining_places=0 WHERE id=a.availability_id;
        WHEN 'group_fit' THEN UPDATE private.offering_movement_availability SET remaining_places=1 WHERE id=a.availability_id;
        WHEN 'paused_need' THEN UPDATE public.movement_needs SET status='paused' WHERE id=n.movement_need_id;
        WHEN 'closed_need' THEN UPDATE public.movement_needs SET status='closed' WHERE id=n.movement_need_id;
        WHEN 'expired_need' THEN UPDATE public.movement_needs SET status='expired' WHERE id=n.movement_need_id;
        WHEN 'superseded_match' THEN UPDATE private.trusted_route_match_evidence SET status='superseded' WHERE id=e;
        WHEN 'revoked_access' THEN UPDATE public.member_vehicle_access SET active=false WHERE member_id=a.member_id AND vehicle_id=a.vehicle_id;
        WHEN 'vehicle_capacity' THEN UPDATE public.vehicles SET seat_capacity=2 WHERE id=a.vehicle_id;
        WHEN 'stale_intent' THEN UPDATE private.offering_movement_intents SET status='superseded' WHERE id=a.intent_id;
      END CASE;
      before_rows := pg_temp.inbox_operational_snapshot();
      r := pg_temp.inbox_list(a.member_id);
      rejected := r->>'ok'='true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'interest_id'=i1::text);
      after_rows := pg_temp.inbox_operational_snapshot();
      RAISE SQLSTATE 'ZT048';
    EXCEPTION WHEN SQLSTATE 'ZT048' THEN NULL;
    END;
    PERFORM pg_temp.inbox_check('excludes stale support: '||scenario,rejected,r::text);
    PERFORM pg_temp.inbox_check('stale read preserves history and operational rows: '||scenario,before_rows=after_rows);
  END LOOP;

  BEGIN
    UPDATE private.trusted_route_match_evidence SET status='superseded' WHERE id=e;
    r := pg_temp.inbox_list(a.member_id,NULL,1);
    rejected := r->>'ok'='true' AND jsonb_array_length(r->'rows')=1 AND r#>>'{rows,0,interest_id}'=i2::text;
    RAISE SQLSTATE 'ZT048';
  EXCEPTION WHEN SQLSTATE 'ZT048' THEN NULL;
  END;
  PERFORM pg_temp.inbox_check('stale earlier candidate does not consume result limit',rejected,r::text);

  BEGIN
    SELECT x.route_evidence_id INTO new_route FROM public.record_offering_route_evidence_for_server(
      a.intent_id,'test_router','directions','v1','inbox-replacement',
      '{"type":"LineString","coordinates":[[3.5200,6.4300],[3.4900,6.4320],[3.4600,6.4330],[3.4219,6.4281]]}'::jsonb,
      13000,1600,clock_timestamp(),NULL) x;
    r := pg_temp.inbox_list(a.member_id,a.availability_id);
    rejected := r->>'ok'='true' AND r->'rows'='[]';
    RAISE SQLSTATE 'ZT048';
  EXCEPTION WHEN SQLSTATE 'ZT048' THEN NULL;
  END;
  PERFORM pg_temp.inbox_check('replaced exact route support excluded',rejected,r::text);
  PERFORM pg_temp.inbox_check('unchanged exact current support still visible',pg_temp.inbox_list(a.member_id)=baseline);

  -- Expiry uses real time; immutable evidence timestamps are never edited.
  SELECT * INTO short_n FROM pg_temp.inbox_requester_fixture('short-evidence',1);
  short_e := pg_temp.inbox_match(short_n.movement_need_id,a.intent_id,a.route_id,clock_timestamp()+interval '2 seconds');
  short_i := pg_temp.inbox_interest_fixture(short_n.member_id,short_n.movement_need_id,a.availability_id,short_e);
  r := pg_temp.inbox_list(a.member_id);
  PERFORM pg_temp.inbox_check('short evidence is visible while supported',
    EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'interest_id'=short_i::text),r::text);
  PERFORM pg_sleep(2.1);
  r := pg_temp.inbox_list(a.member_id);
  PERFORM pg_temp.inbox_check('expired route match evidence excluded',
    r->>'ok'='true' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'interest_id'=short_i::text),r::text);
  PERFORM pg_temp.inbox_check('elapsed interest is hidden without rewriting active history',
    r=baseline AND (SELECT status='active' FROM private.requester_movement_interests WHERE id=short_i));
  UPDATE private.requester_movement_interests SET status='expired' WHERE id=short_i;
  PERFORM pg_temp.inbox_check('explicit expired interest status excluded',pg_temp.inbox_list(a.member_id)=baseline);

  SELECT * INTO short_a FROM pg_temp.inbox_offering_fixture('short-availability',3,interval '2 seconds',a.member_id);
  short_e := pg_temp.inbox_match(n.movement_need_id,short_a.intent_id,short_a.route_id);
  short_i := pg_temp.inbox_interest_fixture(n.member_id,n.movement_need_id,short_a.availability_id,short_e);
  PERFORM pg_sleep(2.1);
  r := pg_temp.inbox_list(a.member_id,short_a.availability_id);
  PERFORM pg_temp.inbox_check('elapsed availability excluded',r->>'ok'='true' AND r->'rows'='[]',r::text);
  UPDATE private.offering_movement_availability SET status='expired' WHERE id=short_a.availability_id;
  PERFORM pg_temp.inbox_check('expired availability status excluded',pg_temp.inbox_list(a.member_id)=baseline);

  r := pg_temp.inbox_as('authenticated',a.member_id,'SELECT * FROM public.list_requester_movement_interests_for_offerer()');
  PERFORM pg_temp.inbox_check('omitted arguments use NULL availability and default limit',r=baseline,r::text);
  r := pg_temp.inbox_list(a.member_id,NULL,1);
  PERFORM pg_temp.inbox_check('minimum limit returns earliest supported interest',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1 AND r#>>'{rows,0,interest_id}'=i1::text,r::text);
  r := pg_temp.inbox_list(a.member_id,NULL,50);
  PERFORM pg_temp.inbox_check('maximum limit accepted',r=baseline,r::text);
  FOREACH scenario IN ARRAY ARRAY['NULL','0','-1','51'] LOOP
    r := pg_temp.inbox_as('authenticated',a.member_id,
      'SELECT * FROM public.list_requester_movement_interests_for_offerer(NULL,'||scenario||')');
    PERFORM pg_temp.inbox_check('invalid limit rejected: '||scenario,r->>'state'='23514',r::text);
  END LOOP;
  FOREACH scenario IN ARRAY ARRAY['anon','service_role'] LOOP
    r := pg_temp.inbox_as(scenario,a.member_id,'SELECT * FROM public.list_requester_movement_interests_for_offerer()');
    PERFORM pg_temp.inbox_check(scenario||' cannot execute public inbox',r->>'state'='42501',r::text);
  END LOOP;
  r := pg_temp.inbox_list(NULL);
  PERFORM pg_temp.inbox_check('authenticated role without identity rejected',r->>'state'='42501',r::text);
  r := pg_temp.inbox_list(gen_random_uuid());
  PERFORM pg_temp.inbox_check('unknown member identity rejected',r->>'state'='42501',r::text);
  PERFORM pg_temp.inbox_check('only authenticated granted inbox execution',
    has_function_privilege('authenticated','public.list_requester_movement_interests_for_offerer(uuid,integer)','EXECUTE')
    AND NOT has_function_privilege('anon','public.list_requester_movement_interests_for_offerer(uuid,integer)','EXECUTE')
    AND NOT has_function_privilege('service_role','public.list_requester_movement_interests_for_offerer(uuid,integer)','EXECUTE'));
  FOREACH scenario IN ARRAY ARRAY['requester_movement_interests','offering_movement_availability','trusted_route_match_evidence'] LOOP
    r := pg_temp.inbox_as('authenticated',a.member_id,'SELECT * FROM private.'||scenario);
    PERFORM pg_temp.inbox_check('direct private read denied: '||scenario,r->>'state'='42501',r::text);
    PERFORM pg_temp.inbox_check('no client table privileges added: '||scenario,
      NOT has_table_privilege('authenticated','private.'||scenario,'SELECT,INSERT,UPDATE,DELETE')
      AND NOT has_table_privilege('anon','private.'||scenario,'SELECT,INSERT,UPDATE,DELETE'));
  END LOOP;
END;
$test$;

SELECT test_number,test_name,passed,diagnostic FROM pg_temp.inbox_results ORDER BY test_number;
SELECT count(*) AS total_checks,count(*) FILTER (WHERE passed) AS passed_checks,
  count(*) FILTER (WHERE NOT passed) AS failed_checks FROM pg_temp.inbox_results;
DO $results$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.inbox_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0048 inbox behavior test failed';
  END IF;
END;
$results$;
ROLLBACK;
