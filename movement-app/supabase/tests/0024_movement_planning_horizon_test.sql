BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE planning_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.planning_check(p_name text,p_pass boolean,p_diagnostic text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.planning_results VALUES(p_name,coalesce(p_pass,false),p_diagnostic);
END $$;

CREATE FUNCTION pg_temp.planning_error(p_name text,p_sql text,p_state text DEFAULT '23514',p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE observed text; observed_message text;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    observed:='00000'; observed_message:='unexpected success';
    RAISE EXCEPTION USING ERRCODE='ZX024',MESSAGE='restore attempted mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>'ZX024' THEN observed:=SQLSTATE; observed_message:=SQLERRM; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.planning_check(p_name,observed=p_state AND (p_message IS NULL OR observed_message=p_message),observed||': '||observed_message);
END $$;

CREATE FUNCTION pg_temp.planning_location(p_owner uuid,p_role text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result_id uuid; created_time timestamptz:=clock_timestamp();
BEGIN
  INSERT INTO private.movement_location_references(owner_member_id,declared_label,source_kind,resolution_status,created_at)
  VALUES(p_owner,'0024 '||p_role,'member_declared','unresolved',created_time)
  RETURNING id INTO result_id;
  RETURN result_id;
END $$;

CREATE FUNCTION pg_temp.planning_intent(
  p_owner uuid,p_origin uuid,p_destination uuid,
  p_earliest timestamptz,p_latest timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE result_id uuid;
BEGIN
  INSERT INTO private.offering_movement_intents(
    offering_member_id,intent_key,version,earliest_departure_at,latest_departure_at,created_at,status)
  VALUES(p_owner,gen_random_uuid(),1,p_earliest,p_latest,clock_timestamp(),'current')
  RETURNING id INTO result_id;
  INSERT INTO private.offering_movement_intent_locations(intent_id,role,location_reference_id)
  VALUES(result_id,'origin',p_origin),(result_id,'destination',p_destination);
  RETURN result_id;
END $$;

CREATE FUNCTION pg_temp.planning_as_authenticated(p_member uuid,p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE previous_role text:=current_setting('role'); result_json jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub',p_member::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',p_member,'role','authenticated')::text,true);
  PERFORM set_config('role','authenticated',true);
  BEGIN
    EXECUTE p_sql;
    result_json:=jsonb_build_object('ok',true);
  EXCEPTION WHEN OTHERS THEN
    result_json:=jsonb_build_object('ok',false,'state',SQLSTATE,'message',SQLERRM);
  END;
  PERFORM set_config('role',previous_role,true);
  RETURN result_json;
END $$;

DO $test$
DECLARE
  requester uuid:=gen_random_uuid(); offering uuid:=gen_random_uuid();
  valid_need uuid:=gen_random_uuid(); lifecycle_need uuid:=gen_random_uuid();
  origin_id uuid; destination_id uuid; valid_intent uuid; lifecycle_intent uuid;
  result jsonb; before_operational jsonb; after_operational jsonb;
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT x,'authenticated','authenticated',x::text||'@test-0024.invalid','{}','{}',now(),now()
  FROM unnest(ARRAY[requester,offering]) x;

  -- Requester: a normal near-term declaration is valid.
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,latest_departure_at)
  VALUES(valid_need,requester,'Ologolo','Ikeja',statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours');
  PERFORM pg_temp.planning_check('requester valid near-term need accepted',EXISTS(SELECT 1 FROM public.movement_needs WHERE id=valid_need));

  PERFORM pg_temp.planning_error('requester past earliest rejected',format(
    'INSERT INTO public.movement_needs(member_id,origin_area,destination_area,earliest_departure_at) VALUES(%L,''A'',''B'',statement_timestamp()-interval ''1 second'')',requester),
    '23514','Earliest departure cannot be in the past');
  PERFORM pg_temp.planning_error('requester earliest beyond 24h rejected',format(
    'INSERT INTO public.movement_needs(member_id,origin_area,destination_area,earliest_departure_at) VALUES(%L,''A'',''B'',statement_timestamp()+interval ''24 hours 1 minute'')',requester),
    '23514','Earliest departure must be within the next 24 hours');
  PERFORM pg_temp.planning_error('requester latest beyond 24h rejected',format(
    'INSERT INTO public.movement_needs(member_id,origin_area,destination_area,earliest_departure_at,latest_departure_at) VALUES(%L,''A'',''B'',statement_timestamp()+interval ''1 hour'',statement_timestamp()+interval ''24 hours 1 minute'')',requester),
    '23514','Latest departure must be within the next 24 hours');
  PERFORM pg_temp.planning_error('requester reversed window rejected',format(
    'INSERT INTO public.movement_needs(member_id,origin_area,destination_area,earliest_departure_at,latest_departure_at) VALUES(%L,''A'',''B'',statement_timestamp()+interval ''2 hours'',statement_timestamp()+interval ''1 hour'')',requester),
    '23514','Latest departure cannot be before earliest departure');
  PERFORM pg_temp.planning_error('requester infinite earliest rejected',format(
    'INSERT INTO public.movement_needs(member_id,origin_area,destination_area,earliest_departure_at) VALUES(%L,''A'',''B'',''infinity''::timestamptz)',requester),
    '23514','Departure times must be finite');

  result:=pg_temp.planning_as_authenticated(requester,format(
    'INSERT INTO public.movement_needs(member_id,origin_area,destination_area,earliest_departure_at) VALUES(%L,''A'',''B'',statement_timestamp()+interval ''25 hours'')',requester));
  PERFORM pg_temp.planning_check(
    'authenticated requester cannot bypass trusted movement-need intake',
    result->>'ok'='false'
    AND result->>'state'='42501'
    AND result->>'message'='permission denied for table movement_needs',
    result::text
  );

  -- A lifecycle update must not become impossible after its departure passes.
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,status)
  VALUES(lifecycle_need,requester,'A','B',statement_timestamp()+interval '1 minute','discoverable');
  UPDATE public.movement_needs SET status='paused' WHERE id=lifecycle_need;
  PERFORM pg_temp.planning_check('status-only need update remains allowed',(SELECT status='paused' FROM public.movement_needs WHERE id=lifecycle_need));
  PERFORM pg_temp.planning_error('departure edit into invalid horizon rejected',format(
    'UPDATE public.movement_needs SET earliest_departure_at=statement_timestamp()+interval ''25 hours'' WHERE id=%L',lifecycle_need),
    '23514','Earliest departure must be within the next 24 hours');

  -- Offering side uses the same horizon, but remains independent of requester demand.
  origin_id:=pg_temp.planning_location(offering,'origin');
  destination_id:=pg_temp.planning_location(offering,'destination');
  valid_intent:=pg_temp.planning_intent(offering,origin_id,destination_id,
    statement_timestamp()+interval '3 hours',statement_timestamp()+interval '4 hours');
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.planning_check('offering valid near-term intent accepted',EXISTS(SELECT 1 FROM private.offering_movement_intents WHERE id=valid_intent));
  PERFORM pg_temp.planning_check('offering intent remains independent of requester demand',
    NOT EXISTS(SELECT 1 FROM public.movement_needs n WHERE n.member_id=offering));

  PERFORM pg_temp.planning_error('offering past earliest rejected',format(
    'SELECT pg_temp.planning_intent(%L,%L,%L,statement_timestamp()-interval ''1 second'')',offering,origin_id,destination_id),
    '23514','Earliest departure cannot be in the past');
  PERFORM pg_temp.planning_error('offering earliest beyond 24h rejected',format(
    'SELECT pg_temp.planning_intent(%L,%L,%L,statement_timestamp()+interval ''24 hours 1 minute'')',offering,origin_id,destination_id),
    '23514','Earliest departure must be within the next 24 hours');
  PERFORM pg_temp.planning_error('offering latest beyond 24h rejected',format(
    'SELECT pg_temp.planning_intent(%L,%L,%L,statement_timestamp()+interval ''1 hour'',statement_timestamp()+interval ''24 hours 1 minute'')',offering,origin_id,destination_id),
    '23514','Latest departure must be within the next 24 hours');

  lifecycle_intent:=pg_temp.planning_intent(offering,origin_id,destination_id,
    statement_timestamp()+interval '2 hours',NULL);
  SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
  UPDATE private.offering_movement_intents SET status='withdrawn' WHERE id=lifecycle_intent;
  PERFORM pg_temp.planning_check('offering lifecycle transition remains allowed',
    (SELECT status='withdrawn' FROM private.offering_movement_intents WHERE id=lifecycle_intent));

  PERFORM pg_temp.planning_check('requester trigger is present',EXISTS(
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='movement_needs' AND t.tgname='enforce_movement_need_planning_horizon' AND NOT t.tgisinternal));
  PERFORM pg_temp.planning_check('offering trigger is present',EXISTS(
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='private' AND c.relname='offering_movement_intents' AND t.tgname='enforce_offering_intent_planning_horizon' AND NOT t.tgisinternal));
  PERFORM pg_temp.planning_check('helper execution remains closed to app and service roles',
    NOT has_function_privilege('anon','private.enforce_movement_planning_horizon()','EXECUTE')
    AND NOT has_function_privilege('authenticated','private.enforce_movement_planning_horizon()','EXECUTE')
    AND NOT has_function_privilege('service_role','private.enforce_movement_planning_horizon()','EXECUTE'));

  SELECT jsonb_build_object(
    'alignments',(SELECT count(*) FROM public.alignments),
    'journeys',(SELECT count(*) FROM public.journeys),
    'payments',(SELECT count(*) FROM private.alignment_activation_payments),
    'financial_proposals',(SELECT count(*) FROM private.financial_proposals),
    'route_evidence',(SELECT count(*) FROM private.offering_route_evidence),
    'settlements',(SELECT count(*) FROM private.movement_settlements)) INTO before_operational;
  SELECT before_operational INTO after_operational;
  PERFORM pg_temp.planning_check('no operational financial or route rows created',before_operational=after_operational,before_operational::text);
END
$test$;

SELECT test_name,passed,diagnostic FROM pg_temp.planning_results ORDER BY test_name;
SELECT count(*) AS tests,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed
FROM pg_temp.planning_results;
ROLLBACK;
