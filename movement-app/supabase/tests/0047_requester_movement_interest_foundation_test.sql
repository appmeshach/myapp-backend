BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.interest_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.interest_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.interest_results(
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
ON FUNCTION pg_temp.interest_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.interest_as(
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
ON FUNCTION pg_temp.interest_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Trusted offering fixture
-- =========================================================

CREATE FUNCTION pg_temp.interest_offering_fixture(
  p_label text,
  p_total_places integer DEFAULT 3,
  p_departure interval DEFAULT interval '1 hour'
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
  m uuid := gen_random_uuid();
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
    m::text || '@test-0047-offerer.invalid',
    clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    clock_timestamp(),
    clock_timestamp()
  );


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
    pg_temp.interest_as(
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
      '0047 offering fixture intent failed: %',
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
    'T0047-' || left(v::text, 8)
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
    pg_temp.interest_as(
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
      '0047 offering fixture availability failed: %',
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

CREATE FUNCTION pg_temp.interest_requester_fixture(
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
    m::text || '@test-0047-requester.invalid',
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
    pg_temp.interest_as(
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
      '0047 requester fixture need failed: %',
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

CREATE FUNCTION pg_temp.interest_match(p_need uuid,p_intent uuid,p_route uuid,p_expiry timestamptz DEFAULT NULL)
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

CREATE FUNCTION pg_temp.interest_create(p_member uuid,p_request uuid,p_need uuid,p_availability uuid,p_evidence uuid)
RETURNS jsonb LANGUAGE sql AS $call$
  SELECT pg_temp.interest_as('authenticated',p_member,format(
    'SELECT * FROM public.create_requester_movement_interest(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
    p_request,p_need,p_availability,p_evidence));
$call$;

CREATE FUNCTION pg_temp.interest_read(p_member uuid,p_interest uuid)
RETURNS jsonb LANGUAGE sql AS $call$
  SELECT pg_temp.interest_as('authenticated',p_member,format(
    'SELECT * FROM public.get_requester_movement_interest(%L::uuid)',p_interest));
$call$;

-- Compare complete operational rows, including timestamps, not just counts.
CREATE FUNCTION pg_temp.interest_operational_snapshot()
RETURNS jsonb LANGUAGE sql AS $snapshot$
  SELECT jsonb_build_object(
    'availability',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.offering_movement_availability x),
    'offers',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.movement_offers x),
    'alignments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.alignments x),
    'journeys',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.journeys x),
    'needs',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.movement_needs x),
    'participants',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.movement_participants x));
$snapshot$;

DO $test$
DECLARE
  a record; b record; n record; other_n record; short_a record; short_n record;
  e uuid; eb uuid; other_e uuid; short_e uuid; route_id uuid; self_need uuid;
  request_id uuid := gen_random_uuid();
  interest_id uuid; second_id uuid;
  r jsonb; replay jsonb; before_rows jsonb; after_rows jsonb;
  scenario text; command text; field text; rejected boolean; hidden boolean;
  stored private.requester_movement_interests%ROWTYPE;
BEGIN
  SELECT * INTO a FROM pg_temp.interest_offering_fixture('primary',3);
  SELECT * INTO b FROM pg_temp.interest_offering_fixture('second',3);
  SELECT * INTO n FROM pg_temp.interest_requester_fixture('requester',2);
  SELECT * INTO other_n FROM pg_temp.interest_requester_fixture('other',1);
  e := pg_temp.interest_match(n.movement_need_id,a.intent_id,a.route_id);
  eb := pg_temp.interest_match(n.movement_need_id,b.intent_id,b.route_id);
  other_e := pg_temp.interest_match(other_n.movement_need_id,a.intent_id,a.route_id);

  r := pg_temp.interest_read(a.member_id,gen_random_uuid());
  PERFORM pg_temp.interest_check('no requester exposure before explicit interest',r->>'ok'='true' AND r->'rows'='[]',r::text);
  before_rows := pg_temp.interest_operational_snapshot();
  r := pg_temp.interest_create(n.member_id,request_id,n.movement_need_id,a.availability_id,e);
  interest_id := (r#>>'{rows,0,interest_id}')::uuid;
  PERFORM pg_temp.interest_check('authenticated requester creates exact supported interest',r->>'ok'='true' AND interest_id IS NOT NULL,r::text);
  IF interest_id IS NULL THEN RAISE EXCEPTION 'Interest fixture failed: %',r; END IF;
  SELECT * INTO STRICT stored FROM private.requester_movement_interests WHERE id=interest_id;
  PERFORM pg_temp.interest_check('immutable requester offerer availability intent and evidence bindings',
    stored.request_id=request_id AND stored.movement_need_id=n.movement_need_id
    AND stored.requesting_member_id=n.member_id AND stored.offering_member_id=a.member_id
    AND stored.availability_id=a.availability_id AND stored.offering_movement_intent_id=a.intent_id
    AND stored.route_match_evidence_id=e AND stored.route_match_evidence_version=1 AND stored.status='active');
  PERFORM pg_temp.interest_check('write result contains only safe fields',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r#>'{rows,0}') k)=ARRAY['created_at','interest_id','interest_status']);
  after_rows := pg_temp.interest_operational_snapshot();
  FOREACH field IN ARRAY ARRAY['availability','offers','alignments','journeys','needs','participants'] LOOP
    PERFORM pg_temp.interest_check('creation leaves operational '||field||' unchanged',
      before_rows->field IS NOT DISTINCT FROM after_rows->field);
  END LOOP;
  replay := pg_temp.interest_create(n.member_id,request_id,n.movement_need_id,a.availability_id,e);
  PERFORM pg_temp.interest_check('exact request replay returns same interest and timestamp',replay=r,replay::text);
  FOR scenario IN SELECT unnest(ARRAY['need','availability','evidence']) LOOP
    replay := pg_temp.interest_create(n.member_id,request_id,
      CASE WHEN scenario='need' THEN other_n.movement_need_id ELSE n.movement_need_id END,
      CASE WHEN scenario='availability' THEN b.availability_id ELSE a.availability_id END,
      CASE WHEN scenario='evidence' THEN eb ELSE e END);
    PERFORM pg_temp.interest_check('changed replay '||scenario||' rejected',replay->>'state'='23514',replay::text);
  END LOOP;
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
  PERFORM pg_temp.interest_check('duplicate active same need availability rejected',r->>'state'='23505',r::text);
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,b.availability_id,eb);
  second_id := (r#>>'{rows,0,interest_id}')::uuid;
  PERFORM pg_temp.interest_check('same need has active interests in two different availabilities',
    second_id IS NOT NULL AND (SELECT count(*)=2 FROM private.requester_movement_interests
    WHERE movement_need_id=n.movement_need_id AND status='active'),r::text);
  r := pg_temp.interest_create(other_n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
  PERFORM pg_temp.interest_check('unrelated member cannot create for another need',r->>'state'='42501',r::text);
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,other_e);
  PERFORM pg_temp.interest_check('evidence from different requester need rejected',r->>'state'='23514',r::text);
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,eb);
  PERFORM pg_temp.interest_check('evidence from different availability route rejected',r->>'state'='23514',r::text);

  -- Self-interest is rejected by the reused trusted context before evidence use.
  r := pg_temp.interest_as('authenticated',a.member_id,format(
    'SELECT * FROM public.create_movement_need(%L::uuid,%L::uuid,%L::uuid,%L::timestamptz,%L::timestamptz,1)',
    gen_random_uuid(),
    (SELECT location_reference_id FROM private.offering_movement_intent_locations WHERE intent_id=a.intent_id AND role='origin'),
    (SELECT location_reference_id FROM private.offering_movement_intent_locations WHERE intent_id=a.intent_id AND role='destination'),
    clock_timestamp()+interval '1 hour',clock_timestamp()+interval '2 hours'));
  self_need := (r#>>'{rows,0,movement_need_id}')::uuid;
  IF self_need IS NULL THEN RAISE EXCEPTION 'Self need fixture failed: %',r; END IF;
  r := pg_temp.interest_create(a.member_id,gen_random_uuid(),self_need,a.availability_id,e);
  PERFORM pg_temp.interest_check('self interest rejected',r->>'state'='23514' AND r->>'message' LIKE '%own movement need%',r::text);

  r := pg_temp.interest_read(a.member_id,interest_id);
  PERFORM pg_temp.interest_check('correct offerer sees explicit interest',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1,r::text);
  PERFORM pg_temp.interest_check('offerer receives exactly safe fields',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r#>'{rows,0}') k)=ARRAY[
      'created_at','destination_area','earliest_departure_at','interest_id','latest_departure_at',
      'movement_need_id','origin_area','people_count','requester_origin_distance_to_route_meters']);
  PERFORM pg_temp.interest_check('trusted broad areas and large objective distance retained',
    r#>>'{rows,0,origin_area}'='Ologolo, Lagos' AND r#>>'{rows,0,destination_area}'='Ikeja, Lagos'
    AND r#>>'{rows,0,people_count}'='2' AND r#>>'{rows,0,requester_origin_distance_to_route_meters}'='250000',r::text);
  r := pg_temp.interest_read(b.member_id,interest_id);
  PERFORM pg_temp.interest_check('unrelated offerer cannot read interest',r->>'ok'='true' AND r->'rows'='[]',r::text);
  r := pg_temp.interest_read(n.member_id,interest_id);
  PERFORM pg_temp.interest_check('offerer read is not requester enumeration',r->>'ok'='true' AND r->'rows'='[]',r::text);

  -- Restore each support mutation via a subtransaction, without bypassing any
  -- immutable trigger. Both create/replay and offerer read must fail closed.
  FOREACH scenario IN ARRAY ARRAY['withdrawn','unavailable','full','group_fit','need_paused','evidence_superseded','access_revoked'] LOOP
    BEGIN
      CASE scenario
        WHEN 'withdrawn' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a.availability_id;
        WHEN 'unavailable' THEN UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=a.availability_id;
        WHEN 'full' THEN UPDATE private.offering_movement_availability SET status='full',remaining_places=0 WHERE id=a.availability_id;
        WHEN 'group_fit' THEN UPDATE private.offering_movement_availability SET remaining_places=1 WHERE id=a.availability_id;
        WHEN 'need_paused' THEN UPDATE public.movement_needs SET status='paused' WHERE id=n.movement_need_id;
        WHEN 'evidence_superseded' THEN UPDATE private.trusted_route_match_evidence SET status='superseded' WHERE id=e;
        WHEN 'access_revoked' THEN UPDATE public.member_vehicle_access SET active=false WHERE member_id=a.member_id AND vehicle_id=a.vehicle_id;
      END CASE;
      r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
      rejected := r->>'state'='23514';
      replay := pg_temp.interest_read(a.member_id,interest_id);
      hidden := replay->>'ok'='true' AND replay->'rows'='[]';
      RAISE SQLSTATE 'ZX047';
    EXCEPTION WHEN SQLSTATE 'ZX047' THEN NULL;
    END;
    PERFORM pg_temp.interest_check('creation rejects '||scenario,rejected,r::text);
    PERFORM pg_temp.interest_check('later '||scenario||' support is not actionable',hidden,replay::text);
  END LOOP;

  BEGIN
    SELECT x.route_evidence_id INTO route_id FROM public.record_offering_route_evidence_for_server(
      a.intent_id,'test_router','directions','v1','new-route',
      '{"type":"LineString","coordinates":[[3.5200,6.4300],[3.4900,6.4320],[3.4600,6.4330],[3.4219,6.4281]]}'::jsonb,
      13000,1600,clock_timestamp(),NULL) x;
    other_e := pg_temp.interest_match(n.movement_need_id,a.intent_id,route_id);
    r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,other_e);
    rejected := r->>'state'='23514';
    replay := pg_temp.interest_read(a.member_id,interest_id);
    hidden := replay->'rows'='[]';
    RAISE SQLSTATE 'ZX047';
  EXCEPTION WHEN SQLSTATE 'ZX047' THEN NULL;
  END;
  PERFORM pg_temp.interest_check('new current route cannot authorize old availability',rejected,r::text);
  PERFORM pg_temp.interest_check('old interest nonactionable after route replacement',hidden,replay::text);

  -- Time expiry uses real bounded evidence; never changes immutable timestamps.
  SELECT * INTO short_n FROM pg_temp.interest_requester_fixture('short-match',1);
  short_e := pg_temp.interest_match(short_n.movement_need_id,a.intent_id,a.route_id,clock_timestamp()+interval '2 seconds');
  r := pg_temp.interest_create(short_n.member_id,gen_random_uuid(),short_n.movement_need_id,a.availability_id,short_e);
  route_id := (r#>>'{rows,0,interest_id}')::uuid;
  IF route_id IS NULL THEN RAISE EXCEPTION 'Short interest fixture failed: %',r; END IF;
  PERFORM pg_sleep(2.1);
  r := pg_temp.interest_create(short_n.member_id,gen_random_uuid(),short_n.movement_need_id,a.availability_id,short_e);
  PERFORM pg_temp.interest_check('expired route match evidence rejected',r->>'state'='23514',r::text);
  r := pg_temp.interest_read(a.member_id,route_id);
  PERFORM pg_temp.interest_check('expired evidence interest not actionable',r->'rows'='[]',r::text);
  UPDATE private.requester_movement_interests SET status='expired' WHERE id=route_id;
  BEGIN
    UPDATE private.requester_movement_interests SET status='active' WHERE id=route_id;
    rejected := false;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  PERFORM pg_temp.interest_check('expired history cannot reopen',rejected);

  SELECT * INTO short_a FROM pg_temp.interest_offering_fixture('short-availability',3,interval '2 seconds');
  short_e := pg_temp.interest_match(n.movement_need_id,short_a.intent_id,short_a.route_id);
  PERFORM pg_sleep(2.1);
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,short_a.availability_id,short_e);
  PERFORM pg_temp.interest_check('elapsed availability rejected',r->>'state'='23514',r::text);
  UPDATE private.offering_movement_availability SET status='expired' WHERE id=short_a.availability_id;
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,short_a.availability_id,short_e);
  PERFORM pg_temp.interest_check('expired availability status rejected',r->>'state'='23514',r::text);

  FOREACH scenario IN ARRAY ARRAY['request','need','availability','evidence'] LOOP
    r := pg_temp.interest_create(n.member_id,
      CASE WHEN scenario='request' THEN NULL ELSE gen_random_uuid() END,
      CASE WHEN scenario='need' THEN NULL ELSE n.movement_need_id END,
      CASE WHEN scenario='availability' THEN NULL ELSE a.availability_id END,
      CASE WHEN scenario='evidence' THEN NULL ELSE e END);
    PERFORM pg_temp.interest_check('null '||scenario||' rejected',r->>'state'='22004',r::text);
  END LOOP;
  r := pg_temp.interest_create(NULL,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
  PERFORM pg_temp.interest_check('missing authenticated identity rejected',r->>'state'='42501',r::text);
  FOREACH scenario IN ARRAY ARRAY['anon','service_role'] LOOP
    r := pg_temp.interest_as(scenario,n.member_id,format(
      'SELECT * FROM public.create_requester_movement_interest(%L::uuid,%L::uuid,%L::uuid,%L::uuid)',
      gen_random_uuid(),n.movement_need_id,a.availability_id,e));
    PERFORM pg_temp.interest_check(scenario||' cannot execute create',r->>'state'='42501',r::text);
  END LOOP;
  PERFORM pg_temp.interest_check('authenticated has only controlled RPC access',
    has_function_privilege('authenticated','public.create_requester_movement_interest(uuid,uuid,uuid,uuid)','EXECUTE')
    AND NOT has_table_privilege('authenticated','private.requester_movement_interests','SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('anon','private.requester_movement_interests','SELECT,INSERT,UPDATE,DELETE')
    AND NOT has_table_privilege('service_role','private.requester_movement_interests','INSERT,UPDATE,DELETE'));
  PERFORM pg_temp.interest_check('RLS enabled without client policies',
    (SELECT relrowsecurity FROM pg_class WHERE oid='private.requester_movement_interests'::regclass)
    AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.requester_movement_interests'::regclass));
  r := pg_temp.interest_as('authenticated',n.member_id,'SELECT * FROM private.requester_movement_interests');
  PERFORM pg_temp.interest_check('direct authenticated select denied',r->>'state'='42501',r::text);
  -- Execute actual direct DML under client role; restore it on every path.
  FOREACH command IN ARRAY ARRAY[
    'INSERT INTO private.requester_movement_interests DEFAULT VALUES',
    'UPDATE private.requester_movement_interests SET status=''withdrawn''',
    'DELETE FROM private.requester_movement_interests'] LOOP
    BEGIN
      SET LOCAL ROLE authenticated;
      EXECUTE command;
      RESET ROLE;
      rejected := false;
    EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; rejected := true;
    END;
    PERFORM pg_temp.interest_check('direct client DML denied: '||split_part(command,' ',1),rejected);
  END LOOP;
  FOR command IN SELECT unnest(ARRAY[
    format('DELETE FROM private.requester_movement_interests WHERE id=%L',interest_id),
    format('UPDATE private.requester_movement_interests SET route_match_evidence_version=2 WHERE id=%L',interest_id),
    format('UPDATE private.requester_movement_interests SET status=''expired'' WHERE id=%L',interest_id)]) LOOP
    BEGIN EXECUTE command; rejected := false;
    EXCEPTION WHEN check_violation THEN rejected := true;
    END;
    PERFORM pg_temp.interest_check('history protection: '||command,rejected);
  END LOOP;

  before_rows := pg_temp.interest_operational_snapshot();
  r := pg_temp.interest_as('authenticated',b.member_id,format(
    'SELECT * FROM public.withdraw_requester_movement_interest(%L::uuid)',interest_id));
  PERFORM pg_temp.interest_check('only requester may withdraw',r->>'state'='42501',r::text);
  r := pg_temp.interest_as('authenticated',n.member_id,format(
    'SELECT * FROM public.withdraw_requester_movement_interest(%L::uuid)',interest_id));
  PERFORM pg_temp.interest_check('requester withdraws active interest',r#>>'{rows,0,interest_status}'='withdrawn',r::text);
  replay := pg_temp.interest_as('authenticated',n.member_id,format(
    'SELECT * FROM public.withdraw_requester_movement_interest(%L::uuid)',interest_id));
  PERFORM pg_temp.interest_check('withdrawal exact repeat is idempotent',replay=r,replay::text);
  PERFORM pg_temp.interest_check('withdrawal leaves all operational rows unchanged',before_rows=pg_temp.interest_operational_snapshot());
  replay := pg_temp.interest_create(n.member_id,request_id,n.movement_need_id,a.availability_id,e);
  PERFORM pg_temp.interest_check('historical request replay stays withdrawn',replay=r,replay::text);
  r := pg_temp.interest_read(a.member_id,interest_id);
  PERFORM pg_temp.interest_check('withdrawn interest hidden from offerer',r->'rows'='[]',r::text);
  BEGIN
    UPDATE private.requester_movement_interests SET status='active' WHERE id=interest_id;
    rejected := false;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  PERFORM pg_temp.interest_check('withdrawn history cannot reopen',rejected);
  -- Current exact evidence still supports a NEW explicit write. There is no
  -- lifetime pair uniqueness; future fresh evidence is likewise not excluded.
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
  PERFORM pg_temp.interest_check('new request permits historical reinterest without reopening',
    r->>'ok'='true' AND (r#>>'{rows,0,interest_id}')::uuid<>interest_id,r::text);
END;
$test$;

SELECT * FROM pg_temp.interest_results ORDER BY test_number;
DO $results$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.interest_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0047 interest behavior test failed';
  END IF;
END;
$results$;
ROLLBACK;
