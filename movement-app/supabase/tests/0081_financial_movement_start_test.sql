BEGIN;
CREATE FUNCTION pg_temp.start_result(p_confirm boolean DEFAULT false,p_member uuid DEFAULT NULL,p_role text DEFAULT 'authenticated',p_missing boolean DEFAULT false,p_need uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; BEGIN SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 RETURN pg_temp.snapshot_select_as(p_role,CASE WHEN p_missing THEN NULL ELSE coalesce(p_member,CASE WHEN p_confirm THEN f.requester ELSE f.offerer END) END,
  format('SELECT * FROM public.%I(%L::uuid)',CASE WHEN p_confirm THEN 'confirm_my_funded_movement_start' ELSE 'request_my_funded_movement_start' END,coalesce(p_need,f.need)));
END $$;
CREATE FUNCTION pg_temp.start_other_sources() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; h text; result text:='';
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')
   AND (n.nspname,c.relname) NOT IN (('public','journeys'),('public','alignments'),('private','funded_movement_start_requests'),('private','funded_movement_starts'))
  ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',r.nspname,r.relname) INTO h;
  result:=result||r.nspname||'.'||r.relname||':'||h;
 END LOOP;
 RETURN md5(result);
END $$;
-- START_0081_TESTS:
DO $tests$
DECLARE f record; g private.financial_agreements%ROWTYPE; r jsonb; retry jsonb; before text; others text;
 required bigint; actor uuid; j uuid; requested timestamptz; started timestamptz; sql text; key text; state text;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 r:=pg_temp.start_result();PERFORM pg_temp.snapshot_check('unfunded nonactivated denied',r->>'state'='23514');
 FOREACH actor IN ARRAY ARRAY[f.requester,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.start_result(false,actor);PERFORM pg_temp.snapshot_check('nonofferer preactivation denied '||actor,r->>'ok'='false'); END LOOP;
 FOREACH state IN ARRAY ARRAY['anon','service_role'] LOOP
  r:=pg_temp.start_result(false,NULL,state);PERFORM pg_temp.snapshot_check(state||' request denied',r->>'state'='42501');
  r:=pg_temp.start_result(true,NULL,state);PERFORM pg_temp.snapshot_check(state||' confirm denied',r->>'state'='42501'); END LOOP;
 r:=pg_temp.start_result(false,NULL,'authenticated',true);PERFORM pg_temp.snapshot_check('missing identity denied',r->>'state'='42501');
 r:=pg_temp.start_result(false,NULL,'authenticated',false,gen_random_uuid());PERFORM pg_temp.snapshot_check('unknown need denied',r->>'state'='42501');
 PERFORM pg_temp.prepare_activation_faces();
 SELECT sum(amount_minor::numeric)::bigint INTO required FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution');
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 PERFORM public.record_wallet_top_up_for_server(f.requester,required+100,'NGN','test-0081','fund-'||gen_random_uuid());
 PERFORM pg_temp.funding_succeed(pg_temp.hold_result());
 r:=pg_temp.start_result();PERFORM pg_temp.snapshot_check('held without activation denied',r->>'state'='23514');
 PERFORM pg_temp.funding_succeed(pg_temp.activation_result());
 r:=pg_temp.start_result();PERFORM pg_temp.snapshot_check('activation without coordination denied',r->>'state'='23514');
 PERFORM pg_temp.funding_succeed(pg_temp.coordination_result());
 SELECT id INTO STRICT j FROM public.journeys WHERE alignment_id=g.alignment_id;
 r:=pg_temp.start_result();PERFORM pg_temp.snapshot_check('no meeting point denied',r->>'state'='23514');
 r:=pg_temp.start_result(true);PERFORM pg_temp.snapshot_check('premature requester confirmation denied',r->>'state'='23514');
 FOREACH actor IN ARRAY ARRAY[f.requester,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.start_result(false,actor);PERFORM pg_temp.snapshot_check('request exact offerer '||actor,r->>'state'='42501'); END LOOP;
 FOREACH actor IN ARRAY ARRAY[f.offerer,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.start_result(true,actor);PERFORM pg_temp.snapshot_check('confirm exact requester '||actor,r->>'state'='42501'); END LOOP;
 r:=pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Station entrance'',NULL)',f.need));PERFORM pg_temp.funding_succeed(r);
 r:=pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.get_my_movement_start_status(%L)',f.need));PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('backend funded request capability',r#>>'{rows,0,start_authority}'='funded' AND r#>>'{rows,0,can_request_start}'='true' AND r#>>'{rows,0,can_confirm_start}'='false');
 r:=pg_temp.coordination_as(f.requester,'SELECT * FROM public.list_my_active_movement_continuations()');
 PERFORM pg_temp.snapshot_check('not started excluded active recovery',r->>'ok'='true' AND jsonb_array_length(r->'rows')=0);
 PERFORM pg_temp.probe('rollback request then retry','SELECT pg_temp.funding_succeed(pg_temp.start_result())');
 PERFORM pg_temp.snapshot_check('rollback no request',(SELECT start_requested_at IS NULL FROM public.journeys WHERE id=j) AND NOT EXISTS(SELECT 1 FROM private.funded_movement_start_requests WHERE journey_id=j));
 PERFORM pg_temp.probe('partial request fails closed',format('SET CONSTRAINTS private.funded_start_request_complete DEFERRED; SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_start_requests VALUES(%L,%L,clock_timestamp(),1); SELECT pg_temp.consent_rejected(pg_temp.start_result(),''23514'')',f.offerer,g.alignment_id,j));
 PERFORM pg_temp.probe('arbitrary unproven first request rejected',format('UPDATE public.journeys SET start_requested_at=clock_timestamp() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('arbitrary unproven first start rejected',format('UPDATE public.journeys SET status=''in_progress'',started_at=clock_timestamp() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('arbitrary unproven alignment start rejected',format('UPDATE public.alignments SET status=''in_progress'' WHERE id=%L',g.alignment_id),'23514');
 PERFORM pg_temp.probe('request completeness enforced immediately',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_start_requests VALUES(%L,%L,clock_timestamp(),1)',f.offerer,g.alignment_id,j),'23514');
 others:=pg_temp.start_other_sources();r:=pg_temp.start_result();PERFORM pg_temp.funding_succeed(r);
 SELECT start_requested_at INTO requested FROM public.journeys WHERE id=j;
 PERFORM pg_temp.snapshot_check('request exact single immutable provenance',(SELECT count(*) FROM private.funded_movement_start_requests WHERE journey_id=j AND alignment_id=g.alignment_id AND requested_at=requested AND meeting_point_revision=1)=1);
 PERFORM pg_temp.snapshot_check('request freezes controls not started',r#>>'{rows,0,journey_state}'='not_started' AND r#>>'{rows,0,can_edit_meeting_point}'='false' AND r#>>'{rows,0,can_request_start}'='false' AND r#>>'{rows,0,started_at}' IS NULL);
 PERFORM pg_temp.snapshot_check('request keeps alignment activated',(SELECT status='activated' FROM public.alignments WHERE id=g.alignment_id));
 PERFORM pg_temp.snapshot_check('request no other side effects across every table',others=pg_temp.start_other_sources());
 before:=pg_temp.materialization_sources();retry:=pg_temp.start_result();PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.snapshot_check('request replay exact zero writes',r=retry AND before=pg_temp.materialization_sources());
 r:=pg_temp.coordination_as(f.requester,format('SELECT * FROM public.get_my_movement_start_status(%L)',f.need));PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('only requester confirm capability',r#>>'{rows,0,can_confirm_start}'='true' AND r#>>'{rows,0,can_request_start}'='false');
 r:=pg_temp.coordination_as(f.requester,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''Forbidden'',1)',f.need));PERFORM pg_temp.snapshot_check('normal meeting edit frozen',r->>'state'='42501');
 PERFORM pg_temp.probe('trusted meeting edit frozen',format('UPDATE private.journey_meeting_points SET place_text=''Forbidden'',revision=2 WHERE journey_id=%L',j),'23514');
 PERFORM pg_temp.probe('trusted meeting delete frozen',format('DELETE FROM private.journey_meeting_points WHERE journey_id=%L',j),'23514');
 PERFORM pg_temp.probe('rollback confirm then retry','SELECT pg_temp.funding_succeed(pg_temp.start_result(true))');
 PERFORM pg_temp.snapshot_check('rollback no start',(SELECT status='not_started' AND started_at IS NULL FROM public.journeys WHERE id=j) AND NOT EXISTS(SELECT 1 FROM private.funded_movement_starts WHERE journey_id=j));
 PERFORM pg_temp.probe('partial confirmation fails closed',format('SET CONSTRAINTS private.funded_start_complete DEFERRED; SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_starts VALUES(%L,%L,clock_timestamp()); SELECT pg_temp.consent_rejected(pg_temp.start_result(true),''23514'')',f.requester,g.alignment_id,j));
 PERFORM pg_temp.probe('unproven start after request rejected',format('UPDATE public.journeys SET status=''in_progress'',started_at=clock_timestamp() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('confirmation completeness enforced immediately',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_starts VALUES(%L,%L,clock_timestamp())',f.requester,g.alignment_id,j),'23514');
 others:=pg_temp.start_other_sources();r:=pg_temp.start_result(true);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Confirmation failed %; graph %',r,jsonb_build_object(
   'clock',clock_timestamp(),'isolation',current_setting('transaction_isolation'),
   'journey',(SELECT to_jsonb(x) FROM public.journeys x WHERE id=j),
   'alignment',(SELECT to_jsonb(x) FROM public.alignments x WHERE id=g.alignment_id),
   'request',(SELECT to_jsonb(x) FROM private.funded_movement_start_requests x WHERE alignment_id=g.alignment_id),
   'start',(SELECT to_jsonb(x) FROM private.funded_movement_starts x WHERE alignment_id=g.alignment_id),
   'meeting_point',(SELECT to_jsonb(x) FROM private.journey_meeting_points x WHERE journey_id=j),
   'constraint_mode','Runtime SET CONSTRAINTS mode is not exposed by PostgreSQL catalogs; failed RPC subtransaction has rolled back');
 END IF;
 PERFORM pg_temp.funding_succeed(r);
 SELECT started_at INTO STRICT started FROM public.journeys WHERE id=j;
 PERFORM pg_temp.snapshot_check('atomic journey alignment in progress',(SELECT status='in_progress' AND start_requested_at=requested FROM public.journeys WHERE id=j) AND (SELECT status='in_progress' FROM public.alignments WHERE id=g.alignment_id));
 PERFORM pg_temp.snapshot_check('one authoritative exact started instant',(SELECT count(*) FROM private.funded_movement_starts WHERE alignment_id=g.alignment_id AND journey_id=j AND started_at=started)=1 AND started>=requested);
 PERFORM pg_temp.snapshot_check('confirmation no other side effects across every table',others=pg_temp.start_other_sources());
 PERFORM pg_temp.snapshot_check('started projection controls off',r#>>'{rows,0,journey_state}'='in_progress' AND r#>>'{rows,0,can_edit_meeting_point}'='false' AND r#>>'{rows,0,can_request_start}'='false' AND r#>>'{rows,0,can_confirm_start}'='false');
 before:=pg_temp.materialization_sources();retry:=pg_temp.start_result(true);PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.snapshot_check('confirm replay exact zero writes',r=retry AND before=pg_temp.materialization_sources());
 retry:=pg_temp.start_result();PERFORM pg_temp.funding_succeed(retry);PERFORM pg_temp.snapshot_check('request after start historical zero writes',retry->'rows'=r->'rows' AND before=pg_temp.materialization_sources());
 retry:=pg_temp.coordination_result();PERFORM pg_temp.funding_succeed(retry);PERFORM pg_temp.snapshot_check('entry replay after start same graph zero writes',retry#>>'{rows,0,journey_state}'='in_progress' AND before=pg_temp.materialization_sources());
 -- 0020 explicitly allows consent-preserving agreement supersession.
 PERFORM pg_temp.probe('superseded agreement historical replay',format('UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L; SET CONSTRAINTS ALL IMMEDIATE; SELECT pg_temp.funding_succeed(pg_temp.start_result(true))',g.id));
 FOREACH state IN ARRAY ARRAY['not_started','completed','cancelled','failed'] LOOP
  PERFORM pg_temp.probe('direct journey transition denied '||state,format('UPDATE public.journeys SET status=%L WHERE id=%L',state,j),'23514');
  PERFORM pg_temp.probe('direct alignment transition denied '||state,format('UPDATE public.alignments SET status=%L WHERE id=%L',state,g.alignment_id),'23514'); END LOOP;
 FOREACH key IN ARRAY ARRAY['start_requested_at','started_at','completed_at','completion_requested_at','end_requested_at','end_confirmed_at','created_at'] LOOP
  PERFORM pg_temp.probe('direct timestamp rewrite denied '||key,format('UPDATE public.journeys SET %I=clock_timestamp() WHERE id=%L',key,j),'23514'); END LOOP;
 PERFORM pg_temp.probe('duplicate request receipt impossible',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_start_requests VALUES(%L,%L,%L,1)',f.offerer,g.alignment_id,j,requested),'23514');
 PERFORM pg_temp.probe('duplicate confirmation receipt impossible',format('SELECT set_config(''request.jwt.claim.sub'',%L,true); INSERT INTO private.funded_movement_starts VALUES(%L,%L,%L)',f.requester,g.alignment_id,j,started),'23514');
 PERFORM pg_temp.probe('activation timestamp immutable',format('UPDATE public.alignments SET activated_at=clock_timestamp() WHERE id=%L',g.alignment_id),'23514');
 PERFORM pg_temp.probe('vehicle binding immutable',format('UPDATE public.journeys SET vehicle_id=gen_random_uuid() WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('journey deletion denied',format('DELETE FROM public.journeys WHERE id=%L',j),'23514');
 PERFORM pg_temp.probe('offer withdrawal denied',format('UPDATE public.movement_offers SET status=''withdrawn'' WHERE id=%L',f.movement_offer),'23514');
 FOREACH key IN ARRAY ARRAY['funded_movement_start_requests','funded_movement_starts'] LOOP
  PERFORM pg_temp.probe('receipt append only '||key,format('DELETE FROM private.%I WHERE journey_id=%L',key,j),'23514');
  PERFORM pg_temp.snapshot_check('receipt RLS no API grants '||key,(SELECT relrowsecurity FROM pg_class WHERE oid=('private.'||key)::regclass) AND NOT has_table_privilege('authenticated','private.'||key,'INSERT') AND NOT has_table_privilege('service_role','private.'||key,'INSERT'));
 END LOOP;
 FOREACH key IN ARRAY ARRAY['request_journey_start','confirm_journey_start','request_journey_completion','confirm_journey_completion','request_movement_end','confirm_movement_end','decline_movement_end'] LOOP
  retry:=pg_temp.snapshot_select_as('service_role',f.offerer,format('SELECT * FROM public.%I(%L)',key,j));PERFORM pg_temp.snapshot_check('legacy lifecycle financial blocked '||key,retry->>'state'='23514'); END LOOP;
 FOREACH key IN ARRAY ARRAY['request_my_movement_start','confirm_my_movement_start','request_my_movement_end','confirm_my_movement_end','decline_my_movement_end'] LOOP
  retry:=pg_temp.coordination_as(f.offerer,format('SELECT * FROM public.%I(%L)',key,f.need));PERFORM pg_temp.snapshot_check('old need wrapper financial blocked '||key,retry->>'state'='23514'); END LOOP;
 PERFORM pg_temp.probe('legacy settlement denied',format('INSERT INTO private.movement_settlements(alignment_id,journey_id,beneficiary_member_id,status) VALUES(%L,%L,%L,''pending_amount'')',g.alignment_id,j,f.offerer),'23514');
 before:=pg_temp.materialization_sources();
 FOREACH actor IN ARRAY ARRAY[f.requester,f.offerer] LOOP
  retry:=pg_temp.coordination_as(actor,'SELECT * FROM public.list_my_active_movement_continuations()');
  PERFORM pg_temp.snapshot_check('genuine active recovery '||actor,retry->>'ok'='true' AND EXISTS(SELECT 1 FROM jsonb_array_elements(retry->'rows') x WHERE x->>'movement_need_id'=f.need::text)); END LOOP;
 retry:=pg_temp.coordination_as(gen_random_uuid(),'SELECT * FROM public.list_my_active_movement_continuations()');
 PERFORM pg_temp.snapshot_check('unrelated active recovery denied',retry->>'state'='42501');
 PERFORM pg_temp.snapshot_check('recovery reads no writes',before=pg_temp.materialization_sources());
 IF EXISTS(SELECT 1 FROM public.movement_participants WHERE movement_need_id=f.need AND member_id=f.traveller AND status='confirmed') THEN
  retry:=pg_temp.coordination_as(f.traveller,format('SELECT * FROM public.get_my_movement_start_status(%L)',f.need));PERFORM pg_temp.funding_succeed(retry);
  PERFORM pg_temp.snapshot_check('invited readonly start projection',retry#>>'{rows,0,can_request_start}'='false' AND retry#>>'{rows,0,can_confirm_start}'='false'); END IF;
 PERFORM pg_temp.probe('malformed activation replay fails closed',format('UPDATE private.alignment_face_verifications SET face_match_passed=false,status=''failed'' WHERE alignment_id=%L; SELECT pg_temp.consent_rejected(pg_temp.start_result(true),''23514'')',g.alignment_id));
END;
$tests$;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION '0081 behavioral failures'; END IF; END $$;
ROLLBACK;
