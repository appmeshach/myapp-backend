BEGIN;
CREATE FUNCTION pg_temp.activation_result(p_overrides jsonb DEFAULT '{}',p_member uuid DEFAULT NULL,p_role text DEFAULT 'authenticated',p_missing boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; g private.financial_agreements%ROWTYPE; args jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 args:=jsonb_build_object('agreement',g.id,'version',g.version)||p_overrides;
 RETURN pg_temp.snapshot_select_as(p_role,CASE WHEN p_missing THEN NULL ELSE coalesce(p_member,f.requester) END,
  format('SELECT * FROM public.activate_my_funded_movement(%L::uuid,%L::integer)',args->>'agreement',args->>'version'));
END $$;
CREATE FUNCTION pg_temp.activation_read() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; BEGIN SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 RETURN pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.get_my_movement_activation_status(%L,1)',(SELECT agreement FROM pg_temp.funding_fixture)));
END $$;
CREATE FUNCTION pg_temp.prepare_activation_faces() RETURNS void LANGUAGE plpgsql AS $$
DECLARE a uuid; member_id uuid; submission uuid; media uuid; session_id uuid;
BEGIN
 SELECT alignment_id INTO STRICT a FROM private.financial_agreements WHERE id=(SELECT agreement FROM pg_temp.funding_fixture);
 FOR member_id IN SELECT x.member_id FROM private.required_face_members(a) x LOOP
  submission:=public.create_profile_photo_submission_for_server(member_id,gen_random_uuid()::text||'/original.png','image/png',128);
  media:=public.prepare_profile_photo_submission_for_server(submission,gen_random_uuid()::text||'/processed.png');
  session_id:=public.start_alignment_face_verification_for_server(a,member_id,'test-0079',gen_random_uuid()::text);
  PERFORM public.complete_alignment_face_verification_for_server(session_id,media,true,true);
 END LOOP;
END $$;
-- ACTIVATION_0079_TESTS:
DO $tests$
DECLARE f record; g private.financial_agreements%ROWTYPE; r jsonb; retry jsonb; before text; ledgers jsonb; stamp timestamptz; required bigint; member_id uuid;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 SELECT sum(amount_minor::numeric)::bigint INTO required FROM private.financial_components WHERE agreement_id=g.id AND component_key IN ('requester_platform_share','movement_contribution');
 before:=pg_temp.materialization_sources();r:=pg_temp.activation_read();PERFORM pg_temp.funding_succeed(r);
 PERFORM pg_temp.snapshot_check('unfunded projection truthful read only',r#>>'{rows,0,activation_status}'='funding_required' AND before=pg_temp.materialization_sources());
 r:=pg_temp.activation_result();PERFORM pg_temp.snapshot_check('unfunded and identity incomplete rejected',r->>'ok'='false');
 FOREACH member_id IN ARRAY ARRAY[f.offerer,f.traveller,gen_random_uuid()] LOOP
  r:=pg_temp.activation_result('{}',member_id);PERFORM pg_temp.snapshot_check('only exact requester activates '||member_id,r->>'state'='42501');
 END LOOP;
 r:=pg_temp.activation_result('{}',NULL,'authenticated',true);PERFORM pg_temp.snapshot_check('missing auth denied',r->>'state'='42501');
 r:=pg_temp.activation_result('{}',NULL,'anon');PERFORM pg_temp.snapshot_check('anon denied',r->>'state'='42501');
 r:=pg_temp.activation_result('{}',NULL,'service_role');PERFORM pg_temp.snapshot_check('service role denied',r->>'state'='42501');
 r:=pg_temp.activation_result('{"version":2}');PERFORM pg_temp.snapshot_check('exact version enforced',r->>'state'='23514');
 r:=pg_temp.activation_result('{"version":null}');PERFORM pg_temp.snapshot_check('NULL version denied',r->>'state'='22004');
 r:=pg_temp.activation_result('{"agreement":null}');PERFORM pg_temp.snapshot_check('NULL agreement denied',r->>'state'='22004');
 r:=pg_temp.activation_result('{"agreement":"bad"}');PERFORM pg_temp.snapshot_check('typed invalid UUID denied',r->>'state'='22P02');
 PERFORM pg_temp.snapshot_check('no preactivation reveal',(SELECT count(*) FROM private.post_activation_reveal_subjects(f.need,f.requester))=0);
 PERFORM pg_temp.prepare_activation_faces();
 PERFORM pg_temp.probe('face only cannot activate','SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''23514'')');
 PERFORM pg_temp.snapshot_check('face only no reveal',(SELECT count(*) FROM private.post_activation_reveal_subjects(f.need,f.requester))=0);
 PERFORM pg_temp.probe('receipt alone cannot substitute exact historical funding',format('SELECT public.ensure_ngn_wallet_accounts_for_server(%L); INSERT INTO private.movement_funding_holds VALUES(%L,clock_timestamp()); SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''23514'')',f.requester,g.id));
 PERFORM pg_temp.probe('legacy create blocked with ready faces',format('SELECT public.create_alignment_activation_payment(%L,100,''NGN'',''test-0079'')',g.alignment_id),'23514','funded activation');
 PERFORM pg_temp.probe('legacy status refuses false monetary projection',format('SELECT pg_temp.consent_rejected(pg_temp.snapshot_select_as(''authenticated'',%L,%L),''23514'')',f.requester,format('SELECT * FROM public.get_my_activation_payment_status(%L)',g.alignment_id)));
 PERFORM pg_temp.probe('direct service activation cannot bypass receipt',format('UPDATE public.alignments SET status=''activated'',activated_at=clock_timestamp() WHERE id=%L',g.alignment_id),'23514','receipt');
 PERFORM pg_temp.probe('direct legacy succeeded payment cannot bypass',format('INSERT INTO private.alignment_activation_payments(alignment_id,payer_member_id,amount_minor,currency,provider,status) VALUES(%L,%L,100,''NGN'',''test-0079'',''pending'')',g.alignment_id,f.offerer),'23514','funded activation');
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 PERFORM public.record_wallet_top_up_for_server(f.requester,required+100,'NGN','test-0079','fund-'||gen_random_uuid());
 PERFORM pg_temp.funding_succeed(pg_temp.hold_result());
 PERFORM pg_temp.probe('funded identity-incomplete projection truthful',format('SELECT public.revoke_current_profile_photo_for_server(%L); DO $x$ DECLARE r jsonb; BEGIN r:=pg_temp.activation_read(); IF r#>>''{rows,0,activation_status}''<>''identity_required'' THEN RAISE EXCEPTION ''Wrong identity projection''; END IF; END $x$',f.requester));
 PERFORM pg_temp.snapshot_check('funding alone no reveal',(SELECT count(*) FROM private.post_activation_reveal_subjects(f.need,f.requester))=0);
 PERFORM pg_temp.probe('missing required readiness denies funded activation',format('SELECT public.revoke_current_profile_photo_for_server(%L); SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''P0001'')',f.requester));
 PERFORM pg_temp.probe('wrong media member binding denies activation',format('UPDATE private.alignment_face_verifications SET media_id=(SELECT id FROM public.member_media WHERE member_id=%L AND is_current AND media_type=''photo'') WHERE alignment_id=%L AND member_id=%L; SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''P0001'')',f.offerer,g.alignment_id,f.requester));
 PERFORM pg_temp.probe('wrong face member denies activation',format('UPDATE private.alignment_face_verifications SET member_id=%L WHERE alignment_id=%L AND member_id=%L; SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''P0001'')',f.offerer,g.alignment_id,f.requester));
 PERFORM pg_temp.probe('superseded latest attempt denies funded activation',format('SELECT public.start_alignment_face_verification_for_server(%L,%L,''test-0079'',gen_random_uuid()::text); SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''P0001'')',g.alignment_id,f.requester));
 PERFORM pg_temp.probe('expired-at-activation face check denies',format('UPDATE private.alignment_face_verifications SET expires_at=clock_timestamp() WHERE member_id=%L AND alignment_id=%L; SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''P0001'')',f.requester,g.alignment_id));
 PERFORM pg_temp.probe('first activation rejects superseded agreement',format('UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''23514'')',g.id));
 r:=pg_temp.activation_read();PERFORM pg_temp.funding_succeed(r);PERFORM pg_temp.snapshot_check('ready projection truthful',r#>>'{rows,0,activation_status}'='ready_to_activate');
 PERFORM pg_temp.probe('partial activation receipt lacks exact roster evidence',format('INSERT INTO private.funded_movement_activations VALUES(%L,%L,clock_timestamp()); UPDATE public.alignments SET status=''activated'',activated_at=(SELECT activated_at FROM private.funded_movement_activations WHERE financial_agreement_id=%L) WHERE id=%L',g.id,g.alignment_id,g.id,g.alignment_id),'23514','face evidence');
 ledgers:=jsonb_build_object('transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t));
 r:=pg_temp.activation_result();PERFORM pg_temp.funding_succeed(r);stamp:=(r#>>'{rows,0,activated_at}')::timestamptz;
 PERFORM pg_temp.snapshot_check('activation returns exact persisted status and instant',r#>>'{rows,0,alignment_status}'='activated' AND (SELECT activated_at=stamp AND status='activated' FROM public.alignments WHERE id=g.alignment_id));
 PERFORM pg_temp.snapshot_check('one activation receipt and exact required member evidence',(SELECT count(*) FROM private.funded_movement_activations WHERE financial_agreement_id=g.id)=1 AND (SELECT count(*) FROM private.funded_movement_activation_faces WHERE financial_agreement_id=g.id)=(SELECT count(*) FROM private.required_face_members(g.alignment_id)));
 PERFORM pg_temp.snapshot_check('activation no wallet or funding writes',ledgers=jsonb_build_object('transactions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_transactions t),'postings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM private.wallet_postings t),'funding',(SELECT jsonb_agg(to_jsonb(t)) FROM private.movement_funding_holds t)));
 PERFORM pg_temp.snapshot_check('no journey payment settlement revenue or payout',(SELECT count(*) FROM public.journeys WHERE alignment_id=g.alignment_id)=0 AND (SELECT count(*) FROM private.alignment_activation_payments WHERE alignment_id=g.alignment_id)=0 AND (SELECT count(*) FROM private.movement_settlements WHERE alignment_id=g.alignment_id)=0 AND (SELECT activation_fee_minor IS NULL FROM public.alignments WHERE id=g.alignment_id));
 before:=pg_temp.materialization_sources();retry:=pg_temp.activation_result();PERFORM pg_temp.funding_succeed(retry);
 PERFORM pg_temp.snapshot_check('exact retry same IDs timestamp zero writes',r->'rows'=retry->'rows' AND before=pg_temp.materialization_sources());
 r:=pg_temp.activation_read();PERFORM pg_temp.snapshot_check('activated projection authoritative',r#>>'{rows,0,activation_status}'='activated' AND (r#>>'{rows,0,activated_at}')::timestamptz=stamp);
 PERFORM pg_temp.snapshot_check('funded activation unlocks existing reveal',(SELECT count(*) FROM private.post_activation_reveal_subjects(f.need,f.requester))=1);
 PERFORM pg_temp.probe('replacement and revocation do not break historical replay',format('SELECT public.revoke_current_profile_photo_for_server(%L); SELECT pg_temp.funding_succeed(pg_temp.activation_result())',f.requester));
 PERFORM pg_temp.probe('natural later face expiry preserves replay',format('UPDATE private.alignment_face_verifications SET expires_at=%L::timestamptz+interval ''1 millisecond'' WHERE alignment_id=%L; SELECT pg_sleep(0.02); DO $x$ DECLARE r jsonb; before text; BEGIN before:=pg_temp.materialization_sources(); r:=pg_temp.activation_result(); PERFORM pg_temp.funding_succeed(r); IF before<>pg_temp.materialization_sources() THEN RAISE EXCEPTION ''Replay wrote data''; END IF; END $x$',stamp,g.alignment_id));
 PERFORM pg_temp.probe('duplicate activation face evidence cannot be fabricated',format('INSERT INTO private.funded_movement_activation_faces VALUES(%L,%L,(SELECT face_verification_id FROM private.funded_movement_activation_faces WHERE financial_agreement_id=%L LIMIT 1))',g.id,gen_random_uuid(),g.id),'23505');
 PERFORM pg_temp.probe('malformed historical face fails closed',format('UPDATE private.alignment_face_verifications SET face_match_passed=false,status=''failed'' WHERE alignment_id=%L; SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''23514'')',g.alignment_id));
 PERFORM pg_temp.probe('receipt immutable',format('UPDATE private.funded_movement_activations SET activated_at=clock_timestamp() WHERE financial_agreement_id=%L',g.id),'23514','append-only');
 PERFORM pg_temp.probe('face receipt immutable',format('DELETE FROM private.funded_movement_activation_faces WHERE financial_agreement_id=%L',g.id),'23514','append-only');
 PERFORM pg_temp.probe('activation timestamp immutable',format('UPDATE public.alignments SET activated_at=clock_timestamp() WHERE id=%L',g.alignment_id),'23514','immutable');
 PERFORM pg_temp.probe('superseded agreement historical replay succeeds',format('UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L; SELECT pg_temp.funding_succeed(pg_temp.activation_result())',g.id));
 PERFORM pg_temp.snapshot_check('receipt tables have no API grants',NOT has_table_privilege('authenticated','private.funded_movement_activations','INSERT') AND NOT has_table_privilege('service_role','private.funded_movement_activation_faces','INSERT'));
END;
$tests$;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION '0079 behavioral failures'; END IF; END $$;
ROLLBACK;
