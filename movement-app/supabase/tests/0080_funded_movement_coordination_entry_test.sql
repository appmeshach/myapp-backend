BEGIN;
CREATE FUNCTION pg_temp.coordination_result(p_member uuid DEFAULT NULL,p_role text DEFAULT 'authenticated',p_missing boolean DEFAULT false,p_need uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; BEGIN SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 RETURN pg_temp.snapshot_select_as(p_role,CASE WHEN p_missing THEN NULL ELSE coalesce(p_member,f.requester) END,
  format('SELECT * FROM public.open_my_funded_movement_coordination(%L::uuid)',coalesce(p_need,f.need)));
END $$;
CREATE FUNCTION pg_temp.coordination_as(p_member uuid,p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RETURN pg_temp.snapshot_select_as('authenticated',p_member,p_sql); END $$;
CREATE FUNCTION pg_temp.direct_lifecycle(p_journey uuid) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN UPDATE public.journeys SET status='in_progress' WHERE id=p_journey; RETURN true; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.direct_lifecycle(uuid) TO service_role;
CREATE FUNCTION pg_temp.coordination_other_sources() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; h text; result text:='';
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')
   AND (n.nspname,c.relname) NOT IN (('public','journeys'),('private','funded_movement_coordination_entries'))
  ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',r.nspname,r.relname) INTO h;
  result:=result||r.nspname||'.'||r.relname||':'||h;
 END LOOP;
 RETURN md5(result);
END $$;
-- COORDINATION_0080_TESTS:
DO $tests$
DECLARE f record; g private.financial_agreements%ROWTYPE; r jsonb; retry jsonb; before text;
 ledgers jsonb; others text; required bigint; actor uuid; j uuid; stamp timestamptz; sql text; key text; state text;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 before:=pg_temp.materialization_sources();r:=pg_temp.coordination_result();
 PERFORM pg_temp.snapshot_check('unfunded nonactivated cannot construct',r->>'state'='23514' AND before=pg_temp.materialization_sources());
 FOREACH actor IN ARRAY ARRAY[f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.coordination_result(actor);PERFORM pg_temp.snapshot_check('nonprincipal denied '||actor,r->>'state'='42501'); END LOOP;
 FOREACH state IN ARRAY ARRAY['anon','service_role'] LOOP
  r:=pg_temp.coordination_result(NULL,state);PERFORM pg_temp.snapshot_check(state||' denied',r->>'state'='42501'); END LOOP;
 r:=pg_temp.coordination_result(NULL,'authenticated',true);PERFORM pg_temp.snapshot_check('missing identity denied',r->>'state'='42501');
 r:=pg_temp.coordination_result(NULL,'authenticated',false,gen_random_uuid());PERFORM pg_temp.snapshot_check('unknown movement denied',r->>'state'='42501');
 PERFORM pg_temp.prepare_activation_faces();
 SELECT sum(amount_minor::numeric)::bigint INTO required FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution');
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 PERFORM public.record_wallet_top_up_for_server(f.requester,required+100,'NGN','test-0080','fund-'||gen_random_uuid());
 PERFORM pg_temp.funding_succeed(pg_temp.hold_result());
 r:=pg_temp.coordination_result();PERFORM pg_temp.snapshot_check('funding and faces without activation cannot construct',r->>'state'='23514');
 PERFORM pg_temp.funding_succeed(pg_temp.activation_result());
 PERFORM pg_temp.snapshot_check('activation remains explicit no automatic journey',(SELECT count(*) FROM public.journeys WHERE alignment_id=g.alignment_id)=0);
 before:=pg_temp.materialization_sources();
 r:=pg_temp.coordination_as(f.requester,format('SELECT * FROM public.get_my_funded_movement_coordination_readiness(%L)',f.need));PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('requester readiness read only no construction',r#>>'{rows,0,funded_activated}'='true' AND before=pg_temp.materialization_sources());
 r:=pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.get_my_funded_movement_coordination_readiness(%L)',f.need));PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('offerer readiness read only no construction',r#>>'{rows,0,funded_activated}'='true' AND before=pg_temp.materialization_sources());
 r:=pg_temp.coordination_as(f.requester,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',f.need));
 PERFORM pg_temp.snapshot_check('activated without entry no coordination',r->>'ok'='true' AND jsonb_array_length(r->'rows')=0);
 PERFORM pg_temp.probe('direct unproven journey denied',format('INSERT INTO public.journeys(alignment_id,vehicle_id) SELECT %L,vehicle_id FROM public.movement_offers WHERE id=%L',g.alignment_id,f.movement_offer),'23514','provenance');
 PERFORM pg_temp.probe('rolled back constructor leaves no graph','SELECT pg_temp.funding_succeed(pg_temp.coordination_result())');
 PERFORM pg_temp.snapshot_check('rollback construction absent',(SELECT count(*) FROM public.journeys WHERE alignment_id=g.alignment_id)=0 AND (SELECT count(*) FROM private.funded_movement_coordination_entries WHERE alignment_id=g.alignment_id)=0);
 PERFORM pg_temp.probe('partial receipt cannot be repaired',format('SET CONSTRAINTS private.funded_coordination_entry_journey_fk DEFERRED; INSERT INTO private.funded_movement_coordination_entries VALUES(%L,%L,gen_random_uuid(),clock_timestamp()); SELECT pg_temp.consent_rejected(pg_temp.coordination_result(),''23514'')',g.id,g.alignment_id));
 PERFORM pg_temp.probe('offerer can construct genuine entry',format('SELECT pg_temp.funding_succeed(pg_temp.coordination_result(%L))',f.offerer));
 ledgers:=jsonb_build_object('transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t));
 others:=pg_temp.coordination_other_sources();r:=pg_temp.coordination_result();PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('only journey receipt changed across every application table',others=pg_temp.coordination_other_sources());
 SELECT id,created_at INTO STRICT j,stamp FROM public.journeys WHERE alignment_id=g.alignment_id;
 PERFORM pg_temp.snapshot_check('minimal exact safe response',r->'rows'=jsonb_build_array(jsonb_build_object('movement_need_id',f.need,'journey_state','not_started','coordination_ready',true)));
 PERFORM pg_temp.snapshot_check('one exact receipt',(SELECT count(*) FROM private.funded_movement_coordination_entries WHERE alignment_id=g.alignment_id AND journey_id=j AND financial_agreement_id=g.id AND created_at=stamp)=1);
 PERFORM pg_temp.snapshot_check('exact accepted historical vehicle',(SELECT vehicle_id=(SELECT vehicle_id FROM public.movement_offers WHERE id=f.movement_offer) FROM public.journeys WHERE id=j));
 PERFORM pg_temp.snapshot_check('all lifecycle fields empty',(SELECT status='not_started' AND start_requested_at IS NULL AND started_at IS NULL AND completion_requested_at IS NULL AND completed_at IS NULL AND end_requested_at IS NULL AND end_confirmed_at IS NULL AND end_requested_by_member_id IS NULL AND end_confirmed_by_member_id IS NULL AND end_method IS NULL AND end_reason IS NULL FROM public.journeys WHERE id=j));
 PERFORM pg_temp.snapshot_check('trusted postactivation creation',(SELECT x.created_at>=a.activated_at FROM public.journeys x JOIN public.alignments a ON a.id=x.alignment_id WHERE x.id=j));
 PERFORM pg_temp.snapshot_check('no wallet funding writes',ledgers=jsonb_build_object('transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t)));
 PERFORM pg_temp.snapshot_check('no legacy payment or settlement',(SELECT count(*) FROM private.alignment_activation_payments WHERE alignment_id=g.alignment_id)=0 AND (SELECT count(*) FROM private.movement_settlements WHERE alignment_id=g.alignment_id)=0);
 FOREACH actor IN ARRAY ARRAY[f.requester,f.offerer] LOOP
  before:=pg_temp.materialization_sources();retry:=pg_temp.coordination_result(actor);PERFORM pg_temp.funding_succeed(retry);
  PERFORM pg_temp.snapshot_check('principal replay identical zero writes '||actor,r->'rows'=retry->'rows' AND before=pg_temp.materialization_sources());
 END LOOP;
 r:=pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Main entrance'',NULL)',f.need));PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('meeting point human text edit no start authority',r#>>'{rows,0,meeting_point_text}'='Main entrance' AND r#>>'{rows,0,can_request_start}'='false' AND r#>>'{rows,0,can_confirm_start}'='false');
 r:=pg_temp.coordination_as(f.requester,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Station entrance'',1)',f.need));PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('requester meeting point revision',r#>>'{rows,0,meeting_point_revision}'='2');
 r:=pg_temp.coordination_as(f.traveller,format('SELECT * FROM public.get_my_movement_coordination_status(%L)',f.need));
 IF EXISTS(SELECT 1 FROM public.movement_participants WHERE movement_need_id=f.need AND member_id=f.traveller AND status='confirmed') THEN
  PERFORM pg_temp.funding_succeed(r);
  PERFORM pg_temp.snapshot_check('invited read but no principal controls',r#>>'{rows,0,can_edit_meeting_point}'='false' AND r#>>'{rows,0,can_request_start}'='false' AND r#>>'{rows,0,can_confirm_start}'='false');
 ELSE
  PERFORM pg_temp.snapshot_check('absent invited traveller sees no coordination',r->>'ok'='true' AND jsonb_array_length(r->'rows')=0);
 END IF;
 r:=pg_temp.coordination_as(f.traveller,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Forbidden'',2)',f.need));PERFORM pg_temp.snapshot_check('invited cannot mutate meeting point',r->>'state'='42501');
 r:=pg_temp.coordination_as(gen_random_uuid(),format('SELECT * FROM public.get_my_movement_coordination_status(%L)',f.need));PERFORM pg_temp.snapshot_check('unrelated coordination hidden',r->>'ok'='true' AND jsonb_array_length(r->'rows')=0);
 FOREACH key IN ARRAY ARRAY['request_journey_start','confirm_journey_start','request_journey_completion','confirm_journey_completion','request_movement_end','confirm_movement_end','decline_movement_end'] LOOP
  sql:=format('SELECT * FROM public.%I(%L)',key,j);
  r:=pg_temp.snapshot_select_as('service_role',f.offerer,sql);
  PERFORM pg_temp.snapshot_check('service legacy lifecycle denied '||key,r->>'state'='23514');
 END LOOP;
 FOREACH key IN ARRAY ARRAY['request_my_movement_start','confirm_my_movement_start','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end'] LOOP
  r:=pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.%I(%L)',key,f.need));
  PERFORM pg_temp.snapshot_check('current lifecycle denied '||key,r->>'state'='23514');
 END LOOP;
 FOREACH state IN ARRAY ARRAY['in_progress','completed','cancelled','failed'] LOOP
  PERFORM pg_temp.probe('direct journey transition denied '||state,format('UPDATE public.journeys SET status=%L WHERE id=%L',state,j),'23514');
  PERFORM pg_temp.probe('direct alignment transition denied '||state,format('UPDATE public.alignments SET status=%L WHERE id=%L',state,g.alignment_id),'23514');
 END LOOP;
 PERFORM pg_temp.probe('direct start request denied',format('UPDATE public.journeys SET start_requested_at=clock_timestamp() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('direct end request denied',format('UPDATE public.journeys SET end_requested_at=clock_timestamp() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('direct vehicle rebind denied',format('UPDATE public.journeys SET vehicle_id=gen_random_uuid() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('receipt append only',format('DELETE FROM private.funded_movement_coordination_entries WHERE journey_id=%L',j),'23514','append-only');
 PERFORM pg_temp.probe('journey cannot delete',format('DELETE FROM public.journeys WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('legacy settlement direct denied',format('INSERT INTO private.movement_settlements(alignment_id,journey_id,beneficiary_member_id,status) VALUES(%L,%L,%L,''pending_amount'')',g.alignment_id,j,f.offerer),'23514','legacy settlement');
 PERFORM pg_temp.probe('wrong accepted vehicle fails replay',format('UPDATE public.movement_offers SET vehicle_id=gen_random_uuid() WHERE id=%L',f.movement_offer),'23514','immutable');
 PERFORM pg_temp.probe('malformed activation fails replay',format('UPDATE private.alignment_face_verifications SET face_match_passed=false,status=''failed'' WHERE alignment_id=%L; SELECT pg_temp.consent_rejected(pg_temp.coordination_result(),''23514'')',g.alignment_id));
 r:=pg_temp.coordination_as(f.requester,'SELECT * FROM public.list_my_active_movement_continuations()');
 PERFORM pg_temp.snapshot_check('not started excluded active recovery',r->>'ok'='true' AND jsonb_array_length(r->'rows')=0);
 PERFORM pg_temp.snapshot_check('receipt no API grants',NOT has_table_privilege('authenticated','private.funded_movement_coordination_entries','INSERT') AND NOT has_table_privilege('service_role','private.funded_movement_coordination_entries','INSERT'));
 PERFORM pg_temp.probe('duplicate receipt history rejected',format('INSERT INTO private.funded_movement_coordination_entries VALUES(%L,%L,%L,%L)',g.id,g.alignment_id,j,stamp),'23505');
 r:=pg_temp.snapshot_select_as('service_role',f.offerer,format('SELECT pg_temp.direct_lifecycle(%L)',j));
 PERFORM pg_temp.snapshot_check('direct service writer no lifecycle bypass',r->>'state'='23514');
END;
$tests$;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION '0080 behavioral failures'; END IF; END $$;
ROLLBACK;
