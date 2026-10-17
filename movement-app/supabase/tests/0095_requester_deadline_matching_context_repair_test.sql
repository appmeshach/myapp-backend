-- Executed after the unchanged 0052 production-producer fixture prefix.
DO $tests$
DECLARE a record; n record; r jsonb; stamp timestamptz; before_rows jsonb;
BEGIN
 SELECT * INTO a FROM pg_temp.interest_offering_fixture('0095-offerer',3);
 SELECT * INTO n FROM pg_temp.interest_requester_fixture('0095-requester',1);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.interest_check('future effective deadline usable',r->>'ok'='true');
 PERFORM pg_temp.interest_check('unchanged output has exactly 23 columns',(SELECT count(*) FROM jsonb_object_keys(r->'rows'->0))=23);
 before_rows:=pg_temp.interest_operational_snapshot();
 PERFORM public.get_trusted_matching_context_for_server(n.movement_need_id,a.intent_id,a.member_id);
 PERFORM pg_temp.interest_check('context has no operational writes',before_rows=pg_temp.interest_operational_snapshot());
 stamp:=clock_timestamp()+interval '2 seconds';
 UPDATE public.movement_needs SET earliest_departure_at=stamp,latest_departure_at=stamp+interval '2 seconds' WHERE id=n.movement_need_id;
 PERFORM pg_sleep(greatest(0,extract(epoch FROM stamp-clock_timestamp()))+0.05);
 PERFORM public.get_trusted_matching_context_for_server(n.movement_need_id,a.intent_id,a.member_id);
 PERFORM pg_temp.interest_check('future latest authoritative despite elapsed earliest',true);
 PERFORM pg_sleep(greatest(0,extract(epoch FROM stamp+interval '2 seconds'-clock_timestamp()))+0.05);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.deadline_denied('elapsed latest rejected',r);
 stamp:=clock_timestamp()+interval '2 seconds';
 UPDATE public.movement_needs SET earliest_departure_at=stamp,latest_departure_at=NULL WHERE id=n.movement_need_id;
 PERFORM public.get_trusted_matching_context_for_server(n.movement_need_id,a.intent_id,a.member_id);
 PERFORM pg_temp.interest_check('future earliest used with NULL latest',true);
 PERFORM pg_sleep(greatest(0,extract(epoch FROM stamp-clock_timestamp()))+0.05);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.deadline_denied('elapsed earliest fallback rejected including inclusive boundary',r);
 PERFORM pg_temp.interest_check('open availability cannot revive expired requester',(SELECT status='open' FROM private.offering_movement_availability WHERE id=a.availability_id));
 PERFORM pg_temp.freeze_roster_parent(a.availability_id);
 PERFORM pg_temp.interest_check('real authoritative start preserves unavailable roster state',EXISTS(SELECT 1 FROM private.offering_movement_roster_freezes WHERE availability_id=a.availability_id));
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.deadline_denied('roster freeze cannot revive expired requester',r);
 r:=pg_temp.interest_as('service_role',NULL,format('SELECT * FROM public.get_authorized_trusted_matching_context_for_server(%L,%L,%L)',gen_random_uuid(),n.movement_need_id,a.intent_id));
 PERFORM pg_temp.interest_check('unauthorized participant remains denied before temporal detail',r->>'state'='42501' AND r->>'message'='Member is not authorized for this trusted matching context');
 r:=pg_temp.interest_as('authenticated',n.member_id,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.interest_check('authenticated direct context denied',r->>'state'='42501');
 r:=pg_temp.interest_as('anon',NULL,format('SELECT * FROM public.get_trusted_matching_context_for_server(%L,%L,%L)',n.movement_need_id,a.intent_id,a.member_id));
 PERFORM pg_temp.interest_check('anonymous direct context denied',r->>'state'='42501');
END $tests$;
TABLE pg_temp.interest_results;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_temp.interest_results WHERE NOT passed) THEN RAISE EXCEPTION '0095 SQL checks failed'; END IF;
 IF (SELECT count(*) FROM pg_temp.interest_results)<>13 THEN RAISE EXCEPTION '0095 expected 13 focused checks'; END IF;
END $$;
ROLLBACK;
