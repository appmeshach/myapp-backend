BEGIN;

-- Run this WHOLE file as the database administrator after migrations 0001-0021.
-- No real users, Storage objects, external providers, or network calls are used.
-- All fixtures, temporary helpers, role/JWT settings and results roll back.
-- This file does not replace functions, disable triggers/RLS, or grant app rights.
-- Uses the same local role/JWT harness as the 0014 rollback test.
-- Pattern: transaction-local SET ROLE + JWT claims, table/helper privilege
-- checks and administrator fixtures with named boolean results. No proposal RPC exists.
-- Run to the final ROLLBACK even if any result is FALSE.
-- Unexpected fixture/setup errors abort the transaction; issue ROLLBACK if your
-- SQL client stops on error. Do not change ROLLBACK to COMMIT.

CREATE TEMP TABLE proposal_test_results (
  check_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE proposal_function_snapshot ON COMMIT DROP AS
SELECT p.oid, md5(pg_get_functiondef(p.oid)) AS definition_hash,
  p.proacl::text AS acl, p.proconfig::text AS config
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f';

CREATE FUNCTION pg_temp.proposal_check(p_name text, p_passed boolean)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  INSERT INTO pg_temp.proposal_test_results(test_name, passed)
  VALUES (p_name, coalesce(p_passed, false));
END;
$$;

-- Administrator-only test harness, NOT an application SECURITY DEFINER RPC.
-- Role switching must succeed BEFORE the error-catching subtransaction so a
-- harness permission failure cannot masquerade as an expected app denial.
-- SQL arguments below are fixed test SQL or format('%L', fixture values).
CREATE FUNCTION pg_temp.proposal_as(p_role text, p_member uuid, p_sql text)
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

CREATE FUNCTION pg_temp.proposal_denied(
  p_name text, p_role text, p_member uuid, p_sql text,
  p_state text DEFAULT '42501', p_message text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE r jsonb;
BEGIN
  r := pg_temp.proposal_as(p_role, p_member, p_sql);
  PERFORM pg_temp.proposal_check(p_name,
    r->>'ok' = 'false' AND r->>'state' = p_state
    AND (p_message IS NULL OR r->>'message' = p_message));
END;
$$;

REVOKE ALL ON FUNCTION pg_temp.proposal_check(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.proposal_as(text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION pg_temp.proposal_denied(text, text, uuid, text, text, text) FROM PUBLIC;

-- Force the same deferred checks COMMIT would execute, then restore deferred mode.
-- Every expected-invalid mutation runs in an exception subtransaction and rolls
-- back even if it unexpectedly succeeds. Existing pending valid work is checked
-- first so it cannot masquerade as the intended negative test.
CREATE FUNCTION pg_temp.proposal_error(p_name text,p_sql text,p_state text DEFAULT '23514',p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE observed text; observed_message text;
BEGIN
  -- Distinguish validators that share 23514; unrelated deferred failures must
  -- never satisfy these context/consent/materialization tests.
  IF p_message IS NULL THEN
    p_message:=CASE
      WHEN p_name IN ('missing roster rejected','incomplete roster rejected',
        'pending invitation prevents bindable snapshot','extra roster row rejected',
        'same-count roster replacement blocks stale acceptance')
        THEN 'Proposal requires the exact complete confirmed roster'
      WHEN p_name IN ('wrong requester rejected','wrong origin snapshot rejected','wrong count snapshot rejected',
        'origin change blocks stale acceptance','destination change blocks stale acceptance',
        'departure change blocks stale acceptance','declared count change blocks stale acceptance')
        THEN 'Proposal need snapshot does not match'
      WHEN p_name IN ('wrong offering member access rejected','wrong capacity snapshot rejected',
        'capacity change blocks stale acceptance','lost access blocks stale acceptance')
        THEN 'Proposal vehicle access or capacity does not match'
      WHEN p_name='closed need blocks stale acceptance' THEN 'Unmaterialized proposal requires an available movement need'
      WHEN p_name='mismatched offer rejected' THEN 'Proposal offer binding does not match'
      WHEN p_name='offering acceptance requires bound offer' THEN 'Proposal consent requires its bound movement offer'
      WHEN p_name='offer binding requires offering acceptance' THEN 'Bound movement offer requires offering-member acceptance'
      WHEN p_name IN ('requester acceptance requires same-transaction materialization',
        'replacement requester acceptance still requires materialization')
        THEN 'Requester acceptance must materialize in the same transaction'
      WHEN p_name IN ('wrong contribution cannot materialize','wrong currency cannot materialize')
        THEN 'Proposal materialization does not match'
      WHEN p_name='future creation time rejected' THEN 'Proposal creation time cannot be future-dated'
      WHEN p_name IN ('already expired proposal rejected','past expiry rejected at insert')
        THEN 'Proposal cannot be created already expired'
      WHEN p_name='expired proposal cannot bind and gain offering acceptance' THEN 'Proposal is not current and unexpired'
      WHEN p_name LIKE 'materialization %' AND p_name<>'materialization duplicate links rejected'
        THEN 'Materialized proposal is immutable'
      ELSE NULL
    END;
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    observed:='00000';
    RAISE EXCEPTION USING ERRCODE='ZX021',MESSAGE='rollback attempted mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>'ZX021' THEN observed:=SQLSTATE; observed_message:=SQLERRM; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.proposal_check(p_name,observed=p_state
    AND (p_message IS NULL OR observed_message=p_message));
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.proposal_error(text,text,text,text) FROM PUBLIC;

-- Trusted administrator fixture only; no production issuer or price algorithm.
-- Overrides intentionally attack the real table constraints and triggers.
CREATE FUNCTION pg_temp.proposal_publish(p_need uuid,p_driver uuid,p_vehicle uuid,
  p_version integer DEFAULT 1,p_override jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE n public.movement_needs%ROWTYPE; v public.vehicles%ROWTYPE;
  payload jsonb; result_id uuid; traveller record;
BEGIN
 SELECT * INTO STRICT n FROM public.movement_needs WHERE id=p_need;
 SELECT * INTO STRICT v FROM public.vehicles WHERE id=p_vehicle;
 payload:=jsonb_build_object(
   'id',gen_random_uuid(),'movement_need_id',n.id,'offering_member_id',p_driver,
   'member_needing_movement_id',n.member_id,'vehicle_id',v.id,'version',p_version,
   'financial_model_version','shared_platform_fee_v1','pricing_policy_version','fixture_v1',
   'platform_fee_allocation_policy_version','equal_split_requester_remainder_v1',
   'currency','NGN','quoted_platform_fee_total_minor',201,'quoted_movement_contribution_minor',500,
   'origin_area',n.origin_area,'destination_area',n.destination_area,
   'earliest_departure_at',n.earliest_departure_at,'latest_departure_at',n.latest_departure_at,
   'people_count',n.people_count,'seats_offered',n.people_count,'vehicle_seat_capacity',v.seat_capacity,
   'created_at',now(),'status','current') || p_override;
 INSERT INTO private.financial_proposals
 SELECT r.* FROM jsonb_populate_record(NULL::private.financial_proposals,payload) r
 RETURNING id INTO result_id;
 FOR traveller IN SELECT mp.* FROM public.movement_participants mp
   WHERE mp.movement_need_id=p_need AND mp.status='confirmed' ORDER BY mp.member_id
   LIMIT coalesce((p_override->>'roster_limit')::integer,2147483647)
 LOOP
   INSERT INTO private.financial_proposal_travellers(proposal_id,member_id,participant_id,role)
   VALUES(result_id,traveller.member_id,traveller.id,traveller.role);
 END LOOP;
 RETURN result_id;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.proposal_publish(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC;

-- Merely constructs the existing 0020 fixture; no proposal trigger creates it.
CREATE FUNCTION pg_temp.proposal_agreement(p_proposal uuid,p_alignment uuid,p_overrides jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE p private.financial_proposals%ROWTYPE; g uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=p_proposal;
 UPDATE public.movement_offers SET status='accepted' WHERE id=p.movement_offer_id;
 UPDATE public.movement_needs SET status='closed' WHERE id=p.movement_need_id;
 INSERT INTO private.financial_agreements(id,alignment_id,offering_member_id,member_needing_movement_id,
   version,financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,
   currency,quoted_platform_fee_total_minor)
 VALUES(g,p_alignment,p.offering_member_id,p.member_needing_movement_id,1,p.financial_model_version,
   p.pricing_policy_version,p.platform_fee_allocation_policy_version,coalesce(p_overrides->>'currency',p.currency),
   p.quoted_platform_fee_total_minor);
 INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id)
 VALUES (g,'offering_platform_share',p.quoted_platform_fee_total_minor/2,p.offering_member_id,'platform',NULL),
 (g,'requester_platform_share',p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor/2,p.member_needing_movement_id,'platform',NULL),
 (g,'movement_contribution',coalesce((p_overrides->>'contribution')::bigint,p.quoted_movement_contribution_minor),p.member_needing_movement_id,'member',p.offering_member_id);
 UPDATE private.financial_agreements SET offering_accepted_at=p.offering_accepted_at,requester_accepted_at=p.requester_accepted_at WHERE id=g;
 RETURN g;
END;
$$;
REVOKE ALL ON FUNCTION pg_temp.proposal_agreement(uuid,uuid,jsonb) FROM PUBLIC;

CREATE TEMP TABLE proposal_legacy_snapshot ON COMMIT DROP AS
SELECT
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM public.alignments a) AS alignments,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id)::text,'[]')) FROM private.financial_agreements g) AS agreements,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'[]')) FROM private.financial_components c) AS components,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) FROM private.alignment_activation_payments p) AS payments,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'[]')) FROM private.movement_settlements s) AS settlements;

CREATE TEMP TABLE proposal_table_snapshot ON COMMIT DROP AS
SELECT c.oid,c.relacl::text AS acl,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname IN ('public','private') AND c.relkind='r';

DO $test$
DECLARE driver uuid:=gen_random_uuid(); requester uuid:=gen_random_uuid(); guest uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 need uuid:=gen_random_uuid(); other_need uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid();
 proposal uuid; next_proposal uuid; other_proposal uuid; expired_proposal uuid;
 offer uuid:=gen_random_uuid(); next_offer uuid:=gen_random_uuid(); other_offer uuid:=gen_random_uuid();
 alignment uuid:=gen_random_uuid(); agreement uuid; old_proposal jsonb; label text; assignment text; opts jsonb;
 col text; role_name text; sig text; r jsonb; material_checks jsonb;
 replay_proposal uuid; replay_offer uuid:=gen_random_uuid(); materialized_snapshot jsonb;
BEGIN
 INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 SELECT x,'authenticated','authenticated',x::text||'@test-0021.invalid','{}','{}',now(),now()
 FROM unnest(ARRAY[driver,requester,guest,outsider]) x;
 INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number) VALUES(vehicle,'Lexus','Blue',4,'TEST-0021');
 INSERT INTO public.member_vehicle_access(member_id,vehicle_id) VALUES(driver,vehicle);
 INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,people_count)
 VALUES(need,requester,'A','B',now()+interval '1 day',2),(other_need,requester,'C','D',now()+interval '1 day',1);
 INSERT INTO public.movement_participants(movement_need_id,member_id,role,status)
 VALUES(need,guest,'invited_participant','confirmed');

 PERFORM pg_temp.proposal_check('proposal and roster are private',to_regclass('private.financial_proposals') IS NOT NULL AND to_regclass('private.financial_proposal_travellers') IS NOT NULL);
 FOR label,opts IN SELECT * FROM (VALUES
 ('missing roster rejected',jsonb_build_object('roster_limit',0)),
 ('incomplete roster rejected',jsonb_build_object('roster_limit',1)),
 ('wrong requester rejected',jsonb_build_object('member_needing_movement_id',outsider)),
 ('wrong offering member access rejected',jsonb_build_object('offering_member_id',outsider)),
 ('wrong origin snapshot rejected',jsonb_build_object('origin_area','different')),
 ('wrong count snapshot rejected',jsonb_build_object('people_count',1)),
 ('wrong capacity snapshot rejected',jsonb_build_object('vehicle_seat_capacity',3)),
 ('insufficient seats rejected',jsonb_build_object('seats_offered',1)),
 ('excess seats rejected',jsonb_build_object('seats_offered',5)),
 ('negative platform amount rejected',jsonb_build_object('quoted_platform_fee_total_minor',-1)),
 ('negative contribution rejected',jsonb_build_object('quoted_movement_contribution_minor',-1)),
 ('unsupported model rejected',jsonb_build_object('financial_model_version','other')),
 ('unsupported allocation rejected',jsonb_build_object('platform_fee_allocation_policy_version','other')),
 ('blank pricing identifier rejected',jsonb_build_object('pricing_policy_version','')),
 ('invalid currency rejected',jsonb_build_object('currency','ngn')),
 ('fake route evidence rejected',jsonb_build_object('route_evidence_id',gen_random_uuid())),
 ('inherited acceptance rejected',jsonb_build_object('offering_accepted_at',now())),
 ('initial superseded state rejected',jsonb_build_object('status','superseded')),
 ('past expiry rejected at insert',jsonb_build_object('expires_at',now()-interval '1 second')),
 ('future creation time rejected',jsonb_build_object('created_at',clock_timestamp()+interval '1 hour')),
 ('already expired proposal rejected',jsonb_build_object(
   'created_at',clock_timestamp()-interval '2 days','expires_at',clock_timestamp()-interval '1 day')),
 ('zero version rejected',jsonb_build_object('version',0))
 ) cases(name,overrides) LOOP
   PERFORM pg_temp.proposal_error(label,format('SELECT pg_temp.proposal_publish(%L,%L,%L,1,%L::jsonb)',need,driver,vehicle,opts));
 END LOOP;
 PERFORM pg_temp.proposal_error('unknown amount cannot be NULL',format('SELECT pg_temp.proposal_publish(%L,%L,%L,1,''{"quoted_platform_fee_total_minor":null}'')',need,driver,vehicle),'23502');
 PERFORM pg_temp.proposal_error('pending invitation prevents bindable snapshot',format(
   'INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES(%L,%L,''invited_participant'',''invited''); SELECT pg_temp.proposal_publish(%L,%L,%L)',need,outsider,need,driver,vehicle));
 proposal:=pg_temp.proposal_publish(need,driver,vehicle);
 other_proposal:=pg_temp.proposal_publish(other_need,driver,vehicle,1,'{"quoted_platform_fee_total_minor":0,"quoted_movement_contribution_minor":0}');
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.proposal_check('separate roster inserts form complete exact snapshot',
   (SELECT count(*)=2 AND bool_and(member_id IN (requester,guest)) FROM private.financial_proposal_travellers WHERE proposal_id=proposal));
 PERFORM pg_temp.proposal_check('economics remain independent',(SELECT quoted_platform_fee_total_minor=201 AND quoted_movement_contribution_minor=500 FROM private.financial_proposals WHERE id=proposal));
 PERFORM pg_temp.proposal_check('zero is an explicit known amount',(SELECT quoted_platform_fee_total_minor=0 AND quoted_movement_contribution_minor=0 FROM private.financial_proposals WHERE id=other_proposal));
 PERFORM pg_temp.proposal_check('missing route evidence is NULL',(SELECT route_evidence_id IS NULL FROM private.financial_proposals WHERE id=proposal));
 PERFORM pg_temp.proposal_error('duplicate proposal version rejected',format('SELECT pg_temp.proposal_publish(%L,%L,%L)',need,driver,vehicle),'23505');
 PERFORM pg_temp.proposal_error('two current versions rejected',format('SELECT pg_temp.proposal_publish(%L,%L,%L,2)',need,driver,vehicle),'23505');
 PERFORM pg_temp.proposal_error('unaccepted proposal deletion blocked',format('DELETE FROM private.financial_proposals WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('source need deletion cannot erase proposal',format('DELETE FROM public.movement_needs WHERE id=%L',need),'23503');
 FOR label,assignment IN SELECT * FROM (VALUES
 ('identity',format('id=%L',gen_random_uuid())),('need',format('movement_need_id=%L',other_need)),
 ('offering principal',format('offering_member_id=%L',outsider)),('requester principal',format('member_needing_movement_id=%L',outsider)),
 ('vehicle',format('vehicle_id=%L',gen_random_uuid())),('version','version=2'),
 ('platform amount','quoted_platform_fee_total_minor=202'),('contribution','quoted_movement_contribution_minor=501'),
 ('currency','currency=''USD'''),('model','financial_model_version=''other'''),('pricing policy','pricing_policy_version=''v2'''),
 ('allocation policy','platform_fee_allocation_policy_version=''other'''),('origin','origin_area=''new'''),('destination','destination_area=''new'''),
 ('departure','earliest_departure_at=earliest_departure_at+interval ''1 minute'''),('latest departure','latest_departure_at=earliest_departure_at'),
 ('people count','people_count=1'),('seats','seats_offered=3'),('capacity','vehicle_seat_capacity=5'),
 ('pickup','proposed_pickup_area=''new'''),('dropoff','proposed_dropoff_area=''new'''),('ETA','estimated_arrival_minutes=3'),
 ('route evidence',format('route_evidence_id=%L',gen_random_uuid())),('created time','created_at=created_at-interval ''1 day'''),
 ('expiry','expires_at=created_at+interval ''1 day''')
 ) cases(name,value) LOOP
  PERFORM pg_temp.proposal_error(label||' immutable',format('UPDATE private.financial_proposals SET %s WHERE id=%L',assignment,proposal));
 END LOOP;
 FOR label,assignment IN SELECT * FROM (VALUES
 ('roster member',format('member_id=%L',outsider)),('roster source identity',format('participant_id=%L',gen_random_uuid())),
 ('roster proposal',format('proposal_id=%L',other_proposal)),('roster role','role=''primary_requester''')
 ) cases(name,value) LOOP
  PERFORM pg_temp.proposal_error(label||' immutable',format('UPDATE private.financial_proposal_travellers SET %s WHERE proposal_id=%L AND member_id=%L',assignment,proposal,guest));
 END LOOP;
 PERFORM pg_temp.proposal_error('roster deletion blocked',format('DELETE FROM private.financial_proposal_travellers WHERE proposal_id=%L',proposal));
 PERFORM pg_temp.proposal_error('extra roster row rejected',format('INSERT INTO private.financial_proposal_travellers VALUES(%L,%L,%L,''invited_participant'')',proposal,outsider,gen_random_uuid()));

 -- Offers exist before financial consent is recorded. Offering consent and
 -- the exact offer binding must become valid together.
 INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered)
 VALUES(offer,need,driver,vehicle,2),(next_offer,need,driver,vehicle,2),(other_offer,other_need,driver,vehicle,1);

 PERFORM pg_temp.proposal_error('mismatched offer rejected',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   other_offer,proposal));
 PERFORM pg_temp.proposal_error('offering acceptance requires bound offer',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp() WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('offer binding requires offering acceptance',format(
   'UPDATE private.financial_proposals SET movement_offer_id=%L WHERE id=%L',offer,proposal));
 PERFORM pg_temp.proposal_error('requester cannot accept before offering member',format(
   'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L',proposal),
   '23514','new row for relation "financial_proposals" violates check constraint "financial_proposals_requester_consent_check"');
 PERFORM pg_temp.proposal_error('future offering consent rejected',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp()+interval ''1 hour'',movement_offer_id=%L WHERE id=%L',offer,proposal),
   '23514','Proposal evidence cannot be future-dated');
 PERFORM pg_temp.proposal_error('accepted offer cannot bind unmaterialized proposal',format(
   'UPDATE public.movement_offers SET status=''accepted'' WHERE id=%L; UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',offer,offer,proposal),
   '23514','Unmaterialized proposal requires a pending bound offer');

 -- Each source mutation is rolled back along with the refused offer+consent binding,
 -- so these failures prove stale context is the reason acceptance cannot persist.
 FOR label,assignment IN SELECT * FROM (VALUES
 ('origin change','origin_area=''changed'''),('destination change','destination_area=''changed'''),
 ('departure change','earliest_departure_at=earliest_departure_at+interval ''1 minute'''),
 ('declared count change','people_count=3'),('closed need','status=''closed''')
 ) cases(name,value) LOOP
  PERFORM pg_temp.proposal_error(label||' blocks stale acceptance',format(
    'UPDATE public.movement_needs SET %s WHERE id=%L; UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
    assignment,need,offer,proposal));
 END LOOP;
 PERFORM pg_temp.proposal_error('same-count roster replacement blocks stale acceptance',format(
   'UPDATE public.movement_participants SET status=''removed'' WHERE movement_need_id=%L AND member_id=%L; INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES(%L,%L,''invited_participant'',''confirmed''); UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   need,guest,need,outsider,offer,proposal));
 PERFORM pg_temp.proposal_error('capacity change blocks stale acceptance',format(
   'UPDATE public.vehicles SET seat_capacity=3 WHERE id=%L; UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   vehicle,offer,proposal));
 PERFORM pg_temp.proposal_error('lost access blocks stale acceptance',format(
   'UPDATE public.member_vehicle_access SET active=false WHERE member_id=%L AND vehicle_id=%L; UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   driver,vehicle,offer,proposal));

 UPDATE private.financial_proposals
 SET movement_offer_id=offer,offering_accepted_at=clock_timestamp()
 WHERE id=proposal;
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.proposal_check('offering acceptance records the exact pending offer only',
   (SELECT offering_accepted_at IS NOT NULL AND requester_accepted_at IS NULL
      AND movement_offer_id=offer FROM private.financial_proposals WHERE id=proposal));
 PERFORM pg_temp.proposal_error('requester acceptance requires same-transaction materialization',format(
   'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('supersession cannot hide queued requester acceptance',format(
   'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L; UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L',proposal,proposal),
   '23514','Requester acceptance must materialize in the same transaction');
 PERFORM pg_temp.proposal_error('future requester consent rejected',format(
   'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp()+interval ''1 hour'' WHERE id=%L',proposal),
   '23514','Proposal evidence cannot be future-dated');

 SELECT to_jsonb(p) INTO old_proposal FROM private.financial_proposals p WHERE id=proposal;
 UPDATE private.financial_proposals
 SET offering_accepted_at=offering_accepted_at,movement_offer_id=movement_offer_id
 WHERE id=proposal;
 PERFORM pg_temp.proposal_check('identical offering consent retry preserves evidence',
   (SELECT to_jsonb(p)=old_proposal FROM private.financial_proposals p WHERE id=proposal));
 PERFORM pg_temp.proposal_error('offering_accepted_at cannot clear',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=NULL WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('offering_accepted_at cannot rewrite',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=offering_accepted_at+interval ''1 second'' WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('offer cannot rebind',format(
   'UPDATE private.financial_proposals SET movement_offer_id=%L WHERE id=%L',next_offer,proposal));
 PERFORM pg_temp.proposal_error('offer cannot clear',format(
   'UPDATE private.financial_proposals SET movement_offer_id=NULL WHERE id=%L',proposal));

 SELECT to_jsonb(p) INTO old_proposal FROM private.financial_proposals p WHERE id=proposal;
 -- Source change must not prevent preservation/supersession of old history.
 UPDATE public.movement_needs SET origin_area='A revised' WHERE id=need;
 UPDATE private.financial_proposals SET status='superseded' WHERE id=proposal;
 next_proposal:=pg_temp.proposal_publish(need,driver,vehicle,2);
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.proposal_check('supersession preserves exact old snapshot and consent',
   (SELECT to_jsonb(p)-'status'=old_proposal-'status' FROM private.financial_proposals p WHERE id=proposal));
 PERFORM pg_temp.proposal_check('new current version starts unaccepted',
   (SELECT status='current' AND offering_accepted_at IS NULL AND requester_accepted_at IS NULL
      AND movement_offer_id IS NULL AND origin_area='A revised'
      FROM private.financial_proposals WHERE id=next_proposal));
 PERFORM pg_temp.proposal_error('superseded cannot reopen',format(
   'UPDATE private.financial_proposals SET status=''current'' WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('superseded history cannot delete',format(
   'DELETE FROM private.financial_proposals WHERE id=%L',proposal));
 PERFORM pg_temp.proposal_error('offer cannot belong to another proposal even after supersession',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   offer,next_proposal),'23505');

 UPDATE private.financial_proposals
 SET offering_accepted_at=clock_timestamp(),movement_offer_id=next_offer
 WHERE id=next_proposal;
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_temp.proposal_check('replacement proposal is offerer-accepted but not requester-accepted',
   (SELECT offering_accepted_at IS NOT NULL AND requester_accepted_at IS NULL
      AND movement_offer_id=next_offer FROM private.financial_proposals WHERE id=next_proposal));
 PERFORM pg_temp.proposal_error('replacement requester acceptance still requires materialization',format(
   'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L',next_proposal));

 -- An independent context demonstrates expiry and unaccepted historical rows.
 UPDATE private.financial_proposals SET status='superseded' WHERE id=other_proposal;
 expired_proposal:=pg_temp.proposal_publish(other_need,driver,vehicle,2,
   jsonb_build_object('expires_at',clock_timestamp()+interval '250 milliseconds'));
 SET CONSTRAINTS ALL IMMEDIATE;
 SET CONSTRAINTS ALL DEFERRED;
 PERFORM pg_sleep(0.35);
 PERFORM pg_temp.proposal_error('expired proposal cannot bind and gain offering acceptance',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   other_offer,expired_proposal));
 UPDATE private.financial_proposals SET status='superseded' WHERE id=expired_proposal;
 PERFORM pg_temp.proposal_error('unaccepted superseded cannot gain acceptance',format(
   'UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp(),movement_offer_id=%L WHERE id=%L',
   other_offer,expired_proposal));

 PERFORM pg_temp.proposal_check('proposal creation does not backfill alignments',(SELECT alignments FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM public.alignments a));
 PERFORM pg_temp.proposal_check('proposal creation does not materialize agreements',(SELECT agreements FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id)::text,'[]')) FROM private.financial_agreements g));
 -- Materialization fixture is itself rolled back, even on expected success.
 BEGIN
  -- Requester consent is deliberately recorded before the remaining writes only
  -- inside this one transaction. Deferred validation requires the final state to
  -- contain the accepted offer, alignment and matching 0020 agreement.
  UPDATE private.financial_proposals
  SET requester_accepted_at=clock_timestamp()
  WHERE id=next_proposal;
  INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,offering_member_id,member_needing_movement_id)
  VALUES(alignment,need,next_offer,driver,requester);
  agreement:=pg_temp.proposal_agreement(next_proposal,alignment);
  UPDATE private.financial_proposals
  SET alignment_id=alignment,financial_agreement_id=agreement,materialized_at=clock_timestamp()
  WHERE id=next_proposal;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  IF NOT EXISTS (
    SELECT 1 FROM private.financial_proposals p
    WHERE p.id=next_proposal AND p.requester_accepted_at IS NOT NULL
      AND p.alignment_id=alignment AND p.financial_agreement_id=agreement
  ) THEN
    RAISE EXCEPTION 'Materialization missing';
  END IF;

  -- These result rows are copied out before this whole fixture subtransaction
  -- is intentionally rolled back.
  PERFORM pg_temp.proposal_error('materialization alignment cannot clear',format(
    'UPDATE private.financial_proposals SET alignment_id=NULL WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization agreement cannot clear',format(
    'UPDATE private.financial_proposals SET financial_agreement_id=NULL WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization timestamp cannot clear',format(
    'UPDATE private.financial_proposals SET materialized_at=NULL WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization alignment cannot rewrite',format(
    'UPDATE private.financial_proposals SET alignment_id=%L WHERE id=%L',gen_random_uuid(),next_proposal));
  PERFORM pg_temp.proposal_error('materialization agreement cannot rewrite',format(
    'UPDATE private.financial_proposals SET financial_agreement_id=%L WHERE id=%L',gen_random_uuid(),next_proposal));
  PERFORM pg_temp.proposal_error('materialization timestamp cannot rewrite',format(
    'UPDATE private.financial_proposals SET materialized_at=materialized_at+interval ''1 second'' WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization offering acceptance cannot clear',format(
    'UPDATE private.financial_proposals SET offering_accepted_at=NULL WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization requester acceptance cannot clear',format(
    'UPDATE private.financial_proposals SET requester_accepted_at=NULL WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization offering acceptance cannot rewrite',format(
    'UPDATE private.financial_proposals SET offering_accepted_at=offering_accepted_at+interval ''1 second'' WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization requester acceptance cannot rewrite',format(
    'UPDATE private.financial_proposals SET requester_accepted_at=requester_accepted_at+interval ''1 second'' WHERE id=%L',next_proposal));
  PERFORM pg_temp.proposal_error('materialization cannot be superseded',format(
    'UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L',next_proposal));

  SELECT to_jsonb(p) INTO materialized_snapshot FROM private.financial_proposals p WHERE id=next_proposal;
  UPDATE private.financial_proposals
  SET alignment_id=alignment_id,
      financial_agreement_id=financial_agreement_id,
      materialized_at=materialized_at,
      offering_accepted_at=offering_accepted_at,
      requester_accepted_at=requester_accepted_at
  WHERE id=next_proposal;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.proposal_check('materialization identical retry is idempotent',
    (SELECT to_jsonb(p)=materialized_snapshot FROM private.financial_proposals p WHERE id=next_proposal));

  replay_proposal:=pg_temp.proposal_publish(other_need,driver,vehicle,3);
  INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered)
  VALUES(replay_offer,other_need,driver,vehicle,1);
  UPDATE private.financial_proposals
  SET offering_accepted_at=clock_timestamp(),movement_offer_id=replay_offer
  WHERE id=replay_proposal;
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.proposal_error('materialization duplicate links rejected',format(
    'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp(),alignment_id=%L,financial_agreement_id=%L,materialized_at=clock_timestamp() WHERE id=%L',
    alignment,agreement,replay_proposal),'23505');

  SELECT jsonb_object_agg(test_name,passed) INTO material_checks
  FROM pg_temp.proposal_test_results
  WHERE test_name LIKE 'materialization %';
  RAISE EXCEPTION USING ERRCODE='ZX021',MESSAGE='rollback valid materialization fixture';
 EXCEPTION WHEN SQLSTATE 'ZX021' THEN NULL;
 END;
 SET CONSTRAINTS ALL DEFERRED;
 FOR label,assignment IN SELECT key,value FROM jsonb_each_text(material_checks) LOOP
   PERFORM pg_temp.proposal_check(label,assignment::boolean);
 END LOOP;
 PERFORM pg_temp.proposal_check('trusted materialization validates and all links refuse clearing',
   (SELECT count(*)=13 AND bool_and(value::boolean) FROM jsonb_each_text(material_checks)));
 PERFORM pg_temp.proposal_error('partial materialization rejected',format(
   'UPDATE private.financial_proposals SET alignment_id=%L WHERE id=%L',alignment,next_proposal));
 PERFORM pg_temp.proposal_error('wrong contribution cannot materialize',format(
  'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L; INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,offering_member_id,member_needing_movement_id) VALUES(%L,%L,%L,%L,%L); UPDATE private.financial_proposals SET alignment_id=%L,financial_agreement_id=pg_temp.proposal_agreement(%L,%L,''{"contribution":501}''),materialized_at=clock_timestamp() WHERE id=%L',
  next_proposal,alignment,need,next_offer,driver,requester,alignment,next_proposal,alignment,next_proposal));
 PERFORM pg_temp.proposal_error('wrong currency cannot materialize',format(
  'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L; INSERT INTO public.alignments(id,movement_need_id,movement_offer_id,offering_member_id,member_needing_movement_id) VALUES(%L,%L,%L,%L,%L); UPDATE private.financial_proposals SET alignment_id=%L,financial_agreement_id=pg_temp.proposal_agreement(%L,%L,''{"currency":"USD"}''),materialized_at=clock_timestamp() WHERE id=%L',
  next_proposal,alignment,need,next_offer,driver,requester,alignment,next_proposal,alignment,next_proposal));

 FOREACH col IN ARRAY ARRAY['financial_proposals','financial_proposal_travellers'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
   PERFORM pg_temp.proposal_denied(role_name||' cannot read '||col,role_name,requester,'SELECT * FROM private.'||col);
  END LOOP;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   PERFORM pg_temp.proposal_check(role_name||' has no mutations on '||col,
    NOT has_table_privilege(role_name,'private.'||col,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
  END LOOP;
  r:=pg_temp.proposal_as('service_role',NULL,'SELECT count(*) FROM private.'||col);
  PERFORM pg_temp.proposal_check('service SELECT works on '||col,r->>'ok'='true');
  PERFORM pg_temp.proposal_check('PUBLIC no ACL and RLS enabled without policies on '||col,(SELECT c.relrowsecurity AND NOT EXISTS (
    SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=0)
    AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid=c.oid)
    FROM pg_class c WHERE c.oid=to_regclass('private.'||col)));
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['assert_financial_proposal_context(uuid)','protect_financial_proposal()',
   'protect_financial_proposal_traveller()','validate_financial_proposal()'] LOOP
  PERFORM pg_temp.proposal_check('helper restricted and isolated '||sig,
    NOT has_function_privilege('anon','private.'||sig,'EXECUTE')
    AND NOT has_function_privilege('authenticated','private.'||sig,'EXECUTE')
    AND NOT has_function_privilege('service_role','private.'||sig,'EXECUTE')
    AND (SELECT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND NOT EXISTS (
      SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0)
      FROM pg_proc p WHERE p.oid=to_regprocedure('private.'||sig)));
 END LOOP;
END;
$test$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.proposal_check('legacy financial and alignment rows unchanged',
 (SELECT alignments FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id)::text,'[]')) FROM public.alignments a)
 AND (SELECT agreements FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.id)::text,'[]')) FROM private.financial_agreements g)
 AND (SELECT components FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text,'[]')) FROM private.financial_components c)
 AND (SELECT payments FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text,'[]')) FROM private.alignment_activation_payments p)
 AND (SELECT settlements FROM pg_temp.proposal_legacy_snapshot)=(SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text,'[]')) FROM private.movement_settlements s));
SELECT pg_temp.proposal_check('existing function definitions and grants unchanged by test',NOT EXISTS (
 SELECT 1 FROM pg_temp.proposal_function_snapshot s LEFT JOIN pg_proc p ON p.oid=s.oid
 WHERE p.oid IS NULL OR s.definition_hash<>pg_catalog.md5(pg_get_functiondef(p.oid)) OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text));
SELECT pg_temp.proposal_check('existing table ACL and RLS unchanged by test',NOT EXISTS (
 SELECT 1 FROM pg_temp.proposal_table_snapshot s LEFT JOIN pg_class c ON c.oid=s.oid
 WHERE c.oid IS NULL OR s.acl IS DISTINCT FROM c.relacl::text OR s.relrowsecurity<>c.relrowsecurity OR s.relforcerowsecurity<>c.relforcerowsecurity));
SELECT test_name,passed FROM pg_temp.proposal_test_results ORDER BY check_number;
ROLLBACK;
