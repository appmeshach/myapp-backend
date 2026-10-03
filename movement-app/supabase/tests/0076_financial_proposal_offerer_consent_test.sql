BEGIN;
-- Requires the reviewed 0074 normal-producer fixture prefix (behavior runner).
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.probe('legacy operational behavior retained outside financial cutover',
 'DO $x$ DECLARE f record; r jsonb; BEGIN
  SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
  r:=pg_temp.snapshot_select_as(''authenticated'',f.requester,format(''SELECT * FROM public.accept_movement_offer(%L)'',f.movement_offer));
  IF r->>''ok'' IS DISTINCT FROM ''true''
   OR NOT EXISTS(SELECT 1 FROM public.movement_offers WHERE id=f.movement_offer AND status=''accepted'')
   OR NOT EXISTS(SELECT 1 FROM public.movement_needs WHERE id=f.need AND status=''closed'')
   OR NOT EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=f.need AND status=''awaiting_activation_payment'')
   OR EXISTS(SELECT 1 FROM private.financial_proposals WHERE movement_need_id=f.need)
   OR EXISTS(SELECT 1 FROM public.journeys j JOIN public.alignments a ON a.id=j.alignment_id WHERE a.movement_need_id=f.need)
  THEN RAISE EXCEPTION ''Legacy cutover regression: %'',r; END IF;
 END $x$');
CREATE TEMP TABLE pg_temp.consent_fixture AS SELECT pg_temp.issue_id() AS proposal;
SET CONSTRAINTS ALL IMMEDIATE;
CREATE TEMP TABLE pg_temp.competing_offer AS SELECT pg_temp.new_offer() AS id;

CREATE FUNCTION pg_temp.consent(p_overrides jsonb DEFAULT '{}', p_member uuid DEFAULT NULL,
  p_role text DEFAULT 'authenticated', p_missing_identity boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE f record; p private.financial_proposals%ROWTYPE; args jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x JOIN pg_temp.consent_fixture c ON c.proposal=x.id;
 args:=jsonb_build_object('proposal',p.id,'version',p.version,'offer',f.movement_offer)||p_overrides;
 RETURN pg_temp.snapshot_select_as(p_role,CASE WHEN p_missing_identity THEN NULL ELSE coalesce(p_member,f.offerer) END,
  format('SELECT * FROM public.accept_my_financial_proposal_as_offerer(%L::uuid,%L::integer,%L::uuid)',
   args->>'proposal',args->>'version',args->>'offer'));
END $$;
CREATE FUNCTION pg_temp.consent_rejected(r jsonb, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF r->>'ok' IS DISTINCT FROM 'false' OR r->>'state' IS DISTINCT FROM expected THEN
 RAISE EXCEPTION 'Expected consent rejection %, observed %',expected,r; END IF; END $$;

-- Independent legitimate owners/needs. Offer authorization is never fabricated:
-- endpoints -> intake -> trusted route/match -> availability -> real offer RPC.
CREATE FUNCTION pg_temp.foreign_offer(p_same_need boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE f record; owner_id uuid:=gen_random_uuid(); requester_id uuid:=gen_random_uuid();
 origin_id uuid; destination_id uuid; need_id uuid; intent_id uuid; route_id uuid;
 match_id uuid; availability_id uuid; offer_id uuid; r jsonb;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 SELECT id,'authenticated','authenticated',id::text||'@test-0076.invalid',clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb FROM unnest(ARRAY[owner_id,requester_id]) u(id);
 INSERT INTO public.member_vehicle_access(member_id,vehicle_id,active) VALUES(owner_id,f.vehicle,true);
 IF p_same_need THEN need_id:=f.need;
 ELSE
  origin_id:=pg_temp.snapshot_state_endpoint(requester_id,'Agungi, Lagos','0076-origin-'||requester_id,6.4300,3.5200);
  destination_id:=pg_temp.snapshot_state_endpoint(requester_id,'Oniru, Lagos','0076-destination-'||requester_id,6.4310,3.4430);
  r:=pg_temp.snapshot_select_as('authenticated',requester_id,format(
   'SELECT * FROM public.create_movement_need(%L,%L,%L,%L,%L,1)',gen_random_uuid(),origin_id,destination_id,
   statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours'));
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign need failed: %',r; END IF;
  need_id:=(r#>>'{rows,0,movement_need_id}')::uuid;
 END IF;
 origin_id:=pg_temp.snapshot_state_endpoint(owner_id,'Ajah, Lagos','0076-origin-'||owner_id,6.4698,3.5852);
 destination_id:=pg_temp.snapshot_state_endpoint(owner_id,'Victoria Island, Lagos','0076-destination-'||owner_id,6.4281,3.4219);
 BEGIN
  SET CONSTRAINTS private.offering_intent_complete DEFERRED;
  r:=pg_temp.snapshot_select_as('authenticated',owner_id,format(
   'SELECT * FROM public.create_offering_movement_intent(%L,%L,%L,%L,%L)',gen_random_uuid(),origin_id,destination_id,
   statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours'));
  IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign intent failed: %',r; END IF;
  intent_id:=(r#>>'{rows,0,offering_movement_intent_id}')::uuid;
  SET CONSTRAINTS private.offering_intent_complete IMMEDIATE;
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 r:=pg_temp.snapshot_route(intent_id,'0076-route-'||intent_id);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign route failed: %',r; END IF;
 route_id:=(r#>>'{rows,0,route_evidence_id}')::uuid;
 r:=pg_temp.snapshot_match(need_id,intent_id,route_id,1);
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign match failed: %',r; END IF;
 match_id:=(r#>>'{rows,0,route_match_evidence_id}')::uuid;
 r:=pg_temp.snapshot_select_as('authenticated',owner_id,format(
  'SELECT * FROM public.open_offering_movement_availability(%L,%L,%L,3)',gen_random_uuid(),intent_id,f.vehicle));
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign availability failed: %',r; END IF;
 availability_id:=(r#>>'{rows,0,availability_id}')::uuid;
 r:=pg_temp.snapshot_select_as('authenticated',owner_id,format(
  'SELECT * FROM public.create_movement_offer(%L,%L,%L,3,''Chevron pickup'',''Oniru dropoff'',18)',need_id,match_id,availability_id));
 IF r->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Foreign offer failed: %',r; END IF;
 offer_id:=(r#>>'{rows,0,movement_offer_id}')::uuid;
 RETURN offer_id;
END $$;

-- A complete data fingerprint excluding ONLY the two permitted consent fields.
-- Includes operational/financial/payment/wallet tables, all provenance/rosters,
-- competing offers, capacity and proposal economics, so hidden writes fail.
CREATE FUNCTION pg_temp.consent_sources() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; h text; result text:=''; BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations')
  ORDER BY n.nspname,c.relname LOOP
  IF r.nspname='private' AND r.relname='financial_proposals' THEN
   SELECT md5(coalesce(string_agg((CASE WHEN p.id=(SELECT proposal FROM pg_temp.consent_fixture)
     THEN to_jsonb(p)-ARRAY['movement_offer_id','offering_accepted_at'] ELSE to_jsonb(p) END)::text,'' ORDER BY p.id),''))
    INTO h FROM private.financial_proposals p;
  ELSE
   EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',r.nspname,r.relname) INTO h;
  END IF;
  result:=result||r.nspname||'.'||r.relname||':'||h;
 END LOOP;
 RETURN md5(result);
END $$;

DO $tests$
DECLARE f record; p private.financial_proposals%ROWTYPE; r jsonb; retry jsonb; before text;
 change jsonb; field text; original jsonb; expiry timestamptz;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x JOIN pg_temp.consent_fixture c ON c.proposal=x.id;
 FOR field IN SELECT unnest(ARRAY['proposal','version','offer']) LOOP
  r:=pg_temp.consent(jsonb_build_object(field,NULL));
  PERFORM pg_temp.snapshot_check('NULL '||field||' rejected',r->>'ok'='false' AND r->>'state'='22004');
 END LOOP;
 FOR change IN SELECT value FROM jsonb_array_elements('[{"version":0},{"version":-1},{"version":2},{"offer":"00000000-0000-4000-8000-000000000076"}]') LOOP
  r:=pg_temp.consent(change);
  PERFORM pg_temp.snapshot_check('invalid selector '||change::text,r->>'ok'='false' AND r->>'state'='23514');
 END LOOP;
 r:=pg_temp.consent(jsonb_build_object('proposal',gen_random_uuid()));
 PERFORM pg_temp.snapshot_check('absent proposal fails closed',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.consent('{"offer":"malformed"}');
 PERFORM pg_temp.snapshot_check('malformed typed UUID rejected',r->>'ok'='false' AND r->>'state'='22P02');
 r:=pg_temp.consent('{}',f.requester);
 PERFORM pg_temp.snapshot_check('requester denied offerer consent',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.consent('{}',f.traveller);
 PERFORM pg_temp.snapshot_check('invited traveller role denied',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.consent('{}',gen_random_uuid());
 PERFORM pg_temp.snapshot_check('unmapped caller denied',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.consent('{}',NULL,'authenticated',true);
 PERFORM pg_temp.snapshot_check('missing identity denied',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.consent('{}',f.offerer,'anon');
 PERFORM pg_temp.snapshot_check('anon execute denied',r->>'ok'='false' AND r->>'state'='42501');
 r:=pg_temp.consent('{}',f.offerer,'service_role');
 PERFORM pg_temp.snapshot_check('service role execute denied',r->>'ok'='false' AND r->>'state'='42501');
 PERFORM pg_temp.snapshot_check('private table mutations and reads denied',
  NOT has_table_privilege('authenticated','private.financial_proposals','UPDATE')
  AND NOT has_table_privilege('authenticated','private.financial_proposals','SELECT')
  AND NOT has_table_privilege('authenticated','private.financial_proposal_travellers','INSERT'));
 PERFORM pg_temp.snapshot_check('legacy internal has no callable member/server grant',
  NOT has_function_privilege('authenticated','private.accept_movement_offer_legacy_internal(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','private.accept_movement_offer_legacy_internal(uuid)','EXECUTE'));
 PERFORM pg_temp.probe('superseded proposal rejected',format('UPDATE private.financial_proposals SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',p.id));
 PERFORM pg_temp.probe('withdrawn offer rejected',format('UPDATE public.movement_offers SET status=''withdrawn'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.movement_offer));
 PERFORM pg_temp.probe('closed need rejected',format('UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.need));
 PERFORM pg_temp.probe('lost vehicle access rejected',format('UPDATE public.member_vehicle_access SET active=false WHERE vehicle_id=%L AND member_id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.vehicle,f.offerer));
 PERFORM pg_temp.probe('changed vehicle capacity rejected',format('UPDATE public.vehicles SET seat_capacity=3 WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.vehicle));
 PERFORM pg_temp.probe('live roster mutation rejected',format('UPDATE public.movement_participants SET status=''invited'' WHERE movement_need_id=%L AND member_id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.need,f.traveller));
 PERFORM pg_temp.probe('availability withdrawal rejected',format('UPDATE private.offering_movement_availability SET status=''withdrawn'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.availability));
 PERFORM pg_temp.probe('terminal quote rejected',format('UPDATE private.pricing_quotes SET status=''superseded'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',p.pricing_quote_id));
 PERFORM pg_temp.probe('different genuine offer with identical terms rejected',
  'SELECT pg_temp.consent_rejected(pg_temp.consent(jsonb_build_object(''offer'',pg_temp.new_offer())),''23514'')');
 PERFORM pg_temp.probe('same need different genuine offerer rejected',
  'SELECT pg_temp.consent_rejected(pg_temp.consent(jsonb_build_object(''offer'',pg_temp.foreign_offer(true))),''23514'')');
 PERFORM pg_temp.probe('legacy competing offer cannot bypass financial cutover',
  'DO $x$ DECLARE o uuid; f record; r jsonb; BEGIN o:=pg_temp.foreign_offer(true);
   SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
   r:=pg_temp.snapshot_select_as(''authenticated'',f.requester,format(''SELECT * FROM public.accept_movement_offer(%L)'',o));
   PERFORM pg_temp.consent_rejected(r,''23514'');
   IF r->>''message'' IS DISTINCT FROM ''Financial proposal sequence requires financial requester materialization''
    THEN RAISE EXCEPTION ''Wrong legacy guard rejection: %'',r; END IF; END $x$');
 PERFORM pg_temp.probe('different need genuine offer rejected',
  'SELECT pg_temp.consent_rejected(pg_temp.consent(jsonb_build_object(''offer'',pg_temp.foreign_offer(false))),''23514'')');
 PERFORM pg_temp.probe('unrelated existing member denied',
  'DO $x$ DECLARE o uuid; m uuid; BEGIN o:=pg_temp.foreign_offer(false);
   SELECT offering_member_id INTO m FROM public.movement_offers WHERE id=o;
   PERFORM pg_temp.consent_rejected(pg_temp.consent(''{}'',m),''42501''); END $x$');
 PERFORM pg_temp.probe('changed pickup declaration rejected',format('UPDATE public.movement_offers SET proposed_pickup_area=''Different pickup'' WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.movement_offer));
 PERFORM pg_temp.probe('changed seats declaration rejected',format('UPDATE public.movement_offers SET seats_offered=2 WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.movement_offer));
 PERFORM pg_temp.probe('changed dropoff declaration rejected',format('UPDATE public.movement_offers SET proposed_dropoff_area=NULL WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.movement_offer));
 PERFORM pg_temp.probe('changed arrival declaration rejected',format('UPDATE public.movement_offers SET estimated_arrival_minutes=19 WHERE id=%L; SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.movement_offer));
 PERFORM pg_temp.probe('active alignment blocks consent',format(
  'INSERT INTO public.alignments(movement_need_id,movement_offer_id,member_needing_movement_id,offering_member_id,activation_currency,status) VALUES(%L,%L,%L,%L,''NGN'',''awaiting_activation_payment''); SELECT pg_temp.consent_rejected(pg_temp.consent(),''23514'')',f.need,f.movement_offer,f.requester,f.offerer));
 r:=pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.accept_movement_offer(%L)',f.movement_offer));
 PERFORM pg_temp.snapshot_check('legacy requester acceptance cannot bypass unconsented financial history',
  r->>'ok'='false' AND r->>'state'='23514' AND r->>'message'='Financial proposal sequence requires financial requester materialization');

 before:=pg_temp.consent_sources(); original:=to_jsonb(p);
 r:=pg_temp.consent();
 PERFORM pg_temp.snapshot_check('exact offerer successfully consents',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1);
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p.id;
 PERFORM pg_temp.snapshot_check('exact five-field consent evidence response',r->'rows'=jsonb_build_array(jsonb_build_object(
  'proposal_id',p.id,'proposal_version',p.version,'proposal_status','current',
  'movement_offer_id',f.movement_offer,'offering_accepted_at',p.offering_accepted_at)));
 PERFORM pg_temp.snapshot_check('binding and offering consent atomic',p.movement_offer_id=f.movement_offer AND p.offering_accepted_at IS NOT NULL);
 PERFORM pg_temp.snapshot_check('database timestamp bounded',p.offering_accepted_at>=p.created_at AND p.offering_accepted_at<p.expires_at AND p.offering_accepted_at<=clock_timestamp());
 PERFORM pg_temp.snapshot_check('offer remains pending',(SELECT status='pending' FROM public.movement_offers WHERE id=f.movement_offer));
 PERFORM pg_temp.snapshot_check('genuine competing offer remains pending',
  (SELECT o.status='pending' FROM public.movement_offers o JOIN pg_temp.competing_offer c ON c.id=o.id));
 PERFORM pg_temp.snapshot_check('need remains discoverable',(SELECT status='discoverable' FROM public.movement_needs WHERE id=f.need));
 PERFORM pg_temp.snapshot_check('no alignment agreement or materialization',p.alignment_id IS NULL AND p.financial_agreement_id IS NULL AND p.materialized_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.alignments WHERE movement_need_id=f.need));
 PERFORM pg_temp.snapshot_check('requester acceptance remains NULL',p.requester_accepted_at IS NULL);
 PERFORM pg_temp.snapshot_check('no wallet ledger payment obligation journey capacity or competing offer writes',before=pg_temp.consent_sources());
 PERFORM pg_temp.snapshot_check('economics provenance roster and other fields unchanged',
  to_jsonb(p)-ARRAY['movement_offer_id','offering_accepted_at']=original-ARRAY['movement_offer_id','offering_accepted_at']);
 original:=to_jsonb(p); retry:=pg_temp.consent();
 PERFORM pg_temp.snapshot_check('exact retry returns same timestamp and exact response',retry=r);
 PERFORM pg_temp.snapshot_check('retry performs no additional writes',original=(SELECT to_jsonb(x) FROM private.financial_proposals x WHERE x.id=p.id) AND before=pg_temp.consent_sources());
 PERFORM pg_temp.probe('write-once consent protected',format('UPDATE private.financial_proposals SET offering_accepted_at=clock_timestamp() WHERE id=%L',p.id),'23514','write-once');
 PERFORM pg_temp.probe('different already-bound offer rejected',format('UPDATE private.financial_proposals SET movement_offer_id=gen_random_uuid() WHERE id=%L',p.id),'23514','historical snapshot source');
 PERFORM pg_temp.probe('requester acceptance cannot persist without materialization',format('UPDATE private.financial_proposals SET requester_accepted_at=clock_timestamp() WHERE id=%L; SET CONSTRAINTS private.financial_proposal_complete IMMEDIATE',p.id),'23514','same transaction');
 r:=pg_temp.snapshot_select_as('authenticated',f.requester,format('SELECT * FROM public.accept_movement_offer(%L)',f.movement_offer));
 PERFORM pg_temp.snapshot_check('legacy requester acceptance cannot bypass consented proposal',r->>'ok'='false' AND r->>'state'='23514');
END $tests$;

SELECT pg_temp.probe('NULL optional declarations consent uses exact genuine source',
 'DO $x$ DECLARE o uuid; n uuid; r jsonb; BEGIN
  UPDATE private.financial_proposals SET status=''superseded'' WHERE id=(SELECT proposal FROM pg_temp.consent_fixture);
  o:=pg_temp.new_offer(true); PERFORM pg_temp.bind_offer(o); n:=pg_temp.issue_id();
  UPDATE pg_temp.consent_fixture SET proposal=n;
  r:=pg_temp.consent(jsonb_build_object(''offer'',o));
  IF r->>''ok'' IS DISTINCT FROM ''true'' OR NOT EXISTS(SELECT 1 FROM private.financial_proposals
   WHERE id=n AND movement_offer_id=o AND offering_accepted_at IS NOT NULL
    AND proposed_pickup_area IS NULL AND proposed_dropoff_area IS NULL AND estimated_arrival_minutes IS NULL)
  THEN RAISE EXCEPTION ''NULL consent fixture failed: %'',r; END IF;
 END $x$');

-- A separate subtransaction proves natural expiry without editing history.
SELECT pg_temp.probe('expired proposal rejected through normal expiring producers',
 'DO $x$ DECLARE n uuid; expiry timestamptz; BEGIN
  UPDATE private.financial_proposals SET status=''superseded'' WHERE id=(SELECT proposal FROM pg_temp.consent_fixture);
  PERFORM pg_temp.bind_offer(pg_temp.expiring_offer()); n:=pg_temp.issue_id();
  UPDATE pg_temp.consent_fixture SET proposal=n;
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT expires_at INTO expiry FROM private.financial_proposals WHERE id=n;
  PERFORM pg_sleep(greatest(0,extract(epoch FROM expiry-clock_timestamp()))+0.05);
  PERFORM pg_temp.consent_rejected(pg_temp.consent(jsonb_build_object(''offer'',(SELECT movement_offer_id FROM private.movement_context_snapshots WHERE id=(SELECT snapshot_id FROM pg_temp.binding_fixture)))),''23514'');
 END $x$');

SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN
 RAISE EXCEPTION '0076 behavioral checks failed'; END IF; END $$;
ROLLBACK;
