BEGIN;
-- Runner prepends the reviewed 0074/0076 normal-producer fixtures, including
-- an unmanaged-need legacy acceptance rollback probe and genuine competition.
CREATE FUNCTION pg_temp.requester_accept(p_overrides jsonb DEFAULT '{}',p_member uuid DEFAULT NULL,
 p_role text DEFAULT 'authenticated',p_missing boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; p private.financial_proposals%ROWTYPE; args jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x JOIN pg_temp.consent_fixture c ON c.proposal=x.id;
 args:=jsonb_build_object('proposal',p.id,'version',p.version)||p_overrides;
 RETURN pg_temp.snapshot_select_as(p_role,CASE WHEN p_missing THEN NULL ELSE coalesce(p_member,f.requester) END,
  format('SELECT * FROM public.accept_my_financial_proposal_as_requester(%L::uuid,%L::integer)',args->>'proposal',args->>'version'));
END $$;

CREATE FUNCTION pg_temp.materialization_sources(p_allow boolean DEFAULT false) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; f record; h text; expr text; predicate text; result text:='';
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations') ORDER BY n.nspname,c.relname LOOP
  expr:='to_jsonb(t)'; predicate:='true';
  IF p_allow THEN
   IF r.nspname='public' AND r.relname='movement_needs' THEN
    expr:=format('CASE WHEN t.id=%L THEN to_jsonb(t)-ARRAY[''status'',''updated_at''] ELSE to_jsonb(t) END',f.need);
   ELSIF r.nspname='public' AND r.relname='movement_offers' THEN
    expr:=format('CASE WHEN t.movement_need_id=%L THEN to_jsonb(t)-ARRAY[''status'',''updated_at''] ELSE to_jsonb(t) END',f.need);
   ELSIF r.nspname='private' AND r.relname='offering_movement_availability' THEN
    expr:=format('CASE WHEN t.id=%L THEN to_jsonb(t)-ARRAY[''remaining_places'',''status'',''updated_at''] ELSE to_jsonb(t) END',f.availability);
   ELSIF r.nspname='private' AND r.relname='financial_proposals' THEN
    expr:=format('CASE WHEN t.id=%L THEN to_jsonb(t)-ARRAY[''requester_accepted_at'',''alignment_id'',''financial_agreement_id'',''materialized_at''] ELSE to_jsonb(t) END',(SELECT proposal FROM pg_temp.consent_fixture));
   ELSIF r.nspname='public' AND r.relname='alignments' THEN
    predicate:=format('t.movement_need_id<>%L',f.need);
   ELSIF r.nspname='private' AND r.relname='financial_agreements' THEN
    predicate:=format('NOT EXISTS(SELECT 1 FROM public.alignments a WHERE a.id=t.alignment_id AND a.movement_need_id=%L)',f.need);
   ELSIF r.nspname='private' AND r.relname='financial_components' THEN
    predicate:=format('NOT EXISTS(SELECT 1 FROM private.financial_agreements g JOIN public.alignments a ON a.id=g.alignment_id WHERE g.id=t.agreement_id AND a.movement_need_id=%L)',f.need);
   END IF;
  END IF;
  EXECUTE format('SELECT md5(coalesce(string_agg((%s)::text, '''' ORDER BY (%s)::text), '''')) FROM %I.%I t WHERE %s',expr,expr,r.nspname,r.relname,predicate) INTO h;
  result:=result||r.nspname||'.'||r.relname||':'||h;
 END LOOP;
 RETURN md5(result);
END $$;

DO $tests$
DECLARE f record; p private.financial_proposals%ROWTYPE; original jsonb; r jsonb; again jsonb;
 before text; exact_before text; g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; change jsonb; member_id uuid;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x JOIN pg_temp.consent_fixture c ON c.proposal=x.id;
 r:=pg_temp.requester_accept();
 PERFORM pg_temp.snapshot_check('unconsented and unbound proposal rejected',r->>'ok'='false' AND r->>'state'='23514');
 r:=pg_temp.consent();
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Normal offerer consent fixture failed: %',r; END IF;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p.id;
 FOR change IN SELECT value FROM jsonb_array_elements('[{"proposal":null},{"version":null}]') LOOP
  r:=pg_temp.requester_accept(change);
  PERFORM pg_temp.snapshot_check('NULL requester selector '||change::text,r->>'ok'='false' AND r->>'state'='22004');
 END LOOP;
 FOR change IN SELECT value FROM jsonb_array_elements('[{"version":0},{"version":-1},{"version":2}]') LOOP
  r:=pg_temp.requester_accept(change);
  PERFORM pg_temp.snapshot_check('invalid expected requester version '||change::text,r->>'ok'='false' AND r->>'state'='23514');
 END LOOP;
 r:=pg_temp.requester_accept(jsonb_build_object('proposal',gen_random_uuid()));
 PERFORM pg_temp.snapshot_check('absent proposal fails closed',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.requester_accept('{"proposal":"malformed"}');
 PERFORM pg_temp.snapshot_check('typed malformed UUID fails safely',r->>'ok'='false' AND r->>'state'='22P02');
 FOR member_id IN SELECT unnest(ARRAY[f.offerer,f.traveller,gen_random_uuid()]) LOOP
  r:=pg_temp.requester_accept('{}',member_id);
  PERFORM pg_temp.snapshot_check('non-requester offerer traveller or unmapped caller '||member_id::text,r->>'ok'='false' AND r->>'state'='42501');
 END LOOP;
 r:=pg_temp.requester_accept('{}',NULL,'authenticated',true);
 PERFORM pg_temp.snapshot_check('missing auth identity denied',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.requester_accept('{}',f.requester,'anon');
 PERFORM pg_temp.snapshot_check('anon denied requester execution',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.requester_accept('{}',f.requester,'service_role');
 PERFORM pg_temp.snapshot_check('service role denied requester execution',r->>'ok'='false' AND r->>'state'='42501');
 PERFORM pg_temp.probe('unrelated existing member denied requester acceptance',
  'DO $x$ DECLARE o uuid; m uuid; BEGIN o:=pg_temp.foreign_offer(false); SELECT offering_member_id INTO m FROM public.movement_offers WHERE id=o;
   PERFORM pg_temp.consent_rejected(pg_temp.requester_accept(''{}'',m),''42501''); END $x$');
 PERFORM pg_temp.probe('superseded proposal rejected',format('UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',p.id));
 PERFORM pg_temp.probe('withdrawn bound offer rejected',format('UPDATE public.movement_offers SET status=''withdrawn'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',f.movement_offer));
 PERFORM pg_temp.probe('closed unavailable need rejected',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',f.need));
 PERFORM pg_temp.probe('vehicle access loss rejected',format('UPDATE public.member_vehicle_access SET active=false WHERE vehicle_id=%L AND member_id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',f.vehicle,f.offerer));
 PERFORM pg_temp.probe('vehicle capacity drift rejected',format('UPDATE public.vehicles SET seat_capacity=3 WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',f.vehicle));
 PERFORM pg_temp.probe('roster drift rejected',format('UPDATE public.movement_participants SET status=''invited'' WHERE movement_need_id=%L AND member_id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',f.need,f.traveller));
 PERFORM pg_temp.probe('terminal trusted quote rejected',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',p.pricing_quote_id));
 PERFORM pg_temp.probe('trusted snapshot drift rejected',format('UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',p.id,p.movement_context_snapshot_id));
 PERFORM pg_temp.probe('active existing alignment blocks first materialization',format(
  'INSERT INTO public.alignments(movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id,activation_currency,status) VALUES(%L,%L,%L,%L,''NGN'',''awaiting_activation_payment''); SELECT pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'')',f.need,f.movement_offer,f.requester,f.offerer));
 PERFORM pg_temp.snapshot_check('authenticated cannot mutate financial tables',
  NOT has_table_privilege('authenticated','private.financial_proposals','UPDATE')
  AND NOT has_table_privilege('authenticated','private.financial_agreements','INSERT')
  AND NOT has_table_privilege('authenticated','private.financial_components','INSERT'));
 PERFORM pg_temp.probe('requester acceptance requires same-transaction materialization',format(
  'UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L; SET CONSTRAINTS private.financial_proposal_complete IMMEDIATE',p.id),'23514','same transaction');
 PERFORM pg_temp.probe('naturally expired offerer-consented proposal rejected',
  'DO $x$ DECLARE n uuid; o uuid; r jsonb; expiry timestamptz; BEGIN
   UPDATE private.financial_proposals SET status=''superseded'' WHERE id=(SELECT proposal FROM pg_temp.consent_fixture);
   o:=pg_temp.expiring_offer(); PERFORM pg_temp.bind_offer(o); n:=pg_temp.issue_id();
   UPDATE pg_temp.consent_fixture SET proposal=n;
   r:=pg_temp.consent(jsonb_build_object(''offer'',o));
   IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expiring consent fixture failed: %'',r; END IF;
   SET CONSTRAINTS ALL IMMEDIATE;
   SELECT expires_at INTO expiry FROM private.financial_proposals WHERE id=n;
   PERFORM pg_sleep(greatest(0,extract(epoch FROM expiry-clock_timestamp()))+0.05);
   PERFORM pg_temp.consent_rejected(pg_temp.requester_accept(),''23514'');
  END $x$');
 PERFORM pg_temp.probe('historical retry after original expiry preserves graph without writes',
  'DO $x$ DECLARE n uuid; o uuid; first_result jsonb; retry_result jsonb; expiry timestamptz; fingerprint text; BEGIN
   UPDATE private.financial_proposals SET status=''superseded'' WHERE id=(SELECT proposal FROM pg_temp.consent_fixture);
   o:=pg_temp.expiring_offer(); PERFORM pg_temp.bind_offer(o); n:=pg_temp.issue_id();
   UPDATE pg_temp.consent_fixture SET proposal=n;
   retry_result:=pg_temp.consent(jsonb_build_object(''offer'',o));
   IF retry_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expiring consent fixture failed: %'',retry_result; END IF;
   first_result:=pg_temp.requester_accept();
   IF first_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expiring materialization failed: %'',first_result; END IF;
   SET CONSTRAINTS ALL IMMEDIATE;
   SELECT expires_at INTO expiry FROM private.financial_proposals WHERE id=n;
   fingerprint:=pg_temp.materialization_sources();
   retry_result:=pg_temp.requester_accept();
   IF retry_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expected successful replay: %'',retry_result; END IF;
   IF retry_result IS DISTINCT FROM first_result OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN
    RAISE EXCEPTION ''Before-expiry replay changed persisted evidence''; END IF;
   IF clock_timestamp()>=expiry THEN RAISE EXCEPTION ''Before-expiry replay fixture expired too early''; END IF;
   PERFORM pg_sleep(greatest(0,extract(epoch FROM expiry-clock_timestamp()))+0.05);
   retry_result:=pg_temp.requester_accept();
   IF retry_result->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expected successful replay: %'',retry_result; END IF;
   IF retry_result IS DISTINCT FROM first_result OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN
    RAISE EXCEPTION ''Expired replay changed persisted graph''; END IF;
   IF (SELECT count(*) FROM public.alignments WHERE movement_need_id=(SELECT need FROM pg_temp.snapshot_fixture))<>1
    OR (SELECT count(*) FROM private.financial_agreements WHERE alignment_id=(first_result#>>''{rows,0,alignment_id}'')::uuid)<>1
    OR (SELECT count(*) FROM private.financial_components WHERE agreement_id=(first_result#>>''{rows,0,financial_agreement_id}'')::uuid)<>3 THEN
    RAISE EXCEPTION ''Expired replay duplicated materialization''; END IF;
  END $x$');
 -- Execute the real RPC, then deliberately abort the reviewed probe
 -- subtransaction. No production constraint or trigger is replaced/disabled.
 exact_before:=pg_temp.materialization_sources();
 PERFORM pg_temp.probe('successful materialization rolls back completely on transaction failure',
  'DO $x$ DECLARE r jsonb; BEGIN r:=pg_temp.requester_accept(); IF r->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Unexpected materialization failure: %'',r; END IF; END $x$');
 PERFORM pg_temp.snapshot_check('rollback restores every row and capacity',exact_before=pg_temp.materialization_sources());
 before:=pg_temp.materialization_sources(true); original:=to_jsonb(p);
 r:=pg_temp.requester_accept();
 PERFORM pg_temp.snapshot_check('exact requester succeeds',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1);
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p.id;
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p.alignment_id;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=p.financial_agreement_id;
 PERFORM pg_temp.snapshot_check('selected offer accepted',(SELECT status='accepted' FROM public.movement_offers WHERE id=f.movement_offer));
 PERFORM pg_temp.snapshot_check('need closed',(SELECT status='closed' FROM public.movement_needs WHERE id=f.need));
 PERFORM pg_temp.snapshot_check('genuine competing pending offer rejected',(SELECT status='rejected' FROM public.movement_offers o JOIN pg_temp.competing_offer c ON c.id=o.id));
 PERFORM pg_temp.snapshot_check('one authoritative alignment',(SELECT count(*)=1 FROM public.alignments WHERE movement_need_id=f.need));
 PERFORM pg_temp.snapshot_check('alignment shape and pre-payment status exact',a.movement_offer_id=f.movement_offer AND a.member_needing_movement_id=f.requester
  AND a.offering_member_id=f.offerer AND a.status='awaiting_activation_payment' AND a.activation_fee_minor IS NULL
  AND a.activation_currency='NGN' AND a.activated_at IS NULL);
 PERFORM pg_temp.snapshot_check('whole group capacity consumed once',(SELECT remaining_places=1 FROM private.offering_movement_availability WHERE id=f.availability));
 PERFORM pg_temp.snapshot_check('one agreement version scoped to new alignment',g.alignment_id=a.id AND g.version=1 AND (SELECT count(*)=1 FROM private.financial_agreements WHERE alignment_id=a.id));
 PERFORM pg_temp.snapshot_check('agreement principals exact',g.offering_member_id=p.offering_member_id AND g.member_needing_movement_id=p.member_needing_movement_id);
 PERFORM pg_temp.snapshot_check('agreement policies currency and fee exact',ROW(g.financial_model_version,g.pricing_policy_version,g.platform_fee_allocation_policy_version,g.currency,g.quoted_platform_fee_total_minor)
  IS NOT DISTINCT FROM ROW(p.financial_model_version,p.pricing_policy_version,p.platform_fee_allocation_policy_version,p.currency,p.quoted_platform_fee_total_minor));
 PERFORM pg_temp.snapshot_check('exactly three financial components',(SELECT count(*)=3 FROM private.financial_components WHERE agreement_id=g.id));
 PERFORM pg_temp.snapshot_check('offering share exact with platform beneficiary',EXISTS(SELECT 1 FROM private.financial_components WHERE agreement_id=g.id AND component_key='offering_platform_share'
  AND amount_minor=p.quoted_platform_fee_total_minor/2 AND responsible_member_id=f.offerer AND beneficiary_kind='platform' AND beneficiary_member_id IS NULL));
 PERFORM pg_temp.snapshot_check('requester share exact with odd remainder',EXISTS(SELECT 1 FROM private.financial_components WHERE agreement_id=g.id AND component_key='requester_platform_share'
  AND amount_minor=p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor/2 AND responsible_member_id=f.requester AND beneficiary_kind='platform' AND beneficiary_member_id IS NULL));
 PERFORM pg_temp.snapshot_check('movement contribution exact with offering beneficiary',EXISTS(SELECT 1 FROM private.financial_components WHERE agreement_id=g.id AND component_key='movement_contribution'
  AND amount_minor=p.quoted_movement_contribution_minor AND responsible_member_id=f.requester AND beneficiary_kind='member' AND beneficiary_member_id=f.offerer));
 PERFORM pg_temp.snapshot_check('offering acceptance preserved',p.offering_accepted_at=(original->>'offering_accepted_at')::timestamptz AND g.offering_accepted_at=p.offering_accepted_at);
 PERFORM pg_temp.snapshot_check('database acceptance and materialization timestamps ordered',p.requester_accepted_at>=p.offering_accepted_at AND p.materialized_at>=p.requester_accepted_at
  AND p.materialized_at<p.expires_at AND p.materialized_at<=clock_timestamp() AND g.requester_accepted_at=p.requester_accepted_at);
 PERFORM pg_temp.snapshot_check('proposal economics provenance and offering link immutable',
  to_jsonb(p)-ARRAY['requester_accepted_at','alignment_id','financial_agreement_id','materialized_at']=original-ARRAY['requester_accepted_at','alignment_id','financial_agreement_id','materialized_at']);
 PERFORM pg_temp.snapshot_check('no wallet payment hold funding activation journey review or unrelated writes',before=pg_temp.materialization_sources(true));
 PERFORM pg_temp.snapshot_check('no journey for materialized alignment',NOT EXISTS(SELECT 1 FROM public.journeys WHERE alignment_id=a.id));
 PERFORM pg_temp.snapshot_check('exact nine-field safe result',r->'rows'=jsonb_build_array(jsonb_build_object(
  'proposal_id',p.id,'proposal_version',p.version,'proposal_status','current','movement_offer_id',p.movement_offer_id,
  'alignment_id',a.id,'alignment_status',a.status,'financial_agreement_id',g.id,
  'requester_accepted_at',p.requester_accepted_at,'materialized_at',p.materialized_at)));
 exact_before:=pg_temp.materialization_sources(); again:=pg_temp.requester_accept();
 PERFORM pg_temp.snapshot_check('immediate replay independently succeeds',again->>'ok' IS NOT DISTINCT FROM 'true',again::text);
 PERFORM pg_temp.snapshot_check('exact replay preserves authoritative IDs and timestamps',r->>'ok' IS NOT DISTINCT FROM 'true' AND again->>'ok' IS NOT DISTINCT FROM 'true' AND again=r);
 PERFORM pg_temp.snapshot_check('replay has zero persistent writes',exact_before=pg_temp.materialization_sources());
 PERFORM pg_temp.probe('proposal materialization links immutable',format('UPDATE private.financial_proposals SET alignment_id=gen_random_uuid() WHERE id=%L',p.id),'23514','immutable');
 PERFORM pg_temp.probe('agreement economics immutable',format('UPDATE private.financial_agreements SET quoted_platform_fee_total_minor=quoted_platform_fee_total_minor+1 WHERE id=%L',g.id),'23514','immutable');
 PERFORM pg_temp.probe('component amount immutable',format('UPDATE private.financial_components SET amount_minor=amount_minor+1 WHERE agreement_id=%L',g.id),'23514','immutable');
 PERFORM pg_temp.probe('agreement consent write-once',format('UPDATE private.financial_agreements SET requester_accepted_at=clock_timestamp() WHERE id=%L',g.id),'23514','write-once');
 PERFORM pg_temp.probe('historical superseded agreement replay has zero writes',format(
  'DO $x$ DECLARE original jsonb; again jsonb; fingerprint text; BEGIN
   original:=pg_temp.requester_accept();
   IF original->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expected successful original replay: %%'',original; END IF;
   UPDATE private.financial_agreements SET status=''superseded'' WHERE id=%L;
   SET CONSTRAINTS private.financial_agreement_complete IMMEDIATE;
   fingerprint:=pg_temp.materialization_sources(); again:=pg_temp.requester_accept();
   IF again->>''ok'' IS DISTINCT FROM ''true'' THEN RAISE EXCEPTION ''Expected successful historical replay: %%'',again; END IF;
   IF again IS DISTINCT FROM original OR fingerprint IS DISTINCT FROM pg_temp.materialization_sources() THEN
    RAISE EXCEPTION ''Historical agreement replay changed evidence''; END IF;
  END $x$',g.id));
 PERFORM pg_temp.probe('malformed alignment binding rejected',format(
  'DO $x$ DECLARE p private.financial_proposals%%ROWTYPE; BEGIN SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=%L;
   p.alignment_id:=gen_random_uuid(); PERFORM private.assert_financial_proposal_materialization(p); END $x$',p.id),'23514','Materialized alignment unavailable');
 -- Activated/in-progress/completed/cancelled transitions require payment/journey
 -- prerequisites outside this fixture. Focused portable tests pin the real
 -- lifecycle producers and replay acceptance; integration remains unexecuted.

 PERFORM pg_temp.probe('partial materialization is rejected rather than repaired',format(
  'DO $x$ DECLARE p private.financial_proposals%%ROWTYPE; BEGIN SELECT * INTO STRICT p FROM private.financial_proposals WHERE id=%L; p.financial_agreement_id:=NULL; PERFORM private.assert_financial_proposal_materialization(p); END $x$',p.id),'23514','Complete consistent');
 r:=pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.accept_movement_offer(%L)',f.movement_offer));
 PERFORM pg_temp.snapshot_check('legacy cutover remains blocked after materialization',r->>'ok'='false' AND r->>'state'='23514');
END $tests$;

SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN
 RAISE EXCEPTION '0077 behavioral checks failed'; END IF; END $$;
ROLLBACK;
