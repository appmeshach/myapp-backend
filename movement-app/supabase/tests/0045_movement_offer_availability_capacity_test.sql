BEGIN;
-- NOT a simultaneous-session concurrency test. Sequential competing offers
-- prove first-success/second-failure; Node checks the authoritative row locks.

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.capacity_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.capacity_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.capacity_results(
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
ON FUNCTION pg_temp.capacity_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.capacity_select_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $select_as$
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
$select_as$;


REVOKE ALL
ON FUNCTION pg_temp.capacity_select_as(
  text,
  uuid,
  text
)
FROM PUBLIC;


-- =========================================================
-- Behavioral tests
-- =========================================================

-- Run as the local database administrator after 0042. All fixtures roll back.
-- The role/JWT helper above is copied from the 0038 behavioral test.
-- Resolved locations are administrative fixtures; needs, intents, routes and
-- matches use the same real trusted RPC path as 0038.
CREATE TEMP TABLE pg_temp.capacity_fixtures (
  name text PRIMARY KEY,
  requester uuid, offerer uuid, need uuid, intent uuid,
  route uuid, evidence uuid, vehicle uuid, offer uuid
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.capacity_denied(
  p_name text, p_member uuid, p_sql text, p_state text, p_message text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.capacity_select_as('authenticated', p_member, p_sql);
  PERFORM pg_temp.capacity_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND r->>'message' = p_message, r::text);
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.capacity_denied(text,uuid,text,text,text) FROM PUBLIC;

-- Keep the server-only writer payloads identical across lifecycle fixtures.
CREATE FUNCTION pg_temp.capacity_route(p_intent uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE t timestamptz := clock_timestamp();
BEGIN
  RETURN pg_temp.capacity_select_as('service_role', NULL, format(
    'SELECT * FROM public.record_offering_route_evidence_for_server(
      %L::uuid, ''test-router'', ''directions'', ''v1'', %L,
      %L::jsonb, 18000, 2400, %L::timestamptz, %L::timestamptz)',
    p_intent, p_reference,
    '{"type":"LineString","coordinates":[[3.5852,6.4698],[3.5200,6.4300],[3.4900,6.4320],[3.4430,6.4310],[3.4219,6.4281]]}',
    t, t + interval '3 hours'));
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.capacity_route(uuid,text) FROM PUBLIC;

CREATE FUNCTION pg_temp.capacity_match(
  p_need uuid, p_intent uuid, p_route uuid, p_version integer,
  p_lifetime interval DEFAULT interval '2 hours'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE t timestamptz := clock_timestamp();
BEGIN
  -- These 250 km / 400 km objective distances deliberately match 0038.
  RETURN pg_temp.capacity_select_as('service_role', NULL, format(
    'SELECT * FROM public.record_trusted_route_match_evidence_for_server(
      %L::uuid, %L::uuid, %L::uuid, %L::integer,
      250000, 400000, 18000, 1000, 12000,
      6.4300, 3.5200, 6.4310, 3.4430, %L::timestamptz, %L::timestamptz)',
    p_need, p_intent, p_route, p_version, t, t + p_lifetime));
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.capacity_match(uuid,uuid,uuid,integer,interval) FROM PUBLIC;

DO $fixtures$
DECLARE
  label text;
  requester uuid; offerer uuid; vehicle uuid;
  requester_origin uuid; requester_destination uuid;
  offerer_origin uuid; offerer_destination uuid;
  need uuid; intent uuid; route uuid; evidence uuid;
  loc record; location_id uuid; t timestamptz; r jsonb;
BEGIN
  FOREACH label IN ARRAY ARRAY['main', 'other', 'stale', 'expiry'] LOOP
    requester := gen_random_uuid();
    offerer := gen_random_uuid();
    vehicle := gen_random_uuid();
    t := clock_timestamp();
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    SELECT id,'authenticated','authenticated',id::text || '@test-0045.invalid',
      t,'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,t,t
    FROM unnest(ARRAY[requester,offerer]) ids(id);
    PERFORM pg_temp.capacity_check(label || ': auth trigger creates both members',
      (SELECT count(*) = 2 FROM public.members m WHERE m.id IN (requester,offerer)));

    FOR loc IN SELECT * FROM (VALUES
      ('requester_origin',requester,'Agungi, Lagos',6.4300,3.5200),
      ('requester_destination',requester,'Oniru, Lagos',6.4310,3.4430),
      ('offerer_origin',offerer,'Ajah, Lagos',6.4698,3.5852),
      ('offerer_destination',offerer,'Victoria Island, Lagos',6.4281,3.4219)
    ) v(kind,member_id,area,lat,lon) LOOP
      t := clock_timestamp();
      INSERT INTO private.movement_location_references(
        owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,
        provider_namespace,provider_place_reference,resolution_version,
        created_at,resolved_at,expires_at)
      VALUES(loc.member_id,loc.area,'provider_resolved','resolved',loc.lat,loc.lon,
        'test-provider','0042-' || label || '-' || loc.kind,'test-resolution-v1',
        t,t,t + interval '4 hours') RETURNING id INTO location_id;
      CASE loc.kind
        WHEN 'requester_origin' THEN requester_origin := location_id;
        WHEN 'requester_destination' THEN requester_destination := location_id;
        WHEN 'offerer_origin' THEN offerer_origin := location_id;
        WHEN 'offerer_destination' THEN offerer_destination := location_id;
      END CASE;
    END LOOP;

    -- Requester need exists before the offerer decides to travel.
    r := pg_temp.capacity_select_as('authenticated',requester,format(
      'SELECT * FROM public.create_movement_need(%L::uuid,%L::uuid,%L::uuid,
        %L::timestamptz,%L::timestamptz,1)',gen_random_uuid(),
      requester_origin,requester_destination,
      statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours'));
    need := (r#>>'{rows,0,movement_need_id}')::uuid;
    PERFORM pg_temp.capacity_check(label || ': trusted requester intake succeeds',
      r->>'ok'='true' AND need IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.movement_needs n WHERE n.id=need
          AND n.member_id=requester AND n.status='discoverable'),r::text);

    r := pg_temp.capacity_select_as('authenticated',offerer,format(
      'SELECT * FROM public.create_offering_movement_intent(%L::uuid,%L::uuid,%L::uuid,
        %L::timestamptz,%L::timestamptz)',gen_random_uuid(),
      offerer_origin,offerer_destination,
      statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours'));
    intent := (r#>>'{rows,0,offering_movement_intent_id}')::uuid;
    PERFORM pg_temp.capacity_check(label || ': independent trusted offering intake succeeds',
      r->>'ok'='true' AND intent IS NOT NULL AND EXISTS (
        SELECT 1 FROM private.offering_movement_intents i WHERE i.id=intent
          AND i.offering_member_id=offerer AND i.status='current'),r::text);

    r := pg_temp.capacity_route(intent,'0042-' || label || '-route-1');
    route := (r#>>'{rows,0,route_evidence_id}')::uuid;
    PERFORM pg_temp.capacity_check(label || ': service writer records current route',
      r->>'ok'='true' AND route IS NOT NULL
      AND r#>>'{rows,0,route_evidence_version}'='1'
      AND EXISTS (SELECT 1 FROM private.offering_route_evidence e
        WHERE e.id=route AND e.status='current'),r::text);

    -- Expiry is tested later with a new route and short-lived match, avoiding
    -- timing dependence while the remaining fixtures/assertions are built.
    r := pg_temp.capacity_match(need,intent,route,1);
    evidence := (r#>>'{rows,0,route_match_evidence_id}')::uuid;
    PERFORM pg_temp.capacity_check(label || ': service writer records large-distance current match',
      r->>'ok'='true' AND evidence IS NOT NULL AND EXISTS (
        SELECT 1 FROM private.trusted_route_match_evidence e
        WHERE e.id=evidence AND e.movement_need_id=need
          AND e.offering_member_id=offerer AND e.offering_movement_intent_id=intent
          AND e.route_evidence_id=route AND e.version=1 AND e.status='current'
          AND e.requester_origin_distance_to_route_meters=250000
          AND e.requester_destination_distance_to_route_meters=400000),r::text);

    -- Actual 0021/0022 fixture columns: access, not ownership, is authority.
    INSERT INTO public.vehicles(id,make,model,color,seat_capacity,plate_number)
    VALUES(vehicle,'Lexus','RX350','Blue',4,'T0042-' || left(vehicle::text,8));
    INSERT INTO public.member_vehicle_access(member_id,vehicle_id,active)
    VALUES(offerer,vehicle,true);
    PERFORM pg_temp.capacity_check(label || ': plated vehicle and active access exist',
      EXISTS (SELECT 1 FROM public.vehicles v JOIN public.member_vehicle_access a
        ON a.vehicle_id=v.id WHERE v.id=vehicle AND v.seat_capacity=4
        AND v.plate_number IS NOT NULL AND a.member_id=offerer AND a.active));
    INSERT INTO pg_temp.capacity_fixtures
    VALUES(label,requester,offerer,need,intent,route,evidence,vehicle,NULL);
  END LOOP;
END;
$fixtures$;


CREATE FUNCTION pg_temp.reject_capacity_alignment()
RETURNS trigger LANGUAGE plpgsql AS $failure$
BEGIN
  IF current_setting('test.reject_alignment_0045',true)='on' THEN
    RAISE EXCEPTION USING ERRCODE='P0045',MESSAGE='Deliberate failure after capacity update';
  END IF;
  RETURN NEW;
END;
$failure$;
CREATE TRIGGER test_0045_reject_alignment BEFORE INSERT ON public.alignments
FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_capacity_alignment();

DO $capacity_test$
DECLARE
  f pg_temp.capacity_fixtures%ROWTYPE;
  g pg_temp.capacity_fixtures%ROWTYPE;
  h pg_temp.capacity_fixtures%ROWTYPE;
  j pg_temp.capacity_fixtures%ROWTYPE;
  a uuid; other_a uuid; r jsonb; command text; scenario text;
  first_offer uuid; second_offer uuid; group_offer uuid; last_offer uuid; sibling_offer uuid;
  e_g uuid; e_h uuid; e_j uuid; e_sibling uuid; traveller uuid:=gen_random_uuid();
  rejected boolean; binding_before jsonb; origin_id uuid; destination_id uuid;
  short_intent uuid; short_route uuid; short_evidence uuid; short_a uuid;
  new_intent uuid; new_route uuid; new_evidence uuid;
BEGIN
  SELECT * INTO STRICT f FROM pg_temp.capacity_fixtures WHERE name='main';
  SELECT * INTO STRICT g FROM pg_temp.capacity_fixtures WHERE name='other';
  SELECT * INTO STRICT h FROM pg_temp.capacity_fixtures WHERE name='stale';
  SELECT * INTO STRICT j FROM pg_temp.capacity_fixtures WHERE name='expiry';
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES(traveller,'authenticated','authenticated',traveller::text||'@test-0045.invalid',now(),
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  UPDATE public.movement_needs SET people_count=2 WHERE id IN (f.need,h.need);
  INSERT INTO public.movement_participants(movement_need_id,member_id,role,status)
  VALUES(f.need,traveller,'invited_participant','confirmed'),(h.need,traveller,'invited_participant','confirmed');

  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.open_offering_movement_availability(%L::uuid,%L::uuid,%L::uuid,3)',gen_random_uuid(),f.intent,f.vehicle));
  a:=(r#>>'{rows,0,availability_id}')::uuid;
  IF a IS NULL THEN RAISE EXCEPTION 'Main availability fixture failed: %',r; END IF;
  r:=pg_temp.capacity_select_as('authenticated',g.offerer,format(
    'SELECT * FROM public.open_offering_movement_availability(%L::uuid,%L::uuid,%L::uuid,4)',gen_random_uuid(),g.intent,g.vehicle));
  other_a:=(r#>>'{rows,0,availability_id}')::uuid;
  IF other_a IS NULL THEN RAISE EXCEPTION 'Other availability fixture failed: %',r; END IF;
  r:=pg_temp.capacity_match(g.need,f.intent,f.route,1); e_g:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
  r:=pg_temp.capacity_match(h.need,f.intent,f.route,1); e_h:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
  r:=pg_temp.capacity_match(j.need,f.intent,f.route,1); e_j:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
  r:=pg_temp.capacity_match(f.need,g.intent,g.route,1); e_sibling:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
  IF e_g IS NULL OR e_h IS NULL OR e_j IS NULL OR e_sibling IS NULL THEN RAISE EXCEPTION 'Shared availability match fixtures failed'; END IF;
  command:=format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,3)',f.need,f.evidence,a);

  PERFORM pg_temp.capacity_check('legacy named vehicle parameter removed',
    (SELECT NOT ('p_vehicle_id'=ANY(proargnames)) FROM pg_proc
      WHERE oid='public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)'::regprocedure));
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,replace(command,a::text,f.vehicle::text));
  PERFORM pg_temp.capacity_check('old positional vehicle call cannot bypass availability',r->>'ok'='false',r::text);
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_movement_offer(p_movement_need_id=>%L::uuid,p_route_match_evidence_id=>%L::uuid,p_vehicle_id=>%L::uuid,p_seats_offered=>3)',f.need,f.evidence,f.vehicle));
  PERFORM pg_temp.capacity_check('old named overload absent',r->>'state'='42883',r::text);
  r:=pg_temp.capacity_select_as('authenticated',NULL,command);
  PERFORM pg_temp.capacity_check('unauthenticated creation rejected',r->>'ok'='false',r::text);
  r:=pg_temp.capacity_select_as('anon',NULL,command);
  PERFORM pg_temp.capacity_check('anon cannot execute creation',r->>'state'='42501',r::text);
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,replace(command,a::text,other_a::text));
  PERFORM pg_temp.capacity_check('another members availability rejected',r->>'state'='42501',r::text);

  -- Same offerer, different independent intent: valid evidence must still fail.
  SELECT origin_location_reference_id,destination_location_reference_id INTO origin_id,destination_id
  FROM private.offering_route_evidence WHERE id=f.route;
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_offering_movement_intent(%L::uuid,%L::uuid,%L::uuid,%L::timestamptz,NULL)',
    gen_random_uuid(),origin_id,destination_id,clock_timestamp()+interval '1 hour'));
  new_intent:=(r#>>'{rows,0,offering_movement_intent_id}')::uuid;
  r:=pg_temp.capacity_route(new_intent,'0045-other-intent'); new_route:=(r#>>'{rows,0,route_evidence_id}')::uuid;
  r:=pg_temp.capacity_match(f.need,new_intent,new_route,1); new_evidence:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
  IF new_evidence IS NULL THEN RAISE EXCEPTION 'Other intent fixture failed: %',r; END IF;
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,replace(command,f.evidence::text,new_evidence::text));
  PERFORM pg_temp.capacity_check('same member mismatched availability intent rejected',r->>'state'='23514',r::text);

  FOREACH scenario IN ARRAY ARRAY['withdrawn','full','unavailable','inactive access','stale evidence','insufficient places'] LOOP
    BEGIN
      CASE scenario
        WHEN 'withdrawn' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a;
        WHEN 'full' THEN UPDATE private.offering_movement_availability SET status='full',remaining_places=0 WHERE id=a;
        WHEN 'unavailable' THEN UPDATE private.offering_movement_availability SET status='unavailable' WHERE id=a;
        WHEN 'inactive access' THEN UPDATE public.member_vehicle_access SET active=false WHERE member_id=f.offerer AND vehicle_id=f.vehicle;
        WHEN 'stale evidence' THEN UPDATE private.trusted_route_match_evidence SET status='superseded' WHERE id=f.evidence;
        WHEN 'insufficient places' THEN UPDATE private.offering_movement_availability SET remaining_places=1 WHERE id=a;
      END CASE;
      r:=pg_temp.capacity_select_as('authenticated',f.offerer,command);
      IF r->>'ok'<>'false' THEN RAISE EXCEPTION 'Creation accepted invalid %: %',scenario,r; END IF;
      RAISE EXCEPTION USING ERRCODE='ZX045',MESSAGE='rollback successful scenario';
    EXCEPTION WHEN SQLSTATE 'ZX045' THEN NULL; END;
    PERFORM pg_temp.capacity_check('creation rejects '||scenario,true);
  END LOOP;

  r:=pg_temp.capacity_select_as('authenticated',f.offerer,command);
  first_offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.capacity_check('valid availability backed offer succeeds',r->>'ok'='true' AND first_offer IS NOT NULL,r::text);
  PERFORM pg_temp.capacity_check('vehicle derived from availability',EXISTS(SELECT 1 FROM public.movement_offers WHERE id=first_offer AND vehicle_id=f.vehicle));
  SELECT to_jsonb(b) INTO binding_before FROM private.movement_offer_availability_bindings b WHERE b.movement_offer_id=first_offer;
  PERFORM pg_temp.capacity_check('exact immutable private availability binding exists',
    binding_before->>'availability_id'=a::text AND binding_before->>'offering_movement_intent_id'=f.intent::text);
  rejected:=false;
  BEGIN UPDATE private.movement_offer_availability_bindings SET availability_id=other_a WHERE movement_offer_id=first_offer;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  PERFORM pg_temp.capacity_check('binding cannot be rebound',rejected);
  rejected:=false;
  BEGIN DELETE FROM private.movement_offer_availability_bindings WHERE movement_offer_id=first_offer;
  EXCEPTION WHEN check_violation THEN rejected:=true; END;
  PERFORM pg_temp.capacity_check('binding history cannot be deleted',rejected);

  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,3)',g.need,e_g,a));
  second_offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,3)',h.need,e_h,a));
  group_offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,3)',j.need,e_j,a));
  last_offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;
  r:=pg_temp.capacity_select_as('authenticated',g.offerer,format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,3)',f.need,e_sibling,other_a));
  sibling_offer:=(r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.capacity_check('multiple pending offers coexist without reserving capacity',
    second_offer IS NOT NULL AND group_offer IS NOT NULL AND last_offer IS NOT NULL AND sibling_offer IS NOT NULL
    AND (SELECT remaining_places=3 FROM private.offering_movement_availability WHERE id=a)
    AND (SELECT count(*)=4 FROM private.movement_offer_availability_bindings WHERE availability_id=a));

  command:=format('SELECT * FROM public.accept_movement_offer(%L::uuid)',first_offer);
  r:=pg_temp.capacity_select_as('authenticated',g.requester,command);
  PERFORM pg_temp.capacity_check('only need owner accepts',r->>'ok'='false',r::text);
  FOREACH scenario IN ARRAY ARRAY['incomplete group','stale match','vehicle mismatch','withdrawn availability'] LOOP
    BEGIN
      CASE scenario
        WHEN 'incomplete group' THEN UPDATE public.movement_participants SET status='invited' WHERE movement_need_id=f.need AND member_id=traveller;
        WHEN 'stale match' THEN UPDATE private.trusted_route_match_evidence SET status='superseded' WHERE id=f.evidence;
        WHEN 'vehicle mismatch' THEN UPDATE public.movement_offers SET vehicle_id=g.vehicle WHERE id=first_offer;
        WHEN 'withdrawn availability' THEN UPDATE private.offering_movement_availability SET status='withdrawn' WHERE id=a;
      END CASE;
      r:=pg_temp.capacity_select_as('authenticated',f.requester,command);
      IF r->>'ok'<>'false' OR NOT EXISTS(SELECT 1 FROM private.offering_movement_availability WHERE id=a AND remaining_places=3)
        OR EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=f.need) THEN
        RAISE EXCEPTION 'Invalid acceptance % did not fail atomically: %',scenario,r;
      END IF;
      RAISE EXCEPTION USING ERRCODE='ZX045',MESSAGE='rollback successful scenario';
    EXCEPTION WHEN SQLSTATE 'ZX045' THEN NULL; END;
    PERFORM pg_temp.capacity_check('acceptance rejects '||scenario||' without consuming capacity',true);
  END LOOP;

  PERFORM set_config('test.reject_alignment_0045','on',true);
  r:=pg_temp.capacity_select_as('authenticated',f.requester,command);
  PERFORM set_config('test.reject_alignment_0045','off',true);
  PERFORM pg_temp.capacity_check('later alignment failure rolls back capacity and offer transitions',
    r->>'state'='P0045' AND (SELECT remaining_places=3 FROM private.offering_movement_availability WHERE id=a)
    AND EXISTS(SELECT 1 FROM public.movement_offers WHERE id=first_offer AND status='pending')
    AND NOT EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=f.need),r::text);

  r:=pg_temp.capacity_select_as('authenticated',f.requester,command);
  PERFORM pg_temp.capacity_check('group of two consumes exactly two despite seats_offered three',
    r->>'ok'='true' AND (SELECT remaining_places=1 AND status='open' FROM private.offering_movement_availability WHERE id=a),r::text);
  PERFORM pg_temp.capacity_check('existing need offer alignment and sibling transitions preserved',
    EXISTS(SELECT 1 FROM public.movement_needs WHERE id=f.need AND status='closed')
    AND EXISTS(SELECT 1 FROM public.movement_offers WHERE id=first_offer AND status='accepted')
    AND EXISTS(SELECT 1 FROM public.movement_offers WHERE id=sibling_offer AND status='rejected')
    AND EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=f.need AND movement_offer_id=first_offer AND status='awaiting_activation_payment')
    AND (SELECT remaining_places=4 FROM private.offering_movement_availability WHERE id=other_a));
  r:=pg_temp.capacity_select_as('authenticated',f.requester,command);
  PERFORM pg_temp.capacity_check('duplicate acceptance cannot consume twice',r->>'ok'='false'
    AND (SELECT remaining_places=1 FROM private.offering_movement_availability WHERE id=a),r::text);
  r:=pg_temp.capacity_select_as('authenticated',h.requester,format('SELECT * FROM public.accept_movement_offer(%L::uuid)',group_offer));
  PERFORM pg_temp.capacity_check('two person group cannot partially consume final one place',r->>'ok'='false'
    AND (SELECT remaining_places=1 AND status='open' FROM private.offering_movement_availability WHERE id=a)
    AND NOT EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=h.need)
    AND EXISTS(SELECT 1 FROM public.movement_offers WHERE id=group_offer AND status='pending'),r::text);
  r:=pg_temp.capacity_select_as('authenticated',g.requester,format('SELECT * FROM public.accept_movement_offer(%L::uuid)',second_offer));
  PERFORM pg_temp.capacity_check('next valid acceptance exhausts capacity and marks full',r->>'ok'='true'
    AND (SELECT remaining_places=0 AND status='full' FROM private.offering_movement_availability WHERE id=a),r::text);
  r:=pg_temp.capacity_select_as('authenticated',j.requester,format('SELECT * FROM public.accept_movement_offer(%L::uuid)',last_offer));
  PERFORM pg_temp.capacity_check('later competing pending offer cannot overbook full availability',r->>'ok'='false'
    AND (SELECT remaining_places=0 AND status='full' FROM private.offering_movement_availability WHERE id=a)
    AND NOT EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=j.need)
    AND EXISTS(SELECT 1 FROM public.movement_offers WHERE id=last_offer AND status='pending'),r::text);

  -- Real expiry: a short departure window, never altered immutable timestamps.
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_offering_movement_intent(%L::uuid,%L::uuid,%L::uuid,%L::timestamptz,NULL)',
    gen_random_uuid(),origin_id,destination_id,clock_timestamp()+interval '2 seconds'));
  short_intent:=(r#>>'{rows,0,offering_movement_intent_id}')::uuid;
  r:=pg_temp.capacity_route(short_intent,'0045-short'); short_route:=(r#>>'{rows,0,route_evidence_id}')::uuid;
  r:=pg_temp.capacity_match(j.need,short_intent,short_route,1); short_evidence:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.open_offering_movement_availability(%L::uuid,%L::uuid,%L::uuid,3)',gen_random_uuid(),short_intent,f.vehicle));
  short_a:=(r#>>'{rows,0,availability_id}')::uuid;
  IF short_a IS NULL OR short_evidence IS NULL THEN RAISE EXCEPTION 'Short expiry fixture failed: %',r; END IF;
  PERFORM pg_sleep(2.1);
  UPDATE private.offering_movement_availability SET status='expired' WHERE id=short_a;
  r:=pg_temp.capacity_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',j.need,short_evidence,short_a));
  PERFORM pg_temp.capacity_check('expired availability cannot authorize offer creation',r->>'ok'='false',r::text);

  FOREACH scenario IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    PERFORM pg_temp.capacity_check('authenticated lacks binding '||scenario,
      NOT has_table_privilege('authenticated','private.movement_offer_availability_bindings',scenario));
  END LOOP;
  PERFORM pg_temp.capacity_check('private helper execution revoked',
    NOT has_function_privilege('authenticated','private.assert_movement_offer_availability_binding(uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','private.assert_movement_offer_availability_binding(uuid)','EXECUTE'));
  PERFORM pg_temp.capacity_check('binding table RLS enabled without policies',
    (SELECT relrowsecurity FROM pg_class WHERE oid='private.movement_offer_availability_bindings'::regclass)
    AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.movement_offer_availability_bindings'::regclass));
  SET CONSTRAINTS ALL IMMEDIATE;
END;
$capacity_test$;

SELECT test_number,test_name,passed,diagnostic FROM pg_temp.capacity_results ORDER BY test_number;
DO $verify$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_temp.capacity_results WHERE NOT passed) THEN
    RAISE EXCEPTION '0045 capacity regression failed';
  END IF;
END;
$verify$;
ROLLBACK;
