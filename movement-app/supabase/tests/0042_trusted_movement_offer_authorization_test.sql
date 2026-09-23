BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;


-- =========================================================
-- Results
-- =========================================================

CREATE TEMP TABLE pg_temp.offer_auth_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.offer_auth_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.offer_auth_results(
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
ON FUNCTION pg_temp.offer_auth_check(
  text,
  boolean,
  text
)
FROM PUBLIC;


-- =========================================================
-- Execute one SELECT as a simulated API role/member
-- =========================================================

CREATE FUNCTION pg_temp.offer_auth_select_as(
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
ON FUNCTION pg_temp.offer_auth_select_as(
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
CREATE TEMP TABLE pg_temp.offer_auth_fixtures (
  name text PRIMARY KEY,
  requester uuid, offerer uuid, need uuid, intent uuid,
  route uuid, evidence uuid, vehicle uuid, offer uuid
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.offer_auth_denied(
  p_name text, p_member uuid, p_sql text, p_state text, p_message text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.offer_auth_select_as('authenticated', p_member, p_sql);
  PERFORM pg_temp.offer_auth_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND r->>'message' = p_message, r::text);
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.offer_auth_denied(text,uuid,text,text,text) FROM PUBLIC;

-- Keep the server-only writer payloads identical across lifecycle fixtures.
CREATE FUNCTION pg_temp.offer_auth_route(p_intent uuid, p_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE t timestamptz := clock_timestamp();
BEGIN
  RETURN pg_temp.offer_auth_select_as('service_role', NULL, format(
    'SELECT * FROM public.record_offering_route_evidence_for_server(
      %L::uuid, ''test-router'', ''directions'', ''v1'', %L,
      %L::jsonb, 18000, 2400, %L::timestamptz, %L::timestamptz)',
    p_intent, p_reference,
    '{"type":"LineString","coordinates":[[3.5852,6.4698],[3.5200,6.4300],[3.4900,6.4320],[3.4430,6.4310],[3.4219,6.4281]]}',
    t, t + interval '3 hours'));
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.offer_auth_route(uuid,text) FROM PUBLIC;

CREATE FUNCTION pg_temp.offer_auth_match(
  p_need uuid, p_intent uuid, p_route uuid, p_version integer,
  p_lifetime interval DEFAULT interval '2 hours'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE t timestamptz := clock_timestamp();
BEGIN
  -- These 250 km / 400 km objective distances deliberately match 0038.
  RETURN pg_temp.offer_auth_select_as('service_role', NULL, format(
    'SELECT * FROM public.record_trusted_route_match_evidence_for_server(
      %L::uuid, %L::uuid, %L::uuid, %L::integer,
      250000, 400000, 18000, 1000, 12000,
      6.4300, 3.5200, 6.4310, 3.4430, %L::timestamptz, %L::timestamptz)',
    p_need, p_intent, p_route, p_version, t, t + p_lifetime));
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.offer_auth_match(uuid,uuid,uuid,integer,interval) FROM PUBLIC;

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
    SELECT id,'authenticated','authenticated',id::text || '@test-0042.invalid',
      t,'{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,t,t
    FROM unnest(ARRAY[requester,offerer]) ids(id);
    PERFORM pg_temp.offer_auth_check(label || ': auth trigger creates both members',
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
    r := pg_temp.offer_auth_select_as('authenticated',requester,format(
      'SELECT * FROM public.create_movement_need(%L::uuid,%L::uuid,%L::uuid,
        %L::timestamptz,%L::timestamptz,1)',gen_random_uuid(),
      requester_origin,requester_destination,
      statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours'));
    need := (r#>>'{rows,0,movement_need_id}')::uuid;
    PERFORM pg_temp.offer_auth_check(label || ': trusted requester intake succeeds',
      r->>'ok'='true' AND need IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.movement_needs n WHERE n.id=need
          AND n.member_id=requester AND n.status='discoverable'),r::text);

    r := pg_temp.offer_auth_select_as('authenticated',offerer,format(
      'SELECT * FROM public.create_offering_movement_intent(%L::uuid,%L::uuid,%L::uuid,
        %L::timestamptz,%L::timestamptz)',gen_random_uuid(),
      offerer_origin,offerer_destination,
      statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours'));
    intent := (r#>>'{rows,0,offering_movement_intent_id}')::uuid;
    PERFORM pg_temp.offer_auth_check(label || ': independent trusted offering intake succeeds',
      r->>'ok'='true' AND intent IS NOT NULL AND EXISTS (
        SELECT 1 FROM private.offering_movement_intents i WHERE i.id=intent
          AND i.offering_member_id=offerer AND i.status='current'),r::text);

    r := pg_temp.offer_auth_route(intent,'0042-' || label || '-route-1');
    route := (r#>>'{rows,0,route_evidence_id}')::uuid;
    PERFORM pg_temp.offer_auth_check(label || ': service writer records current route',
      r->>'ok'='true' AND route IS NOT NULL
      AND r#>>'{rows,0,route_evidence_version}'='1'
      AND EXISTS (SELECT 1 FROM private.offering_route_evidence e
        WHERE e.id=route AND e.status='current'),r::text);

    -- Expiry is tested later with a new route and short-lived match, avoiding
    -- timing dependence while the remaining fixtures/assertions are built.
    r := pg_temp.offer_auth_match(need,intent,route,1);
    evidence := (r#>>'{rows,0,route_match_evidence_id}')::uuid;
    PERFORM pg_temp.offer_auth_check(label || ': service writer records large-distance current match',
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
    PERFORM pg_temp.offer_auth_check(label || ': plated vehicle and active access exist',
      EXISTS (SELECT 1 FROM public.vehicles v JOIN public.member_vehicle_access a
        ON a.vehicle_id=v.id WHERE v.id=vehicle AND v.seat_capacity=4
        AND v.plate_number IS NOT NULL AND a.member_id=offerer AND a.active));
    INSERT INTO pg_temp.offer_auth_fixtures
    VALUES(label,requester,offerer,need,intent,route,evidence,vehicle,NULL);
  END LOOP;
END;
$fixtures$;

DO $authorization$
DECLARE
  f pg_temp.offer_auth_fixtures%ROWTYPE;
  other_fixture pg_temp.offer_auth_fixtures%ROWTYPE;
  r jsonb; offer_id uuid; unbound_offer uuid; alignment_id uuid;
  role_name text; operation text; sql_text text; old_role text;
  observed text; observed_message text; binding_before jsonb;
BEGIN
  SELECT * INTO STRICT f FROM pg_temp.offer_auth_fixtures WHERE name='main';
  SELECT * INTO STRICT other_fixture FROM pg_temp.offer_auth_fixtures WHERE name='other';
  PERFORM pg_temp.offer_auth_check('old six-argument offer signature is absent',
    to_regprocedure('public.create_movement_offer(uuid,uuid,integer,text,text,integer)') IS NULL);
  PERFORM pg_temp.offer_auth_check('trusted signature exists and only authenticated can execute',
    to_regprocedure('public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)') IS NOT NULL
    AND has_function_privilege('authenticated',
      'public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)','EXECUTE')
    AND NOT has_function_privilege('anon',
      'public.create_movement_offer(uuid,uuid,uuid,integer,text,text,integer)','EXECUTE'));

  PERFORM pg_temp.offer_auth_denied('NULL evidence cannot authorize creation',f.offerer,
    format('SELECT * FROM public.create_movement_offer(%L::uuid,NULL::uuid,%L::uuid,1)',f.need,f.vehicle),
    '22004','Trusted route-match evidence is required');
  PERFORM pg_temp.offer_auth_denied('unknown evidence cannot authorize creation',f.offerer,
    format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
      f.need,gen_random_uuid(),f.vehicle),'23514','Trusted route-match evidence is unavailable');
  PERFORM pg_temp.offer_auth_denied('evidence for another need fails closed',f.offerer,
    format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
      other_fixture.need,f.evidence,f.vehicle),
    '23514','Trusted route-match evidence does not belong to this movement need');
  -- Exact need matches here, isolating the offering-member ownership check.
  PERFORM pg_temp.offer_auth_denied('another offering members evidence fails closed',f.offerer,
    format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
      other_fixture.need,other_fixture.evidence,f.vehicle),
    '42501','Trusted route-match evidence does not belong to the authenticated member');
  PERFORM pg_temp.offer_auth_check('rejected creations leave no offers or bindings',
    NOT EXISTS (SELECT 1 FROM public.movement_offers o
      WHERE o.movement_need_id IN (f.need,other_fixture.need))
    AND NOT EXISTS (SELECT 1 FROM private.movement_offer_route_match_bindings b
      WHERE b.movement_need_id IN (f.need,other_fixture.need)));

  r := pg_temp.offer_auth_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1,NULL,NULL,15)',
    f.need,f.evidence,f.vehicle));
  offer_id := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('large-distance trusted evidence creates pending offer',
    r->>'ok'='true' AND offer_id IS NOT NULL AND r#>>'{rows,0,status}'='pending'
    AND EXISTS (SELECT 1 FROM public.movement_offers o WHERE o.id=offer_id
      AND o.movement_need_id=f.need AND o.offering_member_id=f.offerer
      AND o.vehicle_id=f.vehicle AND o.status='pending'),r::text);
  PERFORM pg_temp.offer_auth_check('creation atomically binds exactly one authoritative evidence row',
    (SELECT count(*)=1 FROM private.movement_offer_route_match_bindings b
      WHERE b.movement_offer_id=offer_id)
    AND EXISTS (SELECT 1 FROM private.movement_offer_route_match_bindings b
      JOIN private.trusted_route_match_evidence e ON e.id=b.route_match_evidence_id
      WHERE b.movement_offer_id=offer_id AND b.movement_need_id=f.need
        AND b.movement_need_id=e.movement_need_id AND b.offering_member_id=f.offerer
        AND b.offering_member_id=e.offering_member_id
        AND b.offering_movement_intent_id=f.intent
        AND b.offering_movement_intent_id=e.offering_movement_intent_id
        AND b.route_match_evidence_id=f.evidence AND b.route_match_evidence_version=e.version
        AND b.binding_schema_version='movement_offer_route_match_binding_v1'));

  SELECT to_jsonb(b) INTO binding_before FROM private.movement_offer_route_match_bindings b
  WHERE b.movement_offer_id=offer_id;
  -- Subtransactions restore attempted mutations even if protection regresses.
  FOREACH operation IN ARRAY ARRAY['UPDATE','DELETE'] LOOP
    observed := '00000'; observed_message := NULL;
    BEGIN
      IF operation='UPDATE' THEN
        UPDATE private.movement_offer_route_match_bindings
        SET bound_at=bound_at + interval '1 second' WHERE movement_offer_id=offer_id;
      ELSE
        DELETE FROM private.movement_offer_route_match_bindings WHERE movement_offer_id=offer_id;
      END IF;
      RAISE EXCEPTION USING ERRCODE='ZX042',MESSAGE='restore unexpected mutation';
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE<>'ZX042' THEN observed:=SQLSTATE; observed_message:=SQLERRM; END IF;
    END;
    PERFORM pg_temp.offer_auth_check('binding rejects admin ' || operation,
      observed='23514' AND observed_message=CASE WHEN operation='UPDATE'
        THEN 'Movement offer route-match authorization is immutable'
        ELSE 'Movement offer route-match authorization history cannot be deleted' END,
      observed || ': ' || coalesce(observed_message,''));
  END LOOP;
  PERFORM pg_temp.offer_auth_check('immutability probes preserve exact binding',
    (SELECT to_jsonb(b)=binding_before FROM private.movement_offer_route_match_bindings b
      WHERE b.movement_offer_id=offer_id));

  FOREACH role_name IN ARRAY ARRAY['authenticated','anon'] LOOP
    FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
      PERFORM pg_temp.offer_auth_check(role_name || ' has no binding ' || operation || ' privilege',
        NOT has_table_privilege(role_name,'private.movement_offer_route_match_bindings',operation));
      sql_text := CASE operation
        WHEN 'SELECT' THEN 'SELECT * FROM private.movement_offer_route_match_bindings'
        WHEN 'INSERT' THEN 'INSERT INTO private.movement_offer_route_match_bindings DEFAULT VALUES'
        WHEN 'UPDATE' THEN 'UPDATE private.movement_offer_route_match_bindings SET bound_at=bound_at WHERE false'
        ELSE 'DELETE FROM private.movement_offer_route_match_bindings WHERE false' END;
      old_role := current_setting('role');
      -- Switch outside the catcher: harness failure is never an access-denial pass.
      PERFORM set_config('role',role_name,true);
      observed := '00000';
      BEGIN
        EXECUTE sql_text;
        RAISE EXCEPTION USING ERRCODE='ZX042',MESSAGE='restore unexpected access';
      EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE<>'ZX042' THEN observed:=SQLSTATE; END IF;
      END;
      PERFORM set_config('role',old_role,true);
      PERFORM pg_temp.offer_auth_check(role_name || ' actual binding ' || operation || ' denied',
        observed='42501',observed);
    END LOOP;
  END LOOP;

  -- Admin-only unbound fixture, otherwise eligible for acceptance.
  INSERT INTO public.movement_offers(movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
  VALUES(other_fixture.need,other_fixture.offerer,other_fixture.vehicle,1,'pending')
  RETURNING id INTO unbound_offer;
  PERFORM pg_temp.offer_auth_denied('unbound direct-insert offer cannot be accepted',other_fixture.requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)',unbound_offer),
    '23514','Movement offer does not have trusted route-match authorization');
  PERFORM pg_temp.offer_auth_check('unbound rejection preserves pending offer and discoverable need',
    EXISTS (SELECT 1 FROM public.movement_offers WHERE id=unbound_offer AND status='pending')
    AND EXISTS (SELECT 1 FROM public.movement_needs WHERE id=other_fixture.need AND status='discoverable')
    AND NOT EXISTS (SELECT 1 FROM public.alignments WHERE movement_need_id=other_fixture.need));

  PERFORM pg_temp.offer_auth_check('successful acceptance fixture has complete confirmed roster',
    (SELECT count(*)=1 FROM public.movement_participants
      WHERE movement_need_id=f.need AND status='confirmed' AND member_id=f.requester)
    AND NOT EXISTS (SELECT 1 FROM public.movement_participants
      WHERE movement_need_id=f.need AND status='invited'));
  r := pg_temp.offer_auth_select_as('authenticated',f.requester,format(
    'SELECT * FROM public.accept_movement_offer(%L::uuid)',offer_id));
  alignment_id := (r#>>'{rows,0,alignment_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('requester accepts bound offer into awaiting-payment alignment',
    r->>'ok'='true' AND alignment_id IS NOT NULL
    AND r#>>'{rows,0,alignment_status}'='awaiting_activation_payment'
    AND EXISTS (SELECT 1 FROM public.alignments a WHERE a.id=alignment_id
      AND a.movement_need_id=f.need AND a.movement_offer_id=offer_id
      AND a.member_needing_movement_id=f.requester AND a.offering_member_id=f.offerer
      AND a.status='awaiting_activation_payment'),r::text);
  PERFORM pg_temp.offer_auth_check('successful acceptance marks offer accepted and need closed',
    EXISTS (SELECT 1 FROM public.movement_offers WHERE id=offer_id AND status='accepted')
    AND EXISTS (SELECT 1 FROM public.movement_needs WHERE id=f.need AND status='closed'));
END;
$authorization$;

DO $lifecycle$
DECLARE
  f pg_temp.offer_auth_fixtures%ROWTYPE;
  r jsonb; offer_id uuid; new_route uuid; new_evidence uuid; expiry timestamptz;
BEGIN
  SELECT * INTO STRICT f FROM pg_temp.offer_auth_fixtures WHERE name='stale';
  r := pg_temp.offer_auth_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
    f.need,f.evidence,f.vehicle));
  offer_id := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('separate stale fixture starts with valid bound pending offer',
    r->>'ok'='true' AND EXISTS (SELECT 1 FROM private.movement_offer_route_match_bindings b
      JOIN public.movement_offers o ON o.id=b.movement_offer_id
      WHERE o.id=offer_id AND o.status='pending' AND b.route_match_evidence_id=f.evidence),r::text);

  r := pg_temp.offer_auth_route(f.intent,'0042-stale-route-2');
  new_route := (r#>>'{rows,0,route_evidence_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('real route writer supersedes stale fixture route v1',
    r->>'ok'='true' AND new_route<>f.route AND r#>>'{rows,0,route_evidence_version}'='2'
    AND EXISTS (SELECT 1 FROM private.offering_route_evidence e
      WHERE e.id=f.route AND e.status='superseded'),r::text);
  r := pg_temp.offer_auth_match(f.need,f.intent,new_route,2);
  new_evidence := (r#>>'{rows,0,route_match_evidence_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('real match writer supersedes bound evidence with current v2',
    r->>'ok'='true' AND new_evidence<>f.evidence
    AND EXISTS (SELECT 1 FROM private.trusted_route_match_evidence e
      WHERE e.id=f.evidence AND e.status='superseded' AND e.version=1)
    AND EXISTS (SELECT 1 FROM private.trusted_route_match_evidence e
      WHERE e.id=new_evidence AND e.status='current' AND e.version=2
        AND e.route_evidence_id=new_route AND e.route_evidence_version=2),r::text);
  PERFORM pg_temp.offer_auth_denied('superseded bound evidence cannot authorize acceptance',f.requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)',offer_id),
    '23514','Trusted route-match evidence is not current and unexpired');
  PERFORM pg_temp.offer_auth_denied('superseded evidence cannot authorize creation',f.offerer,
    format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
      f.need,f.evidence,f.vehicle),'23514','Trusted route-match evidence is not current and unexpired');
  PERFORM pg_temp.offer_auth_check('stale rejection preserves binding and pending operational state',
    EXISTS (SELECT 1 FROM private.movement_offer_route_match_bindings b
      WHERE b.movement_offer_id=offer_id AND b.route_match_evidence_id=f.evidence)
    AND (SELECT count(*)=1 FROM public.movement_offers WHERE movement_need_id=f.need)
    AND EXISTS (SELECT 1 FROM public.movement_offers WHERE id=offer_id AND status='pending')
    AND EXISTS (SELECT 1 FROM public.movement_needs WHERE id=f.need AND status='discoverable')
    AND NOT EXISTS (SELECT 1 FROM public.alignments WHERE movement_need_id=f.need));

  SELECT * INTO STRICT f FROM pg_temp.offer_auth_fixtures WHERE name='expiry';
  r := pg_temp.offer_auth_route(f.intent,'0042-expiry-route-2');
  new_route := (r#>>'{rows,0,route_evidence_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('expiry fixture gets current trusted route v2',
    r->>'ok'='true' AND new_route IS NOT NULL
    AND r#>>'{rows,0,route_evidence_version}'='2',r::text);
  r := pg_temp.offer_auth_match(f.need,f.intent,new_route,2,interval '2 seconds');
  new_evidence := (r#>>'{rows,0,route_match_evidence_id}')::uuid;
  expiry := (r#>>'{rows,0,route_match_evidence_expires_at}')::timestamptz;
  PERFORM pg_temp.offer_auth_check('real writer creates short-lived current match',
    r->>'ok'='true' AND new_evidence IS NOT NULL AND expiry>clock_timestamp(),r::text);
  r := pg_temp.offer_auth_select_as('authenticated',f.offerer,format(
    'SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
    f.need,new_evidence,f.vehicle));
  offer_id := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.offer_auth_check('short-lived evidence authorizes offer before expiry',
    r->>'ok'='true' AND EXISTS (SELECT 1 FROM private.movement_offer_route_match_bindings b
      WHERE b.movement_offer_id=offer_id AND b.route_match_evidence_id=new_evidence),r::text);
  -- Wall-clock expiry, never a direct trusted-evidence status/timestamp mutation.
  PERFORM pg_sleep(greatest(0,extract(epoch FROM expiry-clock_timestamp())) + 0.05);
  PERFORM pg_temp.offer_auth_check('evidence naturally expires while status remains current',
    EXISTS (SELECT 1 FROM private.trusted_route_match_evidence e
      WHERE e.id=new_evidence AND e.status='current' AND e.expires_at<=clock_timestamp()));
  PERFORM pg_temp.offer_auth_denied('expired evidence cannot authorize creation',f.offerer,
    format('SELECT * FROM public.create_movement_offer(%L::uuid,%L::uuid,%L::uuid,1)',
      f.need,new_evidence,f.vehicle),'23514','Trusted route-match evidence is not current and unexpired');
  PERFORM pg_temp.offer_auth_denied('expired bound evidence cannot authorize acceptance',f.requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)',offer_id),
    '23514','Trusted route-match evidence is not current and unexpired');
  PERFORM pg_temp.offer_auth_check('expiry rejection preserves bound pending offer and creates no alignment',
    (SELECT count(*)=1 FROM public.movement_offers WHERE movement_need_id=f.need)
    AND EXISTS (SELECT 1 FROM public.movement_offers WHERE id=offer_id AND status='pending')
    AND EXISTS (SELECT 1 FROM private.movement_offer_route_match_bindings b
      WHERE b.movement_offer_id=offer_id AND b.route_match_evidence_id=new_evidence)
    AND EXISTS (SELECT 1 FROM public.movement_needs WHERE id=f.need AND status='discoverable')
    AND NOT EXISTS (SELECT 1 FROM public.alignments WHERE movement_need_id=f.need));
END;
$lifecycle$;

SELECT test_number,test_name,passed,
  CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,diagnostic
FROM pg_temp.offer_auth_results ORDER BY test_number;
SELECT count(*) AS assertions,count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed FROM pg_temp.offer_auth_results;
DO $assert$
DECLARE failed_count integer;
BEGIN
  SELECT count(*) INTO failed_count FROM pg_temp.offer_auth_results WHERE NOT passed;
  IF failed_count<>0 THEN
    RAISE EXCEPTION '0042 trusted movement-offer authorization tests failed: %',failed_count;
  END IF;
END;
$assert$;
ROLLBACK;
