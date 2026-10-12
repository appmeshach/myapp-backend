BEGIN;
SELECT 'private job table RLS' AS label,relrowsecurity AS passed FROM pg_class WHERE oid='private.shared_segment_assessment_jobs'::regclass;
SELECT 'no participant policies',NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='private.shared_segment_assessment_jobs'::regclass);
SELECT 'five service-only RPCs',count(*)=5 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres')
 FROM pg_proc WHERE proname IN ('register_requester_availability_assessment_job_for_server','claim_shared_segment_assessment_job_for_server','load_shared_segment_assessment_job_context_for_server','finalize_shared_segment_assessment_job_for_server','fail_shared_segment_assessment_job_for_server');
SELECT 'canonical unique key',EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='private.shared_segment_assessment_jobs'::regclass AND contype='u' AND pg_get_constraintdef(oid) LIKE '%offerer_route_evidence_id, requester_route_evidence_id, algorithm_version, input_context_fingerprint%');
SELECT 'private table privileges',NOT has_table_privilege('anon','private.shared_segment_assessment_jobs','SELECT') AND NOT has_table_privilege('authenticated','private.shared_segment_assessment_jobs','SELECT') AND NOT has_table_privilege('service_role','private.shared_segment_assessment_jobs','SELECT');
SELECT 'RPC role fencing',bool_and(NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('authenticated',oid,'EXECUTE') AND has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE proname IN ('register_requester_availability_assessment_job_for_server','claim_shared_segment_assessment_job_for_server','load_shared_segment_assessment_job_context_for_server','finalize_shared_segment_assessment_job_for_server','fail_shared_segment_assessment_job_for_server');
SELECT 'identity protection trigger',EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='private.shared_segment_assessment_jobs'::regclass AND NOT tgisinternal AND tgname='protect_shared_segment_assessment_job');
SELECT 'claim partial index',EXISTS(SELECT 1 FROM pg_index WHERE indrelid='private.shared_segment_assessment_jobs'::regclass AND indpred IS NOT NULL);
ROLLBACK;
