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
    m::text || '@test-0052.invalid',
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
      'mapbox-region-lagos',
      'Lagos',
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
  p_latest interval DEFAULT interval '2 hours',
  p_state text DEFAULT 'Lagos'
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
    m::text || '@test-0052.invalid',
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
      'mapbox-region-' || lower(p_state),
      p_state,
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

-- All fixtures use production writers/triggers. No clock override or trigger bypass.
CREATE FUNCTION pg_temp.deadline_denied(p_name text, p_result jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.interest_check(p_name,
    p_result->>'ok'='false' AND p_result->>'state'='23514'
    AND p_result->>'message'='Movement need is not available for matching',p_result::text);
END $$;

DO $test$
DECLARE
 a record; n record; w record; c record; foreign_n record;
 e uuid; we uuid; ce uuid; i uuid; offer_id uuid; good_offer uuid;
 r jsonb; before_rows jsonb; history jsonb; deadline timestamptz;
 rejected boolean; count_before bigint; accepted_alignment jsonb;
BEGIN
 SELECT * INTO a FROM pg_temp.interest_offering_fixture('0052-offerer',3);
 SELECT * INTO n FROM pg_temp.interest_requester_fixture('0052-single',1);
 SELECT * INTO w FROM pg_temp.interest_requester_fixture('0052-window',1);
 SELECT * INTO c FROM pg_temp.interest_requester_fixture('0052-current',1);
 SELECT * INTO foreign_n FROM pg_temp.interest_requester_fixture('0052-foreign',1,interval '45 minutes',interval '2 hours','Oyo');
 e := pg_temp.interest_match(n.movement_need_id,a.intent_id,a.route_id);
 we := pg_temp.interest_match(w.movement_need_id,a.intent_id,a.route_id);
 ce := pg_temp.interest_match(c.movement_need_id,a.intent_id,a.route_id);
 r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
 i := (r#>>'{rows,0,interest_id}')::uuid;
 IF i IS NULL THEN RAISE EXCEPTION 'Interest setup failed: %',r; END IF;
 r := pg_temp.offer_interest(a.member_id,i,1);
 offer_id := (r#>>'{rows,0,movement_offer_id}')::uuid;
 IF offer_id IS NULL THEN RAISE EXCEPTION 'Offer setup failed: %',r; END IF;

 -- Current controls and authorization checks run before starting short clocks.
 r := pg_temp.interest_as('authenticated',a.member_id,format(
 'SELECT * FROM public.create_movement_offer(%L,%L,%L,1)',c.movement_need_id,ce,a.availability_id));
 good_offer := (r#>>'{rows,0,movement_offer_id}')::uuid;
 IF good_offer IS NULL THEN RAISE EXCEPTION 'Current offer setup failed: %',r; END IF;
 r := pg_temp.interest_create(foreign_n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
 PERFORM pg_temp.interest_check('foreign requester denied',r->>'state'='42501',r::text);
 r := pg_temp.offer_interest(foreign_n.member_id,i,1);
 PERFORM pg_temp.interest_check('unrelated offerer denied',r->>'state'='42501',r::text);
 r := pg_temp.interest_as('anon',NULL,format('SELECT * FROM public.create_requester_movement_interest(%L,%L,%L,%L)',gen_random_uuid(),n.movement_need_id,a.availability_id,e));
 PERFORM pg_temp.interest_check('anonymous caller denied',r->>'state'='42501',r::text);
 r := pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,we);
 PERFORM pg_temp.interest_check('mismatched evidence denied',r->>'state'='23514',r::text);
 rejected:=false;
 BEGIN
 PERFORM public.get_trusted_matching_context_for_server(n.movement_need_id,a.intent_id,n.member_id);
 EXCEPTION WHEN check_violation THEN rejected:=true; END;
 PERFORM pg_temp.interest_check('self-match denied',rejected);

 -- Fully attested Oyo requester endpoints cannot match the Lagos route.
 rejected:=false;
 BEGIN
 PERFORM public.get_trusted_matching_context_for_server(foreign_n.movement_need_id,a.intent_id,a.member_id);
 EXCEPTION WHEN check_violation THEN
   rejected:=SQLERRM='Requester and offered movements are in different states';
 END;
 PERFORM pg_temp.interest_check('cross-state matching rejected',rejected);

 deadline:=clock_timestamp()+interval '4 seconds';
 UPDATE public.movement_needs SET earliest_departure_at=deadline,latest_departure_at=NULL WHERE id=n.movement_need_id;
 UPDATE public.movement_needs SET earliest_departure_at=deadline,latest_departure_at=deadline+interval '4 seconds' WHERE id=w.movement_need_id;
 UPDATE public.movement_needs SET earliest_departure_at=deadline,latest_departure_at=NULL WHERE id=c.movement_need_id;
 r := pg_temp.interest_as('authenticated',c.member_id,format('SELECT * FROM public.accept_movement_offer(%L)',good_offer));
 PERFORM pg_temp.interest_check('current acceptance succeeds',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1,r::text);
 SELECT to_jsonb(x) INTO STRICT accepted_alignment FROM public.alignments x WHERE movement_offer_id=good_offer;
 PERFORM public.get_trusted_matching_context_for_server(n.movement_need_id,a.intent_id,a.member_id);
 PERFORM pg_temp.interest_check('single request works before deadline',true);
 SELECT jsonb_build_array(to_jsonb(x),to_jsonb(y),to_jsonb(z),to_jsonb(o)) INTO history
 FROM public.movement_needs x,private.requester_movement_interests y,private.trusted_route_match_evidence z,public.movement_offers o
 WHERE x.id=n.movement_need_id AND y.id=i AND z.id=e AND o.id=offer_id;
 before_rows:=pg_temp.interest_operational_snapshot();
 SELECT count(*) INTO count_before FROM private.requester_movement_interests;
 PERFORM pg_sleep(greatest(0,extract(epoch FROM deadline-clock_timestamp()))+0.1);

 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.deadline_denied('expired single context rejected',r);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_requester_availability_matching_context_for_server(%L,%L,%L)',n.member_id,n.movement_need_id,a.availability_id));
 PERFORM pg_temp.deadline_denied('requester compatibility path rejected',r);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_authorized_trusted_matching_context_for_server(%L,%L,%L)',a.member_id,n.movement_need_id,a.intent_id));
 PERFORM pg_temp.deadline_denied('authorized compatibility path rejected',r);
 rejected:=false;
 BEGIN PERFORM pg_temp.interest_match(n.movement_need_id,a.intent_id,a.route_id);
 EXCEPTION WHEN check_violation THEN rejected:=SQLERRM='Movement need is not available for matching'; END;
 PERFORM pg_temp.interest_check('new route evidence rejected',rejected);
 rejected:=false;
 BEGIN PERFORM private.assert_trusted_route_match_evidence(e);
 EXCEPTION WHEN check_violation THEN rejected:=SQLERRM='Movement need is not available for matching'; END;
 PERFORM pg_temp.interest_check('existing route evidence use rejected',rejected);
 r:=pg_temp.interest_create(n.member_id,gen_random_uuid(),n.movement_need_id,a.availability_id,e);
 PERFORM pg_temp.deadline_denied('new interest rejected',r);
 r:=pg_temp.interest_read(a.member_id,i);
 PERFORM pg_temp.interest_check('single interest hidden',r->>'ok'='true' AND r->'rows'='[]'::jsonb,r::text);
 r:=pg_temp.interest_as('authenticated',a.member_id,'SELECT * FROM public.list_requester_movement_interests_for_offerer(NULL,50)');
 PERFORM pg_temp.interest_check('inbox omits expired requester interest',r->>'ok'='true' AND NOT (r->'rows' @> jsonb_build_array(jsonb_build_object('interest_id',i))),r::text);
 r:=pg_temp.interest_as('authenticated',a.member_id,format('SELECT * FROM public.create_movement_offer(%L,%L,%L,1)',n.movement_need_id,e,a.availability_id));
 PERFORM pg_temp.deadline_denied('request-first offer rejected',r);
 r:=pg_temp.offer_interest(a.member_id,i,1);
 PERFORM pg_temp.deadline_denied('interest-based offer rejected',r);
 r:=pg_temp.interest_as('authenticated',n.member_id,format('SELECT * FROM public.accept_movement_offer(%L)',offer_id));
 PERFORM pg_temp.deadline_denied('pending offer acceptance rejected after requester expiry',r);
 PERFORM pg_temp.interest_check('rejections leave capacity offers alignments and needs unchanged',before_rows=pg_temp.interest_operational_snapshot());
 PERFORM pg_temp.interest_check('no new interests inserted',count_before=(SELECT count(*) FROM private.requester_movement_interests));
 PERFORM pg_temp.interest_check('history unchanged including active interest and pending offer',history=(SELECT jsonb_build_array(to_jsonb(x),to_jsonb(y),to_jsonb(z),to_jsonb(o)) FROM public.movement_needs x,private.requester_movement_interests y,private.trusted_route_match_evidence z,public.movement_offers o WHERE x.id=n.movement_need_id AND y.id=i AND z.id=e AND o.id=offer_id));
 PERFORM public.get_trusted_matching_context_for_server(w.movement_need_id,a.intent_id,a.member_id);
 PERFORM pg_temp.interest_check('latest departure keeps elapsed earliest window actionable',clock_timestamp()>deadline);
 PERFORM pg_sleep(greatest(0,extract(epoch FROM deadline+interval '4 seconds'-clock_timestamp()))+0.1);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',w.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.deadline_denied('window rejected after latest deadline',r);
 PERFORM pg_temp.interest_check('accepted alignment unchanged after its requester deadline',
   clock_timestamp()>deadline AND accepted_alignment=(SELECT to_jsonb(x) FROM public.alignments x WHERE movement_offer_id=good_offer AND status='awaiting_activation_payment'));
END;
$test$;
TABLE pg_temp.interest_results;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.interest_results WHERE NOT passed) THEN RAISE EXCEPTION '0052 behavioral checks failed'; END IF;
 IF (SELECT count(*) FROM pg_temp.interest_results)<>25 THEN RAISE EXCEPTION '0052 expected 25 checks'; END IF;
END $$;
ROLLBACK;
