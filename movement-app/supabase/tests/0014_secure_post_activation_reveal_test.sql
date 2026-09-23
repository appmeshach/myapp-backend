BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- Run this WHOLE file as the database administrator after migrations 0001-0042.
-- No real users, Storage objects, external providers, or network calls are used.
-- All fixtures, temporary helpers, role/JWT settings and results roll back.
-- This file does not replace functions, disable triggers/RLS, or grant app rights.
-- The earlier 0013 test was not available in the source checkout when authored.
-- Pattern: transaction-local SET ROLE + JWT claims, actual RPC calls, named
-- boolean results. Run to the final ROLLBACK even if any result is FALSE.
-- Unexpected fixture/setup errors abort the transaction; issue ROLLBACK if your
-- SQL client stops on error. Do not change ROLLBACK to COMMIT.

CREATE TEMP TABLE reveal_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE reveal_function_snapshot ON COMMIT DROP AS
SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS definition_hash,
  p.proacl::text AS acl, p.proconfig::text AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f';

CREATE FUNCTION pg_temp.reveal_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO pg_temp.reveal_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness, NOT an application SECURITY DEFINER RPC.
-- Role switching must succeed BEFORE the error-catching subtransaction so a
-- harness permission failure cannot masquerade as an expected app denial.
-- SQL arguments below are fixed test SQL or format('%L', fixture values).
CREATE FUNCTION pg_temp.reveal_as(p_role text, p_member uuid, p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  previous_role text := current_setting('role');
  previous_sub text := current_setting('request.jwt.claim.sub', true);
  previous_claims text := current_setting('request.jwt.claims', true);
  previous_jwt_role text := current_setting('request.jwt.claim.role', true);
  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN ('authenticated', 'anon', 'service_role') THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', coalesce(p_member::text, ''), true);
  PERFORM set_config('request.jwt.claim.role', p_role, true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', p_member, 'role', p_role)::text, true);
  PERFORM set_config('role', p_role, true);
  BEGIN
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) FROM ('
      || p_sql || ') AS q' INTO rows_json;
    result_json := jsonb_build_object('ok', true, 'rows', rows_json);
  EXCEPTION WHEN OTHERS THEN
    -- The failed query's writes roll back. Do not accept arbitrary errors as a pass.
    result_json := jsonb_build_object('ok', false, 'state', SQLSTATE, 'message', SQLERRM);
  END;
  PERFORM set_config('role', previous_role, true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(previous_sub, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(previous_jwt_role, ''), true);
  PERFORM set_config('request.jwt.claims', coalesce(previous_claims, '{}'), true);
  RETURN result_json;
END;
$$;

CREATE FUNCTION pg_temp.reveal_denied(
  p_name text, p_role text, p_member uuid, p_sql text,
  p_state text DEFAULT '42501', p_message text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.reveal_as(p_role, p_member, p_sql);
  PERFORM pg_temp.reveal_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND (p_message IS NULL OR r->>'message' = p_message));
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.reveal_check(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.reveal_as(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.reveal_denied(text, text, uuid, text, text, text) FROM PUBLIC;

-- Trusted setup adapted from 0042. Only resolved locations are admin fixtures;
-- needs, independent driver intents, routes and matches use the real RPCs.
-- Separate intents keep all three offers' route evidence current independently.
CREATE FUNCTION pg_temp.reveal_trusted_need(
  p_requester uuid, p_driver uuid, p_label text, p_people_count integer
)
RETURNS TABLE (need_id uuid, match_id uuid)
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  requester_origin uuid := gen_random_uuid();
  requester_destination uuid := gen_random_uuid();
  driver_origin uuid := gen_random_uuid();
  driver_destination uuid := gen_random_uuid();
  intent_id uuid;
  route_id uuid;
  r jsonb;
  t timestamptz := clock_timestamp();
  departure_earliest timestamptz := statement_timestamp() + interval '1 hour';
  departure_latest timestamptz := statement_timestamp() + interval '2 hours';
BEGIN
  INSERT INTO private.movement_location_references(
    id, owner_member_id, declared_label, source_kind, resolution_status,
    latitude, longitude, provider_namespace, provider_place_reference,
    resolution_version, created_at, resolved_at, expires_at)
  SELECT id, member_id, area, 'provider_resolved', 'resolved', lat, lon,
    'test-provider', '0014-' || id::text, 'test-resolution-v1', t, t, t + interval '4 hours'
  FROM (VALUES
    (requester_origin, p_requester, p_label || ' origin', 6.4300, 3.5200),
    (requester_destination, p_requester, p_label || ' destination', 6.4310, 3.4430),
    (driver_origin, p_driver, 'Ajah, Lagos', 6.4698, 3.5852),
    (driver_destination, p_driver, 'Victoria Island, Lagos', 6.4281, 3.4219)
  ) locations(id, member_id, area, lat, lon);

  r := pg_temp.reveal_as('authenticated', p_requester, format(
    'SELECT * FROM public.create_movement_need(%L::uuid,%L::uuid,%L::uuid,
      %L::timestamptz,%L::timestamptz,%L::integer)',
    gen_random_uuid(), requester_origin, requester_destination,
    departure_earliest, departure_latest, p_people_count));
  need_id := (r#>>'{rows,0,movement_need_id}')::uuid;
  IF r->>'ok' IS DISTINCT FROM 'true' OR need_id IS NULL THEN
    RAISE EXCEPTION '0014 % trusted need setup failed: %', p_label, r;
  END IF;

  r := pg_temp.reveal_as('authenticated', p_driver, format(
    'SELECT * FROM public.create_offering_movement_intent(%L::uuid,%L::uuid,%L::uuid,
      %L::timestamptz,%L::timestamptz)',
    gen_random_uuid(), driver_origin, driver_destination, departure_earliest, departure_latest));
  intent_id := (r#>>'{rows,0,offering_movement_intent_id}')::uuid;
  IF r->>'ok' IS DISTINCT FROM 'true' OR intent_id IS NULL THEN
    RAISE EXCEPTION '0014 % trusted driver intent setup failed: %', p_label, r;
  END IF;

  t := clock_timestamp();
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.record_offering_route_evidence_for_server(
      %L::uuid,''test-router'',''directions'',''v1'',%L,%L::jsonb,
      18000,2400,%L::timestamptz,%L::timestamptz)',
    intent_id, '0014-' || intent_id::text,
    '{"type":"LineString","coordinates":[[3.5852,6.4698],[3.5200,6.4300],[3.4900,6.4320],[3.4430,6.4310],[3.4219,6.4281]]}',
    t, t + interval '3 hours'));
  route_id := (r#>>'{rows,0,route_evidence_id}')::uuid;
  IF r->>'ok' IS DISTINCT FROM 'true' OR route_id IS NULL
    OR r#>>'{rows,0,route_evidence_version}' IS DISTINCT FROM '1'
    OR r#>>'{rows,0,route_evidence_status}' IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION '0014 % trusted route setup failed: %', p_label, r;
  END IF;

  -- Large objective distances follow 0042; no maximum-detour rule is imposed.
  t := clock_timestamp();
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.record_trusted_route_match_evidence_for_server(
      %L::uuid,%L::uuid,%L::uuid,1,250000,400000,18000,1000,12000,
      6.4300,3.5200,6.4310,3.4430,%L::timestamptz,%L::timestamptz)',
    need_id, intent_id, route_id, t, t + interval '2 hours'));
  match_id := (r#>>'{rows,0,route_match_evidence_id}')::uuid;
  IF r->>'ok' IS DISTINCT FROM 'true' OR match_id IS NULL
    OR r#>>'{rows,0,route_match_evidence_status}' IS DISTINCT FROM 'current' THEN
    RAISE EXCEPTION '0014 % trusted route-match setup failed: %', p_label, r;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.reveal_trusted_need(uuid,uuid,text,integer) FROM PUBLIC;

DO $test$
DECLARE
  driver uuid := gen_random_uuid();
  requester uuid := gen_random_uuid();
  traveller uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  declined uuid := gen_random_uuid();
  removed uuid := gen_random_uuid();
  pending uuid := gen_random_uuid();
  group_need uuid;
  legacy_need uuid;
  model_less_need uuid;
  group_match uuid;
  legacy_match uuid;
  model_less_match uuid;
  legacy_vehicle uuid := gen_random_uuid();
  vehicle uuid;
  model_less_vehicle uuid;
  offer uuid;
  legacy_offer uuid;
  model_less_offer uuid;
  alignment uuid;
  model_less_alignment uuid;
  payment uuid;
  model_less_payment uuid;
  journey uuid;
  invitation uuid;
  pending_invitation uuid := gen_random_uuid();
  driver_photo uuid := gen_random_uuid();
  requester_photo uuid;
  traveller_face_photo uuid := gen_random_uuid();
  face_fixture_time timestamptz;
  replacement_photo uuid := gen_random_uuid();
  share_token text;
  outsider_share text;
  photo_token text;
  photo_expiry timestamptz;
  activated_time timestamptz;
  r jsonb;
  people jsonb;
  requester_people jsonb;
  traveller_people jsonb;
  vehicle_result jsonb;
  keys text[];
  safe_person_keys text[] := ARRAY['age', 'completed_movements', 'first_name',
    'person_number', 'person_role', 'profile_photo_expires_at', 'profile_photo_token',
    'rating', 'verified'];
  actor uuid;
  all_ok boolean;
BEGIN
  -- Minimal fresh auth fixtures; the real auth bootstrap trigger creates members.
  -- Random IDs/emails avoid collisions; no existing rows are selected or changed.
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  SELECT id, 'authenticated', 'authenticated', id::text || '@test-0014.invalid',
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  FROM unnest(ARRAY[driver, requester, traveller, outsider, declined, removed, pending]) AS ids(id);

  UPDATE public.members SET first_name = 'Offering0014', date_of_birth = DATE '1988-02-15',
    identity_verified = true, profile_media_verified = true, rating = 4.75,
    completed_movements = 12, common_movement_area = 'PRIVATE-CMA-0014'
  WHERE id = driver;
  UPDATE public.members SET first_name = 'Primary0014', date_of_birth = DATE '1990-01-15',
    identity_verified = true, profile_media_verified = false, rating = 4.25,
    completed_movements = 7, common_movement_area = 'PRIVATE-CMA-0014'
  WHERE id = requester;
  UPDATE public.members SET first_name = 'Invited0014', date_of_birth = NULL,
    identity_verified = false, profile_media_verified = true, rating = NULL,
    completed_movements = 0, common_movement_area = 'PRIVATE-CMA-0014'
  WHERE id = traveller;

  INSERT INTO public.member_media(id, member_id, media_type, storage_path, verified, is_current, created_at)
  VALUES
    (driver_photo, driver, 'photo', 'test-0014/' || driver::text || '/current.jpg', true, true, now()),
    (gen_random_uuid(), driver, 'photo', 'test-0014/old.jpg', true, false, now() - interval '1 day'),
    (gen_random_uuid(), driver, 'photo', 'test-0014/unverified.jpg', false, false, now() + interval '1 day'),
    (gen_random_uuid(), driver, 'video', 'test-0014/video.mp4', true, true, now() + interval '1 day'),
    (gen_random_uuid(), requester, 'photo', 'test-0014/requester.jpg', true, true, now());

  r := pg_temp.reveal_as('authenticated', driver,
    'SELECT current_user::text AS role, auth.uid() AS member');
  PERFORM pg_temp.reveal_check('01 real authenticated role and JWT subject are active',
    r->>'ok' = 'true' AND r#>>'{rows,0,role}' = 'authenticated'
    AND r#>>'{rows,0,member}' = driver::text);

  PERFORM pg_temp.reveal_denied('02 legacy plate-less registration is not executable',
    'authenticated', driver,
    $$SELECT * FROM public.register_vehicle_with_access('Lexus', NULL, NULL, 'Blue', 4)$$);

  r := pg_temp.reveal_as('authenticated', driver,
    $$SELECT * FROM public.register_vehicle_with_plate('Lexus', 'RX350', 2020, 'Blue', 4, ' TST-0014-FULL ')$$);
  vehicle := (r#>>'{rows,0,vehicle_id}')::uuid;
  PERFORM pg_temp.reveal_check('03 authenticated plate-aware registration succeeds',
    r->>'ok' = 'true' AND vehicle IS NOT NULL AND jsonb_array_length(r->'rows') = 1);
  PERFORM pg_temp.reveal_check('04 plate registration stores trimmed full plate and active access privately',
    EXISTS (SELECT 1 FROM public.vehicles v JOIN public.member_vehicle_access a ON a.vehicle_id = v.id
      WHERE v.id = vehicle AND v.plate_number = 'TST-0014-FULL' AND a.member_id = driver AND a.active)
    AND NOT ((r#>'{rows,0}') ? 'plate_number'));

  PERFORM pg_temp.reveal_denied('05 NULL plate registration is rejected', 'authenticated', driver,
    $$SELECT * FROM public.register_vehicle_with_plate('Lexus', NULL, NULL, 'Blue', 4, NULL)$$,
    'P0001', 'Plate number must contain 1 to 32 characters without control characters');
  PERFORM pg_temp.reveal_denied('06 blank plate registration is rejected', 'authenticated', driver,
    $$SELECT * FROM public.register_vehicle_with_plate('Lexus', NULL, NULL, 'Blue', 4, '   ')$$,
    'P0001', 'Plate number must contain 1 to 32 characters without control characters');

  r := pg_temp.reveal_as('authenticated', driver,
    $$SELECT * FROM public.register_vehicle_with_plate('Lexus', NULL, NULL, 'Blue', 4, 'TST-0014-NOMODEL')$$);
  model_less_vehicle := (r#>>'{rows,0,vehicle_id}')::uuid;
  PERFORM pg_temp.reveal_check('07 model is optional during plate-aware registration',
    r->>'ok' = 'true' AND EXISTS (SELECT 1 FROM public.vehicles
      WHERE id = model_less_vehicle AND model IS NULL));

  PERFORM pg_temp.reveal_denied('08 ordinary SELECT cannot read even own plate', 'authenticated', driver,
    format('SELECT plate_number FROM public.vehicles WHERE id = %L::uuid', vehicle));
  PERFORM pg_temp.reveal_denied('09 vehicle SELECT star cannot bypass column permissions', 'authenticated', driver,
    format('SELECT * FROM public.vehicles WHERE id = %L::uuid', vehicle));
  r := pg_temp.reveal_as('authenticated', driver, format(
    'SELECT id, make, model, year, color, seat_capacity, created_at, updated_at FROM public.vehicles WHERE id = %L::uuid', vehicle));
  PERFORM pg_temp.reveal_check('10 permitted ordinary vehicle columns remain readable',
    r->>'ok' = 'true' AND jsonb_array_length(r->'rows') = 1
    AND r#>>'{rows,0,make}' = 'Lexus' AND r#>>'{rows,0,seat_capacity}' = '4');
  r := pg_temp.reveal_as('authenticated', outsider,
    format('SELECT id, make FROM public.vehicles WHERE id = %L::uuid', vehicle));
  PERFORM pg_temp.reveal_check('11 ordinary vehicle RLS excludes unrelated members',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);

  PERFORM pg_temp.reveal_denied('12 raw own member_media SELECT is blocked', 'authenticated', driver,
    format('SELECT * FROM public.member_media WHERE member_id = %L::uuid', driver));
  PERFORM pg_temp.reveal_denied('13 direct media storage_path SELECT is blocked', 'authenticated', driver,
    format('SELECT storage_path FROM public.member_media WHERE member_id = %L::uuid', driver));

  -- Administrative fixtures model existing pre-0014 plate-less development data.
  INSERT INTO public.vehicles(id, make, model, color, seat_capacity)
  VALUES (legacy_vehicle, 'Lexus', NULL, 'Blue', 4);
  INSERT INTO public.member_vehicle_access(member_id, vehicle_id) VALUES (driver, legacy_vehicle);
  SELECT need_id, match_id INTO STRICT group_need, group_match
  FROM pg_temp.reveal_trusted_need(requester, driver, 'Test', 2);
  SELECT need_id, match_id INTO STRICT legacy_need, legacy_match
  FROM pg_temp.reveal_trusted_need(requester, driver, 'Legacy', 1);
  SELECT need_id, match_id INTO STRICT model_less_need, model_less_match
  FROM pg_temp.reveal_trusted_need(requester, driver, 'Model-less', 1);

  r := pg_temp.reveal_as('authenticated', driver, format(
    'SELECT * FROM public.create_movement_offer(%L::uuid, %L::uuid, %L::uuid, 1)', legacy_need, legacy_match, legacy_vehicle));
  legacy_offer := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.reveal_check('14 legacy plate-less pending offer fixture is valid',
    r->>'ok' = 'true' AND legacy_offer IS NOT NULL);
  PERFORM pg_temp.reveal_denied('15 plate-less vehicle cannot enter a new alignment', 'authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', legacy_offer), 'P0001',
    'A vehicle plate must be recorded before alignment or activation');
  PERFORM pg_temp.reveal_check('16 failed plate-less acceptance leaves no alignment or state changes',
    NOT EXISTS (SELECT 1 FROM public.alignments WHERE movement_need_id = legacy_need)
    AND EXISTS (SELECT 1 FROM public.movement_needs WHERE id = legacy_need AND status = 'discoverable')
    AND EXISTS (SELECT 1 FROM public.movement_offers WHERE id = legacy_offer AND status = 'pending'));

  -- Exercise 0013 through the real share-token invitation and offer RPCs.
  PERFORM pg_temp.reveal_denied('17 0013 raw UUID invitation remains disabled', 'authenticated', requester,
    format('SELECT * FROM public.invite_movement_participant(%L::uuid, %L::uuid)', group_need, traveller));
  PERFORM pg_temp.reveal_denied('18 0013 rejects offers below declared group size', 'authenticated', driver,
    format('SELECT * FROM public.create_movement_offer(%L::uuid, %L::uuid, %L::uuid, 1)', group_need, group_match, vehicle),
    'P0001', 'Seats offered are fewer than the travellers declared for this movement');
  PERFORM pg_temp.reveal_denied('19 0013 rejects offers above vehicle capacity', 'authenticated', driver,
    format('SELECT * FROM public.create_movement_offer(%L::uuid, %L::uuid, %L::uuid, 5)', group_need, group_match, vehicle),
    'P0001', 'Seats offered cannot exceed the vehicle seat capacity');

  r := pg_temp.reveal_as('authenticated', driver, format(
    'SELECT * FROM public.create_movement_offer(%L::uuid, %L::uuid, %L::uuid, 2)', group_need, group_match, vehicle));
  offer := (r#>>'{rows,0,movement_offer_id}')::uuid;
  PERFORM pg_temp.reveal_check('20 recorded-plate vehicle follows normal offer creation',
    r->>'ok' = 'true' AND offer IS NOT NULL);
  PERFORM pg_temp.reveal_denied('21 0013 rejects acceptance before all travellers confirm', 'authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', offer), 'P0001',
    'All declared travellers must be confirmed before accepting an offer');

  r := pg_temp.reveal_as('authenticated', traveller, 'SELECT * FROM public.create_my_profile_share()');
  share_token := r#>>'{rows,0,share_token}';
  r := pg_temp.reveal_as('authenticated', requester, format(
    'SELECT * FROM public.invite_movement_participant_by_share_token(%L::uuid, %L)', group_need, share_token));
  invitation := (r#>>'{rows,0,participant_id}')::uuid;
  PERFORM pg_temp.reveal_check('22 share-token invitation succeeds within capacity',
    r->>'ok' = 'true' AND invitation IS NOT NULL AND r#>>'{rows,0,participant_status}' = 'invited');
  r := pg_temp.reveal_as('authenticated', outsider, 'SELECT * FROM public.create_my_profile_share()');
  outsider_share := r#>>'{rows,0,share_token}';
  PERFORM pg_temp.reveal_denied('23 0013 counts pending invitations against group capacity', 'authenticated', requester,
    format('SELECT * FROM public.invite_movement_participant_by_share_token(%L::uuid, %L)', group_need, outsider_share),
    'P0001', 'Movement group already has all declared traveller slots filled');
  r := pg_temp.reveal_as('authenticated', traveller,
    format('SELECT * FROM public.respond_to_movement_invitation(%L::uuid, true)', invitation));
  PERFORM pg_temp.reveal_check('24 invited traveller can confirm within capacity',
    r->>'ok' = 'true' AND r#>>'{rows,0,participant_status}' = 'confirmed');
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_my_movement_group_readiness(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('25 0013 readiness counts primary requester and confirmed invitee',
    r->>'ok' = 'true' AND r#>>'{rows,0,confirmed_traveller_count}' = '2'
    AND r#>>'{rows,0,pending_invitation_count}' = '0' AND r#>>'{rows,0,group_ready}' = 'true');

  -- Valid table-level legacy fixtures isolate the pending-invitation/capacity
  -- guards (normal 0013 invitations would prevent this overbooked combination).
  INSERT INTO public.movement_participants(id, movement_need_id, member_id, role, status)
  VALUES (pending_invitation, group_need, pending, 'invited_participant', 'invited');
  PERFORM pg_temp.reveal_denied('26 0013 rejects acceptance with unresolved pending invitations', 'authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', offer), 'P0001',
    'Pending traveller invitations must be resolved before accepting an offer');
  PERFORM pg_temp.reveal_denied('27 0013 rejects invitation acceptance when confirmed group is full', 'authenticated', pending,
    format('SELECT * FROM public.respond_to_movement_invitation(%L::uuid, true)', pending_invitation),
    'P0001', 'Movement group is already full');
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.remove_movement_participant(%L::uuid)', pending_invitation));
  PERFORM pg_temp.reveal_check('28 primary requester can resolve extra pending invitation',
    r->>'ok' = 'true' AND r#>>'{rows,0,participant_status}' = 'removed');
  INSERT INTO public.movement_participants(movement_need_id, member_id, role, status)
  VALUES (group_need, declined, 'invited_participant', 'declined'),
    (group_need, removed, 'invited_participant', 'removed');

  UPDATE public.vehicles SET seat_capacity = 1 WHERE id = vehicle;
  PERFORM pg_temp.reveal_denied('29 0013 rechecks vehicle capacity at acceptance', 'authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', offer), 'P0001',
    'This offer now exceeds the vehicle seat capacity');
  UPDATE public.vehicles SET seat_capacity = 4 WHERE id = vehicle;
  UPDATE public.movement_offers SET seats_offered = 1 WHERE id = offer;
  PERFORM pg_temp.reveal_denied('30 0013 rechecks offered seats against confirmed group', 'authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', offer), 'P0001',
    'This offer does not provide enough seats for the confirmed movement group');
  UPDATE public.movement_offers SET seats_offered = 2 WHERE id = offer;
  UPDATE public.member_vehicle_access SET active = false WHERE member_id = driver AND vehicle_id = vehicle;
  PERFORM pg_temp.reveal_denied('31 acceptance still requires active declared vehicle access', 'authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', offer), 'P0001',
    'The offering member no longer has active access to this vehicle');
  UPDATE public.member_vehicle_access SET active = true WHERE member_id = driver AND vehicle_id = vehicle;

  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.discover_masked_offers_for_my_need(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('32 pre-activation offer discovery remains masked and plate-free',
    r->>'ok' = 'true' AND jsonb_array_length(r->'rows') = 1
    AND NOT ((r#>'{rows,0}') ?| ARRAY['plate_number','first_name','member_id','storage_path'])
    AND position('TST-0014-FULL' IN (r->'rows')::text) = 0);
  r := pg_temp.reveal_as('authenticated', driver,
    format('SELECT * FROM public.discover_masked_movement_group(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('33 0013 masked group includes only confirmed numbered travellers',
    r->>'ok' = 'true' AND jsonb_array_length(r->'rows') = 2
    AND r#>>'{rows,0,traveller_number}' = '1' AND r#>>'{rows,1,traveller_number}' = '2'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'rows') e
      WHERE e ?| ARRAY['first_name','member_id','plate_number','storage_path'])
    AND (r#>'{rows,0}') ? 'common_movement_area');

  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', offer));
  alignment := (r#>>'{rows,0,alignment_id}')::uuid;
  PERFORM pg_temp.reveal_check('34 recorded-plate vehicle follows normal group acceptance',
    r->>'ok' = 'true' AND alignment IS NOT NULL
    AND r#>>'{rows,0,alignment_status}' = 'awaiting_activation_payment');
  PERFORM pg_temp.reveal_denied('35 group mutation stays frozen after acceptance', 'authenticated', requester,
    format('SELECT * FROM public.remove_movement_participant(%L::uuid)', invitation), 'P0001',
    'Movement need is not discoverable; cannot remove participants');

  all_ok := true;
  FOREACH actor IN ARRAY ARRAY[driver, requester, traveller] LOOP
    r := pg_temp.reveal_as('authenticated', actor,
      format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
    all_ok := all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  END LOOP;
  PERFORM pg_temp.reveal_check('36 no participant receives people before activation', all_ok);
  all_ok := true;
  FOREACH actor IN ARRAY ARRAY[driver, requester, traveller] LOOP
    r := pg_temp.reveal_as('authenticated', actor,
      format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
    all_ok := all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  END LOOP;
  PERFORM pg_temp.reveal_check('37 no participant receives vehicle before activation', all_ok);

  -- Rollback-only administrator fixtures satisfy the 0016 activation gate.
  -- Bind submissions to the original photos so driver token assertions still
  -- resolve driver_photo and its original storage path. No production worker,
  -- trigger, permission or verification rule is changed by this fixture.
  SELECT id INTO STRICT requester_photo FROM public.member_media
  WHERE member_id = requester AND media_type = 'photo' AND is_current
    AND verified AND storage_path = 'test-0014/requester.jpg';
  face_fixture_time := clock_timestamp();
  INSERT INTO public.member_media(id, member_id, media_type, storage_path, verified, is_current, created_at)
  VALUES (traveller_face_photo, traveller, 'photo',
    'test-0014/' || traveller::text || '/activation-only.jpg', true, true, face_fixture_time);
  INSERT INTO private.profile_photo_submissions(
    member_id, submission_storage_path, submitted_mime_type, submitted_size_bytes,
    status, media_id, created_at, processed_at)
  SELECT member_id, 'test-0014/' || member_id::text || '/activation-submission.jpg',
    'image/jpeg', 1024, 'ready', media_id, face_fixture_time, face_fixture_time
  FROM (VALUES (driver, driver_photo), (requester, requester_photo),
    (traveller, traveller_face_photo)) photos(member_id, media_id);
  UPDATE public.members SET profile_media_verified = true WHERE id = requester;
  INSERT INTO private.alignment_face_verifications(
    alignment_id, member_id, media_id, purpose, status, provider, provider_reference,
    liveness_passed, face_match_passed, started_at, completed_at, expires_at)
  SELECT alignment, member_id, media_id, 'movement_activation', 'succeeded',
    'test-0014', alignment::text || '/' || member_id::text,
    true, true, face_fixture_time, face_fixture_time, face_fixture_time + interval '10 minutes'
  FROM (VALUES (driver, driver_photo), (requester, requester_photo),
    (traveller, traveller_face_photo)) photos(member_id, media_id);

  -- A privileged fixture simulates an inconsistent activation without payment.
  -- No trigger is disabled: the normal journey trigger also runs.
  UPDATE public.alignments SET status = 'activated', activated_at = now() WHERE id = alignment;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  all_ok := r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('38 activation status alone without succeeded payment reveals nothing',
    all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  UPDATE public.alignments SET status = 'awaiting_activation_payment', activated_at = NULL WHERE id = alignment;

  r := pg_temp.reveal_as('service_role', NULL, format(
    $$SELECT * FROM public.create_alignment_activation_payment(%L::uuid, 100, 'NGN', 'test-only')$$, alignment));
  payment := (r#>>'{rows,0,payment_id}')::uuid;
  PERFORM pg_temp.reveal_check('39 server payment creation succeeds',
    r->>'ok' = 'true' AND payment IS NOT NULL);
  PERFORM pg_temp.reveal_denied('40 authenticated clients cannot mark activation payment succeeded',
    'authenticated', driver, format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L::uuid)', payment));
  r := pg_temp.reveal_as('service_role', NULL,
    format('SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L::uuid)', payment));
  PERFORM pg_temp.reveal_check('41 trusted payment RPC activates the alignment successfully',
    r->>'ok' = 'true' AND r#>>'{rows,0,alignment_status}' = 'activated'
    AND EXISTS (SELECT 1 FROM private.alignment_activation_payments WHERE id = payment AND status = 'succeeded'));

  -- Restore the original reveal fixtures before any people results are read.
  -- Delete referencing temporary rows first; keep the driver's original photo
  -- and its ready submission intact for assertions 56-67.
  UPDATE public.members SET profile_media_verified = false WHERE id = requester;
  DELETE FROM private.alignment_face_verifications
  WHERE alignment_id = alignment AND member_id = traveller AND media_id = traveller_face_photo;
  DELETE FROM private.profile_photo_submissions
  WHERE member_id = traveller AND media_id = traveller_face_photo;
  DELETE FROM public.member_media WHERE id = traveller_face_photo AND member_id = traveller;
  UPDATE public.members SET profile_media_verified = true WHERE id = traveller;
  SELECT id INTO journey FROM public.journeys WHERE alignment_id = alignment;

  r := pg_temp.reveal_as('authenticated', driver,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  people := r->'rows';
  PERFORM pg_temp.reveal_check('42 offering member sees exactly confirmed primary requester and invitee',
    r->>'ok' = 'true' AND jsonb_array_length(people) = 2
    AND people @> '[{"person_role":"primary_requester","first_name":"Primary0014"},
      {"person_role":"invited_participant","first_name":"Invited0014"}]'::jsonb);
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  requester_people := r->'rows';
  PERFORM pg_temp.reveal_check('43 confirmed primary requester sees only offering member',
    r->>'ok' = 'true' AND jsonb_array_length(requester_people) = 1
    AND requester_people @> '[{"person_role":"offering_member","first_name":"Offering0014"}]'::jsonb);
  r := pg_temp.reveal_as('authenticated', traveller,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  traveller_people := r->'rows';
  photo_token := traveller_people#>>'{0,profile_photo_token}';
  photo_expiry := (traveller_people#>>'{0,profile_photo_expires_at}')::timestamptz;
  PERFORM pg_temp.reveal_check('44 confirmed invited traveller sees only offering member',
    r->>'ok' = 'true' AND jsonb_array_length(traveller_people) = 1
    AND traveller_people @> '[{"person_role":"offering_member","first_name":"Offering0014"}]'::jsonb);

  r := pg_temp.reveal_as('authenticated', outsider,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('45 unrelated authenticated member receives no people',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  r := pg_temp.reveal_as('authenticated', outsider,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('46 unrelated authenticated member receives no vehicle or plate',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  all_ok := true;
  FOREACH actor IN ARRAY ARRAY[declined, removed, pending] LOOP
    r := pg_temp.reveal_as('authenticated', actor,
      format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
    all_ok := all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
    r := pg_temp.reveal_as('authenticated', actor,
      format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
    all_ok := all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  END LOOP;
  PERFORM pg_temp.reveal_check('47 declined and removed members receive neither reveal', all_ok);

  BEGIN
    UPDATE public.movement_participants
    SET status = 'invited'
    WHERE id = pending_invitation;

    PERFORM pg_temp.reveal_check(
      '48 accepted movement roster cannot restore removed participant to invited',
      false
    );
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM pg_temp.reveal_check(
        '48 accepted movement roster cannot restore removed participant to invited',
        SQLSTATE = 'P0001'
        AND SQLERRM = 'Accepted movement roster is frozen'
      );
  END;

  PERFORM pg_temp.reveal_check('49 every person JSON result has exactly the safe field allowlist',
    jsonb_array_length(people) = 2 AND jsonb_array_length(requester_people) = 1
    AND jsonb_array_length(traveller_people) = 1 AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(people || requester_people || traveller_people) e
      WHERE ARRAY(SELECT jsonb_object_keys(e) ORDER BY 1) <> safe_person_keys));
  SELECT array_agg(p.proargnames[i] ORDER BY p.proargnames[i]) INTO keys
  FROM pg_proc p, generate_subscripts(p.proallargtypes, 1) i
  WHERE p.oid = 'public.get_post_activation_people(uuid)'::regprocedure
    AND p.proargmodes[i] IN ('o','b','t');
  PERFORM pg_temp.reveal_check('50 person RPC declared output has safe names and no UUID type',
    keys = safe_person_keys AND NOT EXISTS (
      SELECT 1 FROM pg_proc p, generate_subscripts(p.proallargtypes, 1) i
      WHERE p.oid = 'public.get_post_activation_people(uuid)'::regprocedure
        AND p.proargmodes[i] IN ('o','b','t') AND p.proallargtypes[i] = 'uuid'::regtype));
  PERFORM pg_temp.reveal_check('51 person values contain no internal UUIDs or private fixture values',
    jsonb_array_length(people) = 2 AND jsonb_array_length(traveller_people) = 1
    AND (people || requester_people || traveller_people)::text !~*
      '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    AND position('PRIVATE-CMA-0014' IN (people || requester_people || traveller_people)::text) = 0
    AND position('1990-01-15' IN people::text) = 0
    AND position('1988-02-15' IN traveller_people::text) = 0
    AND position('test-0014/' IN (people || requester_people || traveller_people)::text) = 0
    AND position('@test-0014.invalid' IN (people || requester_people || traveller_people)::text) = 0);
  PERFORM pg_temp.reveal_check('52 age rating counts and unified verification are correct',
    people @> jsonb_build_array(jsonb_build_object('first_name','Primary0014',
      'age', extract(year FROM age(CURRENT_DATE, DATE '1990-01-15'))::integer,
      'verified',false,'rating',4.25,'completed_movements',7),
      jsonb_build_object('first_name','Invited0014','age',NULL,'verified',false,'rating',NULL,'completed_movements',0))
    AND traveller_people @> '[{"verified":true,"rating":4.75,"completed_movements":12}]'::jsonb);
  PERFORM pg_temp.reveal_check('53 person numbering is positive and begins at one for both sides',
    people#>>'{0,person_number}' = '1' AND people#>>'{1,person_number}' = '2'
    AND requester_people#>>'{0,person_number}' = '1' AND traveller_people#>>'{0,person_number}' = '1'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(people || requester_people || traveller_people) e
      WHERE (e->>'person_number')::integer < 1));

  all_ok := true;
  FOREACH actor IN ARRAY ARRAY[driver, requester, traveller] LOOP
    r := pg_temp.reveal_as('authenticated', actor,
      format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
    vehicle_result := r->'rows';
    all_ok := all_ok AND r->>'ok' = 'true'
      AND vehicle_result = '[{"vehicle_display_name":"Blue Lexus RX350","plate_number":"TST-0014-FULL"}]'::jsonb;
  END LOOP;
  PERFORM pg_temp.reveal_check('54 every actual participant gets natural vehicle name and correct full plate', all_ok);
  SELECT array_agg(p.proargnames[i] ORDER BY p.proargnames[i]) INTO keys
  FROM pg_proc p, generate_subscripts(p.proallargtypes, 1) i
  WHERE p.oid = 'public.get_post_activation_vehicle(uuid)'::regprocedure
    AND p.proargmodes[i] IN ('o','b','t');
  PERFORM pg_temp.reveal_check('55 vehicle reveal has exactly name and plate with no ID year or capacity',
    keys = ARRAY['plate_number','vehicle_display_name']
    AND jsonb_array_length(vehicle_result) = 1
    AND ARRAY(SELECT jsonb_object_keys(vehicle_result->0) ORDER BY 1) = keys);

  PERFORM pg_temp.reveal_check('56 photo token is opaque short-lived data rather than a Storage URL',
    photo_token ~ '^[0-9a-f]{64}$' AND photo_expiry > statement_timestamp()
    AND photo_expiry <= statement_timestamp() + interval '5 minutes');
  PERFORM pg_temp.reveal_check('57 traveller without verified current photo has NULL token and expiry',
    people @> '[{"first_name":"Invited0014","profile_photo_token":null,"profile_photo_expires_at":null}]'::jsonb);
  PERFORM pg_temp.reveal_denied('58 authenticated cannot execute server photo resolver', 'authenticated', traveller,
    format('SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_denied('59 anon cannot execute server photo resolver', 'anon', NULL,
    format('SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_check('60 service_role retains photo resolver execute permission',
    has_function_privilege('service_role', 'public.resolve_post_activation_photo_for_server(text,uuid)', 'EXECUTE'));
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_check('61 server resolver chooses only the current verified photo',
    r->>'ok' = 'true' AND jsonb_array_length(r->'rows') = 1
    AND r#>>'{rows,0,storage_path}' = 'test-0014/' || driver::text || '/current.jpg');
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, outsider));
  PERFORM pg_temp.reveal_check('62 photo token cannot be replayed for another viewer',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  UPDATE private.post_activation_photo_tokens SET expires_at = statement_timestamp() - interval '1 second'
  WHERE token = photo_token;
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_check('63 expired photo token cannot be resolved',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  UPDATE private.post_activation_photo_tokens SET expires_at = photo_expiry WHERE token = photo_token;
  UPDATE public.member_media SET verified = false WHERE id = driver_photo;
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_check('64 photo verification revocation invalidates token access',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  UPDATE public.member_media SET verified = true, is_current = false WHERE id = driver_photo;
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_check('65 noncurrent photo cannot be resolved',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
    UPDATE public.member_media SET is_current = true WHERE id =driver_photo;
  UPDATE public.member_media SET is_current = false
  WHERE member_id = driver AND media_type = 'photo' AND is_current;
  INSERT INTO public.member_media(id, member_id, media_type, storage_path, verified, is_current, created_at)
  VALUES (replacement_photo, driver, 'photo', 'test-0014/replacement.jpg', true, true, now() + interval '2 days');
  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, traveller));
  PERFORM pg_temp.reveal_check('66 replacing current verified photo invalidates older token',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  DELETE FROM public.member_media WHERE id = replacement_photo;

  UPDATE public.member_media
  SET verified = true, is_current = true
  WHERE id = driver_photo;

  INSERT INTO private.post_activation_photo_tokens(
    viewer_member_id,
    alignment_id,
    subject_member_id,
    media_id,
    token,
    expires_at
  )
  VALUES (
    removed,
    alignment,
    driver,
    driver_photo,
    '0014-removed-viewer-' || gen_random_uuid()::text,
    statement_timestamp() + interval '5 minutes'
  );

  SELECT token
  INTO photo_token
  FROM private.post_activation_photo_tokens
  WHERE viewer_member_id = removed
    AND alignment_id = alignment
    AND subject_member_id = driver;

  r := pg_temp.reveal_as('service_role', NULL, format(
    'SELECT * FROM public.resolve_post_activation_photo_for_server(%L, %L::uuid)', photo_token, removed));

  PERFORM pg_temp.reveal_check('67 photo resolver rechecks confirmed viewer participation',
    r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);

  SELECT activated_at INTO activated_time FROM public.alignments WHERE id = alignment;
  UPDATE public.alignments SET activated_at = NULL WHERE id = alignment;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  all_ok := r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('68 missing activation timestamp blocks both reveals',
    all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  UPDATE public.alignments SET activated_at = activated_time WHERE id = alignment;
  UPDATE private.alignment_activation_payments SET amount_minor = 101 WHERE id = payment;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  all_ok := r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('69 mismatched activation payment blocks both reveals',
    all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);
  UPDATE private.alignment_activation_payments SET amount_minor = 100 WHERE id = payment;
  UPDATE public.alignments SET status = 'cancelled' WHERE id = alignment;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  all_ok := r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('70 cancelled alignment blocksboth reveals',
    all_ok AND r->>'ok' = 'true' AND r->'rows' = '[]'::jsonb);

  UPDATE public.alignments
  SET status = 'awaiting_activation_payment'
  WHERE id = alignment;

  face_fixture_time := clock_timestamp();

  INSERT INTO public.member_media(
    id,
    member_id,
    media_type,
    storage_path,
    verified,
    is_current,
    created_at
  )
  VALUES (
    traveller_face_photo,
    traveller,
    'photo',
    'test-0014/' || traveller::text || '/activation-only.jpg',
    true,
    true,
    face_fixture_time
  );

  INSERT INTO private.profile_photo_submissions(
    member_id,
    submission_storage_path,
    submitted_mime_type,
    submitted_size_bytes,
    status,
    media_id,
    created_at,
    processed_at
  )
  VALUES (
    traveller,
    'test-0014/' || traveller::text || '/activation-submission.jpg',
    'image/jpeg',
    1024,
    'ready',
    traveller_face_photo,
    face_fixture_time,
    face_fixture_time
  );

  UPDATE public.members
  SET profile_media_verified = true
  WHERE id = requester;

  INSERT INTO private.alignment_face_verifications(
    alignment_id,
    member_id,
    media_id,
    purpose,
    status,
    provider,
    provider_reference,
    liveness_passed,
    face_match_passed,
    started_at,
    completed_at,
    expires_at
  )
  SELECT
    alignment,
    member_id,
    media_id,
    'movement_activation',
    'succeeded',
    'test-0014',
    alignment::text || '/' || member_id::text || '/reactivation',
    true,
    true,
    face_fixture_time,
    face_fixture_time,
    face_fixture_time + interval '10 minutes'
  FROM (
    VALUES
      (driver, driver_photo),
      (requester, requester_photo),
      (traveller, traveller_face_photo)
  ) photos(member_id, media_id);

  UPDATE public.alignments
  SET status = 'activated'
  WHERE id = alignment;

  UPDATE public.members
  SET profile_media_verified = false
  WHERE id = requester;

  DELETE FROM private.alignment_face_verifications
  WHERE alignment_id = alignment
    AND member_id = traveller
    AND media_id = traveller_face_photo;

  DELETE FROM private.profile_photo_submissions
  WHERE member_id = traveller
    AND media_id = traveller_face_photo;

  DELETE FROM public.member_media
  WHERE id = traveller_face_photo
    AND member_id = traveller;

  UPDATE public.members
  SET profile_media_verified = true
  WHERE id = traveller;
  UPDATE public.alignments SET status = 'activated' WHERE id = alignment;

  -- Second normal alignment uses the model-less vehicle and tests the recheck
  -- between acceptance and activation (no trigger/function bypass required).
  r := pg_temp.reveal_as('authenticated', driver, format(
    'SELECT * FROM public.create_movement_offer(%L::uuid, %L::uuid, %L::uuid, 1)', model_less_need, model_less_match, model_less_vehicle));
  model_less_offer := (r#>>'{rows,0,movement_offer_id}')::uuid;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.accept_movement_offer(%L::uuid)', model_less_offer));
  model_less_alignment := (r#>>'{rows,0,alignment_id}')::uuid;

  -- Current schema requires fresh face readiness for this second alignment too.
  -- Driver and requester already have prepared current photos from the earlier fixture.
  face_fixture_time := clock_timestamp();

  UPDATE public.members
  SET profile_media_verified = true
  WHERE id = requester;

  INSERT INTO private.alignment_face_verifications(
    alignment_id,
    member_id,
    media_id,
    purpose,
    status,
    provider,
    provider_reference,
    liveness_passed,
    face_match_passed,
    started_at,
    completed_at,
    expires_at
  )
  SELECT
    model_less_alignment,
    member_id,
    media_id,
    'movement_activation',
    'succeeded',
    'test-0014',
    model_less_alignment::text || '/' || member_id::text,
    true,
    true,
    face_fixture_time,
    face_fixture_time,
    face_fixture_time + interval '10 minutes'
  FROM (
    VALUES
      (driver, driver_photo),
      (requester, requester_photo)
  ) photos(member_id, media_id);

  r := pg_temp.reveal_as('service_role', NULL, format(
    $$SELECT * FROM public.create_alignment_activation_payment(%L::uuid, 100, 'NGN', 'test-only')$$,
    model_less_alignment));
  model_less_payment := (r#>>'{rows,0,payment_id}')::uuid;

  UPDATE public.vehicles
  SET plate_number = NULL
  WHERE id = model_less_vehicle;

  PERFORM pg_temp.reveal_denied(
    '71 plate removed after acceptance prevents activation',
    'service_role',
    NULL,
    format(
      'SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L::uuid)',
      model_less_payment
    ),
    'P0001',
    'A vehicle plate must be recorded before alignment or activation'
  );

  PERFORM pg_temp.reveal_check(
    '72 failed plate recheck rolls back payment success and journey creation',
    EXISTS (
      SELECT 1
      FROM private.alignment_activation_payments
      WHERE id = model_less_payment
        AND status = 'pending'
        AND succeeded_at IS NULL
    )
    AND EXISTS (
      SELECT 1
      FROM public.alignments
      WHERE id = model_less_alignment
        AND status = 'awaiting_activation_payment'
        AND activated_at IS NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.journeys
      WHERE alignment_id = model_less_alignment
    )
  );

  UPDATE public.vehicles
  SET plate_number = 'TST-0014-NOMODEL'
  WHERE id = model_less_vehicle;

  r := pg_temp.reveal_as('service_role', NULL,
    format(
      'SELECT * FROM public.mark_alignment_activation_payment_succeeded(%L::uuid)',
      model_less_payment
    ));

  all_ok := r->>'ok' = 'true'
    AND r#>>'{rows,0,alignment_status}' = 'activated';

  UPDATE public.members
  SET profile_media_verified = false
  WHERE id = requester;
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', model_less_need));
  PERFORM pg_temp.reveal_check('73 absent model displays Blue Lexus with full plate after activation',
    all_ok AND r->>'ok' = 'true'
    AND r->'rows' = '[{"vehicle_display_name":"Blue Lexus","plate_number":"TST-0014-NOMODEL"}]'::jsonb);

  PERFORM pg_temp.reveal_denied('74 anon cannot execute people reveal', 'anon', NULL,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_denied('75 anon cannot execute vehicle reveal', 'anon', NULL,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_denied('76 authenticated without JWT subject cannot reveal people', 'authenticated', NULL,
    format('SELECT * FROM public.get_post_activation_people(%L::uuid)', group_need), 'P0001', 'Authentication required');
  PERFORM pg_temp.reveal_check('77 raw UUID invitation and old one-sided completion stay revoked',
    NOT has_function_privilege('authenticated','public.invite_movement_participant(uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('anon','public.invite_movement_participant(uuid,uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.request_journey_completion(uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','public.confirm_journey_completion(uuid)','EXECUTE'));

  -- Current 0019 semantics treat mutual ending of a never-started journey as
  -- mutual no-travel cancellation. Start this journey through the current 0018
  -- coordination flow so assertions 78-82 continue testing actual movement completion.
  r := pg_temp.reveal_as('authenticated', driver, format(
    'SELECT * FROM public.set_my_movement_meeting_point(%L::uuid, %L, NULL::bigint)',
    group_need, 'Test meeting point'));

  IF r->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '0014 meeting-point setup failed: %', r;
  END IF;

  r := pg_temp.reveal_as('authenticated', driver, format(
    'SELECT * FROM public.request_my_movement_start(%L::uuid)', group_need));

  IF r->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION '0014 movement-start request failed: %', r;
  END IF;

  r := pg_temp.reveal_as('authenticated', requester, format(
    'SELECT * FROM public.confirm_my_movement_start(%L::uuid)', group_need));

  IF r->>'ok' IS DISTINCT FROM 'true'
    OR r#>>'{rows,0,journey_state}' IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION '0014 movement-start confirmation failed: %', r;
  END IF;

  PERFORM pg_temp.reveal_denied('78 invited traveller cannot end the whole movement', 'authenticated', traveller,
    format('SELECT * FROM public.request_movement_end(%L::uuid)', journey), 'P0001',
    'Only principal movement members may end the movement');
  r := pg_temp.reveal_as('authenticated', driver,
    format('SELECT * FROM public.request_movement_end(%L::uuid)', journey));
  PERFORM pg_temp.reveal_check('79 first principal end request does not complete movement',
    r->>'ok' = 'true'
    AND r#>>'{rows,0,end_status}' = 'awaiting_other_member'
    AND r#>>'{rows,0,journey_status}' = 'in_progress'
    AND r#>>'{rows,0,alignment_status}' = 'in_progress'
    AND EXISTS (
      SELECT 1
      FROM public.alignments a
      JOIN public.journeys j ON j.alignment_id = a.id
      WHERE a.id = alignment
        AND a.status = 'in_progress'
        AND j.id = journey
        AND j.status = 'in_progress'
    ));
  PERFORM pg_temp.reveal_denied('80 principal cannot confirm own movement end request', 'authenticated', driver,
    format('SELECT * FROM public.confirm_movement_end(%L::uuid)', journey), 'P0001',
    'You cannot confirm your own end request');
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.confirm_movement_end(%L::uuid)', journey));
  PERFORM pg_temp.reveal_check('81 0012 mutual completion still completes both journey and alignment',
    r->>'ok' = 'true' AND r#>>'{rows,0,end_status}' = 'completed'
    AND EXISTS (SELECT 1 FROM public.alignments a JOIN public.journeys j ON j.alignment_id = a.id
      WHERE a.id = alignment AND a.status = 'completed' AND j.status = 'completed'));
  r := pg_temp.reveal_as('authenticated', requester,
    format('SELECT * FROM public.get_post_activation_vehicle(%L::uuid)', group_need));
  PERFORM pg_temp.reveal_check('82 valid completed movement retains participant vehicle reveal',
    r->>'ok' = 'true' AND r->'rows' =
      '[{"vehicle_display_name":"Blue Lexus RX350","plate_number":"TST-0014-FULL"}]'::jsonb);

  PERFORM pg_temp.reveal_check('83 all seven 0014 functions retain SECURITY DEFINER and empty search_path',
    (SELECT count(*) = 7 AND bool_and(p.prosecdef AND 'search_path=""' = ANY(p.proconfig))
      FROM pg_proc p WHERE p.oid = ANY(ARRAY[
        'public.register_vehicle_with_access(text,text,integer,text,integer)'::regprocedure,
        'public.register_vehicle_with_plate(text,text,integer,text,integer,text)'::regprocedure,
        'private.require_alignment_vehicle_plate()'::regprocedure,
        'private.post_activation_reveal_subjects(uuid,uuid)'::regprocedure,
        'public.get_post_activation_people(uuid)'::regprocedure,
        'public.get_post_activation_vehicle(uuid)'::regprocedure,
        'public.resolve_post_activation_photo_for_server(text,uuid)'::regprocedure]::oid[])));
  PERFORM pg_temp.reveal_check('84 test has not changed any installed function definition permissions or configuration',
    NOT EXISTS (SELECT 1 FROM pg_temp.reveal_function_snapshot s
      LEFT JOIN pg_proc p ON p.oid = s.oid
      WHERE p.oid IS NULL OR s.definition_hash IS DISTINCT FROM md5(pg_get_functiondef(p.oid))
        OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text));
END;
$test$;

-- One result set, one named boolean per check. FALSE (including a NULL predicate)
-- means failure; expected SQLSTATE/message checks do not hide unrelated errors.
SELECT test_name, passed FROM pg_temp.reveal_test_results ORDER BY check_number;

ROLLBACK;
