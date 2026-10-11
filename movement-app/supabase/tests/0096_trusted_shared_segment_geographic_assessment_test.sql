BEGIN;
CREATE TEMP TABLE assessment_checks(name text,passed boolean);
INSERT INTO assessment_checks VALUES
 ('private RLS enabled',(SELECT relrowsecurity FROM pg_class WHERE oid='private.shared_segment_geographic_assessments'::regclass)),
 ('no client policies',NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.shared_segment_geographic_assessments'::regclass)),
 ('no geometry column',NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='private' AND table_name='shared_segment_geographic_assessments' AND column_name LIKE '%shape%')),
 ('canonical UNIQUE identity',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.shared_segment_geographic_assessments'::regclass AND contype='u')),
 ('no client read',NOT has_table_privilege('authenticated','private.shared_segment_geographic_assessments','SELECT')),
 ('no direct service insert',NOT has_table_privilege('service_role','private.shared_segment_geographic_assessments','INSERT')),
 ('reader service-only',has_function_privilege('service_role','public.get_shared_segment_geographic_assessment_context_for_server(uuid,uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.get_shared_segment_geographic_assessment_context_for_server(uuid,uuid,uuid,uuid)','EXECUTE')),
 ('publication service-only',has_function_privilege('service_role','public.publish_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') AND NOT has_function_privilege('authenticated','public.publish_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'));
SELECT name,passed FROM assessment_checks ORDER BY name;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM assessment_checks WHERE NOT passed) THEN RAISE EXCEPTION '0096 SQL check failed'; END IF; END $$;
ROLLBACK;
