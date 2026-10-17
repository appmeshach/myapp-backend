BEGIN;
CREATE TEMP TABLE reuse_checks(name text, passed boolean);
INSERT INTO reuse_checks
SELECT 'service-only lookup', has_function_privilege('service_role', 'public.get_current_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_current_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.get_current_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb)','EXECUTE');
INSERT INTO reuse_checks
SELECT 'service-only publication', has_function_privilege('service_role','public.publish_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('anon','public.publish_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.publish_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE');
INSERT INTO reuse_checks SELECT 'private evidence RLS unchanged',relrowsecurity FROM pg_class WHERE oid='private.trusted_route_match_evidence'::regclass;
INSERT INTO reuse_checks SELECT 'no participant evidence SELECT',NOT has_table_privilege('authenticated','private.trusted_route_match_evidence','SELECT');
INSERT INTO reuse_checks SELECT 'strict historical timestamp comparison retained',position('v_existing.calculated_at' in prosrc)>0 AND position('IS DISTINCT FROM p_calculated_at' in prosrc)>0 FROM pg_proc WHERE oid='public.record_trusted_route_match_evidence_for_server(uuid,uuid,uuid,integer,bigint,bigint,bigint,bigint,bigint,numeric,numeric,numeric,numeric,timestamp with time zone,timestamp with time zone)'::regprocedure;
SELECT * FROM reuse_checks ORDER BY name;
DO $$ BEGIN IF EXISTS(SELECT FROM reuse_checks WHERE NOT passed) THEN RAISE EXCEPTION '0098 security assertion failed'; END IF; END $$;
ROLLBACK;
