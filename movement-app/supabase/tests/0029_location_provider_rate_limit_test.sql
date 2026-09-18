BEGIN;
-- Administrator-only rollback harness. No network calls. This is NOT a
-- simultaneous-session concurrency test; that remains a separate requirement.
CREATE TEMP TABLE quota_results(test_name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_quota(p_name text,p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pg_temp.quota_results VALUES(p_name,coalesce(p_ok,false));
END; $$;
REVOKE ALL ON FUNCTION pg_temp.check_quota(text,boolean) FROM PUBLIC;
CREATE FUNCTION pg_temp.try_quota(p_role text,p_sql text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE old_role text:=current_setting('role'); result jsonb;
BEGIN
 IF p_role NOT IN ('anon','authenticated','service_role','none') THEN RAISE EXCEPTION 'Invalid test role'; END IF;
 -- Role setup errors must escape, not masquerade as successful denial tests.
 PERFORM set_config('role',p_role,true);
 BEGIN
  IF p_sql ~ '^SELECT' THEN
   EXECUTE 'SELECT to_jsonb(q) FROM ('||p_sql||') q' INTO result;
   result:=jsonb_build_object('ok',true,'row',result);
  ELSE
   EXECUTE p_sql;
   result:=jsonb_build_object('ok',true);
  END IF;
 EXCEPTION WHEN OTHERS THEN
  result:=jsonb_build_object('ok',false,'state',SQLSTATE,'message',SQLERRM);
 END;
 PERFORM set_config('role',old_role,true);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION pg_temp.try_quota(text,text) FROM PUBLIC;
CREATE FUNCTION pg_temp.reject_quota_day() RETURNS trigger LANGUAGE plpgsql AS $fault$
BEGIN
 IF NEW.window_kind='day' THEN
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='unrelated quota test unique violation',CONSTRAINT='unrelated_test_unique';
 END IF;
 RETURN NEW;
END;
$fault$;
REVOKE ALL ON FUNCTION pg_temp.reject_quota_day() FROM PUBLIC;
DO $tests$
DECLARE
 m uuid:=gen_random_uuid(); other_m uuid:=gen_random_uuid(); r record; result jsonb; saved jsonb;
 baseline jsonb; after_state jsonb; i integer; j integer; ok boolean; op text; role_name text; action text;
 minute_limit integer; day_limit integer; t timestamptz:='2030-03-10 23:59:59.250+00';
 sig text:='public.consume_location_provider_quota_for_server(uuid,text)';
 helper text:='private.consume_location_provider_quota_at(uuid,text,timestamptz)';
BEGIN
 SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY member_id,operation,window_kind,window_start),'[]')
 INTO baseline FROM private.location_provider_quota_buckets b;
 BEGIN
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 SELECT id,'authenticated','authenticated',id::text||'@test-0029.invalid',now(),
 '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now()
 FROM unnest(ARRAY[m,other_m]) ids(id);

 PERFORM pg_temp.check_quota('service execute allowed',has_function_privilege('service_role',sig,'EXECUTE'));
 PERFORM pg_temp.check_quota('PUBLIC execute absent',NOT EXISTS(SELECT 1 FROM pg_proc p
 CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 WHERE p.oid IN (sig::regprocedure,helper::regprocedure) AND a.grantee=0 AND a.privilege_type='EXECUTE'));
 PERFORM pg_temp.check_quota('RLS enabled',(SELECT relrowsecurity FROM pg_class WHERE oid='private.location_provider_quota_buckets'::regclass));
 PERFORM pg_temp.check_quota('no policies',NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.location_provider_quota_buckets'::regclass));
 PERFORM pg_temp.check_quota('minimal counter columns',(SELECT array_agg(attname::text ORDER BY attnum)=ARRAY['member_id','operation','window_kind','window_start','request_count','updated_at'] FROM pg_attribute WHERE attrelid='private.location_provider_quota_buckets'::regclass AND attnum>0 AND NOT attisdropped));
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.check_quota(role_name||' helper revoked',NOT has_function_privilege(role_name,helper,'EXECUTE'));
  IF role_name<>'service_role' THEN
   PERFORM pg_temp.check_quota(role_name||' execute revoked',NOT has_function_privilege(role_name,sig,'EXECUTE'));
   result:=pg_temp.try_quota(role_name,format('SELECT * FROM public.consume_location_provider_quota_for_server(%L,%L)',m,'location_search'));
   PERFORM pg_temp.check_quota(role_name||' actual execute denied',result->>'state'='42501');
  END IF;
  FOREACH action IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
   PERFORM pg_temp.check_quota(role_name||' '||action||' ACL revoked',NOT has_table_privilege(role_name,'private.location_provider_quota_buckets',action));
   result:=pg_temp.try_quota(role_name,CASE action
    WHEN 'SELECT' THEN 'SELECT * FROM private.location_provider_quota_buckets'
    WHEN 'INSERT' THEN format('INSERT INTO private.location_provider_quota_buckets VALUES(%L,%L,%L,now(),1,now())',m,'location_search','minute')
    WHEN 'UPDATE' THEN 'UPDATE private.location_provider_quota_buckets SET request_count=request_count'
    ELSE 'DELETE FROM private.location_provider_quota_buckets' END);
   PERFORM pg_temp.check_quota(role_name||' '||action||' actually denied',result->>'state'='42501');
  END LOOP;
 END LOOP;
 result:=pg_temp.try_quota('service_role',format('SELECT * FROM public.consume_location_provider_quota_for_server(%L,%L)',m,'location_search'));
 PERFORM pg_temp.check_quota('service search admission',result->>'ok'='true' AND result->'row'=jsonb_build_object('admitted',true,'retry_after_seconds',0));
 result:=pg_temp.try_quota('service_role',format('SELECT * FROM public.consume_location_provider_quota_for_server(%L,%L)',m,'location_resolution'));
 PERFORM pg_temp.check_quota('service resolution admission',result->>'ok'='true' AND result->'row'->>'admitted'='true');
 PERFORM pg_temp.check_quota('actual server timestamp',EXISTS(SELECT 1 FROM private.location_provider_quota_buckets WHERE member_id=m AND updated_at BETWEEN clock_timestamp()-interval '1 minute' AND clock_timestamp()));
 result:=pg_temp.try_quota('service_role','SELECT * FROM public.consume_location_provider_quota_for_server(NULL,''location_search'')');
 PERFORM pg_temp.check_quota('null member rejected',result->>'state'='23514');
 result:=pg_temp.try_quota('service_role',format('SELECT * FROM public.consume_location_provider_quota_for_server(%L,%L)',gen_random_uuid(),'location_search'));
 PERFORM pg_temp.check_quota('missing member rejected',result->>'state'='23514');
 FOREACH op IN ARRAY ARRAY[NULL,'','location_search ','search'] LOOP
  result:=pg_temp.try_quota('service_role',format('SELECT * FROM public.consume_location_provider_quota_for_server(%L,%L)',m,op));
  PERFORM pg_temp.check_quota('invalid operation '||coalesce(op,'NULL'),result->>'state'='23514');
 END LOOP;
 DELETE FROM private.location_provider_quota_buckets WHERE member_id=m;
 PERFORM set_config('TimeZone','America/Los_Angeles',true);
 FOREACH op IN ARRAY ARRAY['location_search','location_resolution'] LOOP
  minute_limit:=CASE op WHEN 'location_search' THEN 30 ELSE 10 END;
  day_limit:=CASE op WHEN 'location_search' THEN 300 ELSE 100 END;
  ok:=true;
  FOR i IN 1..minute_limit LOOP
   SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,t);
   ok:=ok AND r.admitted AND r.retry_after_seconds=0;
  END LOOP;
  PERFORM pg_temp.check_quota(op||' exact minute admitted',ok);
  SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,t);
  PERFORM pg_temp.check_quota(op||' minute next denied',NOT r.admitted AND r.retry_after_seconds=1);
  PERFORM pg_temp.check_quota(op||' minute denial preserves daily',(SELECT request_count=minute_limit FROM private.location_provider_quota_buckets WHERE member_id=m AND operation=op AND window_kind='day'));
  SELECT * INTO r FROM private.consume_location_provider_quota_at(other_m,op,t);
  PERFORM pg_temp.check_quota(op||' other member independent',r.admitted);
  SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,t+interval '0.750 second');
  PERFORM pg_temp.check_quota(op||' midnight resets both',r.admitted AND r.retry_after_seconds=0);
  PERFORM pg_temp.check_quota(op||' UTC midnight bucket',EXISTS(SELECT 1 FROM private.location_provider_quota_buckets WHERE member_id=m AND operation=op AND window_kind='day' AND window_start='2030-03-11 00:00:00+00' AND request_count=1));
  DELETE FROM private.location_provider_quota_buckets WHERE member_id=m AND operation=op;
  ok:=true;
  FOR j IN 0..9 LOOP
   FOR i IN 1..minute_limit LOOP
    SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,'2030-03-10 12:00:00+00'::timestamptz+j*interval '1 minute');
    ok:=ok AND r.admitted;
   END LOOP;
  END LOOP;
  PERFORM pg_temp.check_quota(op||' exact day across minutes admitted',ok);
  PERFORM pg_temp.check_quota(op||' exact daily count',(SELECT request_count=day_limit FROM private.location_provider_quota_buckets WHERE member_id=m AND operation=op AND window_kind='day'));
  SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,'2030-03-10 12:10:00+00');
  PERFORM pg_temp.check_quota(op||' day next denied UTC retry',NOT r.admitted AND r.retry_after_seconds=42600);
  PERFORM pg_temp.check_quota(op||' day denial creates no minute',NOT EXISTS(SELECT 1 FROM private.location_provider_quota_buckets WHERE member_id=m AND operation=op AND window_kind='minute' AND window_start='2030-03-10 12:10:00+00'));
  SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,'2030-03-10 12:09:59.999+00');
  PERFORM pg_temp.check_quota(op||' both blocked waits for day',NOT r.admitted AND r.retry_after_seconds=42601);
  SELECT * INTO r FROM private.consume_location_provider_quota_at(m,op,'2030-03-11 00:00:00+00');
  PERFORM pg_temp.check_quota(op||' next day admits',r.admitted);
 END LOOP;
 PERFORM pg_temp.check_quota('operations independent',(SELECT count(*)=2 AND min(request_count)=1 AND max(request_count)=1 FROM private.location_provider_quota_buckets WHERE member_id=other_m AND window_kind='day'));
 DELETE FROM private.location_provider_quota_buckets WHERE member_id=other_m;
 CREATE TRIGGER quota_test_unique BEFORE INSERT OR UPDATE ON private.location_provider_quota_buckets
 FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_quota_day();
 result:=pg_temp.try_quota('service_role',format('SELECT * FROM public.consume_location_provider_quota_for_server(%L,%L)',other_m,'location_search'));
 PERFORM pg_temp.check_quota('unrelated unique violation escapes',result->>'state'='23505' AND result->>'message'='unrelated quota test unique violation');
 PERFORM pg_temp.check_quota('late failure rolls back both increments',NOT EXISTS(SELECT 1 FROM private.location_provider_quota_buckets WHERE member_id=other_m));
 DROP TRIGGER quota_test_unique ON private.location_provider_quota_buckets;
 SELECT jsonb_agg(to_jsonb(q)) INTO saved FROM pg_temp.quota_results q;
 RAISE EXCEPTION USING ERRCODE='Z0029',MESSAGE='rollback quota fixtures';
 EXCEPTION WHEN SQLSTATE 'Z0029' THEN NULL;
 END;
 INSERT INTO pg_temp.quota_results SELECT * FROM jsonb_to_recordset(saved) AS q(test_name text,passed boolean);
 SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY member_id,operation,window_kind,window_start),'[]')
 INTO after_state FROM private.location_provider_quota_buckets b;
 PERFORM pg_temp.check_quota('rollback restores all quota state',baseline=after_state);
 PERFORM pg_temp.check_quota('rollback removes users and members',NOT EXISTS(SELECT 1 FROM auth.users WHERE id IN (m,other_m)) AND NOT EXISTS(SELECT 1 FROM public.members WHERE id IN (m,other_m)));
END;
$tests$;
SELECT test_name,passed FROM pg_temp.quota_results ORDER BY test_name;
SELECT count(*) AS total,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.quota_results;
DO $assert$
BEGIN
 IF (SELECT count(*) FROM pg_temp.quota_results)<>74 OR EXISTS(SELECT 1 FROM pg_temp.quota_results WHERE NOT passed) THEN
  RAISE EXCEPTION '0029 behavioral checks failed';
 END IF;
END;
$assert$;
ROLLBACK;
