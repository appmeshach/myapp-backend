BEGIN;
-- Administrator-only rollback harness after migrations 0001-0028.
-- No provider/network calls. Real simultaneous-session races require a separate
-- controlled test; static tests guard the request-key conflict subtransaction.
CREATE TEMP TABLE verified_selection_results(test_name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_verified(p_name text,p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pg_temp.verified_selection_results VALUES(p_name,coalesce(p_ok,false));
END; $$;
REVOKE ALL ON FUNCTION pg_temp.check_verified(text,boolean) FROM PUBLIC;
CREATE FUNCTION pg_temp.try_verified(p_role text,p_sql text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_role text:=current_setting('role'); result jsonb;
BEGIN
 IF p_role NOT IN ('anon','authenticated','service_role','none') THEN RAISE EXCEPTION 'Invalid test role'; END IF;
 -- Role switching is outside the caught block: harness failures must not pass.
 PERFORM set_config('role',p_role,true);
 BEGIN
  IF p_sql ~ '^SELECT' THEN
   EXECUTE 'SELECT to_jsonb(q) FROM ('||p_sql||') q' INTO result;
   result:=jsonb_build_object('ok',true,'row',result);
  ELSE
   EXECUTE p_sql;
   result:=jsonb_build_object('ok',true);
  END IF;
 EXCEPTION WHEN OTHERS THEN
  result:=jsonb_build_object('ok',false,'state',SQLSTATE,'message',SQLERRM);
 END;
 PERFORM set_config('role',old_role,true);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION pg_temp.try_verified(text,text) FROM PUBLIC;
-- Test-only fault injection: force a late, unrelated uniqueness error after the
-- location and receipt inserts. Existing production protections remain enabled.
CREATE FUNCTION pg_temp.reject_verified_test_insert() RETURNS trigger
LANGUAGE plpgsql AS $fixture$ BEGIN
 RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='0028 injected unrelated unique conflict',
  CONSTRAINT='test_unrelated_unique',TABLE='movement_location_selection_attestations',SCHEMA='private';
END; $fixture$;
REVOKE ALL ON FUNCTION pg_temp.reject_verified_test_insert() FROM PUBLIC;
DO $tests$
DECLARE
 m uuid:=gen_random_uuid(); other_m uuid:=gen_random_uuid(); req uuid:=gen_random_uuid();
 operation uuid:=gen_random_uuid(); legacy_req uuid:=gen_random_uuid(); historical_req uuid:=gen_random_uuid();
 source_id uuid; legacy_id uuid; historical_id uuid; resolved_id uuid;
 issued timestamptz:=clock_timestamp()-interval '1 minute'; deadline timestamptz:=clock_timestamp()+interval '1 hour';
 historical_time timestamptz:=clock_timestamp()-interval '2 hours'; resolved_time timestamptz;
 intake text; resolution text; result jsonb; saved jsonb; replay jsonb; row_data jsonb;
 role_name text; signature text; rel text; action text; arg text;
 counts_before jsonb; counts_after jsonb; definitions_before jsonb; definitions_after jsonb;
 expiry_operation uuid:=gen_random_uuid(); later_operation uuid:=gen_random_uuid(); evidence_deadline timestamptz;
 n bigint;
BEGIN
 SELECT jsonb_object_agg(p.oid::text,pg_get_functiondef(p.oid)) INTO definitions_before
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname IN ('public','private') AND p.proname IN
 ('record_offering_route_evidence_for_server','assert_geojson_linestring_v1','assert_offering_route_evidence',
 'record_location_resolution_for_server','assert_movement_location_resolution_evidence',
 'protect_movement_location_resolution_evidence','validate_movement_location_resolution_evidence');
 SELECT jsonb_build_array(
 (SELECT count(*) FROM private.movement_location_references),
 (SELECT count(*) FROM private.movement_location_selection_receipts),
 (SELECT count(*) FROM private.movement_location_selection_attestations),
 (SELECT count(*) FROM private.movement_location_resolution_evidence),
 (SELECT count(*) FROM private.trusted_location_discovery_areas),
 (SELECT count(*) FROM private.offering_movement_intents),
 (SELECT count(*) FROM private.offering_movement_intent_locations),
 (SELECT count(*) FROM private.offering_route_evidence)) INTO counts_before;
 BEGIN
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 SELECT id,'authenticated','authenticated',id::text||'@test-0028.invalid',now(),
 '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now() FROM unnest(ARRAY[m,other_m]) ids(id);
 PERFORM set_config('request.jwt.claim.sub',m::text,true);
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);
 PERFORM pg_temp.check_verified('valid authenticated fixture identity',auth.uid()=m AND auth.role()='authenticated');
 PERFORM pg_temp.check_verified('member fixtures exist',(SELECT count(*)=2 FROM public.members WHERE id IN(m,other_m)));
 PERFORM pg_temp.check_verified('0027 anon execute ACL',NOT has_function_privilege('anon','public.record_selected_location_for_member(uuid,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_verified('0027 authenticated execute ACL',NOT has_function_privilege('authenticated','public.record_selected_location_for_member(uuid,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_verified('0027 service_role execute ACL',NOT has_function_privilege('service_role','public.record_selected_location_for_member(uuid,text,text,text)','EXECUTE'));
 PERFORM pg_temp.check_verified('0026 anon execute ACL',NOT has_function_privilege('anon','public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)','EXECUTE'));
 PERFORM pg_temp.check_verified('0026 authenticated execute ACL',NOT has_function_privilege('authenticated','public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)','EXECUTE'));
 PERFORM pg_temp.check_verified('0026 service_role execute ACL',NOT has_function_privilege('service_role','public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)','EXECUTE'));
 PERFORM pg_temp.check_verified('intake anon execute ACL',NOT has_function_privilege('anon','public.record_verified_selected_location_for_server(uuid,uuid,text,text,text,text,timestamptz,timestamptz)','EXECUTE'));
 PERFORM pg_temp.check_verified('intake authenticated execute ACL',NOT has_function_privilege('authenticated','public.record_verified_selected_location_for_server(uuid,uuid,text,text,text,text,timestamptz,timestamptz)','EXECUTE'));
 PERFORM pg_temp.check_verified('intake service_role execute ACL',has_function_privilege('service_role','public.record_verified_selected_location_for_server(uuid,uuid,text,text,text,text,timestamptz,timestamptz)','EXECUTE'));
 PERFORM pg_temp.check_verified('recovery anon execute ACL',NOT has_function_privilege('anon','public.get_verified_selected_location_for_server(uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('recovery authenticated execute ACL',NOT has_function_privilege('authenticated','public.get_verified_selected_location_for_server(uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('recovery service_role execute ACL',has_function_privilege('service_role','public.get_verified_selected_location_for_server(uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('context anon execute ACL',NOT has_function_privilege('anon','public.get_selected_location_resolution_context_for_server(uuid,uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('context authenticated execute ACL',NOT has_function_privilege('authenticated','public.get_selected_location_resolution_context_for_server(uuid,uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('context service_role execute ACL',has_function_privilege('service_role','public.get_selected_location_resolution_context_for_server(uuid,uuid,uuid)','EXECUTE'));
PERFORM pg_temp.check_verified(
  'resolution anon execute ACL',
  NOT has_function_privilege(
    'anon',
    'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
    'EXECUTE'
  )
);

PERFORM pg_temp.check_verified(
  'resolution authenticated execute ACL',
  NOT has_function_privilege(
    'authenticated',
    'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
    'EXECUTE'
  )
);

PERFORM pg_temp.check_verified(
  'resolution service_role execute ACL',
  NOT has_function_privilege(
    'service_role',
    'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)',
    'EXECUTE'
  )
);
 result:=pg_temp.try_verified('authenticated',format('SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',gen_random_uuid(),'Valid selection','test_provider','valid-place'));
 PERFORM pg_temp.check_verified('old 0027 authenticated actual denial',result->>'state'='42501' AND result->>'message' LIKE 'permission denied for function %');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_selected_location_for_member(%L,%L,%L,%L)',gen_random_uuid(),'Valid selection','test_provider','valid-place'));
 PERFORM pg_temp.check_verified('old 0027 service actual denial',result->>'state'='42501' AND result->>'message' LIKE 'permission denied for function %');
 -- Compare installed implementation to the exact 0026 source body; accept only
 -- the two checkout newline encodings, not arbitrary whitespace normalization.
 PERFORM pg_temp.check_verified('installed 0026 implementation matches immutable source',
 (SELECT md5(p.prosrc) IN ('1747dece6389abc4baa9c129c457862d','d14117b465552d9e5a098ddfd6e6f395') FROM pg_proc p WHERE p.oid='public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)'::regprocedure));
 PERFORM pg_temp.check_verified('wrapper effective owner can execute authoritative 0026',
 (SELECT p.prosecdef AND has_function_privilege(p.proowner,'public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)'::regprocedure,'EXECUTE') FROM pg_proc p WHERE p.oid='public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)'::regprocedure));
 PERFORM pg_temp.check_verified('0026 has no caller identity role guard',
 (SELECT p.prosecdef AND p.prosrc !~* 'auth[.](uid|role)|current_user|session_user' FROM pg_proc p WHERE p.oid='public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)'::regprocedure));
 PERFORM pg_temp.check_verified('protect_movement_location_selection_attestation denies anon',NOT has_function_privilege('anon','private.protect_movement_location_selection_attestation()','EXECUTE'));
 PERFORM pg_temp.check_verified('protect_movement_location_selection_attestation denies authenticated',NOT has_function_privilege('authenticated','private.protect_movement_location_selection_attestation()','EXECUTE'));
 PERFORM pg_temp.check_verified('protect_movement_location_selection_attestation denies service_role',NOT has_function_privilege('service_role','private.protect_movement_location_selection_attestation()','EXECUTE'));
 PERFORM pg_temp.check_verified('protect_movement_location_selection_attestation denies PUBLIC',NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='private.protect_movement_location_selection_attestation()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'));
 PERFORM pg_temp.check_verified('require_verified_location_selection denies anon',NOT has_function_privilege('anon','private.require_verified_location_selection(uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('require_verified_location_selection denies authenticated',NOT has_function_privilege('authenticated','private.require_verified_location_selection(uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('require_verified_location_selection denies service_role',NOT has_function_privilege('service_role','private.require_verified_location_selection(uuid,uuid)','EXECUTE'));
 PERFORM pg_temp.check_verified('require_verified_location_selection denies PUBLIC',NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='private.require_verified_location_selection(uuid,uuid)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'));
 PERFORM pg_temp.check_verified('validate_movement_location_selection_attestation denies anon',NOT has_function_privilege('anon','private.validate_movement_location_selection_attestation()','EXECUTE'));
 PERFORM pg_temp.check_verified('validate_movement_location_selection_attestation denies authenticated',NOT has_function_privilege('authenticated','private.validate_movement_location_selection_attestation()','EXECUTE'));
 PERFORM pg_temp.check_verified('validate_movement_location_selection_attestation denies service_role',NOT has_function_privilege('service_role','private.validate_movement_location_selection_attestation()','EXECUTE'));
 PERFORM pg_temp.check_verified('validate_movement_location_selection_attestation denies PUBLIC',NOT EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='private.validate_movement_location_selection_attestation()'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE'));
 PERFORM pg_temp.check_verified('attestation RLS without policies',(SELECT c.relrowsecurity AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) FROM pg_class c WHERE c.oid='private.movement_location_selection_attestations'::regclass));
 PERFORM pg_temp.check_verified('attestation anon no SELECT',NOT has_table_privilege('anon','private.movement_location_selection_attestations','SELECT'));
 PERFORM pg_temp.check_verified('attestation anon no INSERT',NOT has_table_privilege('anon','private.movement_location_selection_attestations','INSERT'));
 PERFORM pg_temp.check_verified('attestation anon no UPDATE',NOT has_table_privilege('anon','private.movement_location_selection_attestations','UPDATE'));
 PERFORM pg_temp.check_verified('attestation anon no DELETE',NOT has_table_privilege('anon','private.movement_location_selection_attestations','DELETE'));
 PERFORM pg_temp.check_verified('attestation authenticated no SELECT',NOT has_table_privilege('authenticated','private.movement_location_selection_attestations','SELECT'));
 PERFORM pg_temp.check_verified('attestation authenticated no INSERT',NOT has_table_privilege('authenticated','private.movement_location_selection_attestations','INSERT'));
 PERFORM pg_temp.check_verified('attestation authenticated no UPDATE',NOT has_table_privilege('authenticated','private.movement_location_selection_attestations','UPDATE'));
 PERFORM pg_temp.check_verified('attestation authenticated no DELETE',NOT has_table_privilege('authenticated','private.movement_location_selection_attestations','DELETE'));
 PERFORM pg_temp.check_verified('attestation service_role no SELECT',NOT has_table_privilege('service_role','private.movement_location_selection_attestations','SELECT'));
 PERFORM pg_temp.check_verified('attestation service_role no INSERT',NOT has_table_privilege('service_role','private.movement_location_selection_attestations','INSERT'));
 PERFORM pg_temp.check_verified('attestation service_role no UPDATE',NOT has_table_privilege('service_role','private.movement_location_selection_attestations','UPDATE'));
 PERFORM pg_temp.check_verified('attestation service_role no DELETE',NOT has_table_privilege('service_role','private.movement_location_selection_attestations','DELETE'));
 intake:=format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Lagos selection','test_provider','place-1','selection_proof_v1',issued,deadline);
 result:=pg_temp.try_verified('service_role',intake);
 source_id:=(result->'row'->>'location_reference_id')::uuid;
 PERFORM pg_temp.check_verified('verified intake succeeds',result->>'ok'='true' AND source_id IS NOT NULL);
 PERFORM pg_temp.check_verified('intake returns only selection fields',(SELECT count(*)=2 FROM jsonb_object_keys(result->'row')));
 PERFORM pg_temp.check_verified('one selected location receipt and attestation',(SELECT count(*)=1 FROM private.movement_location_references WHERE owner_member_id=m) AND (SELECT count(*)=1 FROM private.movement_location_selection_receipts WHERE request_id=req AND location_reference_id=source_id) AND (SELECT count(*)=1 FROM private.movement_location_selection_attestations WHERE selection_request_id=req));
 PERFORM pg_temp.check_verified('selected source has no coordinates or resolution',EXISTS(SELECT 1 FROM private.movement_location_references WHERE id=source_id AND source_kind='member_selected' AND resolution_status='unresolved' AND latitude IS NULL AND longitude IS NULL AND resolved_at IS NULL AND resolution_version IS NULL));
 replay:=pg_temp.try_verified('service_role',intake);
 PERFORM pg_temp.check_verified('exact intake replay',replay=result);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Changed','test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('changed intake label',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Lagos selection','another_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('changed intake namespace',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Lagos selection','test_provider','place-2','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('changed intake place',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Lagos selection','test_provider','place-1','selection_proof_v2',issued,deadline));
 PERFORM pg_temp.check_verified('changed intake proof version',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Lagos selection','test_provider','place-1','selection_proof_v1',issued-interval '1 second',deadline));
 PERFORM pg_temp.check_verified('changed proof issued time',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'Lagos selection','test_provider','place-1','selection_proof_v1',issued,deadline+interval '1 second'));
 PERFORM pg_temp.check_verified('changed proof expiry',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',other_m,req,'Lagos selection','test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('cross member replay',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',gen_random_uuid(),req,'Lagos selection','test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('missing member intake',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,gen_random_uuid(),'Lagos selection','test_provider','place-1','selection_proof_v1',issued,clock_timestamp()-interval '1 second'));
 PERFORM pg_temp.check_verified('expired first proof rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,gen_random_uuid(),'Lagos selection','test_provider','place-1','selection_proof_v1',issued,'infinity'::timestamptz));
 PERFORM pg_temp.check_verified('infinite first proof rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,gen_random_uuid(),'Lagos selection','test_provider','place-1','selection_proof_v1',clock_timestamp()+interval '1 minute',deadline));
 PERFORM pg_temp.check_verified('future proof rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,'   ','test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('blank label',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,repeat('x',301),'test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('oversized label',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,req,' Lagos selection','test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('padded label',result->>'state'='23514');
 CREATE TRIGGER test_0028_late_unique_failure BEFORE INSERT ON private.movement_location_selection_attestations
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_verified_test_insert();
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,gen_random_uuid(),'Lagos selection','test_provider','place-1','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('unrelated late unique failure is rethrown',result->>'state'='23505' AND result->>'message'='0028 injected unrelated unique conflict');
 DROP TRIGGER test_0028_late_unique_failure ON private.movement_location_selection_attestations;
 PERFORM pg_temp.check_verified('late unique failure rolls back location receipt and attestation',
  (SELECT count(*)=1 FROM private.movement_location_references WHERE owner_member_id=m)
  AND (SELECT count(*)=1 FROM private.movement_location_selection_receipts r JOIN private.movement_location_references l ON l.id=r.location_reference_id WHERE l.owner_member_id=m)
  AND (SELECT count(*)=1 FROM private.movement_location_selection_attestations a JOIN private.movement_location_selection_receipts r ON r.request_id=a.selection_request_id JOIN private.movement_location_references l ON l.id=r.location_reference_id WHERE l.owner_member_id=m));
 PERFORM pg_temp.check_verified('failed retries leave no orphan triple',(SELECT count(*)=1 FROM private.movement_location_references WHERE owner_member_id=m) AND (SELECT count(*)=1 FROM private.movement_location_selection_receipts r JOIN private.movement_location_references l ON l.id=r.location_reference_id WHERE l.owner_member_id=m) AND (SELECT count(*)=1 FROM private.movement_location_selection_attestations a JOIN private.movement_location_selection_receipts r ON r.request_id=a.selection_request_id JOIN private.movement_location_references l ON l.id=r.location_reference_id WHERE l.owner_member_id=m));
 result:=pg_temp.try_verified('anon',intake);
 PERFORM pg_temp.check_verified('intake actual anon denied',result->>'state'='42501');
 result:=pg_temp.try_verified('anon',format('SELECT * FROM private.movement_location_selection_attestations WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('direct anon SELECT * FROM denied',result->>'state'='42501');
 result:=pg_temp.try_verified('anon',format('DELETE FROM private.movement_location_selection_attestations WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('direct anon DELETE FROM denied',result->>'state'='42501');
 result:=pg_temp.try_verified('anon',format('UPDATE private.movement_location_selection_attestations SET proof_version=proof_version WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('direct anon UPDATE denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',intake);
 PERFORM pg_temp.check_verified('intake actual authenticated denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',format('SELECT * FROM private.movement_location_selection_attestations WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('direct authenticated SELECT * FROM denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',format('DELETE FROM private.movement_location_selection_attestations WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('direct authenticated DELETE FROM denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',format('UPDATE private.movement_location_selection_attestations SET proof_version=proof_version WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('direct authenticated UPDATE denied',result->>'state'='42501');
 result:=pg_temp.try_verified('none',format('UPDATE private.movement_location_selection_attestations SET proof_version=proof_version WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('attestation owner no-op update rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('DELETE FROM private.movement_location_selection_attestations WHERE selection_request_id=%L',req));
 PERFORM pg_temp.check_verified('attestation owner delete rejected',result->>'state'='23514');
 -- Owner-created legacy fixture is deliberately unattested; application roles cannot create it.
 INSERT INTO private.movement_location_references(owner_member_id,declared_label,source_kind,resolution_status,provider_namespace,provider_place_reference,created_at)
 VALUES(m,'Legacy selection','member_selected','unresolved','test_provider','legacy',historical_time) RETURNING id INTO legacy_id;
 INSERT INTO private.movement_location_selection_receipts VALUES(legacy_req,legacy_id,historical_time);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,legacy_req,'Legacy selection','test_provider','legacy','selection_proof_v1',issued,deadline));
 PERFORM pg_temp.check_verified('legacy replay cannot upgrade',result->>'state'='23514');
 PERFORM pg_temp.check_verified('legacy remains unattested',NOT EXISTS(SELECT 1 FROM private.movement_location_selection_attestations WHERE selection_request_id=legacy_req));
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'untrusted_v1','selection_proof_v1',historical_time-interval '1 minute',historical_time+interval '1 minute',historical_time));
 PERFORM pg_temp.check_verified('invalid attestation version rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','',historical_time-interval '1 minute',historical_time+interval '1 minute',historical_time));
 PERFORM pg_temp.check_verified('blank proof version rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','   ',historical_time-interval '1 minute',historical_time+interval '1 minute',historical_time));
 PERFORM pg_temp.check_verified('whitespace proof version rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','selection_proof_v1',historical_time,historical_time,historical_time));
 PERFORM pg_temp.check_verified('equal proof timestamps rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','selection_proof_v1',historical_time+interval '1 minute',historical_time,historical_time));
 PERFORM pg_temp.check_verified('reversed proof timestamps rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','selection_proof_v1','-infinity'::timestamptz,historical_time+interval '1 minute',historical_time));
 PERFORM pg_temp.check_verified('infinite issued timestamp rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','selection_proof_v1',historical_time-interval '1 minute','infinity'::timestamptz,historical_time));
 PERFORM pg_temp.check_verified('infinite expiry timestamp rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','selection_proof_v1',historical_time-interval '1 minute',historical_time+interval '1 minute','infinity'::timestamptz));
 PERFORM pg_temp.check_verified('infinite verified timestamp rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('none',format('INSERT INTO private.movement_location_selection_attestations(selection_request_id,attestation_version,proof_version,proof_issued_at,proof_expires_at,verified_at) VALUES(%L,%L,%L,%L,%L,%L)',legacy_req,'trusted_selection_intake_v1','selection_proof_v1',historical_time-interval '1 minute',historical_time+interval '1 minute',historical_time+interval '1 second'));
 PERFORM pg_temp.check_verified('receipt acceptance time mismatch rejected',result->>'state'='23514');
 -- The unexpected member_declared receipt is tested inside one caught statement;
 -- its deferred receipt constraint is never disabled and no malformed row survives.
 result:=pg_temp.try_verified('none',format($invalid_sql$DO $invalid_fixture$
 DECLARE lid uuid; rid uuid:=gen_random_uuid(); t timestamptz:=clock_timestamp();
 BEGIN
 INSERT INTO private.movement_location_references(owner_member_id,declared_label,source_kind,resolution_status,provider_namespace,provider_place_reference,created_at)
 VALUES(%L,'Invalid selected shape','member_declared','unresolved','test_provider','invalid-shape',t) RETURNING id INTO lid;
 INSERT INTO private.movement_location_selection_receipts VALUES(rid,lid,t);
 INSERT INTO private.movement_location_selection_attestations(selection_request_id,proof_version,proof_issued_at,proof_expires_at,verified_at)
 VALUES(rid,'selection_proof_v1',t-interval '1 minute',t+interval '1 minute',t);
 END; $invalid_fixture$;$invalid_sql$,m));
 PERFORM pg_temp.check_verified('unexpected location shape rejected',result->>'state'='23514');
 PERFORM pg_temp.check_verified('malformed attestation attempts leave legacy unattested',NOT EXISTS(SELECT 1 FROM private.movement_location_selection_attestations WHERE selection_request_id=legacy_req));
 -- Historical acceptance fixture permits deterministic expiry recovery without sleeps.
 INSERT INTO private.movement_location_references(owner_member_id,declared_label,source_kind,resolution_status,provider_namespace,provider_place_reference,created_at)
 VALUES(m,'Historical selection','member_selected','unresolved','test_provider','historical',historical_time) RETURNING id INTO historical_id;
 INSERT INTO private.movement_location_selection_receipts VALUES(historical_req,historical_id,historical_time);
 INSERT INTO private.movement_location_selection_attestations(selection_request_id,proof_version,proof_issued_at,proof_expires_at,verified_at)
 VALUES(historical_req,'selection_proof_v1',historical_time-interval '1 minute',historical_time+interval '1 minute',historical_time);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_verified_selected_location_for_server(%L,%L)',m,historical_req));
 PERFORM pg_temp.check_verified('accepted expired proof recovery',result->>'ok'='true' AND result->'row'->>'location_reference_id'=historical_id::text);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_verified_selected_location_for_server(%L,%L,%L,%L,%L,%L,%L,%L)',m,historical_req,'Historical selection','test_provider','historical','selection_proof_v1',historical_time-interval '1 minute',historical_time+interval '1 minute'));
 PERFORM pg_temp.check_verified('accepted expired proof exact intake replay',result->>'ok'='true' AND result->'row'->>'location_reference_id'=historical_id::text);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_verified_selected_location_for_server(%L,%L)',m,req));
 PERFORM pg_temp.check_verified('recovery valid owner',result->>'ok'='true');
 saved:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_verified_selected_location_for_server(%L,%L)',other_m,req));
 replay:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_verified_selected_location_for_server(%L,%L)',m,gen_random_uuid()));
 PERFORM pg_temp.check_verified('recovery foreign and missing equivalent',saved=replay AND saved->>'state'='23514');
 result:=pg_temp.try_verified('anon',format('SELECT * FROM public.get_verified_selected_location_for_server(%L,%L)',m,req));
 PERFORM pg_temp.check_verified('recovery actual anon denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',format('SELECT * FROM public.get_verified_selected_location_for_server(%L,%L)',m,req));
 PERFORM pg_temp.check_verified('recovery actual authenticated denied',result->>'state'='42501');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,source_id,operation));
 PERFORM pg_temp.check_verified('context valid owner',result->>'ok'='true');
 saved:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',other_m,source_id,operation));
 replay:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,gen_random_uuid(),operation));
 PERFORM pg_temp.check_verified('context foreign and missing equivalent',saved=replay AND saved->>'state'='23514');
 result:=pg_temp.try_verified('anon',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,source_id,operation));
 PERFORM pg_temp.check_verified('context actual anon denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,source_id,operation));
 PERFORM pg_temp.check_verified('context actual authenticated denied',result->>'state'='42501');
 resolved_time:=clock_timestamp();
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,6.5,3.4,%L,NULL)',source_id,gen_random_uuid(),'test_provider','geocode','test_v1','place-1','resolution_v1',resolved_time));
 PERFORM pg_temp.check_verified('old 0026 service actual denial',result->>'state'='42501' AND result->>'message' LIKE 'permission denied for function %');
 resolution:=format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,6.5,3.4,%L,NULL)',m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',resolved_time);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'wrong_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',6.5,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('resolution namespace binding',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','test_v1','wrong_place','resolution_v1','Ologolo, Lagos',6.5,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('resolution place binding',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos','NaN'::numeric,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('0026 NaN preserved',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos','Infinity'::numeric,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('0026 infinity preserved',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',91,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('0026 latitude range preserved',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',6.5,181,resolved_time,NULL));
 PERFORM pg_temp.check_verified('0026 longitude range preserved',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','','place-1','resolution_v1','Ologolo, Lagos',6.5,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('0026 empty provenance preserved',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,legacy_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',6.5,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('unattested resolution rejected',result->>'state'='23514');
 saved:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',other_m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',6.5,3.4,resolved_time,NULL));
 replay:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,gen_random_uuid(),operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',6.5,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('resolution foreign and missing equivalent',saved=replay AND saved->>'state'='23514');
 result:=pg_temp.try_verified('anon',resolution);
 PERFORM pg_temp.check_verified('resolution actual anon denied',result->>'state'='42501');
 result:=pg_temp.try_verified('authenticated',resolution);
 PERFORM pg_temp.check_verified('resolution actual authenticated denied',result->>'state'='42501');
 result:=pg_temp.try_verified('service_role',resolution);
 resolved_id:=(result->'row'->>'resolved_location_reference_id')::uuid;
 replay:=pg_temp.try_verified('service_role',resolution);
 PERFORM pg_temp.check_verified('attested resolution succeeds',result->>'ok'='true' AND resolved_id IS NOT NULL);
 PERFORM pg_temp.check_verified('exact resolution replay',result=replay);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',m,source_id,operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',6.6,3.4,resolved_time,NULL));
 PERFORM pg_temp.check_verified('changed resolution replay rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,source_id,operation));
 PERFORM pg_temp.check_verified('context returns committed operation result',result->>'ok'='true' AND result->'row'->>'resolved_location_reference_id'=resolved_id::text);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,historical_id,operation));
 PERFORM pg_temp.check_verified('context refuses unrelated operation',result->>'state'='23514');
 PERFORM pg_temp.check_verified('single evidence and target after failed resolution',(SELECT count(*)=1 FROM private.movement_location_resolution_evidence WHERE source_location_reference_id=source_id) AND (SELECT count(*)=1 FROM private.movement_location_references WHERE owner_member_id=m AND source_kind='provider_resolved'));
 -- Versions are immutable history, not a superseded/current lifecycle.
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,6.6,3.4,%L,NULL)',m,source_id,later_operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',resolved_time));
 PERFORM pg_temp.check_verified('later resolution creates version two',result->>'ok'='true' AND result->'row'->>'version'='2');
 result:=pg_temp.try_verified('service_role',resolution);
 PERFORM pg_temp.check_verified('older exact retry remains version one',result->>'ok'='true' AND result->'row'->>'version'='1' AND result->'row'->>'resolved_location_reference_id'=resolved_id::text);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,source_id,operation));
 PERFORM pg_temp.check_verified('context preserves requested older operation',result->>'ok'='true' AND result->'row'->>'version'='1' AND result->'row'->>'resolved_location_reference_id'=resolved_id::text);
 -- Use real elapsed database time, without backdating evidence or disabling guards.
 evidence_deadline:=clock_timestamp()+interval '2 seconds';
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,6.7,3.4,%L,%L)',m,source_id,expiry_operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',resolved_time,evidence_deadline));
 PERFORM pg_temp.check_verified('finite expiry resolution accepted while eligible',result->>'ok'='true' AND result->'row'->>'version'='3');
 PERFORM pg_sleep(greatest(0,extract(epoch FROM evidence_deadline-clock_timestamp()))+0.02);
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.record_attested_location_resolution_for_server(%L,%L,%L,%L,%L,%L,%L,%L,%L,6.7,3.4,%L,%L)',m,source_id,expiry_operation,'test_provider','geocode','test_v1','place-1','resolution_v1','Ologolo, Lagos',resolved_time,evidence_deadline));
 PERFORM pg_temp.check_verified('expired evidence exact retry rejected',result->>'state'='23514');
 result:=pg_temp.try_verified('service_role',format('SELECT * FROM public.get_selected_location_resolution_context_for_server(%L,%L,%L)',m,source_id,expiry_operation));
 PERFORM pg_temp.check_verified('context rejects expired evidence',result->>'state'='23514');
 PERFORM pg_temp.check_verified('expired replay creates no replacement evidence',(SELECT count(*)=3 FROM private.movement_location_resolution_evidence WHERE source_location_reference_id=source_id));
 SET CONSTRAINTS ALL IMMEDIATE;
 PERFORM pg_temp.check_verified('deferred constraints validate',true);
 SELECT jsonb_agg(to_jsonb(t)) INTO saved FROM pg_temp.verified_selection_results t;
 RAISE EXCEPTION USING ERRCODE='Z0028',MESSAGE='rollback all 0028 fixtures';
 EXCEPTION WHEN SQLSTATE 'Z0028' THEN NULL;
 END;
 -- PL/pgSQL variables survive the rolled-back fixture subtransaction.
 INSERT INTO pg_temp.verified_selection_results SELECT x.test_name,x.passed FROM jsonb_to_recordset(saved) x(test_name text,passed boolean);
 SELECT jsonb_build_array(
 (SELECT count(*) FROM private.movement_location_references),
 (SELECT count(*) FROM private.movement_location_selection_receipts),
 (SELECT count(*) FROM private.movement_location_selection_attestations),
 (SELECT count(*) FROM private.movement_location_resolution_evidence),
 (SELECT count(*) FROM private.trusted_location_discovery_areas),
 (SELECT count(*) FROM private.offering_movement_intents),
 (SELECT count(*) FROM private.offering_movement_intent_locations),
 (SELECT count(*) FROM private.offering_route_evidence)) INTO counts_after;
 PERFORM pg_temp.check_verified('rollback leaves zero context evidence receipt attestation fixtures',counts_before=counts_after);
 PERFORM pg_temp.check_verified('rollback leaves zero user member fixtures',NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN(m,other_m)) AND NOT EXISTS(SELECT 1 FROM public.members WHERE id IN(m,other_m)));
 SELECT jsonb_object_agg(p.oid::text,pg_get_functiondef(p.oid)) INTO definitions_after
 FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
 WHERE ns.nspname IN ('public','private') AND p.proname IN
 ('record_offering_route_evidence_for_server','assert_geojson_linestring_v1','assert_offering_route_evidence',
 'record_location_resolution_for_server','assert_movement_location_resolution_evidence',
 'protect_movement_location_resolution_evidence','validate_movement_location_resolution_evidence');
 PERFORM pg_temp.check_verified('0025 and 0026 function definitions unchanged during tests',definitions_before=definitions_after);
END;
$tests$;
SELECT test_name,passed FROM pg_temp.verified_selection_results ORDER BY test_name;
SELECT count(*) AS total,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.verified_selection_results;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_temp.verified_selection_results)<>134 THEN RAISE EXCEPTION '0028 expected exactly 134 named results'; END IF;
 IF EXISTS(SELECT 1 FROM pg_temp.verified_selection_results WHERE NOT passed) THEN RAISE EXCEPTION '0028 behavioral checks failed'; END IF;
END; $$;
ROLLBACK;
