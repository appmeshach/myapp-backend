BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0020.
-- No real users, Storage objects, external providers, or network calls are used.
-- All fixtures, temporary helpers, role/JWT settings and results roll back.
-- This file does not replace functions, disable triggers/RLS, or grant app rights.
-- Uses the same local role/JWT harness as the 0014 rollback test.
-- Pattern: transaction-local SET ROLE + JWT claims, actual RPC calls, named
-- boolean results. Run to the final ROLLBACK even if any result is FALSE.
-- Unexpected fixture/setup errors abort the transaction; issue ROLLBACK if your
-- SQL client stops on error. Do not change ROLLBACK to COMMIT.

CREATE TEMP TABLE financial_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE financial_function_snapshot ON COMMIT DROP AS
SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS definition_hash,
  p.proacl::text AS acl, p.proconfig::text AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f';

CREATE FUNCTION pg_temp.financial_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO pg_temp.financial_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness, NOT an application SECURITY DEFINER RPC.
-- Role switching must succeed BEFORE the error-catching subtransaction so a
-- harness permission failure cannot masquerade as an expected app denial.
-- SQL arguments below are fixed test SQL or format('%L', fixture values).
CREATE FUNCTION pg_temp.financial_as(p_role text, p_member uuid, p_sql text)
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

CREATE FUNCTION pg_temp.financial_denied(
  p_name text, p_role text, p_member uuid, p_sql text,
  p_state text DEFAULT '42501', p_message text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.financial_as(p_role, p_member, p_sql);
  PERFORM pg_temp.financial_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND (p_message IS NULL OR r->>'message' = p_message));
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.financial_check(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.financial_as(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.financial_denied(text, text, uuid, text, text, text) FROM PUBLIC;





-- Force the same deferred checks COMMIT would execute, then restore deferred mode.
-- Every expected-invalid mutation runs in an exception subtransaction and rolls
-- back even if it unexpectedly succeeds. Existing pending valid work is checked
-- first so it cannot masquerade as the intended negative test.
CREATE FUNCTION pg_temp.financial_error(p_name text,p_sql text,p_state text DEFAULT '23514')
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE observed text;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    observed:='00000';
    RAISE EXCEPTION USING ERRCODE='ZX020',MESSAGE='rollback attempted mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>'ZX020' THEN observed:=SQLSTATE; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.financial_check(p_name,observed=p_state);
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.financial_error(text,text,text) FROM PUBLIC;

-- Administrator-only fixture builder. Overrides are fixed test values, never
-- application input; the production tables/triggers perform all validation.
CREATE FUNCTION pg_temp.financial_publish(p_alignment uuid,p_offering uuid,p_requester uuid,
  p_total bigint,p_contribution bigint,p_version integer DEFAULT 1,p_override jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE agreement uuid:=gen_random_uuid();
BEGIN
 INSERT INTO private.financial_agreements(id,alignment_id,offering_member_id,member_needing_movement_id,
   version,financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,
   currency,quoted_platform_fee_total_minor)
 VALUES(agreement,p_alignment,p_offering,p_requester,p_version,'shared_platform_fee_v1',
   coalesce(p_override->>'pricing_policy','fixture_price_v1'),'equal_split_requester_remainder_v1','NGN',p_total);
 -- Separate statements deliberately exercise deferred construction.
 IF coalesce((p_override->>'component_count')::integer,3)>=1 THEN
 INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id)
 VALUES(agreement,'offering_platform_share',coalesce((p_override->>'offering_amount')::bigint,p_total/2),
   coalesce((p_override->>'offering_responsible')::uuid,p_offering),coalesce(p_override->>'offering_kind','platform'),(p_override->>'offering_beneficiary')::uuid);
 END IF;
 IF coalesce((p_override->>'component_count')::integer,3)>=2 THEN
 INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id)
 VALUES(agreement,'requester_platform_share',coalesce((p_override->>'requester_amount')::bigint,p_total-p_total/2),
   coalesce((p_override->>'requester_responsible')::uuid,p_requester),coalesce(p_override->>'requester_kind','platform'),(p_override->>'requester_beneficiary')::uuid);
 END IF;
 IF coalesce((p_override->>'component_count')::integer,3)>=3 THEN
 INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id)
 VALUES(agreement,'movement_contribution',p_contribution,
   coalesce((p_override->>'contribution_responsible')::uuid,p_requester),coalesce(p_override->>'contribution_kind','member'),
   CASE WHEN p_override ? 'contribution_beneficiary' THEN (p_override->>'contribution_beneficiary')::uuid ELSE p_offering END);
 END IF;
 RETURN agreement;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.financial_publish(uuid,uuid,uuid,bigint,bigint,integer,jsonb) FROM PUBLIC;

-- Snapshot existing monetary state before any new agreement exists. No legacy
-- table is updated by the agreement tests. Fingerprints never leave the test.
CREATE TEMP TABLE financial_legacy_snapshot ON COMMIT DROP AS
SELECT
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) FROM private.alignment_activation_payments p) AS payments,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'[]')) FROM private.movement_settlements s) AS settlements;

DO $test$
DECLARE
 driver uuid:=gen_random_uuid(); requester uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 need uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); offer uuid:=gen_random_uuid();
 alignment uuid:=gen_random_uuid(); agreement uuid; second_agreement uuid; component uuid;
 r jsonb; published jsonb; accepted jsonb; old_alignment jsonb; col text; sig text; role_name text;
 template text; override jsonb; n integer; total bigint;
BEGIN
 INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 SELECT id,'authenticated','authenticated',id::text||'@test-0020.invalid','{}','{}',now(),now()
 FROM unnest(ARRAY[driver,requester,outsider]) ids(id);
 INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Lexus','Blue',4,'TEST-0020');
 INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at)
 VALUES(need,requester,'A','B',now()+interval '1 day');
 INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,status)
 VALUES(offer,need,driver,vehicle,1,'accepted');
 INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id)
 VALUES(alignment,need,offer,requester,driver);
 SELECT to_jsonb(a) INTO old_alignment FROM public.alignments a WHERE id=alignment;

 PERFORM pg_temp.financial_check('both tables are private',to_regclass('private.financial_agreements') IS NOT NULL AND to_regclass('private.financial_components') IS NOT NULL);
 -- Deferred trigger allows the parent INSERT; fails when constraints are forced.
 template:=format('INSERT INTO private.financial_agreements(alignment_id,offering_member_id,member_needing_movement_id,version,financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,currency,quoted_platform_fee_total_minor) VALUES(%L,%L,%L,1,''shared_platform_fee_v1'',''fixture_price_v1'',''equal_split_requester_remainder_v1'',''NGN'',201)',alignment,driver,requester);
 PERFORM pg_temp.financial_error('incomplete component set rejected at deferred validation',template);
 PERFORM pg_temp.financial_error('superseding cannot hide incomplete version',template||format('; UPDATE private.financial_agreements SET status=''superseded'' WHERE alignment_id=%L',alignment));
 PERFORM pg_temp.financial_error('wrong offering principal rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,201,500)',alignment,outsider,requester));
 PERFORM pg_temp.financial_error('wrong requester principal rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,201,500)',alignment,driver,outsider));
 FOR col,override IN SELECT * FROM (VALUES
 ('one component rejected',jsonb_build_object('component_count',1)),
 ('two components rejected',jsonb_build_object('component_count',2)),
 ('offering share cannot benefit member kind',jsonb_build_object('offering_kind','member','offering_beneficiary',driver)),
 ('requester share cannot benefit member kind',jsonb_build_object('requester_kind','member','requester_beneficiary',requester)),
 ('contribution cannot benefit platform',jsonb_build_object('contribution_kind','platform','contribution_beneficiary',NULL)),
 ('contribution requires member beneficiary',jsonb_build_object('contribution_beneficiary',NULL)),
 ('both shares rounded up rejected',jsonb_build_object('offering_amount',101,'requester_amount',101)),
 ('oversized malformed shares rejected without overflow',jsonb_build_object('offering_amount',9223372036854775807::bigint,'requester_amount',9223372036854775807::bigint)),
 ('wrong offering responsibility',jsonb_build_object('offering_responsible',requester)),
 ('wrong requester responsibility',jsonb_build_object('requester_responsible',driver)),
 ('wrong contribution responsibility',jsonb_build_object('contribution_responsible',driver)),
 ('platform offering cannot have member beneficiary',jsonb_build_object('offering_beneficiary',driver)),
 ('platform requester cannot have member beneficiary',jsonb_build_object('requester_beneficiary',requester)),
 ('contribution cannot benefit requester',jsonb_build_object('contribution_beneficiary',requester)),
 ('contribution cannot benefit unrelated member',jsonb_build_object('contribution_beneficiary',outsider)),
 ('sum mismatch rejected',jsonb_build_object('requester_amount',100)),
 ('reversed odd remainder rejected even with correct sum',jsonb_build_object('offering_amount',101,'requester_amount',100)),
 ('negative component rejected',jsonb_build_object('offering_amount',-1))
 ) cases(label,opts) LOOP
  PERFORM pg_temp.financial_error(col,format('SELECT pg_temp.financial_publish(%L,%L,%L,201,500,1,%L::jsonb)',alignment,driver,requester,override));
 END LOOP;
 PERFORM pg_temp.financial_error('negative quoted total rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,-1,500)',alignment,driver,requester));
 PERFORM pg_temp.financial_error('negative contribution rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,201,-1)',alignment,driver,requester));
 PERFORM pg_temp.financial_error('version zero rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,201,500,0)',alignment,driver,requester));
 PERFORM pg_temp.financial_error('unknown model rejected',replace(template,'''shared_platform_fee_v1''','''unknown_model'''));
 PERFORM pg_temp.financial_error('unknown allocation policy rejected',replace(template,'''equal_split_requester_remainder_v1''','''unknown_policy'''));
 PERFORM pg_temp.financial_error('blank pricing version rejected',replace(template,'''fixture_price_v1''',''''''));
 PERFORM pg_temp.financial_error('invalid currency rejected',replace(template,'''NGN''','''ngn'''));

 agreement:=pg_temp.financial_publish(alignment,driver,requester,201,500);
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.financial_check('agreement and all components validate together',(SELECT count(*)=3 FROM private.financial_components WHERE agreement_id=agreement));
 PERFORM pg_temp.financial_check('201 splits into 100 and 101',(SELECT amount_minor=100 FROM private.financial_components WHERE agreement_id=agreement AND component_key='offering_platform_share') AND (SELECT amount_minor=101 FROM private.financial_components WHERE agreement_id=agreement AND component_key='requester_platform_share'));
 PERFORM pg_temp.financial_check('contribution remains separate',(SELECT amount_minor=500 AND responsible_member_id=requester AND beneficiary_member_id=driver FROM private.financial_components WHERE agreement_id=agreement AND component_key='movement_contribution'));
 SELECT to_jsonb(a) INTO published FROM private.financial_agreements a WHERE id=agreement;
 SELECT id INTO component FROM private.financial_components WHERE agreement_id=agreement AND component_key='movement_contribution';
 PERFORM pg_temp.financial_error('duplicate alignment version rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,201,500)',alignment,driver,requester),'23505');
 PERFORM pg_temp.financial_error('two current versions rejected',format('SELECT pg_temp.financial_publish(%L,%L,%L,201,500,2)',alignment,driver,requester),'23505');
 PERFORM pg_temp.financial_error('fourth collectible total rejected',format('INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind) VALUES(%L,''platform_fee_total'',201,%L,''platform'')',agreement,driver));
 PERFORM pg_temp.financial_error('duplicate component key rejected',format('INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind) VALUES(%L,''offering_platform_share'',100,%L,''platform'')',agreement,driver),'23505');
 PERFORM pg_temp.financial_error('invalid agreement status rejected',format('UPDATE private.financial_agreements SET status=''unknown'' WHERE id=%L',agreement));
 PERFORM pg_temp.financial_error('published price immutable before acceptance',format('UPDATE private.financial_agreements SET quoted_platform_fee_total_minor=202 WHERE id=%L',agreement));
 PERFORM pg_temp.financial_error('unaccepted agreement cannot be deleted',format('DELETE FROM private.financial_agreements WHERE id=%L',agreement));
 UPDATE private.financial_agreements SET offering_accepted_at=clock_timestamp() WHERE id=agreement;
 PERFORM pg_temp.financial_check('offering acceptance does not accept for requester',(SELECT offering_accepted_at IS NOT NULL AND requester_accepted_at IS NULL FROM private.financial_agreements WHERE id=agreement));
 UPDATE private.financial_agreements SET requester_accepted_at=clock_timestamp() WHERE id=agreement;
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 SELECT to_jsonb(a) INTO accepted FROM private.financial_agreements a WHERE id=agreement;
 PERFORM pg_temp.financial_check('trusted one-way acceptance recorded',(SELECT offering_accepted_at IS NOT NULL AND requester_accepted_at IS NOT NULL FROM private.financial_agreements WHERE id=agreement));
 UPDATE private.financial_agreements SET offering_accepted_at=offering_accepted_at,requester_accepted_at=requester_accepted_at WHERE id=agreement;
 PERFORM pg_temp.financial_check('acceptance no-op is idempotent',(SELECT to_jsonb(a)=accepted FROM private.financial_agreements a WHERE id=agreement));
 FOR col IN SELECT unnest(ARRAY['offering_accepted_at','requester_accepted_at']) LOOP
  PERFORM pg_temp.financial_error(col||' cannot clear',format('UPDATE private.financial_agreements SET %I=NULL WHERE id=%L',col,agreement));
  PERFORM pg_temp.financial_error(col||' cannot rewrite',format('UPDATE private.financial_agreements SET %I=%I+interval ''1 second'' WHERE id=%L',col,col,agreement));
 END LOOP;
 FOR col,template IN SELECT * FROM (VALUES
 ('agreement identity',format('id=%L',gen_random_uuid())),
 ('agreement alignment',format('alignment_id=%L',gen_random_uuid())),
 ('agreement principal offering',format('offering_member_id=%L',outsider)),
 ('agreement principal requester',format('member_needing_movement_id=%L',outsider)),
 ('agreement version','version=2'),('agreement model','financial_model_version=''other'''),
 ('agreement pricing policy','pricing_policy_version=''other'''),
 ('agreement allocation policy','platform_fee_allocation_policy_version=''other'''),
 ('agreement currency','currency=''USD'''),('agreement total','quoted_platform_fee_total_minor=202'),
 ('agreement created timestamp','created_at=created_at+interval ''1 second''')
 ) cases(label,assignment) LOOP
  PERFORM pg_temp.financial_error(col||' immutable',format('UPDATE private.financial_agreements SET %s WHERE id=%L',template,agreement));
 END LOOP;
 FOR col,template IN SELECT * FROM (VALUES
 ('component identity',format('id=%L',gen_random_uuid())),('component created timestamp','created_at=created_at+interval ''1 second'''),
 ('component amount','amount_minor=501'),('component responsibility',format('responsible_member_id=%L',driver)),
 ('component beneficiary',format('beneficiary_member_id=%L',requester)),('component beneficiary kind','beneficiary_kind=''platform'''),
 ('component agreement',format('agreement_id=%L',gen_random_uuid())),('component key','component_key=''requester_platform_share''')
 ) cases(label,assignment) LOOP
  PERFORM pg_temp.financial_error(col||' immutable',format('UPDATE private.financial_components SET %s WHERE id=%L',template,component));
 END LOOP;
 PERFORM pg_temp.financial_error('component cannot be deleted',format('DELETE FROM private.financial_components WHERE id=%L',component));
 PERFORM pg_temp.financial_error('agreement cannot be deleted',format('DELETE FROM private.financial_agreements WHERE id=%L',agreement));
 PERFORM pg_temp.financial_error('all components cannot be deleted',format('DELETE FROM private.financial_components WHERE agreement_id=%L',agreement));
 PERFORM pg_temp.financial_error('alignment deletion cannot cascade financial history',format('DELETE FROM public.alignments WHERE id=%L',alignment),'23503');
 UPDATE private.financial_agreements SET status='superseded' WHERE id=agreement;
 PERFORM pg_temp.financial_error('superseded agreement cannot be deleted',format('DELETE FROM private.financial_agreements WHERE id=%L',agreement));
 second_agreement:=pg_temp.financial_publish(alignment,driver,requester,200,500,2,'{"pricing_policy":"fixture_price_v2"}');
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.financial_check('superseded history and new current coexist',(SELECT count(*)=2 FROM private.financial_agreements WHERE alignment_id=alignment) AND (SELECT status='current' AND offering_accepted_at IS NULL AND requester_accepted_at IS NULL FROM private.financial_agreements WHERE id=second_agreement));
 PERFORM pg_temp.financial_check('old economics and acceptance preserved',(SELECT to_jsonb(a)-'status'=accepted-'status' FROM private.financial_agreements a WHERE id=agreement));
 PERFORM pg_temp.financial_check('even total splits equally',(SELECT bool_and(amount_minor=100) FROM private.financial_components WHERE agreement_id=second_agreement AND component_key IN ('offering_platform_share','requester_platform_share')));
 PERFORM pg_temp.financial_error('superseded cannot reopen',format('UPDATE private.financial_agreements SET status=''current'' WHERE id=%L',agreement));
 PERFORM pg_temp.financial_error('superseded economics immutable',format('UPDATE private.financial_components SET amount_minor=0 WHERE id=%L',component));
 PERFORM pg_temp.financial_error('superseded acceptance immutable',format('UPDATE private.financial_agreements SET requester_accepted_at=NULL WHERE id=%L',agreement));
 PERFORM pg_temp.financial_check('new version may use new pricing identifier',(SELECT pricing_policy_version='fixture_price_v2' FROM private.financial_agreements WHERE id=second_agreement));
 -- Zero and bigint maximum validate without fractional arithmetic or overflow.
 n:=2;
 FOREACH total IN ARRAY ARRAY[0::bigint,1::bigint,2::bigint,3::bigint,9223372036854775807::bigint] LOOP
  UPDATE private.financial_agreements SET status='superseded' WHERE id=second_agreement;
  PERFORM pg_temp.financial_error('unaccepted superseded version cannot gain acceptance '||n,format('UPDATE private.financial_agreements SET offering_accepted_at=clock_timestamp() WHERE id=%L',second_agreement));
  n:=n+1;
  second_agreement:=pg_temp.financial_publish(alignment,driver,requester,total,0,n);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.financial_check('integer boundary valid '||total,(SELECT amount_minor=total/2 FROM private.financial_components WHERE agreement_id=second_agreement AND component_key='offering_platform_share') AND (SELECT amount_minor=total-total/2 FROM private.financial_components WHERE agreement_id=second_agreement AND component_key='requester_platform_share'));
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  PERFORM pg_temp.financial_denied(role_name||' agreement read denied',role_name,requester,'SELECT * FROM private.financial_agreements');
  PERFORM pg_temp.financial_denied(role_name||' component read denied',role_name,requester,'SELECT * FROM private.financial_components');
 END LOOP;
 FOREACH col IN ARRAY ARRAY['financial_agreements','financial_components'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.financial_check(role_name||' cannot mutate '||col,
     NOT has_table_privilege(role_name,'private.'||col,'INSERT') AND NOT has_table_privilege(role_name,'private.'||col,'UPDATE')
     AND NOT has_table_privilege(role_name,'private.'||col,'DELETE') AND NOT has_table_privilege(role_name,'private.'||col,'TRUNCATE'));
  END LOOP;
  PERFORM pg_temp.financial_check('PUBLIC has no table privileges '||col,NOT EXISTS (
    SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid=to_regclass('private.'||col) AND acl.grantee=0));
  PERFORM pg_temp.financial_check('RLS enabled without policies '||col,(SELECT c.relrowsecurity AND NOT EXISTS (
    SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid) FROM pg_class c WHERE c.oid=to_regclass('private.'||col)));
  r:=pg_temp.financial_as('service_role',NULL,'SELECT count(*) FROM private.'||col);
  PERFORM pg_temp.financial_check('service reads '||col,r->>'ok'='true');
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['protect_financial_agreement()','protect_financial_component()','validate_financial_agreement()'] LOOP
  PERFORM pg_temp.financial_check('helper not executable '||sig,NOT has_function_privilege('authenticated','private.'||sig,'EXECUTE') AND NOT has_function_privilege('anon','private.'||sig,'EXECUTE') AND NOT has_function_privilege('service_role','private.'||sig,'EXECUTE'));
  PERFORM pg_temp.financial_check('helper private definer configuration '||sig,(SELECT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND NOT EXISTS (
    SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0)
    FROM pg_proc p WHERE p.oid=to_regprocedure('private.'||sig)));
 END LOOP;
 PERFORM pg_temp.financial_check('alignment and legacy price untouched',(SELECT to_jsonb(a)=old_alignment FROM public.alignments a WHERE id=alignment));
 PERFORM pg_temp.financial_check('no automatic activation or journey',NOT EXISTS(SELECT 1 FROM public.journeys WHERE alignment_id=alignment));
END;
$test$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.financial_check('legacy payment history untouched',
 (SELECT payments FROM pg_temp.financial_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) FROM private.alignment_activation_payments p));
SELECT pg_temp.financial_check('legacy settlements untouched',
 (SELECT settlements FROM pg_temp.financial_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'[]')) FROM private.movement_settlements s));
SELECT pg_temp.financial_check('existing functions and grants unchanged by test',NOT EXISTS (
 SELECT 1 FROM pg_temp.financial_function_snapshot s JOIN pg_proc p ON p.oid=s.oid
 WHERE s.definition_hash<>md5(pg_get_functiondef(p.oid)) OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text
));
SELECT test_name,passed FROM pg_temp.financial_test_results ORDER BY check_number;
ROLLBACK;
