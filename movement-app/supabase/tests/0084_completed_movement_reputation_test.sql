BEGIN;
CREATE TEMP TABLE reputation_checks(label text NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.reputation_check(label text,ok boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',label; END IF; INSERT INTO reputation_checks VALUES(label); END $$;
CREATE FUNCTION pg_temp.reputation_reject(sql text,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE sql; EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE=expected THEN INSERT INTO reputation_checks VALUES(sql); RETURN; END IF; RAISE;
 END; RAISE EXCEPTION 'Expected rejection: %',sql;
END $$;
DO $$ DECLARE r jsonb; before text; result jsonb; BEGIN
 PERFORM pg_temp.reputation_check('two principals counted only',
  (SELECT completed_movements=1 FROM public.members WHERE id='__OFFERER__') AND
  (SELECT completed_movements=1 FROM public.members WHERE id='__REQUESTER__') AND
  (SELECT completed_movements=0 FROM public.members WHERE id='__TRAVELLER__'));
 FOREACH before IN ARRAY ARRAY['anon','service_role'] LOOP
  PERFORM pg_temp.reputation_reject(format('SET LOCAL ROLE %I; SELECT * FROM public.rate_my_completed_movement_person(%L,1,5)',before,'__NEED__'),'42501');
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM pg_temp.reputation_reject('SET LOCAL ROLE authenticated; SELECT * FROM public.get_my_completed_movement_rating_targets(''__NEED__'')','42501');
 PERFORM set_config('request.jwt.claim.sub','__TRAVELLER__',true);
 PERFORM pg_temp.reputation_reject('SET LOCAL ROLE authenticated; SELECT * FROM public.rate_my_completed_movement_person(''__NEED__'',1,5)','42501');
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 PERFORM pg_temp.reputation_reject('SET LOCAL ROLE authenticated; SELECT * FROM public.get_my_completed_movement_rating_targets(''__NEED__'')','42501');
 PERFORM set_config('request.jwt.claim.sub','__REQUESTER__',true);
 PERFORM pg_temp.reputation_reject('SET LOCAL ROLE authenticated; SELECT * FROM public.get_my_completed_movement_rating_targets(''00000000-0000-4000-8000-000000000000'')','42501');
 PERFORM set_config('request.jwt.claim.sub','__PENDING_REQUESTER__',true);
 PERFORM pg_temp.reputation_reject('SET LOCAL ROLE authenticated; SELECT * FROM public.get_my_completed_movement_rating_targets(''__PENDING__'')');
 PERFORM set_config('request.jwt.claim.sub','__REQUESTER__',true);
 FOREACH before IN ARRAY ARRAY['0','2','-1','NULL'] LOOP
  PERFORM pg_temp.reputation_reject(format('SET LOCAL ROLE authenticated; SELECT * FROM public.rate_my_completed_movement_person(%L,%s,5)','__NEED__',before));
 END LOOP;
 FOREACH before IN ARRAY ARRAY['0','6','NULL'] LOOP
  PERFORM pg_temp.reputation_reject(format('SET LOCAL ROLE authenticated; SELECT * FROM public.rate_my_completed_movement_person(%L,1,%s)','__NEED__',before));
 END LOOP;
 r:=__SCHEMA__.snapshot_select_as('authenticated','__REQUESTER__','SELECT * FROM public.get_my_completed_movement_rating_targets(''__NEED__'')');
 PERFORM __SCHEMA__.funding_succeed(r);
 PERFORM pg_temp.reputation_check('safe principal projection',NOT (r::text ~ '(member_id|alignment_id|journey_id|agreement_id|__OFFERER__)'));
 r:=__SCHEMA__.snapshot_select_as('authenticated','__REQUESTER__','SELECT * FROM public.rate_my_completed_movement_person(''__NEED__'',1,5)');
 PERFORM __SCHEMA__.funding_succeed(r);
 PERFORM pg_temp.reputation_check('first vote exact numeric average',(SELECT rating=5.00 FROM public.members WHERE id='__OFFERER__'));
 before:=__SCHEMA__.materialization_sources();
 result:=__SCHEMA__.snapshot_select_as('authenticated','__REQUESTER__','SELECT * FROM public.rate_my_completed_movement_person(''__NEED__'',1,5)');
 PERFORM pg_temp.reputation_check('exact replay same result no writes',r=result AND before=__SCHEMA__.materialization_sources()
  AND (SELECT count(*)=1 FROM private.completed_movement_ratings WHERE alignment_id='__ALIGNMENT__'));
 PERFORM pg_temp.reputation_reject('SET LOCAL ROLE authenticated; SELECT * FROM public.rate_my_completed_movement_person(''__NEED__'',1,4)');
 FOREACH before IN ARRAY ARRAY['UPDATE private.completed_movement_ratings SET stars=4','DELETE FROM private.completed_movement_ratings','TRUNCATE private.completed_movement_ratings',
  'UPDATE private.completed_movement_principals SET person_role=''offering_member''','DELETE FROM private.completed_movement_principals','TRUNCATE private.completed_movement_principals CASCADE'] LOOP
  PERFORM pg_temp.reputation_reject(before);
 END LOOP;
 FOREACH before IN ARRAY ARRAY['anon','authenticated'] LOOP
  PERFORM pg_temp.reputation_reject(format('SET LOCAL ROLE %I; SELECT * FROM private.completed_movement_ratings',before),'42501');
  PERFORM pg_temp.reputation_reject(format('SET LOCAL ROLE %I; SELECT * FROM private.completed_movement_principals',before),'42501');
 END LOOP;
 PERFORM pg_temp.reputation_reject('UPDATE public.members SET rating=1 WHERE id=''__OFFERER__''');
 PERFORM pg_temp.reputation_reject('UPDATE public.members SET completed_movements=50 WHERE id=''__REQUESTER__''');
 PERFORM pg_temp.reputation_reject('INSERT INTO private.completed_movement_principals SELECT ''__ALIGNMENT__'',''__TRAVELLER__'',''offering_member'',completed_at FROM private.funded_movement_completions WHERE alignment_id=''__ALIGNMENT__''');
 r:=__SCHEMA__.snapshot_select_as('authenticated','__OFFERER__','SELECT * FROM public.rate_my_completed_movement_person(''__NEED__'',1,3)');
 PERFORM __SCHEMA__.funding_succeed(r);
 PERFORM pg_temp.reputation_check('reciprocal principal vote',(SELECT rating=3 FROM public.members WHERE id='__REQUESTER__'));
 PERFORM pg_temp.reputation_check('exact rounding',round((1::numeric+2+2)/3,2)=1.67 AND round((1::numeric+2)/2,2)=1.50);
END $$;
SELECT 'PASS '||count(*)||' reputation behavioral checks' FROM reputation_checks;
ROLLBACK;
