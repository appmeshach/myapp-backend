BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='5s';

CREATE TEMP TABLE pg_temp.snapshot_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.snapshot_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  INSERT INTO pg_temp.snapshot_results(
    test_name,
    passed,
    diagnostic
  )
  VALUES(
    p_name,
    coalesce(p_passed,false),
    p_diagnostic
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_check(text,boolean,text)
FROM PUBLIC;


-- Execute one SELECT using one of the API/database roles.
CREATE FUNCTION pg_temp.snapshot_select_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  previous_role text;
  previous_sub text;
  previous_jwt_role text;
  previous_claims text;
  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated','anon','service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  previous_role := current_setting('role');
  previous_sub := current_setting('request.jwt.claim.sub',true);
  previous_jwt_role := current_setting('request.jwt.claim.role',true);
  previous_claims := current_setting('request.jwt.claims',true);

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member_id::text,''),
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

  PERFORM set_config('role',p_role,true);

  BEGIN
    EXECUTE
      'SELECT coalesce(
         jsonb_agg(to_jsonb(q)),
         ''[]''::jsonb
       )
       FROM (' || p_sql || ') AS q'
    INTO rows_json;

    result_json := jsonb_build_object(
      'ok',true,
      'rows',rows_json
    );
  EXCEPTION
    WHEN OTHERS THEN
      result_json := jsonb_build_object(
        'ok',false,
        'state',SQLSTATE,
        'message',SQLERRM
      );
  END;

  PERFORM set_config('role',previous_role,true);
  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(previous_sub,''),
    true
  );
  PERFORM set_config(
    'request.jwt.claim.role',
    coalesce(previous_jwt_role,''),
    true
  );
  PERFORM set_config(
    'request.jwt.claims',
    coalesce(previous_claims,'{}'),
    true
  );

  RETURN result_json;
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_select_as(text,uuid,text)
FROM PUBLIC;


-- Build the same provider-resolved + trusted-state endpoint shape used by the
-- later same-state movement system. Directly inserting a resolved location is
-- insufficient because route matching requires authoritative state evidence.
CREATE FUNCTION pg_temp.snapshot_state_endpoint(
  p_owner_member_id uuid,
  p_label text,
  p_provider_place_reference text,
  p_latitude numeric,
  p_longitude numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  source_id uuid;
  target_id uuid;
  resolution_evidence_id uuid;
  t timestamptz := clock_timestamp();
BEGIN
  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    provider_namespace,
    provider_place_reference,
    created_at
  )
  VALUES(
    p_owner_member_id,
    p_label,
    'member_selected',
    'unresolved',
    'test-provider',
    p_provider_place_reference,
    t
  )
  RETURNING id
  INTO source_id;

  INSERT INTO private.movement_location_references(
    owner_member_id,
    declared_label,
    source_kind,
    resolution_status,
    latitude,
    longitude,
    provider_namespace,
    provider_place_reference,
    resolution_version,
    resolved_at,
    created_at,
    expires_at
  )
  VALUES(
    p_owner_member_id,
    p_label,
    'provider_resolved',
    'resolved',
    p_latitude,
    p_longitude,
    'test-provider',
    p_provider_place_reference,
    'test-resolution-v1',
    t,
    t,
    t + interval '4 hours'
  )
  RETURNING id
  INTO target_id;

  INSERT INTO private.movement_location_resolution_evidence(
    source_location_reference_id,
    resolved_location_reference_id,
    version,
    producer_request_id,
    provider_product,
    provider_version,
    resolution_schema_version,
    requested_expires_at,
    recorded_at
  )
  VALUES(
    source_id,
    target_id,
    1,
    gen_random_uuid(),
    'test-geocoder',
    'v1',
    'movement_location_resolution_v1',
    t + interval '4 hours',
    t
  )
  RETURNING id
  INTO resolution_evidence_id;

  INSERT INTO private.trusted_location_state_evidence(
    resolution_evidence_id,
    resolved_location_reference_id,
    provider_namespace,
    state_provider_reference,
    state_name,
    state_key,
    recorded_at
  )
  VALUES(
    resolution_evidence_id,
    target_id,
    'test-provider',
    'region-lagos',
    'Lagos',
    private.canonical_nigerian_state_key('Lagos'),
    clock_timestamp()
  );

  RETURN target_id;
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_state_endpoint(
  uuid,
  text,
  text,
  numeric,
  numeric
)
FROM PUBLIC;


-- Trusted server-side route fixture.
CREATE FUNCTION pg_temp.snapshot_route(
  p_intent uuid,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  t timestamptz := clock_timestamp();
BEGIN
  RETURN pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_offering_route_evidence_for_server(
         %L::uuid,
         ''test-router'',
         ''directions'',
         ''v1'',
         %L,
         %L::jsonb,
         18000,
         2400,
         %L::timestamptz,
         %L::timestamptz
       )',
      p_intent,
      p_reference,
      '{"type":"LineString","coordinates":[[3.5852,6.4698],[3.5200,6.4300],[3.4900,6.4320],[3.4430,6.4310],[3.4219,6.4281]]}',
      t,
      t + interval '3 hours'
    )
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_route(uuid,text)
FROM PUBLIC;


CREATE FUNCTION pg_temp.snapshot_match(
  p_need uuid,
  p_intent uuid,
  p_route uuid,
  p_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  t timestamptz := clock_timestamp();
BEGIN
  RETURN pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_trusted_route_match_evidence_for_server(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::integer,
         250000,
         400000,
         18000,
         1000,
         12000,
         6.4300,
         3.5200,
         6.4310,
         3.4430,
         %L::timestamptz,
         %L::timestamptz
       )',
      p_need,
      p_intent,
      p_route,
      p_version,
      t,
      t + interval '2 hours'
    )
  );
END;
$$;

REVOKE ALL
ON FUNCTION pg_temp.snapshot_match(uuid,uuid,uuid,integer)
FROM PUBLIC;


CREATE TEMP TABLE pg_temp.snapshot_fixture (
  requester uuid NOT NULL,
  offerer uuid NOT NULL,
  traveller uuid NOT NULL,
  vehicle uuid NOT NULL,
  need uuid NOT NULL,
  intent uuid NOT NULL,
  route uuid NOT NULL,
  match_evidence uuid NOT NULL,
  availability uuid NOT NULL,
  movement_offer uuid NOT NULL
) ON COMMIT DROP;


DO $fixture$
DECLARE
  requester uuid := gen_random_uuid();
  offerer uuid := gen_random_uuid();
  traveller uuid := gen_random_uuid();
  vehicle uuid := gen_random_uuid();

  requester_origin uuid;
  requester_destination uuid;
  offerer_origin uuid;
  offerer_destination uuid;

  need uuid;
  intent uuid;
  route uuid;
  match_evidence uuid;
  availability uuid;
  movement_offer uuid;

  loc record;
  location_id uuid;
  r jsonb;
  t timestamptz;
BEGIN
  t := clock_timestamp();

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
  SELECT
    id,
    'authenticated',
    'authenticated',
    id::text || '@test-0072.invalid',
    t,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    t,
    t
  FROM unnest(ARRAY[
    requester,
    offerer,
    traveller
  ]) ids(id);

  requester_origin :=
    pg_temp.snapshot_state_endpoint(
      requester,
      'Agungi, Lagos',
      '0072-requester-origin',
      6.4300,
      3.5200
    );

  requester_destination :=
    pg_temp.snapshot_state_endpoint(
      requester,
      'Oniru, Lagos',
      '0072-requester-destination',
      6.4310,
      3.4430
    );

  offerer_origin :=
    pg_temp.snapshot_state_endpoint(
      offerer,
      'Ajah, Lagos',
      '0072-offerer-origin',
      6.4698,
      3.5852
    );

  offerer_destination :=
    pg_temp.snapshot_state_endpoint(
      offerer,
      'Victoria Island, Lagos',
      '0072-offerer-destination',
      6.4281,
      3.4219
    );

  r := pg_temp.snapshot_select_as(
    'authenticated',
    requester,
    format(
      'SELECT *
       FROM public.create_movement_need(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         %L::timestamptz,
         %L::timestamptz,
         1
       )',
      gen_random_uuid(),
      requester_origin,
      requester_destination,
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    )
  );

  need := (r#>>'{rows,0,movement_need_id}')::uuid;

  IF need IS NULL THEN
    RAISE EXCEPTION '0072 requester fixture failed: %',r;
  END IF;

  -- Make this a two-person confirmed requester group.
  UPDATE public.movement_needs
  SET people_count=2
  WHERE id=need;

  INSERT INTO public.movement_participants(
    movement_need_id,
    member_id,
    role,
    status
  )
  VALUES(
    need,
    traveller,
    'invited_participant',
    'confirmed'
  );

  r := pg_temp.snapshot_select_as(
    'authenticated',
    offerer,
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
      offerer_origin,
      offerer_destination,
      statement_timestamp() + interval '1 hour',
      statement_timestamp() + interval '2 hours'
    )
  );

  intent :=
    (r#>>'{rows,0,offering_movement_intent_id}')::uuid;

  IF intent IS NULL THEN
    RAISE EXCEPTION '0072 offering intent fixture failed: %',r;
  END IF;

  r := pg_temp.snapshot_route(
    intent,
    '0072-main-route'
  );

  route :=
    (r#>>'{rows,0,route_evidence_id}')::uuid;

  IF route IS NULL THEN
    RAISE EXCEPTION '0072 route fixture failed: %',r;
  END IF;

  r := pg_temp.snapshot_match(
    need,
    intent,
    route,
    1
  );

  match_evidence :=
    (r#>>'{rows,0,route_match_evidence_id}')::uuid;

  IF match_evidence IS NULL THEN
    RAISE EXCEPTION '0072 route-match fixture failed: %',r;
  END IF;

  INSERT INTO public.vehicles(
    id,
    make,
    model,
    color,
    seat_capacity,
    plate_number
  )
  VALUES(
    vehicle,
    'Lexus',
    'RX350',
    'Blue',
    4,
    'T0072-' || left(vehicle::text,8)
  );

  INSERT INTO public.member_vehicle_access(
    member_id,
    vehicle_id,
    active
  )
  VALUES(
    offerer,
    vehicle,
    true
  );

  r := pg_temp.snapshot_select_as(
    'authenticated',
    offerer,
    format(
      'SELECT *
       FROM public.open_offering_movement_availability(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         3
       )',
      gen_random_uuid(),
      intent,
      vehicle
    )
  );

  availability :=
    (r#>>'{rows,0,availability_id}')::uuid;

  IF availability IS NULL THEN
    RAISE EXCEPTION '0072 availability fixture failed: %',r;
  END IF;

  r := pg_temp.snapshot_select_as(
    'authenticated',
    offerer,
    format(
      'SELECT *
       FROM public.create_movement_offer(
         %L::uuid,
         %L::uuid,
         %L::uuid,
         3,
         ''Chevron pickup'',
         ''Oniru dropoff'',
         18
       )',
      need,
      match_evidence,
      availability
    )
  );

  movement_offer :=
    (r#>>'{rows,0,movement_offer_id}')::uuid;

  IF movement_offer IS NULL THEN
    RAISE EXCEPTION '0072 movement offer fixture failed: %',r;
  END IF;

  INSERT INTO pg_temp.snapshot_fixture
  VALUES(
    requester,
    offerer,
    traveller,
    vehicle,
    need,
    intent,
    route,
    match_evidence,
    availability,
    movement_offer
  );
END;
$fixture$;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;


-- Snapshot production itself starts here.
DO $tests$
DECLARE
  f pg_temp.snapshot_fixture%ROWTYPE;
  r jsonb;
  original jsonb;
  replay jsonb;
  v_snapshot_id uuid;
  fn oid :=
    'public.record_movement_context_snapshot_for_server(uuid)'::regprocedure;
  remaining_before integer;
  offer_before jsonb;
  alignment_count_before bigint;
  proposal_count_before bigint;
  payment_count_before bigint;
  agreement_count_before bigint;
  role_name text;
BEGIN
  SELECT *
  INTO STRICT f
  FROM pg_temp.snapshot_fixture;

  SELECT remaining_places
  INTO remaining_before
  FROM private.offering_movement_availability
  WHERE id=f.availability;

  SELECT to_jsonb(o)
  INTO offer_before
  FROM public.movement_offers o
  WHERE o.id=f.movement_offer;

  SELECT count(*)
  INTO alignment_count_before
  FROM public.alignments
  WHERE movement_need_id=f.need;

  SELECT count(*)
  INTO proposal_count_before
  FROM private.financial_proposals
  WHERE movement_need_id=f.need;

  SELECT count(*)
  INTO payment_count_before
  FROM private.alignment_activation_payments;

  SELECT count(*)
  INTO agreement_count_before
  FROM private.financial_agreements fa
  JOIN public.alignments a
    ON a.id=fa.alignment_id
  WHERE a.movement_need_id=f.need;

  r := pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
      f.movement_offer
    )
  );

  PERFORM pg_temp.snapshot_check(
    'service-role valid snapshot creation',
    r->>'ok'='true'
    AND jsonb_array_length(r->'rows')=1,
    r::text
  );

  original := (r->'rows'->0);
  v_snapshot_id := (original->>'snapshot_id')::uuid;

  PERFORM pg_temp.snapshot_check(
    'snapshot row created',
    v_snapshot_id IS NOT NULL
    AND EXISTS(
      SELECT 1
      FROM private.movement_context_snapshots s
      WHERE s.id=v_snapshot_id
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot copies exact movement offer terms',
    EXISTS(
      SELECT 1
      FROM private.movement_context_snapshots s
      JOIN public.movement_offers o
        ON o.id=s.movement_offer_id
      WHERE s.id=v_snapshot_id
        AND o.id=f.movement_offer
        AND s.movement_need_id=o.movement_need_id
        AND s.offering_member_id=o.offering_member_id
        AND s.vehicle_id=o.vehicle_id
        AND s.seats_offered=o.seats_offered
        AND s.proposed_pickup_area
              IS NOT DISTINCT FROM o.proposed_pickup_area
        AND s.proposed_dropoff_area
              IS NOT DISTINCT FROM o.proposed_dropoff_area
        AND s.declared_arrival_minutes
              IS NOT DISTINCT FROM o.estimated_arrival_minutes
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot binds exact requester and offering intent',
    EXISTS(
      SELECT 1
      FROM private.movement_context_snapshots s
      WHERE s.id=v_snapshot_id
        AND s.requesting_member_id=f.requester
        AND s.offering_member_id=f.offerer
        AND s.offering_movement_intent_id=f.intent
        AND s.offering_intent_version=1
        AND s.people_count=2
        AND s.vehicle_seat_capacity=4
        AND s.status='current'
    )
  );

  PERFORM pg_temp.snapshot_check(
    'exact two-person confirmed roster copied',
    (
      SELECT count(*)=2
      FROM private.movement_context_snapshot_travellers st
      WHERE st.snapshot_id=v_snapshot_id
    )
    AND EXISTS(
      SELECT 1
      FROM private.movement_context_snapshot_travellers st
      WHERE st.snapshot_id=v_snapshot_id
        AND st.member_id=f.requester
        AND st.role='primary_requester'
    )
    AND EXISTS(
      SELECT 1
      FROM private.movement_context_snapshot_travellers st
      WHERE st.snapshot_id=v_snapshot_id
        AND st.member_id=f.traveller
        AND st.role='invited_participant'
    )
  );

  PERFORM private.assert_movement_context_snapshot(
    v_snapshot_id
  );

  PERFORM pg_temp.snapshot_check(
    'existing 0022 validator accepts produced snapshot',
    true
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot creation does not consume availability',
    (
      SELECT remaining_places=remaining_before
      FROM private.offering_movement_availability
      WHERE id=f.availability
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot creation leaves offer pending and unchanged',
    (
      SELECT to_jsonb(o)=offer_before
      FROM public.movement_offers o
      WHERE o.id=f.movement_offer
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot creation creates no alignment',
    (
      SELECT count(*)=alignment_count_before
      FROM public.alignments
      WHERE movement_need_id=f.need
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot creation creates no financial proposal',
    (
      SELECT count(*)=proposal_count_before
      FROM private.financial_proposals
      WHERE movement_need_id=f.need
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot creation creates no activation payment',
    (
      SELECT count(*)=payment_count_before
      FROM private.alignment_activation_payments
    )
  );

  PERFORM pg_temp.snapshot_check(
    'snapshot creation creates no financial agreement',
    (
      SELECT count(*)=agreement_count_before
      FROM private.financial_agreements fa
      JOIN public.alignments a
        ON a.id=fa.alignment_id
      WHERE a.movement_need_id=f.need
    )
  );

  PERFORM pg_sleep(0.01);

  r := pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
      f.movement_offer
    )
  );

  replay := (r->'rows'->0);

  PERFORM pg_temp.snapshot_check(
    'exact replay returns identical ID version and timestamps',
    r->>'ok'='true'
    AND replay=original,
    r::text
  );

  PERFORM pg_temp.snapshot_check(
    'exact replay creates no second snapshot',
    (
      SELECT count(*)=1
      FROM private.movement_context_snapshots s
      WHERE s.movement_need_id=f.need
        AND s.offering_member_id=f.offerer
    )
  );

  PERFORM pg_temp.snapshot_check(
    'PUBLIC has no execute grant',
    NOT EXISTS(
      SELECT 1
      FROM pg_proc p,
      LATERAL aclexplode(
        coalesce(
          p.proacl,
          acldefault('f',p.proowner)
        )
      ) a
      WHERE p.oid=fn
        AND a.grantee=0
        AND a.privilege_type='EXECUTE'
    )
  );

  PERFORM pg_temp.snapshot_check(
    'service_role has execute grant',
    has_function_privilege(
      'service_role',
      fn,
      'EXECUTE'
    )
  );

  FOREACH role_name IN ARRAY ARRAY[
    'anon',
    'authenticated'
  ]
  LOOP
    PERFORM pg_temp.snapshot_check(
      role_name || ' has no execute grant',
      NOT has_function_privilege(
        role_name,
        fn,
        'EXECUTE'
      )
    );

    r := pg_temp.snapshot_select_as(
      role_name,
      CASE
        WHEN role_name='authenticated'
        THEN f.requester
        ELSE NULL
      END,
      format(
        'SELECT *
         FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
        f.movement_offer
      )
    );

    PERFORM pg_temp.snapshot_check(
      role_name || ' execution denied',
      r->>'state'='42501',
      r::text
    );
  END LOOP;

  PERFORM pg_temp.snapshot_check(
    'service_role still lacks direct snapshot table writes',
    NOT has_table_privilege(
      'service_role',
      'private.movement_context_snapshots',
      'INSERT,UPDATE,DELETE,TRUNCATE'
    )
    AND NOT has_table_privilege(
      'service_role',
      'private.movement_context_snapshot_travellers',
      'INSERT,UPDATE,DELETE,TRUNCATE'
    )
  );

  PERFORM pg_temp.snapshot_check(
    'private offer-binding helper is not callable by API roles',
    NOT has_function_privilege(
      'anon',
      'private.assert_movement_context_snapshot_offer_binding(private.movement_context_snapshots)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'authenticated',
      'private.assert_movement_context_snapshot_offer_binding(private.movement_context_snapshots)',
      'EXECUTE'
    )
    AND NOT has_function_privilege(
      'service_role',
      'private.assert_movement_context_snapshot_offer_binding(private.movement_context_snapshots)',
      'EXECUTE'
    )
  );

  r := pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    'SELECT *
     FROM public.record_movement_context_snapshot_for_server(NULL)'
  );

  PERFORM pg_temp.snapshot_check(
    'null offer rejected',
    r->>'state'='22004',
    r::text
  );

  r := pg_temp.snapshot_select_as(
    'service_role',
    NULL,
    format(
      'SELECT *
       FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
      gen_random_uuid()
    )
  );

  PERFORM pg_temp.snapshot_check(
    'unknown offer rejected',
    r->>'state'='23514',
    r::text
  );

  -- Every negative mutation runs inside a subtransaction and therefore rolls
  -- itself back before the next check.
  BEGIN
    UPDATE public.movement_offers
    SET status='withdrawn'
    WHERE id=f.movement_offer;

    r := pg_temp.snapshot_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
        f.movement_offer
      )
    );

    IF r->>'ok' <> 'false' THEN
      RAISE EXCEPTION 'withdrawn offer unexpectedly accepted';
    END IF;

    RAISE EXCEPTION USING
      ERRCODE='Z7201',
      MESSAGE='rollback withdrawn-offer probe';
  EXCEPTION
    WHEN SQLSTATE 'Z7201' THEN
      NULL;
  END;

  PERFORM pg_temp.snapshot_check(
    'withdrawn offer rejected without changing stored snapshot',
    EXISTS(
      SELECT 1
      FROM private.movement_context_snapshots s
      WHERE s.id=v_snapshot_id
        AND s.status='current'
    )
  );

  BEGIN
    UPDATE private.offering_movement_availability
    SET status='withdrawn'
    WHERE id=f.availability;

    r := pg_temp.snapshot_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
        f.movement_offer
      )
    );

    IF r->>'ok' <> 'false' THEN
      RAISE EXCEPTION 'withdrawn availability unexpectedly accepted';
    END IF;

    RAISE EXCEPTION USING
      ERRCODE='Z7202',
      MESSAGE='rollback withdrawn-availability probe';
  EXCEPTION
    WHEN SQLSTATE 'Z7202' THEN
      NULL;
  END;

  PERFORM pg_temp.snapshot_check(
    'withdrawn availability rejected without consuming capacity',
    (
      SELECT remaining_places=remaining_before
        AND status='open'
      FROM private.offering_movement_availability
      WHERE id=f.availability
    )
  );

  BEGIN
    UPDATE private.trusted_route_match_evidence
    SET status='superseded'
    WHERE id=f.match_evidence;

    r := pg_temp.snapshot_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
        f.movement_offer
      )
    );

    IF r->>'ok' <> 'false' THEN
      RAISE EXCEPTION 'stale route match unexpectedly accepted';
    END IF;

    RAISE EXCEPTION USING
      ERRCODE='Z7203',
      MESSAGE='rollback stale-route probe';
  EXCEPTION
    WHEN SQLSTATE 'Z7203' THEN
      NULL;
  END;

  PERFORM pg_temp.snapshot_check(
    'stale route match rejected while offer remains pending',
    EXISTS(
      SELECT 1
      FROM public.movement_offers
      WHERE id=f.movement_offer
        AND status='pending'
    )
  );

  BEGIN
    UPDATE public.movement_participants
    SET status='invited'
    WHERE movement_need_id=f.need
      AND member_id=f.traveller;

    r := pg_temp.snapshot_select_as(
      'service_role',
      NULL,
      format(
        'SELECT *
         FROM public.record_movement_context_snapshot_for_server(%L::uuid)',
        f.movement_offer
      )
    );

    IF r->>'ok' <> 'false' THEN
      RAISE EXCEPTION 'incomplete roster unexpectedly accepted';
    END IF;

    RAISE EXCEPTION USING
      ERRCODE='Z7204',
      MESSAGE='rollback incomplete-roster probe';
  EXCEPTION
    WHEN SQLSTATE 'Z7204' THEN
      NULL;
  END;

  PERFORM pg_temp.snapshot_check(
    'incomplete roster rejected without altering snapshot',
    (
      SELECT count(*)=2
      FROM private.movement_context_snapshot_travellers st
      WHERE st.snapshot_id=v_snapshot_id
    )
  );
END;
$tests$;

SET CONSTRAINTS ALL IMMEDIATE;

SELECT
  test_number,
  test_name,
  passed,
  diagnostic
FROM pg_temp.snapshot_results
ORDER BY test_number;

SELECT
  count(*) AS tests,
  count(*) FILTER(WHERE passed) AS passed,
  count(*) FILTER(WHERE NOT passed) AS failed
FROM pg_temp.snapshot_results;

DO $verify$
BEGIN
  IF EXISTS(
    SELECT 1
    FROM pg_temp.snapshot_results
    WHERE NOT passed
  ) THEN
    RAISE EXCEPTION
      '0072 trusted movement context snapshot producer behavioral checks failed';
  END IF;
END;
$verify$;

ROLLBACK;