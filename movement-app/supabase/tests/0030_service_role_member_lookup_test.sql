BEGIN;
-- Administrator-only rollback harness. Run after migration 0030. No data writes.
CREATE TEMP TABLE member_lookup_results(test_name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_member_lookup(p_name text,p_ok boolean) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO pg_temp.member_lookup_results VALUES(p_name,coalesce(p_ok,false));
END; $$;
REVOKE ALL ON FUNCTION pg_temp.check_member_lookup(text,boolean) FROM PUBLIC;

DO $tests$
DECLARE old_role text:=current_setting('role');
BEGIN
 PERFORM pg_temp.check_member_lookup('service SELECT allowed',has_table_privilege('service_role','public.members','SELECT'));
 PERFORM pg_temp.check_member_lookup('anon SELECT absent',NOT has_table_privilege('anon','public.members','SELECT'));
 PERFORM pg_temp.check_member_lookup('authenticated SELECT preserved',has_table_privilege('authenticated','public.members','SELECT'));
 PERFORM pg_temp.check_member_lookup('RLS remains enabled',(SELECT relrowsecurity FROM pg_class WHERE oid='public.members'::regclass));
 -- Exercise the same projection/filter under the actual server role. No fixtures
 -- or member data are returned. Role setup and permission errors must escape.
 PERFORM set_config('role','service_role',true);
 PERFORM id FROM public.members WHERE id='00000000-0000-4000-8000-000000000000'::uuid LIMIT 2;
 PERFORM set_config('role',old_role,true);
 PERFORM pg_temp.check_member_lookup('actual server lookup allowed',true);
END;
$tests$;
SELECT test_name,passed FROM pg_temp.member_lookup_results ORDER BY test_name;
SELECT count(*) AS total,count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM pg_temp.member_lookup_results;
DO $assert$
BEGIN
 IF (SELECT count(*) FROM pg_temp.member_lookup_results)<>5 OR EXISTS(SELECT 1 FROM pg_temp.member_lookup_results WHERE NOT passed) THEN
  RAISE EXCEPTION '0030 behavioral checks failed';
 END IF;
END;
$assert$;
ROLLBACK;
