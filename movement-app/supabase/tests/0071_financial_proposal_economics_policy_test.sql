BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE economics_results(name text PRIMARY KEY,passed boolean NOT NULL) ON COMMIT DROP;
CREATE FUNCTION pg_temp.check_result(n text,b boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO economics_results VALUES(n,coalesce(b,false)); END $$;
CREATE FUNCTION pg_temp.reject(n text,command text,expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text:='00000'; BEGIN
 BEGIN EXECUTE command; RAISE SQLSTATE 'Z0071';
 EXCEPTION WHEN OTHERS THEN actual:=SQLSTATE; END;
 PERFORM pg_temp.check_result(n,actual=expected);
END $$;
CREATE FUNCTION pg_temp.calc(s bigint,n integer) RETURNS jsonb LANGUAGE sql AS $$
 SELECT to_jsonb(x) FROM private.calculate_financial_proposal_economics(s,n,'shared_platform_fee_v1','equal_split_requester_remainder_v1') x
$$;
DO $$ DECLARE x record; e record; j jsonb; role_name text; cmd text; s bigint; n integer;
 fn oid:='private.calculate_financial_proposal_economics(bigint,integer,text,text)'::regprocedure;
BEGIN
 FOR e IN SELECT * FROM (VALUES
  (200000::bigint,1,200000::bigint,60000::bigint,30000::bigint,30000::bigint,170000::bigint,140000::bigint),
  (200000,3,600000,180000,90000,90000,510000,420000),
  (1,1,1,0,0,0,1,1),(2,1,2,1,0,1,1,1),(5,1,5,2,1,1,4,3),(15,1,15,5,2,3,12,10),
  (4,1,4,1,0,1,3,3),(6,1,6,2,1,1,5,4),(5,3,15,5,2,3,12,10),
  (9223372036854775807,1,9223372036854775807,2767011611056432742,1383505805528216371,1383505805528216371,7839866231326559436,6456360425798343065)
 ) v(s,n,g,f,o,r,c,net) LOOP
  SELECT * INTO x FROM private.calculate_financial_proposal_economics(e.s,e.n,'shared_platform_fee_v1','equal_split_requester_remainder_v1');
  PERFORM pg_temp.check_result('exact vector '||e.s||' x '||e.n,
    ROW(x.gross_requester_total_minor,x.quoted_platform_fee_total_minor,x.offering_platform_share_minor,x.requester_platform_share_minor,x.quoted_movement_contribution_minor,x.offering_final_net_minor)
    IS NOT DISTINCT FROM ROW(e.g,e.f,e.o,e.r,e.c,e.net));
 END LOOP;
 -- Independent decimal-round oracle over many residues and occupied group sizes.
 FOR s IN 1..1000 LOOP
  FOR n IN 1..12 LOOP
   SELECT * INTO x FROM private.calculate_financial_proposal_economics(s,n,'shared_platform_fee_v1','equal_split_requester_remainder_v1');
   IF x.gross_requester_total_minor<>s*n
    OR x.quoted_platform_fee_total_minor<>round(s::numeric*n*0.30)
    OR x.offering_platform_share_minor<>x.quoted_platform_fee_total_minor/2
    OR x.quoted_movement_contribution_minor+x.requester_platform_share_minor<>x.gross_requester_total_minor
    OR x.offering_platform_share_minor+x.requester_platform_share_minor<>x.quoted_platform_fee_total_minor
    OR x.quoted_movement_contribution_minor-x.offering_platform_share_minor<>x.offering_final_net_minor
    OR x.offering_final_net_minor<>x.gross_requester_total_minor-x.quoted_platform_fee_total_minor THEN
     RAISE EXCEPTION 'Economic identity failed at %, %',s,n;
   END IF;
  END LOOP;
 END LOOP;
 PERFORM pg_temp.check_result('12000 cases: all identities and independent HALF-UP oracle',true);
 PERFORM pg_temp.check_result('occupied-count aggregate rounding, not per-seat rounding',pg_temp.calc(5,3)->>'quoted_platform_fee_total_minor'='5');
 PERFORM pg_temp.check_result('deterministic repeat',pg_temp.calc(200000,3)=pg_temp.calc(200000,3));
 PERFORM pg_temp.check_result('max safe multi-person gross',pg_temp.calc(4611686018427387903,2)->>'gross_requester_total_minor'='9223372036854775806');
 PERFORM pg_temp.check_result('maximum integer people count',pg_temp.calc(1,2147483647)->>'gross_requester_total_minor'='2147483647');
 PERFORM pg_temp.check_result('all six outputs are bigint',
  (SELECT array_agg(t ORDER BY ord)=ARRAY['bigint'::regtype::oid,'integer'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'bigint'::regtype::oid,'bigint'::regtype::oid,'bigint'::regtype::oid,'bigint'::regtype::oid,'bigint'::regtype::oid,'bigint'::regtype::oid]
   FROM pg_proc p,LATERAL unnest(p.proallargtypes) WITH ORDINALITY a(t,ord) WHERE p.oid=fn));
 FOREACH cmd IN ARRAY ARRAY['NULL,1','1,NULL'] LOOP
  PERFORM pg_temp.reject('null input '||cmd,'SELECT pg_temp.calc('||cmd||')','22004');
 END LOOP;
 FOREACH cmd IN ARRAY ARRAY['0,1','-1,1','1,0','1,-1','-9223372036854775808,1'] LOOP
  PERFORM pg_temp.reject('invalid input '||cmd,'SELECT pg_temp.calc('||cmd||')','23514');
 END LOOP;
 FOREACH cmd IN ARRAY ARRAY['9223372036854775807,2','4611686018427387904,2','9223372036854775807,2147483647'] LOOP
  PERFORM pg_temp.reject('overflow '||cmd,'SELECT pg_temp.calc('||cmd||')','22003');
 END LOOP;
 FOREACH cmd IN ARRAY ARRAY[
  $args$NULL,'equal_split_requester_remainder_v1'$args$,
  $args$'shared_platform_fee_v1',NULL$args$] LOOP
  PERFORM pg_temp.reject('null policy '||cmd,'SELECT * FROM private.calculate_financial_proposal_economics(1,1,'||cmd||')','22004');
 END LOOP;
 FOREACH cmd IN ARRAY ARRAY[
  '''other_v1'',''equal_split_requester_remainder_v1''',
  '''shared_platform_fee_v1'',''other_v1''',
  '''trusted_server_result_infrastructure_v1'',''equal_split_requester_remainder_v1''',
  '''shared_platform_fee_v1 '',''equal_split_requester_remainder_v1''',
  $args$'shared_platform_fee_v1',''$args$] LOOP
  PERFORM pg_temp.reject('unsupported policy '||cmd,'SELECT * FROM private.calculate_financial_proposal_economics(1,1,'||cmd||')','23514');
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  PERFORM pg_temp.check_result(role_name||' no EXECUTE',NOT has_function_privilege(role_name,fn,'EXECUTE'));
  PERFORM pg_temp.reject(role_name||' actual invocation denied',format('SET LOCAL ROLE %I; SELECT * FROM private.calculate_financial_proposal_economics(200000,1,''shared_platform_fee_v1'',''equal_split_requester_remainder_v1'')',role_name),'42501');
 END LOOP;
 PERFORM pg_temp.check_result('PUBLIC no EXECUTE',NOT EXISTS(SELECT 1 FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid=fn AND a.grantee=0 AND a.privilege_type='EXECUTE'));
 PERFORM pg_temp.check_result('immutable hardened private function', (SELECT provolatile='i' AND prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid=fn));
END $$;
SET CONSTRAINTS ALL IMMEDIATE;
TABLE economics_results;
SELECT count(*) FILTER(WHERE passed) AS passed,count(*) FILTER(WHERE NOT passed) AS failed FROM economics_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM economics_results WHERE NOT passed) THEN RAISE EXCEPTION '0071 economics behavioral checks failed'; END IF; END $$;
ROLLBACK;
