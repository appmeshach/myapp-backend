BEGIN;
CREATE FUNCTION pg_temp.hold_result(p_overrides jsonb DEFAULT '{}',p_member uuid DEFAULT NULL,p_role text DEFAULT 'authenticated',p_missing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; g private.financial_agreements%ROWTYPE; args jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN pg_temp.funding_fixture b ON b.agreement=x.id;
 args:=jsonb_build_object('agreement',g.id,'version',g.version)||p_overrides;
 RETURN pg_temp.snapshot_select_as(p_role,CASE WHEN p_missing THEN NULL ELSE coalesce(p_member,f.requester) END,
  format('SELECT * FROM public.hold_my_movement_funds(%L::uuid,%L::integer)',args->>'agreement',args->>'version'));
END $$;
CREATE FUNCTION pg_temp.funding_read() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; BEGIN SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 RETURN pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.get_my_movement_funding_status(%L)',(SELECT agreement FROM pg_temp.funding_fixture)));
END $$;
CREATE FUNCTION pg_temp.funding_succeed(r jsonb) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF r->>'ok' IS DISTINCT FROM 'true' OR jsonb_array_length(r->'rows')<>1 THEN RAISE EXCEPTION 'Expected successful funding: %',r; END IF; END $$;
CREATE FUNCTION pg_temp.prepare_funding_activation() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE f record; a uuid; member_id uuid; submission uuid; media uuid; session_id uuid; payment uuid; j uuid; r jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT alignment_id INTO STRICT a FROM private.financial_agreements WHERE id=(SELECT agreement FROM pg_temp.funding_fixture);
 FOR member_id IN SELECT x.member_id FROM private.required_face_members(a) x LOOP
  submission:=public.create_profile_photo_submission_for_server(member_id,gen_random_uuid()::text||'/original.png','image/png',128);
  media:=public.prepare_profile_photo_submission_for_server(submission,gen_random_uuid()::text||'/processed.png');
  session_id:=public.start_alignment_face_verification_for_server(a,member_id,'test-0078',gen_random_uuid()::text);
  PERFORM public.complete_alignment_face_verification_for_server(session_id,media,true,true);
 END LOOP;
 SELECT payment_id INTO payment FROM public.create_alignment_activation_payment(a,100,'NGN','test-0078');
 RETURN payment;
END $$;
CREATE FUNCTION pg_temp.advance_funding_lifecycle(p_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f record; a uuid; payment uuid; j uuid; r jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT alignment_id INTO STRICT a FROM private.financial_agreements WHERE id=(SELECT agreement FROM pg_temp.funding_fixture);
 payment:=pg_temp.prepare_funding_activation();
 PERFORM public.mark_alignment_activation_payment_succeeded(payment,'test-'||gen_random_uuid());
 SELECT id INTO STRICT j FROM public.journeys WHERE alignment_id=a;
 IF p_state='cancelled' THEN
  r:=pg_temp.snapshot_select_as('authenticated',f.offerer,format('SELECT * FROM public.request_movement_end(%L)',j)); PERFORM pg_temp.funding_succeed(r);
  r:=pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.confirm_movement_end(%L)',j)); PERFORM pg_temp.funding_succeed(r);
 ELSIF p_state IN ('in_progress','completed') THEN
  r:=pg_temp.snapshot_select_as('authenticated',f.offerer,format('SELECT * FROM public.set_my_movement_meeting_point(%L,''0078 fixture meeting point'',NULL)',f.need)); PERFORM pg_temp.funding_succeed(r);
  r:=pg_temp.snapshot_select_as('authenticated',f.offerer,format('SELECT * FROM public.request_journey_start(%L)',j)); PERFORM pg_temp.funding_succeed(r);
  r:=pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.confirm_journey_start(%L)',j)); PERFORM pg_temp.funding_succeed(r);
  IF p_state='completed' THEN
   r:=pg_temp.snapshot_select_as('authenticated',f.offerer,format('SELECT * FROM public.request_movement_end(%L)',j)); PERFORM pg_temp.funding_succeed(r);
   r:=pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.confirm_movement_end(%L)',j)); PERFORM pg_temp.funding_succeed(r);
  END IF;
 END IF;
 IF (SELECT status FROM public.alignments WHERE id=a) IS DISTINCT FROM p_state THEN RAISE EXCEPTION 'Expected legitimate lifecycle %',p_state; END IF;
END $$;
CREATE TEMP TABLE pg_temp.funding_fixture(agreement uuid) ON COMMIT DROP;
DO $$ DECLARE r jsonb; BEGIN
 r:=pg_temp.consent(); IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Normal consent failed: %',r; END IF;
 r:=pg_temp.requester_accept(); IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Normal materialization failed: %',r; END IF;
 INSERT INTO pg_temp.funding_fixture VALUES((r#>>'{rows,0,financial_agreement_id}')::uuid);
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
-- FUNDING_0078_TESTS:
DO $tests$
DECLARE f record; g private.financial_agreements%ROWTYPE; r jsonb; retry jsonb; before text; graph_before jsonb;
 required bigint; available_before bigint; available_after bigint; held_after bigint; change jsonb; actor uuid; account uuid;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x JOIN pg_temp.funding_fixture b ON b.agreement=x.id;
 SELECT sum(amount_minor::numeric)::bigint INTO required FROM private.financial_components
  WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution');
 before:=pg_temp.materialization_sources();r:=pg_temp.funding_read();PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('read initially not held',r#>>'{rows,0,funding_status}'='not_held' AND (r#>>'{rows,0,required_minor}')::bigint=required);
 PERFORM pg_temp.snapshot_check('read projection creates no accounts or writes',before=pg_temp.materialization_sources());
 r:=pg_temp.hold_result();PERFORM pg_temp.snapshot_check('missing wallet fails closed',r->>'state'='23514' AND before=pg_temp.materialization_sources());
 FOR change IN SELECT value FROM jsonb_array_elements('[{"agreement":null},{"version":null}]') LOOP
  r:=pg_temp.hold_result(change);PERFORM pg_temp.snapshot_check('NULL selector '||change::text,r->>'state'='22004'); END LOOP;
 FOR change IN SELECT value FROM jsonb_array_elements('[{"version":0},{"version":-1},{"version":2}]') LOOP
  r:=pg_temp.hold_result(change);PERFORM pg_temp.snapshot_check('bad version '||change::text,r->>'state'='23514'); END LOOP;
 r:=pg_temp.hold_result('{"agreement":"bad"}');PERFORM pg_temp.snapshot_check('malformed typed UUID rejected',r->>'state'='22P02');
 r:=pg_temp.hold_result(jsonb_build_object('agreement',gen_random_uuid()));PERFORM pg_temp.snapshot_check('unknown agreement denied',r->>'state'='42501');
 FOREACH actor IN ARRAY ARRAY[f.offerer,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.hold_result('{}',actor);PERFORM pg_temp.snapshot_check('non requester denied '||actor,r->>'state'='42501'); END LOOP;
 r:=pg_temp.hold_result('{}',NULL,'authenticated',true);PERFORM pg_temp.snapshot_check('missing auth denied',r->>'state'='42501');
 r:=pg_temp.hold_result('{}',NULL,'anon');PERFORM pg_temp.snapshot_check('anon denied',r->>'state'='42501');
 r:=pg_temp.hold_result('{}',NULL,'service_role');PERFORM pg_temp.snapshot_check('service role denied',r->>'state'='42501');
 PERFORM pg_temp.snapshot_check('no direct client ledger or receipt grants',NOT has_table_privilege('authenticated','private.wallet_transactions','INSERT') AND NOT has_table_privilege('authenticated','private.movement_funding_holds','INSERT'));
 PERFORM pg_temp.probe('incomplete wallet not repaired',format('INSERT INTO private.wallet_accounts(member_id,account_kind,currency) VALUES(%L,''member_available'',''NGN''); SELECT pg_temp.consent_rejected(pg_temp.hold_result(),''23514'')',f.requester));
 PERFORM pg_temp.probe('superseded first hold rejected',format('UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.hold_result(),''23514'')',g.id));
 PERFORM pg_temp.probe('unmaterialized unaccepted agreement rejected',format('INSERT INTO private.financial_agreements(alignment_id,offering_member_id,member_needing_movement_id,version,financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,currency,quoted_platform_fee_total_minor,status) VALUES(%L,%L,%L,2,%L,%L,%L,''NGN'',0,''superseded'')',g.alignment_id,g.offering_member_id,g.member_needing_movement_id,g.financial_model_version,g.pricing_policy_version,g.platform_fee_allocation_policy_version),'23514','unaccepted');
 PERFORM pg_temp.probe('wrong component responsible cannot be fabricated',format('UPDATE private.financial_components SET responsible_member_id=%L WHERE agreement_id=%L',f.offerer,g.id),'23514','immutable');
 PERFORM pg_temp.probe('wrong component beneficiary cannot be fabricated',format('UPDATE private.financial_components SET beneficiary_member_id=%L WHERE agreement_id=%L AND component_key=''movement_contribution''',f.requester,g.id),'23514','immutable');
 PERFORM pg_temp.probe('wrong alignment binding cannot be fabricated',format('UPDATE private.financial_agreements SET alignment_id=gen_random_uuid() WHERE id=%L',g.id),'23514','immutable');
 PERFORM pg_temp.probe('wrong currency cannot be fabricated',format('UPDATE private.financial_agreements SET currency=''USD'' WHERE id=%L',g.id),'23514','immutable');
 PERFORM public.ensure_ngn_wallet_accounts_for_server(f.requester);
 PERFORM pg_temp.probe('closed wallet fails without repairs',format('UPDATE private.wallet_accounts SET status=''closed'' WHERE member_id=%L AND account_kind=''member_held''; SELECT pg_temp.consent_rejected(pg_temp.hold_result(),''23514'')',f.requester));
 before:=pg_temp.materialization_sources();r:=pg_temp.hold_result();
 PERFORM pg_temp.snapshot_check('insufficient balance produces zero persistent writes',r->>'state'='23514' AND before=pg_temp.materialization_sources());
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 PERFORM pg_temp.probe('exact available balance succeeds atomically',format('SELECT public.record_wallet_top_up_for_server(%L,%s,''NGN'',''test-0078'',''exact-''||gen_random_uuid()); SELECT pg_temp.funding_succeed(pg_temp.hold_result());',f.requester,required));
 -- Every funding amount below is read from components. This top-up is trusted
 -- test infrastructure, not a provider integration or a production hold action.
 PERFORM public.record_wallet_top_up_for_server(f.requester,required+100,'NGN','test-0078','fund-'||gen_random_uuid());
 graph_before:=jsonb_build_object('agreement',to_jsonb(g),'alignment',(SELECT to_jsonb(a) FROM public.alignments a WHERE a.id=g.alignment_id),
  'proposal',(SELECT to_jsonb(p) FROM private.financial_proposals p WHERE p.financial_agreement_id=g.id));
 SELECT coalesce(sum(CASE WHEN wp.direction='credit' THEN wp.amount_minor::numeric ELSE -wp.amount_minor::numeric END),0)::bigint INTO available_before
  FROM private.wallet_postings wp JOIN private.wallet_accounts wa ON wa.id=wp.account_id WHERE wa.member_id=f.requester AND wa.account_kind='member_available';
 PERFORM pg_temp.probe('malformed historical postings fail closed without repair',format(
 'DO $x$ DECLARE c private.financial_components%%ROWTYPE; t uuid; stamp timestamptz; avail uuid; held uuid; fingerprint text; BEGIN
 SELECT * INTO STRICT c FROM private.financial_components WHERE agreement_id=%L AND component_key=''movement_contribution'';
 SELECT id INTO avail FROM private.wallet_accounts WHERE member_id=%L AND account_kind=''member_available'';
 SELECT id INTO held FROM private.wallet_accounts WHERE member_id=%L AND account_kind=''member_held'';
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) VALUES(''movement_hold'',''NGN'',%L,c.id,''movement_hold:''||c.id) RETURNING id,created_at INTO t,stamp;
 INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,avail,''debit'',c.amount_minor+1),(t,held,''credit'',c.amount_minor+1);
 INSERT INTO private.movement_funding_holds VALUES(c.agreement_id,stamp);
 fingerprint:=pg_temp.materialization_sources(); PERFORM pg_temp.consent_rejected(pg_temp.hold_result(),''23514'');
 IF fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Malformed graph was repaired''; END IF; END $x$',g.id,f.requester,f.requester,g.alignment_id));
 PERFORM pg_temp.probe('partial historical component hold not repaired',format(
 'DO $x$ DECLARE c private.financial_components%%ROWTYPE; t uuid; avail uuid; held uuid; BEGIN
 SELECT * INTO STRICT c FROM private.financial_components WHERE agreement_id=%L AND component_key=''movement_contribution'';
 SELECT id INTO avail FROM private.wallet_accounts WHERE member_id=%L AND account_kind=''member_available'';
 SELECT id INTO held FROM private.wallet_accounts WHERE member_id=%L AND account_kind=''member_held'';
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) VALUES(''movement_hold'',''NGN'',%L,c.id,''movement_hold:''||c.id) RETURNING id INTO t;
 INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,avail,''debit'',c.amount_minor),(t,held,''credit'',c.amount_minor);
 PERFORM pg_temp.consent_rejected(pg_temp.hold_result(),''23514''); END $x$',g.id,f.requester,f.requester,g.alignment_id));
 PERFORM pg_temp.probe('overflow balance fails atomically',format(
 'DO $x$ DECLARE t uuid; avail uuid; clearing uuid; fingerprint text; BEGIN
 SELECT id INTO avail FROM private.wallet_accounts WHERE member_id=%L AND account_kind=''member_available'';
 SELECT id INTO clearing FROM private.wallet_accounts WHERE account_kind=''provider_clearing'' AND currency=''NGN'';
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 INSERT INTO private.wallet_transactions(transaction_kind,currency,idempotency_key) VALUES(''internal_transfer'',''NGN'',''overflow:''||gen_random_uuid()) RETURNING id INTO t;
 INSERT INTO private.wallet_postings(transaction_id,account_id,direction,amount_minor) VALUES(t,clearing,''debit'',9223372036854775807),(t,avail,''credit'',9223372036854775807);
 fingerprint:=pg_temp.materialization_sources(); PERFORM pg_temp.consent_rejected(pg_temp.hold_result(),''23514'');
 IF fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Insufficient/overflow writer mutated data''; END IF; END $x$',f.requester));
 r:=pg_temp.hold_result();PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('requester holds exact required component sum',(r#>>'{rows,0,required_minor}')::bigint=required AND (r#>>'{rows,0,held_minor}')::bigint=required AND r#>>'{rows,0,funding_status}'='held');
 PERFORM pg_temp.snapshot_check('bounded eight field result',(SELECT count(*) FROM jsonb_object_keys(r#>'{rows,0}'))=8);
 SELECT coalesce(sum(CASE WHEN wp.direction='credit' THEN wp.amount_minor::numeric ELSE -wp.amount_minor::numeric END),0)::bigint INTO available_after
  FROM private.wallet_postings wp JOIN private.wallet_accounts wa ON wa.id=wp.account_id WHERE wa.member_id=f.requester AND wa.account_kind='member_available';
 SELECT coalesce(sum(CASE WHEN wp.direction='credit' THEN wp.amount_minor::numeric ELSE -wp.amount_minor::numeric END),0)::bigint INTO held_after
  FROM private.wallet_postings wp JOIN private.wallet_accounts wa ON wa.id=wp.account_id WHERE wa.member_id=f.requester AND wa.account_kind='member_held';
 PERFORM pg_temp.snapshot_check('available decreases exactly once',available_before-available_after=required);
 PERFORM pg_temp.snapshot_check('held increases by exact total',held_after=required);
 PERFORM pg_temp.snapshot_check('positive component count matches transaction count',(SELECT count(*) FROM private.wallet_transactions wt JOIN private.financial_components fc ON fc.id=wt.financial_component_id WHERE fc.agreement_id=g.id AND wt.transaction_kind='movement_hold')=(SELECT count(*) FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution') AND amount_minor>0));
 PERFORM pg_temp.snapshot_check('offering platform share not held',NOT EXISTS(SELECT 1 FROM private.wallet_transactions wt JOIN private.financial_components fc ON fc.id=wt.financial_component_id WHERE fc.agreement_id=g.id AND fc.component_key='offering_platform_share'));
 PERFORM pg_temp.snapshot_check('zero requester obligation has no posting',NOT EXISTS(SELECT 1 FROM private.wallet_transactions wt JOIN private.financial_components fc ON fc.id=wt.financial_component_id WHERE fc.agreement_id=g.id AND fc.amount_minor=0));
 PERFORM pg_temp.snapshot_check('one immutable completion receipt',(SELECT count(*) FROM private.movement_funding_holds WHERE financial_agreement_id=g.id)=1);
 PERFORM pg_temp.snapshot_check('agreement alignment proposal unchanged',graph_before=jsonb_build_object('agreement',(SELECT to_jsonb(x) FROM private.financial_agreements x WHERE x.id=g.id),'alignment',(SELECT to_jsonb(a) FROM public.alignments a WHERE a.id=g.alignment_id),'proposal',(SELECT to_jsonb(p) FROM private.financial_proposals p WHERE p.financial_agreement_id=g.id)));
 PERFORM pg_temp.snapshot_check('no activation journey settlement revenue withdrawable',NOT EXISTS(SELECT 1 FROM public.journeys j WHERE j.alignment_id=g.alignment_id) AND NOT EXISTS(SELECT 1 FROM private.alignment_activation_payments ap WHERE ap.alignment_id=g.alignment_id) AND NOT EXISTS(SELECT 1 FROM private.wallet_postings wp JOIN private.wallet_accounts wa ON wa.id=wp.account_id WHERE wa.account_kind IN ('platform_revenue','member_withdrawable')));
 before:=pg_temp.materialization_sources();retry:=pg_temp.hold_result();PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.snapshot_check('immediate retry succeeds identical',retry=r);
 PERFORM pg_temp.snapshot_check('retry zero writes and no double consumption',before=pg_temp.materialization_sources());
 retry:=pg_temp.funding_read();PERFORM pg_temp.funding_succeed(retry);PERFORM pg_temp.snapshot_check('read returns exact persisted receipt',retry=r AND before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('historical superseded agreement replay succeeds no writes',format('DO $x$ DECLARE original jsonb; retry jsonb; fingerprint text; BEGIN original:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(original); UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L; fingerprint:=pg_temp.materialization_sources(); retry:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(retry); IF retry IS DISTINCT FROM original OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Historical replay changed evidence''; END IF; END $x$',g.id));
 PERFORM pg_temp.probe('receipt append only',format('UPDATE private.movement_funding_holds SET fully_held_at=clock_timestamp() WHERE financial_agreement_id=%L',g.id),'23514','append-only');
 PERFORM pg_temp.probe('ledger holds append only',format('UPDATE private.wallet_transactions SET currency=''USD'' WHERE alignment_id=%L',g.alignment_id),'23514','append-only');
 PERFORM pg_temp.probe('duplicate component hold database protected',format('INSERT INTO private.wallet_transactions(transaction_kind,currency,alignment_id,financial_component_id,idempotency_key) SELECT ''movement_hold'',''NGN'',%L,id,''duplicate:''||gen_random_uuid() FROM private.financial_components WHERE agreement_id=%L AND amount_minor>0 AND component_key=''movement_contribution''',g.alignment_id,g.id),'23505','');
 PERFORM pg_temp.probe('historical activated replay independently succeeds no writes',
 'DO $x$ DECLARE before_result jsonb; replay_result jsonb; fingerprint text; BEGIN
 before_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(before_result);
 PERFORM pg_temp.advance_funding_lifecycle(''activated''); fingerprint:=pg_temp.materialization_sources();
 replay_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(replay_result);
 IF replay_result IS DISTINCT FROM before_result OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Lifecycle replay changed graph''; END IF; END $x$');
 PERFORM pg_temp.probe('historical in_progress replay independently succeeds no writes',
 'DO $x$ DECLARE before_result jsonb; replay_result jsonb; fingerprint text; BEGIN
 before_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(before_result);
 PERFORM pg_temp.advance_funding_lifecycle(''in_progress''); fingerprint:=pg_temp.materialization_sources();
 replay_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(replay_result);
 IF replay_result IS DISTINCT FROM before_result OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Lifecycle replay changed graph''; END IF; END $x$');
 PERFORM pg_temp.probe('historical completed replay independently succeeds no writes',
 'DO $x$ DECLARE before_result jsonb; replay_result jsonb; fingerprint text; BEGIN
 before_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(before_result);
 PERFORM pg_temp.advance_funding_lifecycle(''completed''); fingerprint:=pg_temp.materialization_sources();
 replay_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(replay_result);
 IF replay_result IS DISTINCT FROM before_result OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Lifecycle replay changed graph''; END IF; END $x$');
 PERFORM pg_temp.probe('historical cancelled replay independently succeeds no writes',
 'DO $x$ DECLARE before_result jsonb; replay_result jsonb; fingerprint text; BEGIN
 before_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(before_result);
 PERFORM pg_temp.advance_funding_lifecycle(''cancelled''); fingerprint:=pg_temp.materialization_sources();
 replay_result:=pg_temp.hold_result(); PERFORM pg_temp.funding_succeed(replay_result);
 IF replay_result IS DISTINCT FROM before_result OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Lifecycle replay changed graph''; END IF; END $x$');
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION '0078 behavioral checks failed'; END IF; END $$;
ROLLBACK;
