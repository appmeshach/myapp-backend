-- Appended to the real through-0081 fixture transaction, and always rolled back.
DO $tests$
DECLARE f record; g private.financial_agreements%ROWTYPE; first_id uuid; second_id uuid;
 media uuid; row_count bigint; def text; r jsonb; before text; seq bigint; stamp timestamptz;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=(SELECT agreement FROM pg_temp.funding_fixture);
 PERFORM pg_temp.prepare_activation_faces();
 SELECT media_id,id INTO media,first_id FROM private.alignment_face_verifications WHERE alignment_id=g.alignment_id AND member_id=f.requester ORDER BY attempt_ordinal DESC LIMIT 1;
 -- Controlled owner-only fixture clocks: no system clock manipulation. Attempt
 -- creation still uses the normal producer and its alignment/member locks.
 UPDATE private.alignment_face_verifications SET started_at=clock_timestamp()+interval '5 milliseconds' WHERE id=first_id;
 second_id:=public.start_alignment_face_verification_for_server(g.alignment_id,f.requester,'temporal-test',gen_random_uuid()::text);
 UPDATE private.alignment_face_verifications SET started_at=(SELECT started_at-interval '5 milliseconds' FROM private.alignment_face_verifications WHERE id=first_id),expires_at=(SELECT started_at-interval '5 milliseconds'+interval '10 minutes' FROM private.alignment_face_verifications WHERE id=first_id) WHERE id=second_id;
 PERFORM public.complete_alignment_face_verification_for_server(second_id,media,false,false);
 PERFORM pg_temp.snapshot_check('higher ordinal failure with earlier wall time defeats older success',NOT private.has_current_alignment_face_check(g.alignment_id,f.requester,clock_timestamp()) AND
   (SELECT attempt_ordinal FROM private.alignment_face_verifications WHERE id=second_id)>(SELECT attempt_ordinal FROM private.alignment_face_verifications WHERE id=first_id));
 first_id:=second_id;
 second_id:=public.start_alignment_face_verification_for_server(g.alignment_id,f.requester,'temporal-test',gen_random_uuid()::text);
 UPDATE private.alignment_face_verifications SET started_at=(SELECT started_at-interval '5 milliseconds' FROM private.alignment_face_verifications WHERE id=first_id),expires_at=(SELECT started_at-interval '5 milliseconds'+interval '10 minutes' FROM private.alignment_face_verifications WHERE id=first_id) WHERE id=second_id;
 PERFORM public.complete_alignment_face_verification_for_server(second_id,media,true,true);
 PERFORM pg_temp.snapshot_check('higher ordinal success with earlier wall time defeats older failure',private.has_current_alignment_face_check(g.alignment_id,f.requester,clock_timestamp()));
 seq:=(SELECT last_value FROM private.alignment_face_attempt_ordinal_seq);before:=pg_temp.materialization_sources();
 PERFORM public.complete_alignment_face_verification_for_server(second_id,media,true,true);
 PERFORM pg_temp.snapshot_check('exact face callback replay allocates nothing and writes nothing',seq=(SELECT last_value FROM private.alignment_face_attempt_ordinal_seq) AND before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('ordinal immutable',format('UPDATE private.alignment_face_verifications SET attempt_ordinal=attempt_ordinal+100000 WHERE id=%L',second_id),'23514','immutable');
 PERFORM pg_temp.snapshot_check('sequence denied to every API role',NOT has_sequence_privilege('anon','private.alignment_face_attempt_ordinal_seq','USAGE') AND NOT has_sequence_privilege('authenticated','private.alignment_face_attempt_ordinal_seq','USAGE') AND NOT has_sequence_privilege('service_role','private.alignment_face_attempt_ordinal_seq','UPDATE'));
 PERFORM pg_temp.snapshot_check('private ordinal guard locked down',NOT has_function_privilege('anon','private.protect_alignment_face_attempt_ordinal()','EXECUTE') AND NOT has_function_privilege('authenticated','private.protect_alignment_face_attempt_ordinal()','EXECUTE') AND NOT has_function_privilege('service_role','private.protect_alignment_face_attempt_ordinal()','EXECUTE'));
 PERFORM pg_temp.snapshot_check('attestation and ordinal table writes denied',NOT has_column_privilege('authenticated','private.alignment_face_verifications','attempt_ordinal','UPDATE') AND NOT has_column_privilege('authenticated','private.offering_route_evidence','created_at','INSERT') AND NOT has_column_privilege('service_role','private.trusted_route_match_evidence','created_at','UPDATE'));
 PERFORM pg_temp.probe('genuine future route input rejected',format('SELECT * FROM public.record_offering_route_evidence_for_server(%L,''test-provider'',''directions'',''v1'',%L,''{"type":"LineString","coordinates":[[3,6],[4,7]]}'',1000,100,clock_timestamp()+interval ''1 hour'',NULL)',f.intent,gen_random_uuid()),'23514','generation time');
 -- Synthetic evaluation clock below trusted persisted metadata. Replace only
 -- validator evaluation expressions in this rollback transaction, never inputs.
 stamp:=clock_timestamp()-interval '1 hour';
 FOREACH def IN ARRAY ARRAY['private.assert_financial_proposal_materialization(private.financial_proposals)','private.assert_trusted_location_discovery_area(uuid)','private.assert_trusted_location_state_evidence(uuid)'] LOOP
  EXECUTE replace(pg_get_functiondef(def::regprocedure),'clock_timestamp()',quote_literal(stamp)||'::timestamptz');
 END LOOP;
 PERFORM pg_temp.snapshot_check('historical materialization survives lower synthetic evaluation clock',private.assert_financial_proposal_materialization((SELECT p FROM private.financial_proposals p WHERE p.financial_agreement_id=g.id))='awaiting_activation_payment');
 SET CONSTRAINTS private.wallet_transaction_balanced_after_transaction,private.wallet_transaction_balanced_after_posting DEFERRED;
 PERFORM public.record_wallet_top_up_for_server(f.requester,1000000,'NGN','temporal-test','topup-'||gen_random_uuid());
 PERFORM pg_temp.funding_succeed(pg_temp.hold_result());
 r:=pg_temp.activation_result();PERFORM pg_temp.funding_succeed(r);
 seq:=(SELECT last_value FROM private.alignment_face_attempt_ordinal_seq);
 before:=pg_temp.materialization_sources();
 PERFORM pg_temp.funding_succeed(pg_temp.activation_result());
 PERFORM pg_temp.snapshot_check('exact activation replay uses bound historical faces no ordinal no writes',before=pg_temp.materialization_sources() AND seq=(SELECT last_value FROM private.alignment_face_attempt_ordinal_seq));
 PERFORM pg_temp.probe('live expired face denies new readiness',format('UPDATE private.alignment_face_verifications SET expires_at=clock_timestamp()-interval ''1 millisecond'',completed_at=clock_timestamp()-interval ''2 milliseconds'' WHERE id=%L; DO $x$ BEGIN IF private.has_current_alignment_face_check(%L,%L,clock_timestamp()) THEN RAISE EXCEPTION ''Expired face accepted''; END IF; END $x$',second_id,g.alignment_id,f.requester));
 PERFORM pg_temp.probe('wrong historical face binding rejected',format('UPDATE private.alignment_face_verifications SET member_id=%L WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.activation_result(),''23514'')',f.offerer,second_id));
END $tests$;
-- FACE_PREFLIGHT_PROBE
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION 'Temporal hardening behavioral failures'; END IF; END $$;
ROLLBACK;
