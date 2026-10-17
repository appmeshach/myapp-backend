BEGIN;

-- 0098: selected-availability reuse. No new evidence meaning or participant API.
-- 0046 owns authorization and the existing need -> endpoints -> intent -> route
-- -> availability -> vehicle/access lock hierarchy. Locks end at each RPC.
CREATE FUNCTION public.get_current_requester_availability_route_match_for_server(
  p_verified_member_id uuid, p_movement_need_id uuid, p_availability_id uuid,
  p_expected_payload jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  c record;
  e private.trusted_route_match_evidence%ROWTYPE;
  identity jsonb;
  result jsonb;
  expected_expiry timestamptz;
BEGIN
  SELECT * INTO STRICT c
  FROM public.get_requester_availability_matching_context_for_server(
    p_verified_member_id, p_movement_need_id, p_availability_id);
  identity := jsonb_build_object(
    'movementNeedId',c.movement_need_id,'requestingMemberId',c.requesting_member_id,
    'availabilityId',p_availability_id,
    'requesterOriginLocationReferenceId',c.requester_origin_location_reference_id,
    'requesterDestinationLocationReferenceId',c.requester_destination_location_reference_id,
    'offeringMovementIntentId',c.offering_movement_intent_id,
    'offeringMemberId',c.offering_member_id,'offeringIntentVersion',c.offering_intent_version,
    'routeEvidenceId',c.route_evidence_id,'routeEvidenceVersion',c.route_evidence_version);
  SELECT * INTO e FROM private.trusted_route_match_evidence m
  WHERE m.movement_need_id=c.movement_need_id
    AND m.requesting_member_id=c.requesting_member_id
    AND m.requester_origin_location_reference_id=c.requester_origin_location_reference_id
    AND m.requester_destination_location_reference_id=c.requester_destination_location_reference_id
    AND m.offering_movement_intent_id=c.offering_movement_intent_id
    AND m.offering_member_id=c.offering_member_id
    AND m.offering_intent_version=c.offering_intent_version
    AND m.route_evidence_id=c.route_evidence_id AND m.route_evidence_version=c.route_evidence_version
    AND m.evidence_schema_version='trusted_route_match_evidence_v1'
    AND m.algorithm_version='route_match_geometry_v1'
    AND m.status='current' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state','not_found','identity',identity);
  END IF;
  -- Includes exact context, dependency expiry and trusted temporal assertions.
  PERFORM private.assert_trusted_route_match_evidence(e.id);
  result := jsonb_build_object('state','reuse_existing','identity',identity,
    'evidence',jsonb_build_object(
      'routeMatchEvidenceId',e.id,'routeMatchEvidenceVersion',e.version,
      'routeMatchEvidenceStatus',e.status,'routeMatchEvidenceExpiresAt',e.expires_at),
    'payload',jsonb_build_object(
      'movementNeedId',e.movement_need_id,'offeringMovementIntentId',e.offering_movement_intent_id,
      'expectedRouteEvidenceId',e.route_evidence_id,'expectedRouteEvidenceVersion',e.route_evidence_version,
      'requesterOriginDistanceToRouteMeters',e.requester_origin_distance_to_route_meters,
      'requesterDestinationDistanceToRouteMeters',e.requester_destination_distance_to_route_meters,
      'calculatedRouteShapeLengthMeters',e.calculated_route_shape_length_meters,
      'requesterOriginPositionAlongRouteMeters',e.requester_origin_position_along_route_meters,
      'requesterDestinationPositionAlongRouteMeters',e.requester_destination_position_along_route_meters,
      'requesterOriginClosestRoute',jsonb_build_object('latitude',e.requester_origin_closest_route_latitude,'longitude',e.requester_origin_closest_route_longitude),
      'requesterDestinationClosestRoute',jsonb_build_object('latitude',e.requester_destination_closest_route_latitude,'longitude',e.requester_destination_closest_route_longitude),
      'calculatedAt',e.calculated_at,'expiresAt',NULL));
  IF p_expected_payload IS NOT NULL THEN
    -- Exact uncertain-write recovery is checked in PostgreSQL, before JSON
    -- numeric/timestamp values cross JavaScript's precision boundary.
    SELECT LEAST((p_expected_payload->>'expiresAt')::timestamptz,
      origin.expires_at,destination.expires_at,intent.expires_at,c.route_expires_at)
    INTO expected_expiry
    FROM private.movement_location_references origin
    JOIN private.movement_location_references destination
      ON destination.id=c.requester_destination_location_reference_id
    JOIN private.offering_movement_intents intent ON intent.id=c.offering_movement_intent_id
    WHERE origin.id=c.requester_origin_location_reference_id;
    IF (result->'payload')-'calculatedAt' IS DISTINCT FROM p_expected_payload-'calculatedAt'
      OR e.calculated_at IS DISTINCT FROM (p_expected_payload->>'calculatedAt')::timestamptz
      OR e.expires_at IS DISTINCT FROM expected_expiry THEN
      RETURN jsonb_build_object('state','not_found','identity',identity);
    END IF;
  END IF;
  RETURN result;
END;
$$;

-- Revalidate the selected availability and computation identity at publication.
-- Two workers may calculate without locks. The second serialized publisher
-- reuses a winner with identical facts, retaining the winner's timestamp.
-- This is a current-use operation, never a relaxed historical writer replay.
CREATE FUNCTION public.publish_requester_availability_route_match_for_server(
  p_verified_member_id uuid, p_movement_need_id uuid, p_availability_id uuid,
  p_expected_identity jsonb, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  current_match jsonb;
BEGIN
  current_match := public.get_current_requester_availability_route_match_for_server(
    p_verified_member_id,p_movement_need_id,p_availability_id);
  IF p_expected_identity IS DISTINCT FROM current_match->'identity'
    OR p_payload->>'movementNeedId' IS DISTINCT FROM p_movement_need_id::text
    OR p_payload->>'offeringMovementIntentId' IS DISTINCT FROM p_expected_identity->>'offeringMovementIntentId'
    OR p_payload->>'expectedRouteEvidenceId' IS DISTINCT FROM p_expected_identity->>'routeEvidenceId'
    OR p_payload->'expectedRouteEvidenceVersion' IS DISTINCT FROM p_expected_identity->'routeEvidenceVersion'
    OR p_payload->'expiresAt' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(p_payload->'calculatedAt') IS DISTINCT FROM 'string'
    OR NOT isfinite((p_payload->>'calculatedAt')::timestamptz)
    OR (p_payload->>'calculatedAt')::timestamptz>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected route-match inputs changed or invalid';
  END IF;
  IF current_match->>'state'='reuse_existing' THEN
    IF (current_match->'payload')-'calculatedAt' IS DISTINCT FROM p_payload-'calculatedAt' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected route-match calculation differs from current evidence';
    END IF;
    RETURN current_match;
  END IF;
  -- The unchanged 0082 writer remains authoritative for validation and insert.
  PERFORM public.record_trusted_route_match_evidence_for_server(
    p_movement_need_id,(p_payload->>'offeringMovementIntentId')::uuid,
    (p_payload->>'expectedRouteEvidenceId')::uuid,(p_payload->>'expectedRouteEvidenceVersion')::integer,
    (p_payload->>'requesterOriginDistanceToRouteMeters')::bigint,
    (p_payload->>'requesterDestinationDistanceToRouteMeters')::bigint,
    (p_payload->>'calculatedRouteShapeLengthMeters')::bigint,
    (p_payload->>'requesterOriginPositionAlongRouteMeters')::bigint,
    (p_payload->>'requesterDestinationPositionAlongRouteMeters')::bigint,
    (p_payload#>>'{requesterOriginClosestRoute,latitude}')::numeric,
    (p_payload#>>'{requesterOriginClosestRoute,longitude}')::numeric,
    (p_payload#>>'{requesterDestinationClosestRoute,latitude}')::numeric,
    (p_payload#>>'{requesterDestinationClosestRoute,longitude}')::numeric,
    (p_payload->>'calculatedAt')::timestamptz,NULL);
  current_match := public.get_current_requester_availability_route_match_for_server(
    p_verified_member_id,p_movement_need_id,p_availability_id);
  -- Reject extra keys or lossy JSON-to-SQL coercion before this RPC commits.
  IF current_match->>'state' IS DISTINCT FROM 'reuse_existing'
    OR (current_match->'payload')-'calculatedAt' IS DISTINCT FROM p_payload-'calculatedAt'
    OR (current_match#>>'{payload,calculatedAt}')::timestamptz IS DISTINCT FROM (p_payload->>'calculatedAt')::timestamptz THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selected route-match publication payload is not canonical';
  END IF;
  RETURN current_match;
END;
$$;

REVOKE ALL ON FUNCTION public.get_current_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.publish_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_current_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_requester_availability_route_match_for_server(uuid,uuid,uuid,jsonb,jsonb) TO service_role;
COMMIT;
