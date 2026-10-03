BEGIN;
-- Runner prepends the reviewed 0074 normal-producer fixtures in this transaction.
CREATE FUNCTION pg_temp.read_proposal(p_id uuid,p_member uuid,p_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
 RETURN pg_temp.snapshot_select_as(p_role,p_member,format('SELECT * FROM public.get_my_financial_proposal(%L::uuid)',p_id));
END $$;

CREATE FUNCTION pg_temp.projection_fingerprint() RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; h text; result text:='';
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind='r' AND n.nspname IN ('public','private','auth','supabase_migrations') ORDER BY n.nspname,c.relname LOOP
  EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(t)::text, '''' ORDER BY to_jsonb(t)::text), '''')) FROM %I.%I t',r.nspname,r.relname) INTO h;
  result:=result||r.nspname||'.'||r.relname||':'||h;
 END LOOP;
 RETURN md5(result);
END $$;

DO $tests$
DECLARE f record; p uuid; r jsonb; o jsonb; foreign_result jsonb; before text; keys text[];
 n uuid; expiry timestamptz; stored record;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 p:=pg_temp.issue_id();
 SELECT * INTO STRICT stored FROM private.financial_proposals WHERE id=p;
 before:=pg_temp.projection_fingerprint();
 r:=pg_temp.read_proposal(p,f.requester); o:=pg_temp.read_proposal(p,f.offerer);
 PERFORM pg_temp.snapshot_check('requester principal authorized',r->>'ok'='true' AND jsonb_array_length(r->'rows')=1 AND r#>>'{rows,0,caller_role}'='requester');
 PERFORM pg_temp.snapshot_check('offering principal authorized',o->>'ok'='true' AND jsonb_array_length(o->'rows')=1 AND o#>>'{rows,0,caller_role}'='offerer');
 PERFORM pg_temp.snapshot_check('principals see identical immutable terms',((r#>'{rows,0}')-'caller_role')=((o#>'{rows,0}')-'caller_role'));
 SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(r#>'{rows,0}') k;
 PERFORM pg_temp.snapshot_check('exact safe fields exclude provenance',keys=(SELECT array_agg(k ORDER BY k) FROM unnest(ARRAY[
  'proposal_id','proposal_version','proposal_status','created_at','expires_at','caller_role','currency',
  'quoted_platform_fee_total_minor','quoted_movement_contribution_minor','origin_area','destination_area',
  'earliest_departure_at','latest_departure_at','people_count','seats_offered','vehicle_seat_capacity',
  'proposed_pickup_area','proposed_dropoff_area','estimated_arrival_minutes','offering_accepted_at','requester_accepted_at']) k));
 PERFORM pg_temp.snapshot_check('stored economics and movement projected exactly',
  (r#>>'{rows,0,quoted_platform_fee_total_minor}')::bigint=stored.quoted_platform_fee_total_minor
  AND (r#>>'{rows,0,quoted_movement_contribution_minor}')::bigint=stored.quoted_movement_contribution_minor
  AND r#>>'{rows,0,origin_area}'=stored.origin_area AND r#>>'{rows,0,destination_area}'=stored.destination_area
  AND (r#>>'{rows,0,people_count}')::integer=stored.people_count);
 foreign_result:=pg_temp.read_proposal(p,f.traveller);
 PERFORM pg_temp.snapshot_check('invited traveller has no principal access',foreign_result=jsonb_build_object('ok',true,'rows','[]'::jsonb));
 PERFORM pg_temp.snapshot_check('unknown and unauthorized indistinguishable',pg_temp.read_proposal(gen_random_uuid(),f.traveller)=foreign_result);
 PERFORM pg_temp.snapshot_check('NULL ID returns empty',pg_temp.read_proposal(NULL,f.requester)=foreign_result);
 PERFORM pg_temp.snapshot_check('unmapped member returns empty',pg_temp.read_proposal(p,gen_random_uuid())=foreign_result);
 PERFORM pg_temp.snapshot_check('missing auth identity returns empty',pg_temp.read_proposal(p,NULL)=foreign_result);
 o:=pg_temp.read_proposal(p,NULL,'anon');
 PERFORM pg_temp.snapshot_check('anon denied',o->>'ok'='false' AND o->>'state'='42501');
 o:=pg_temp.read_proposal(p,f.requester,'service_role');
 PERFORM pg_temp.snapshot_check('service role denied',o->>'ok'='false' AND o->>'state'='42501');
 PERFORM pg_temp.snapshot_check('authenticated private tables still denied',NOT has_table_privilege('authenticated','private.financial_proposals','SELECT')
  AND NOT has_table_privilege('authenticated','private.financial_proposal_travellers','SELECT')
  AND NOT has_table_privilege('authenticated','private.pricing_quotes','SELECT')
  AND NOT has_table_privilege('authenticated','private.movement_context_snapshots','SELECT'));
 PERFORM pg_temp.snapshot_check('current status faithful',r#>>'{rows,0,proposal_status}'='current');
 PERFORM pg_temp.snapshot_check('expiry faithful',(r#>>'{rows,0,expires_at}')::timestamptz=stored.expires_at);
 PERFORM pg_temp.snapshot_check('NULL consent faithfully projected',r#>'{rows,0,offering_accepted_at}'='null'::jsonb AND r#>'{rows,0,requester_accepted_at}'='null'::jsonb);
 PERFORM pg_temp.snapshot_check('projection writes no persistent data',before=pg_temp.projection_fingerprint());
 PERFORM pg_temp.snapshot_check('definer and empty search path',EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.get_my_financial_proposal(uuid)'::regprocedure AND prosecdef AND proconfig=ARRAY['search_path=""']));
 o:=pg_temp.snapshot_select_as('authenticated',f.requester,'SELECT * FROM public.get_my_financial_proposal(''malformed''::uuid)');
 PERFORM pg_temp.snapshot_check('malformed UUID rejected by typed boundary',o->>'ok'='false' AND o->>'state'='22P02');
 UPDATE private.financial_proposals SET status='superseded' WHERE id=p;
 r:=pg_temp.read_proposal(p,f.requester); o:=pg_temp.read_proposal(p,f.offerer);
 PERFORM pg_temp.snapshot_check('historical superseded accessible to both',r#>>'{rows,0,proposal_status}'='superseded' AND o#>>'{rows,0,proposal_status}'='superseded');
 -- Normal producer chain: nullable declarations, with a naturally short lifetime.
 PERFORM pg_temp.bind_offer(pg_temp.expiring_offer(true)); n:=pg_temp.issue_id();
 r:=pg_temp.read_proposal(n,f.requester);
 PERFORM pg_temp.snapshot_check('NULL optional movement fields preserved',r#>'{rows,0,proposed_pickup_area}'='null'::jsonb
  AND r#>'{rows,0,proposed_dropoff_area}'='null'::jsonb AND r#>'{rows,0,estimated_arrival_minutes}'='null'::jsonb);
 SELECT expires_at INTO expiry FROM private.financial_proposals WHERE id=n;
 SET CONSTRAINTS ALL IMMEDIATE;
 PERFORM pg_sleep(greatest(0,extract(epoch FROM expiry-clock_timestamp()))+0.05);
 r:=pg_temp.read_proposal(n,f.requester);
 PERFORM pg_temp.snapshot_check('expired proposal remains truthful exact-ID history',r->>'ok'='true'
  AND (r#>>'{rows,0,expires_at}')::timestamptz=expiry AND r#>>'{rows,0,proposal_status}'='current');
END $tests$;
SET CONSTRAINTS ALL IMMEDIATE;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN
 RAISE EXCEPTION '0075 behavioral checks failed'; END IF; END $$;
ROLLBACK;
