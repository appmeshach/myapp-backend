BEGIN;

-- Internal current-use lookup only. The 0096 context function establishes and
-- locks the exact trusted pair dependencies for this short SQL transaction.
CREATE FUNCTION public.get_current_shared_segment_geographic_assessment_for_server(
  p_movement_need_id uuid,
  p_requesting_member_id uuid,
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  snapshot jsonb;
  ctx jsonb;
  stored private.shared_segment_geographic_assessments%ROWTYPE;
BEGIN
  snapshot := public.get_shared_segment_geographic_assessment_context_for_server(
    p_movement_need_id,
    p_requesting_member_id,
    p_offering_movement_intent_id,
    p_offering_member_id
  );

  IF snapshot->>'input_state' <> 'ready' THEN
    RETURN jsonb_build_object(
      'lookup_state', 'not_ready',
      'assessment_id', NULL,
      'algorithm_version', NULL,
      'parameter_fingerprint', NULL,
      'canonical_result', NULL
    );
  END IF;

  ctx := snapshot->'context';

  SELECT assessment.*
  INTO stored
  FROM private.shared_segment_geographic_assessments AS assessment
  WHERE assessment.movement_need_id = p_movement_need_id
    AND assessment.requesting_member_id = p_requesting_member_id
    AND assessment.offering_movement_intent_id = p_offering_movement_intent_id
    AND assessment.offering_member_id = p_offering_member_id
    AND assessment.offerer_route_evidence_id = (ctx->'offerer_evidence'->>'id')::uuid
    AND assessment.requester_route_evidence_id = (ctx->'requester_evidence'->>'id')::uuid
    AND assessment.offerer_route_version = (ctx->'offerer_evidence'->>'version')::integer
    AND assessment.requester_route_version = (ctx->'requester_evidence'->>'version')::integer
    AND assessment.algorithm_version = 'shared_segment_geographic_assessment_v1'
    AND assessment.parameter_fingerprint = ctx->>'parameter_fingerprint'
    AND assessment.input_context_fingerprint = snapshot->>'input_context_fingerprint'
    AND assessment.canonical_context = ctx
    AND assessment.expires_at = (snapshot->>'expires_at')::timestamptz
    AND assessment.expires_at > clock_timestamp();

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'lookup_state', 'not_found',
      'assessment_id', NULL,
      'algorithm_version', NULL,
      'parameter_fingerprint', NULL,
      'canonical_result', NULL
    );
  END IF;

  -- Recheck time after the row read. Dependency locks acquired while building
  -- the context remain held until this function call completes.
  IF stored.expires_at <= clock_timestamp() THEN
    RETURN jsonb_build_object(
      'lookup_state', 'not_found',
      'assessment_id', NULL,
      'algorithm_version', NULL,
      'parameter_fingerprint', NULL,
      'canonical_result', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'lookup_state', 'reuse_existing',
    'assessment_id', stored.id,
    'algorithm_version', stored.algorithm_version,
    'parameter_fingerprint', stored.parameter_fingerprint,
    'canonical_result', stored.canonical_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid)
  TO service_role;

COMMIT;
