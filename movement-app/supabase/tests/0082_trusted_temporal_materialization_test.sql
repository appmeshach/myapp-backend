-- Controlled producer clock references, inside a rollback transaction only.
-- No row repair: consent/materialization run normal RPCs with every lock and
-- provenance/expiry predicate active, while independent DB clock reads regress.
DO $clock_references$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='accept_my_financial_proposal_as_offerer';
 EXECUTE replace(definition,'accepted_at:=clock_timestamp();','accepted_at:=clock_timestamp()+interval ''1 second'';');
 SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='accept_my_financial_proposal_as_requester';
 definition:=replace(definition,'accepted_at:=clock_timestamp();','accepted_at:=p.offering_accepted_at-interval ''5338 microseconds'';');
 EXECUTE replace(definition,'completed_at:=clock_timestamp();','completed_at:=accepted_at-interval ''5338 microseconds'';');
END $clock_references$;
DO $tests$
DECLARE r jsonb; retry jsonb; before text; proposal private.financial_proposals%ROWTYPE;
BEGIN
 r:=pg_temp.consent();IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Normal offerer consent failed: %',r; END IF;
 r:=pg_temp.requester_accept();IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Normal requester construction failed: %',r; END IF;
 SELECT x.* INTO STRICT proposal FROM private.financial_proposals x WHERE x.id=(r#>>'{rows,0,proposal_id}')::uuid;
 PERFORM pg_temp.snapshot_check('normal construction accepts exact causal graph despite regressing independent clocks',
  proposal.requester_accepted_at=proposal.offering_accepted_at-interval '5338 microseconds' AND
  proposal.materialized_at=proposal.requester_accepted_at-interval '5338 microseconds' AND
  private.assert_financial_proposal_materialization(proposal)='awaiting_activation_payment');
 before:=pg_temp.materialization_sources();retry:=pg_temp.requester_accept();
 PERFORM pg_temp.snapshot_check('regressed-clock graph exact replay preserves all IDs and stamps without writes',retry->>'ok'='true' AND r->'rows'=retry->'rows' AND before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('plausible materialization clocks cannot substitute snapshot identity',format('DO $x$ DECLARE p private.financial_proposals%%ROWTYPE; BEGIN SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=%L; p.movement_context_snapshot_id:=gen_random_uuid(); PERFORM private.assert_financial_proposal_materialization(p); END $x$',proposal.id),'23514','exact movement context provenance');
 PERFORM pg_temp.probe('plausible materialization clocks cannot substitute requester parent',format('DO $x$ DECLARE p private.financial_proposals%%ROWTYPE; BEGIN SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=%L; p.movement_need_id:=gen_random_uuid(); PERFORM private.assert_financial_proposal_materialization(p); END $x$',proposal.id),'23514','exact pricing quote provenance');
END $tests$;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION 'Temporal construction behaviors failed'; END IF; END $$;
ROLLBACK;
