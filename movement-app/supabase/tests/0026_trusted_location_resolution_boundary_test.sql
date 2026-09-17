BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- Run only with an explicitly authorized fixture-capable database owner.
-- These helpers and all fixtures disappear at ROLLBACK; no live test runs here.
CREATE TEMP TABLE location_resolution_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.resolution_check(p_name text,p_ok boolean)
RETURNS void LANGUAGE plpgsql AS $check_result$
BEGIN
  INSERT INTO pg_temp.location_resolution_results VALUES(p_name,coalesce(p_ok,false));
END;
$check_result$;

CREATE FUNCTION pg_temp.resolution_try(p_role text,p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $try_statement$
DECLARE old_role text:=current_setting('role'); result_row jsonb; answer jsonb;
BEGIN
  IF p_role NOT IN ('owner','anon','authenticated','service_role') THEN
    RAISE EXCEPTION 'Invalid fixture role';
  END IF;
  IF p_role<>'owner' THEN PERFORM set_config('role',p_role,true); END IF;
  BEGIN
    EXECUTE p_sql INTO result_row;
    answer:=jsonb_build_object('ok',true,'row',result_row);
  EXCEPTION WHEN OTHERS THEN
    answer:=jsonb_build_object('ok',false,'sqlstate',SQLSTATE,'message',SQLERRM);
  END;
  PERFORM set_config('role',old_role,true);
  RETURN answer;
END;
$try_statement$;

CREATE FUNCTION pg_temp.resolution_call(p_payload jsonb,p_role text DEFAULT 'service_role')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $call_writer$
BEGIN
  RETURN pg_temp.resolution_try(p_role,format(
    $rpc_sql$SELECT to_jsonb(r) FROM public.record_location_resolution_for_server(
      %L::uuid,%L::uuid,%L::text,%L::text,%L::text,%L::text,%L::text,
      %L::numeric,%L::numeric,%L::timestamptz,%L::timestamptz) r$rpc_sql$,
    p_payload->>'source',p_payload->>'request',p_payload->>'namespace',
    p_payload->>'product',p_payload->>'provider_version',p_payload->>'place',
    p_payload->>'resolution_version',p_payload->>'latitude',p_payload->>'longitude',
    p_payload->>'resolved_at',p_payload->>'expires_at'));
END;
$call_writer$;

DO $resolution_tests$
DECLARE
  owner_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  source_id uuid:=gen_random_uuid(); other_source_id uuid:=gen_random_uuid();
  selected_id uuid:=gen_random_uuid(); fixture_intent_id uuid:=gen_random_uuid();
  first_evidence uuid; first_target uuid; second_target uuid;
  base_time timestamptz:=clock_timestamp(); deadline timestamptz;
  payload jsonb; selected_payload jsonb; response jsonb;
  original_source jsonb; original_binding jsonb; original_evidence jsonb; original_target jsonb;
  locations_before bigint; evidence_before bigint; variant record; role_name text;
  signature text:='public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)';
BEGIN
  deadline:=base_time+interval '2 hours';
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT u,'authenticated','authenticated',u::text||'@test-0026.invalid',base_time,
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,base_time,base_time
  FROM unnest(ARRAY[owner_id,outsider_id]) u;
  INSERT INTO private.movement_location_references(
    id,owner_member_id,declared_label,source_kind,resolution_status,created_at,expires_at,
    provider_namespace,provider_place_reference
  ) VALUES
    (source_id,owner_id,'Ologolo','member_declared','unresolved',base_time,deadline,NULL,NULL),
    (other_source_id,outsider_id,'Other declaration','member_declared','unresolved',base_time,NULL,NULL,NULL),
    (selected_id,owner_id,'Selected landmark','member_selected','unresolved',base_time,deadline,'fixture-location','selected-place');
  INSERT INTO private.offering_movement_intents(
    id,offering_member_id,intent_key,version,earliest_departure_at,latest_departure_at,created_at,expires_at
  ) VALUES(fixture_intent_id,owner_id,gen_random_uuid(),1,statement_timestamp()+interval '1 hour',
    statement_timestamp()+interval '90 minutes',base_time,deadline);
  INSERT INTO private.offering_movement_intent_locations(intent_id,role,location_reference_id)
  VALUES(fixture_intent_id,'origin',source_id),(fixture_intent_id,'destination',selected_id);
  SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete IMMEDIATE;
  SELECT to_jsonb(s) INTO original_source FROM private.movement_location_references s WHERE s.id=source_id;
  SELECT jsonb_agg(to_jsonb(b) ORDER BY b.role) INTO original_binding
  FROM private.offering_movement_intent_locations b WHERE b.intent_id=fixture_intent_id;
  payload:=jsonb_build_object('source',source_id,'request',gen_random_uuid(),
    'namespace','fixture-location','product','lookup','provider_version','adapter-v1',
    'place','resolved-place','resolution_version','normalizer-v1','latitude',6.434,'longitude',3.489,
    'resolved_at',base_time,'expires_at',deadline+interval '1 hour');

  PERFORM pg_temp.resolution_check('writer execute service only',
    has_function_privilege('service_role',signature,'EXECUTE')
    AND NOT has_function_privilege('authenticated',signature,'EXECUTE')
    AND NOT has_function_privilege('anon',signature,'EXECUTE')
    AND NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=signature::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'));
  FOREACH role_name IN ARRAY ARRAY['authenticated','anon'] LOOP
    response:=pg_temp.resolution_call(payload,role_name);
    PERFORM pg_temp.resolution_check(role_name||' cannot execute',response->>'sqlstate'='42501');
  END LOOP;
  FOR variant IN SELECT * FROM (VALUES
    ('evidence','private.movement_location_resolution_evidence'),
    ('location','private.movement_location_references')
  ) AS t(label,table_name) LOOP
    PERFORM pg_temp.resolution_check('service no direct mutation '||variant.label,
      has_table_privilege('service_role',variant.table_name,'SELECT')
      AND NOT has_table_privilege('service_role',variant.table_name,'INSERT')
      AND NOT has_table_privilege('service_role',variant.table_name,'UPDATE')
      AND NOT has_table_privilege('service_role',variant.table_name,'DELETE')
      AND NOT has_table_privilege('service_role',variant.table_name,'TRUNCATE'));
  END LOOP;
  PERFORM pg_temp.resolution_check('evidence RLS no policies',
    (SELECT relrowsecurity FROM pg_class WHERE oid='private.movement_location_resolution_evidence'::regclass)
    AND NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.movement_location_resolution_evidence'::regclass));

  response:=pg_temp.resolution_call(payload);
  first_evidence:=(response#>>'{row,evidence_id}')::uuid;
  first_target:=(response#>>'{row,resolved_location_reference_id}')::uuid;
  PERFORM pg_temp.resolution_check('valid unresolved source resolves',response->>'ok'='true' AND first_target IS NOT NULL);
  PERFORM pg_temp.resolution_check('version starts at one',response#>>'{row,version}'='1');
  PERFORM pg_temp.resolution_check('only four result fields',
    (SELECT count(*) FROM jsonb_object_keys(response->'row'))=4);
  SELECT to_jsonb(e) INTO original_evidence FROM private.movement_location_resolution_evidence e WHERE e.id=first_evidence;
  SELECT to_jsonb(t) INTO original_target FROM private.movement_location_references t WHERE t.id=first_target;
  PERFORM pg_temp.resolution_check('original source unchanged',
    (SELECT to_jsonb(s)=original_source FROM private.movement_location_references s WHERE s.id=source_id));
  PERFORM pg_temp.resolution_check('owner derived',original_target->>'owner_member_id'=owner_id::text);
  PERFORM pg_temp.resolution_check('label derived',original_target->>'declared_label'='Ologolo');
  PERFORM pg_temp.resolution_check('target resolved provider shape',
    original_target->>'source_kind'='provider_resolved' AND original_target->>'resolution_status'='resolved');
  PERFORM pg_temp.resolution_check('coordinates and provenance on target',
    (original_target->>'latitude')::numeric=6.434 AND (original_target->>'longitude')::numeric=3.489
    AND original_target->>'provider_namespace'='fixture-location' AND original_target->>'provider_place_reference'='resolved-place'
    AND original_target->>'resolution_version'='normalizer-v1'
    AND NOT (original_evidence ?| ARRAY['latitude','longitude','provider_namespace','provider_place_reference','owner_member_id','declared_label','resolved_at','expires_at']));
  PERFORM pg_temp.resolution_check('exact source target link',
    original_evidence->>'source_location_reference_id'=source_id::text
    AND original_evidence->>'resolved_location_reference_id'=first_target::text AND first_target<>source_id);
  PERFORM pg_temp.resolution_check('schema fixed and recording time shared',
    original_evidence->>'resolution_schema_version'='movement_location_resolution_v1'
    AND original_evidence->>'recorded_at'=original_target->>'created_at');
  PERFORM pg_temp.resolution_check('effective expiry source bounded',
    (original_target->>'expires_at')::timestamptz=deadline
    AND (original_evidence->>'requested_expires_at')::timestamptz=deadline+interval '1 hour');
  SELECT count(*) INTO locations_before FROM private.movement_location_references;
  SELECT count(*) INTO evidence_before FROM private.movement_location_resolution_evidence;
  response:=pg_temp.resolution_call(payload);
  PERFORM pg_temp.resolution_check('exact retry same IDs no duplicates',
    response->>'ok'='true' AND response#>>'{row,evidence_id}'=first_evidence::text
    AND response#>>'{row,resolved_location_reference_id}'=first_target::text
    AND (SELECT count(*) FROM private.movement_location_references)=locations_before
    AND (SELECT count(*) FROM private.movement_location_resolution_evidence)=evidence_before);

  FOR variant IN SELECT * FROM (VALUES
    ('source',to_jsonb(other_source_id)),('namespace',to_jsonb('other-provider'::text)),
    ('product',to_jsonb('other-product'::text)),('provider_version',to_jsonb('v2'::text)),
    ('place',to_jsonb('other-place'::text)),('resolution_version',to_jsonb('v2'::text)),
    ('latitude',to_jsonb(7::numeric)),('longitude',to_jsonb(4::numeric)),
    ('resolved_at',to_jsonb(base_time+interval '1 microsecond')),
    ('expires_at',to_jsonb(deadline+interval '2 hours'))
  ) AS t(field,value) LOOP
    response:=pg_temp.resolution_call(payload||jsonb_build_object(variant.field,variant.value));
    PERFORM pg_temp.resolution_check('replay rejects changed '||variant.field,
      response->>'sqlstate'='23514'
      AND (SELECT count(*) FROM private.movement_location_references)=locations_before
      AND (SELECT count(*) FROM private.movement_location_resolution_evidence)=evidence_before);
  END LOOP;

  response:=pg_temp.resolution_call(payload||jsonb_build_object('request',gen_random_uuid()));
  second_target:=(response#>>'{row,resolved_location_reference_id}')::uuid;
  PERFORM pg_temp.resolution_check('same transaction second request version two',
    response->>'ok'='true' AND response#>>'{row,version}'='2' AND second_target<>first_target);
  PERFORM pg_temp.resolution_check('version one evidence unchanged',
    (SELECT to_jsonb(e)=original_evidence FROM private.movement_location_resolution_evidence e WHERE e.id=first_evidence));
  PERFORM pg_temp.resolution_check('version one target unchanged',
    (SELECT to_jsonb(t)=original_target FROM private.movement_location_references t WHERE t.id=first_target));
  PERFORM pg_temp.resolution_check('intent endpoints unchanged',
    (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.role)=original_binding FROM private.offering_movement_intent_locations b WHERE b.intent_id=fixture_intent_id));

  selected_payload:=payload||jsonb_build_object('source',selected_id,'request',gen_random_uuid(),'place','selected-place');
  response:=pg_temp.resolution_call(selected_payload);
  PERFORM pg_temp.resolution_check('selected hint exact identity accepted',response->>'ok'='true');
  FOR variant IN SELECT * FROM (VALUES ('namespace','different-provider'),('place','different-place')) t(field,value) LOOP
    response:=pg_temp.resolution_call(selected_payload||jsonb_build_object('request',gen_random_uuid(),variant.field,variant.value));
    PERFORM pg_temp.resolution_check('selected hint rejects changed '||variant.field,response->>'sqlstate'='23514');
  END LOOP;

  SELECT count(*) INTO locations_before FROM private.movement_location_references;
  SELECT count(*) INTO evidence_before FROM private.movement_location_resolution_evidence;
  FOR variant IN SELECT * FROM (VALUES
    ('resolved source','source',to_jsonb(first_target)),
    ('missing source','source',to_jsonb(gen_random_uuid())),
    ('null source','source','null'::jsonb),('null request','request','null'::jsonb),
    ('null latitude','latitude','null'::jsonb),('null longitude','longitude','null'::jsonb),
    ('high longitude','longitude',to_jsonb(181)),('low longitude','longitude',to_jsonb(-181)),
    ('high latitude','latitude',to_jsonb(91)),('low latitude','latitude',to_jsonb(-91)),
    ('NaN latitude','latitude',to_jsonb('NaN'::text)),('infinite longitude','longitude',to_jsonb('Infinity'::text)),
    ('negative infinite latitude','latitude',to_jsonb('-Infinity'::text)),
    ('future resolution','resolved_at',to_jsonb(clock_timestamp()+interval '1 hour')),
    ('resolution before source','resolved_at',to_jsonb(base_time-interval '1 second')),
    ('null resolution time','resolved_at','null'::jsonb),
    ('infinite resolution time','resolved_at',to_jsonb('infinity'::text)),
    ('past expiry','expires_at',to_jsonb(base_time-interval '1 second')),
    ('infinite expiry','expires_at',to_jsonb('infinity'::text)),
    ('blank namespace','namespace',to_jsonb(' '::text)),('untrimmed namespace','namespace',to_jsonb(' fixture'::text)),
    ('null namespace','namespace','null'::jsonb),('blank product','product',to_jsonb(''::text)),
    ('blank provider version','provider_version',to_jsonb(' '::text)),
    ('blank place','place',to_jsonb(E'\t'::text)),('blank resolution version','resolution_version',to_jsonb(''::text))
  ) AS t(label,field,value) LOOP
    response:=pg_temp.resolution_call(payload||jsonb_build_object('request',gen_random_uuid())||jsonb_build_object(variant.field,variant.value));
    PERFORM pg_temp.resolution_check('invalid input '||variant.label,
      response->>'sqlstate'='23514'
      AND (SELECT count(*) FROM private.movement_location_references)=locations_before
      AND (SELECT count(*) FROM private.movement_location_resolution_evidence)=evidence_before);
  END LOOP;

  -- Both NULL deadlines intentionally produce no expiry, including exact retry.
  selected_payload:=payload||jsonb_build_object('source',other_source_id,'request',gen_random_uuid(),'expires_at',NULL);
  response:=pg_temp.resolution_call(selected_payload);
  PERFORM pg_temp.resolution_check('both null deadlines accepted',response->>'ok'='true' AND response#>>'{row,expires_at}' IS NULL);
  response:=pg_temp.resolution_call(selected_payload);
  PERFORM pg_temp.resolution_check('null deadline exact retry accepted',response->>'ok'='true');
  response:=pg_temp.resolution_call(payload||jsonb_build_object('request',gen_random_uuid(),'expires_at',base_time+interval '1 hour'));
  PERFORM pg_temp.resolution_check('caller earlier expiry respected',response->>'ok'='true'
    AND (response#>>'{row,expires_at}')::timestamptz=base_time+interval '1 hour');

  response:=pg_temp.resolution_try('owner',format(
    'UPDATE private.movement_location_resolution_evidence SET version=version WHERE id=%L RETURNING to_jsonb(id)',first_evidence));
  PERFORM pg_temp.resolution_check('even no-op evidence UPDATE rejected',response->>'sqlstate'='23514');
  response:=pg_temp.resolution_try('owner',format(
    'DELETE FROM private.movement_location_resolution_evidence WHERE id=%L RETURNING to_jsonb(id)',first_evidence));
  PERFORM pg_temp.resolution_check('evidence DELETE rejected',response->>'sqlstate'='23514');
  response:=pg_temp.resolution_try('owner',format(
    'UPDATE private.movement_location_references SET latitude=7 WHERE id=%L RETURNING to_jsonb(id)',first_target));
  PERFORM pg_temp.resolution_check('0022 resolved location UPDATE rejected',response->>'sqlstate'='23514');
  PERFORM pg_temp.resolution_check('source still unchanged after all attempts',
    (SELECT to_jsonb(s)=original_source FROM private.movement_location_references s WHERE s.id=source_id));
  SET CONSTRAINTS private.offering_intent_complete,private.offering_intent_locations_complete IMMEDIATE;
  PERFORM pg_temp.resolution_check('final deferred construction checks pass',true);
END;
$resolution_tests$;

SELECT count(*) AS tests,count(*) FILTER(WHERE passed) AS passed,
  count(*) FILTER(WHERE NOT passed) AS failed FROM location_resolution_results;
SELECT test_name,passed FROM location_resolution_results ORDER BY test_name;
-- Expired persisted source/target and lock-wait races require elapsed wall time.
-- Existing 0022 INSERT guards forbid backdated already-expired fixtures. Do not
-- disable those guards or fake concurrency with sleeps; see the companion doc.
ROLLBACK;
