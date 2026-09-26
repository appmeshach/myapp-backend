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
  p_people_count integer DEFAULT 1,
  p_earliest interval DEFAULT interval '45 minutes',
  p_latest interval DEFAULT interval '2 hours'
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
        clock_timestamp() + p_earliest,
        clock_timestamp() + p_latest,
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

CREATE FUNCTION pg_temp.offer_interest(p_member uuid,p_interest uuid,p_seats integer DEFAULT 2)
RETURNS jsonb LANGUAGE sql AS $call$
  SELECT pg_temp.interest_as('authenticated',p_member,format(
    'SELECT * FROM public.create_movement_offer_from_interest(%L::uuid,%L::integer)',p_interest,p_seats));
$call$;

DO $test$
DECLARE
  a record; b record; n record; other_n record; short_n record;
  e uuid; other_e uuid; i uuid; short_i uuid; short_e uuid; offer_id uuid; other_offer uuid;
  r jsonb; before_rows jsonb; evidence_before jsonb; interest_before jsonb;
  scenario text; command text; rejected boolean;
BEGIN
  SELECT * INTO a FROM pg_temp.interest_offering_fixture('continuation',3);
  SELECT * INTO b FROM pg_temp.interest_offering_fixture('unrelated',3);
  SELECT * INTO n FROM pg_temp.interest_requester_fixture('requester',2);
  e := pg_temp.interest_match(n.movement_need_id,a.intent_id,a.route_id);
  r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
  i := (r#>>'{rows,0,interest_id}')::uuid;
  IF i IS NULL THEN RAISE EXCEPTION 'Interest fixture failed: %',r; END IF;
  r := pg_temp.offer_interest(b.member_id,i);
  PERFORM pg_temp.interest_check('unrelated offerer denied',r->>'state'='42501',r::text);
  r := pg_temp.offer_interest(n.member_id,i);
  PERFORM pg_temp.interest_check('requester cannot act as offerer',r->>'state'='42501',r::text);
  r := pg_temp.offer_interest(NULL,i);
  PERFORM pg_temp.interest_check('missing auth denied',r->>'state'='42501',r::text);
  r := pg_temp.offer_interest(a.member_id,NULL);
  PERFORM pg_temp.interest_check('null interest denied',r->>'state'='22004',r::text);
  r := pg_temp.offer_interest(a.member_id,gen_random_uuid());
  PERFORM pg_temp.interest_check('missing interest denied',r->>'state'='42501',r::text);
  r := pg_temp.interest_as('authenticated',a.member_id,
    'SELECT * FROM public.create_movement_offer_from_interest(''bad-id''::uuid,2)');
  PERFORM pg_temp.interest_check('malformed UUID denied',r->>'state'='22P02',r::text);
  FOREACH scenario IN ARRAY ARRAY['anon','service_role'] LOOP
    r := pg_temp.interest_as(scenario,a.member_id,format(
      'SELECT * FROM public.create_movement_offer_from_interest(%L::uuid,2)',i));
    PERFORM pg_temp.interest_check(scenario||' denied',r->>'state'='42501',r::text);
  END LOOP;
  FOREACH scenario IN ARRAY ARRAY['authenticated','anon','service_role'] LOOP
    PERFORM pg_temp.interest_check('private helper revoked from '||scenario,
      NOT has_function_privilege(scenario,
        'private.create_movement_offer_internal(uuid,uuid,uuid,integer,text,text,integer)','EXECUTE'));
  END LOOP;
  PERFORM pg_temp.interest_check('authenticated public RPC only',
    has_function_privilege('authenticated','public.create_movement_offer_from_interest(uuid,integer,text,text,integer)','EXECUTE')
    AND NOT has_table_privilege('authenticated','private.requester_movement_interests','SELECT,INSERT,UPDATE,DELETE'));

  -- Legal support mutations are rolled back without bypassing any trigger.
  FOREACH scenario IN ARRAY ARRAY['interest_withdrawn','availability_withdrawn','unavailable','full',
    'group_fit','need_paused','need_closed','evidence_superseded','access_revoked'] LOOP
    BEGIN
      CASE scenario
        WHEN 'interest_withdrawn' THEN UPDATE private.requester_movement_interests SET status='withdrawn' WHERE id=i;
        WHEN 'availability_withdrawn' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a.availability_id;
        WHEN 'unavailable' THEN UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=a.availability_id;
        WHEN 'full' THEN UPDATE private.offering_movement_availability SET status='full',remaining_places=0 WHERE id=a.availability_id;
        WHEN 'group_fit' THEN UPDATE private.offering_movement_availability SET remaining_places=1 WHERE id=a.availability_id;
        WHEN 'need_paused' THEN UPDATE public.movement_needs SET status='paused' WHERE id=n.movement_need_id;
        WHEN 'need_closed' THEN UPDATE public.movement_needs SET status='closed' WHERE id=n.movement_need_id;
        WHEN 'evidence_superseded' THEN UPDATE private.trusted_route_match_evidence SET status='superseded' WHERE id=e;
        WHEN 'access_revoked' THEN UPDATE public.member_vehicle_access SET active=false WHERE member_id=a.member_id AND vehicle_id=a.vehicle_id;
      END CASE;
      before_rows := pg_temp.interest_operational_snapshot();
      r := pg_temp.offer_interest(a.member_id,i);
      rejected := r->>'ok'='false' AND before_rows=pg_temp.interest_operational_snapshot();
      RAISE SQLSTATE 'ZX049';
    EXCEPTION WHEN SQLSTATE 'ZX049' THEN NULL;
    END;
    PERFORM pg_temp.interest_check('rejects '||scenario||' atomically',rejected,r::text);
  END LOOP;
  BEGIN
    PERFORM public.record_offering_route_evidence_for_server(
      a.intent_id,'test_router','directions','v1','replacement',
      '{"type":"LineString","coordinates":[[3.5200,6.4300],[3.4900,6.4320],[3.4600,6.4330],[3.4219,6.4281]]}'::jsonb,
      13000,1600,clock_timestamp(),NULL);
    r := pg_temp.offer_interest(a.member_id,i);
    rejected := r->>'ok'='false';
    RAISE SQLSTATE 'ZX049';
  EXCEPTION WHEN SQLSTATE 'ZX049' THEN NULL;
  END;
  PERFORM pg_temp.interest_check('replaced offering route denied',rejected,r::text);

  FOREACH command IN ARRAY ARRAY['NULL,NULL,NULL,NULL','0,NULL,NULL,NULL','1,NULL,NULL,NULL',
    '4,NULL,NULL,NULL','2,NULL,NULL,-1','2,repeat(''x'',201),NULL,NULL','2,NULL,repeat(''x'',201),NULL'] LOOP
    r := pg_temp.interest_as('authenticated',a.member_id,format(
      'SELECT * FROM public.create_movement_offer_from_interest(%L::uuid,%s)',i,command));
    PERFORM pg_temp.interest_check('interest proposal rejects '||command,r->>'ok'='false',r::text);
    r := pg_temp.interest_as('authenticated',a.member_id,format(
      'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,%s)',n.movement_need_id,e,a.availability_id,command));
    PERFORM pg_temp.interest_check('request-first proposal rejects '||command,r->>'ok'='false',r::text);
  END LOOP;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY id) INTO evidence_before FROM private.trusted_route_match_evidence x;
  SELECT to_jsonb(x) INTO interest_before FROM private.requester_movement_interests x WHERE id=i;
  before_rows := pg_temp.interest_operational_snapshot()-'offers';
  r := pg_temp.interest_as('authenticated',a.member_id,format(
    'SELECT * FROM public.create_movement_offer_from_interest(%L::uuid,2,'' Pickup '','' Dropoff '',5)',i));
  offer_id := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.interest_check('own supported interest creates pending offer',
    r->>'ok'='true' AND offer_id IS NOT NULL AND r#>>'{rows,0,status}'='pending',r::text);
  IF offer_id IS NULL THEN RAISE EXCEPTION 'Offer fixture failed: %',r; END IF;
  PERFORM pg_temp.interest_check('safe exact return shape',
    (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(r#>'{rows,0}') k)
      = ARRAY['created_at','movement_offer_id','status']);
  PERFORM pg_temp.interest_check('derived need offerer vehicle and proposal',EXISTS(
    SELECT 1 FROM public.movement_offers o WHERE o.id=offer_id AND o.movement_need_id=n.movement_need_id
      AND o.offering_member_id=a.member_id AND o.vehicle_id=a.vehicle_id AND o.seats_offered=2
      AND o.proposed_pickup_area='Pickup' AND o.proposed_dropoff_area='Dropoff' AND o.estimated_arrival_minutes=5));
  PERFORM pg_temp.interest_check('exact objective evidence and intent bound',EXISTS(
    SELECT 1 FROM private.movement_offer_route_match_bindings rb
    JOIN private.requester_movement_interests ri ON ri.route_match_evidence_id=rb.route_match_evidence_id
      AND ri.route_match_evidence_version=rb.route_match_evidence_version
    WHERE rb.movement_offer_id=offer_id AND ri.id=i AND rb.offering_movement_intent_id=a.intent_id));
  PERFORM pg_temp.interest_check('exact availability bound',EXISTS(
    SELECT 1 FROM private.movement_offer_availability_bindings ab
    WHERE ab.movement_offer_id=offer_id AND ab.availability_id=a.availability_id));
  PERFORM pg_temp.interest_check('no evidence created or rewritten',evidence_before=
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM private.trusted_route_match_evidence x));
  PERFORM pg_temp.interest_check('interest unchanged',interest_before=
    (SELECT to_jsonb(x) FROM private.requester_movement_interests x WHERE id=i));
  PERFORM pg_temp.interest_check('capacity needs participants alignments journeys unchanged',
    before_rows=pg_temp.interest_operational_snapshot()-'offers');
  PERFORM pg_temp.interest_check('large distance retained',
    (SELECT requester_origin_distance_to_route_meters=250000 FROM private.trusted_route_match_evidence WHERE id=e));
  before_rows := pg_temp.interest_operational_snapshot();
  r := pg_temp.offer_interest(a.member_id,i);
  PERFORM pg_temp.interest_check('existing evidence offer uniqueness preserved atomically',
    r->>'state'='23505' AND before_rows=pg_temp.interest_operational_snapshot(),r::text);

  SELECT * INTO other_n FROM pg_temp.interest_requester_fixture('request-first',1);
  other_e := pg_temp.interest_match(other_n.movement_need_id,a.intent_id,a.route_id);
  r := pg_temp.interest_as('authenticated',a.member_id,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',other_n.movement_need_id,other_e,a.availability_id));
  other_offer := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.interest_check('request-first without any interest still works',other_offer IS NOT NULL,r::text);
  BEGIN
    UPDATE public.member_vehicle_access SET active=false WHERE member_id=a.member_id AND vehicle_id=a.vehicle_id;
    r := pg_temp.interest_as('authenticated',other_n.member_id,format('SELECT * FROM public.accept_movement_offer(%L::uuid)',other_offer));
    rejected := r->>'ok'='false' AND (SELECT remaining_places=3 FROM private.offering_movement_availability WHERE id=a.availability_id);
    RAISE SQLSTATE 'ZX049';
  EXCEPTION WHEN SQLSTATE 'ZX049' THEN NULL;
  END;
  PERFORM pg_temp.interest_check('acceptance revalidates support before capacity',rejected,r::text);
  r := pg_temp.interest_as('authenticated',other_n.member_id,format('SELECT * FROM public.accept_movement_offer(%L::uuid)',other_offer));
  PERFORM pg_temp.interest_check('acceptance alone consumes group capacity',r->>'ok'='true'
    AND (SELECT remaining_places=2 FROM private.offering_movement_availability WHERE id=a.availability_id),r::text);

  SELECT * INTO short_n FROM pg_temp.interest_requester_fixture('short-evidence',1);
  short_e := pg_temp.interest_match(short_n.movement_need_id,a.intent_id,a.route_id,clock_timestamp()+interval '2 seconds');
  r := pg_temp.interest_create(short_n.member_id,gen_random_uuid(),short_n.movement_need_id,a.availability_id,short_e);
  short_i := (r#>>'{rows,0,interest_id}')::uuid;
  IF short_i IS NULL THEN RAISE EXCEPTION 'Short fixture failed: %',r; END IF;
  PERFORM pg_sleep(2.1);
  r := pg_temp.offer_interest(a.member_id,short_i,1);
  PERFORM pg_temp.interest_check('expired evidence and elapsed interest rejected',r->>'ok'='false',r::text);
  UPDATE private.requester_movement_interests SET status='expired' WHERE id=short_i;
  r := pg_temp.offer_interest(a.member_id,short_i,1);
  PERFORM pg_temp.interest_check('expired status rejected',r->>'ok'='false',r::text);
  SELECT * INTO short_n FROM pg_temp.interest_requester_fixture('expired-need',1);
  short_e := pg_temp.interest_match(short_n.movement_need_id,a.intent_id,a.route_id);
  r := pg_temp.interest_create(short_n.member_id,gen_random_uuid(),short_n.movement_need_id,a.availability_id,short_e);
  short_i := (r#>>'{rows,0,interest_id}')::uuid;
  IF short_i IS NULL THEN RAISE EXCEPTION 'Expired need fixture failed: %',r; END IF;

  UPDATE public.movement_needs
  SET status='expired'
  WHERE id=short_n.movement_need_id;

  r := pg_temp.offer_interest(a.member_id,short_i,1);
  PERFORM pg_temp.interest_check('expired movement need rejected',r->>'ok'='false',r::text);
END;
$test$;

SELECT * FROM pg_temp.interest_results ORDER BY test_number;
SELECT count(*) AS total, count(*) FILTER (WHERE passed) AS passed FROM pg_temp.interest_results;
DO $results$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.interest_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0049 interest offer behavior test failed';
  END IF;
END;
$results$;
ROLLBACK;
