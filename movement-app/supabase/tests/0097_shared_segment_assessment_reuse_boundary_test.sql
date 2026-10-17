BEGIN;
CREATE TEMP TABLE reuse_checks(name text, passed boolean);
INSERT INTO reuse_checks VALUES
 ('lookup exists',to_regprocedure('public.get_current_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid)') IS NOT NULL),
 ('service execution',has_function_privilege('service_role','public.get_current_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid)','EXECUTE')),
 ('anonymous denied',NOT has_function_privilege('anon','public.get_current_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid)','EXECUTE')),
 ('authenticated denied',NOT has_function_privilege('authenticated','public.get_current_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid)','EXECUTE')),
 ('private assessment remains unreadable',NOT has_table_privilege('service_role','private.shared_segment_geographic_assessments','SELECT')),
 ('no participant policy',NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.shared_segment_geographic_assessments'::regclass));
SELECT name,passed FROM reuse_checks ORDER BY name;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM reuse_checks WHERE NOT passed) THEN RAISE EXCEPTION '0097 SQL check failed'; END IF; END $$;
ROLLBACK;
