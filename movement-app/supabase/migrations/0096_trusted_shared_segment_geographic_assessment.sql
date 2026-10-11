BEGIN;

-- WE DO NOT CREATE JOURNEYS. Immutable private geometric facts, never eligibility.
CREATE TABLE private.shared_segment_geographic_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offerer_route_evidence_id uuid NOT NULL REFERENCES private.offering_route_evidence(id),
  requester_route_evidence_id uuid NOT NULL REFERENCES private.requester_route_evidence(id),
  offerer_route_version integer NOT NULL CHECK (offerer_route_version>=1),
  requester_route_version integer NOT NULL CHECK (requester_route_version>=1),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  movement_need_id uuid NOT NULL REFERENCES public.movement_needs(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  algorithm_version text NOT NULL CHECK (algorithm_version='shared_segment_geographic_assessment_v1'),
  parameter_fingerprint text NOT NULL CHECK (parameter_fingerprint ~ '^[a-f0-9]{64}$'),
  input_context_fingerprint text NOT NULL CHECK (input_context_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_context jsonb NOT NULL CHECK (jsonb_typeof(canonical_context)='object'),
  canonical_result jsonb NOT NULL CHECK (jsonb_typeof(canonical_result)='object'),
  road_topology_verified boolean NOT NULL DEFAULT false CHECK (NOT road_topology_verified),
  authorizes_admission boolean NOT NULL DEFAULT false CHECK (NOT authorizes_admission),
  confirms_usable_shared_segment boolean NOT NULL DEFAULT false CHECK (NOT confirms_usable_shared_segment),
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(generated_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  CHECK (generated_at<=created_at AND created_at<expires_at),
  CHECK (requesting_member_id<>offering_member_id),
  UNIQUE (offerer_route_evidence_id,requester_route_evidence_id,algorithm_version,input_context_fingerprint)
);
ALTER TABLE private.shared_segment_geographic_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.shared_segment_geographic_assessments FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_shared_segment_geographic_assessment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Geographic assessment history is immutable';
END;
$$;
CREATE TRIGGER protect_shared_segment_geographic_assessment BEFORE UPDATE OR DELETE
  ON private.shared_segment_geographic_assessments FOR EACH ROW
  EXECUTE FUNCTION private.protect_shared_segment_geographic_assessment();
REVOKE ALL ON FUNCTION private.protect_shared_segment_geographic_assessment() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.shared_segment_assessment_parameters()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT '{"samplingSpacingMeters":5,"proximityMeters":5,"minimumSupportedMeters":100,"maximumHeadingDegrees":45,"maximumUnsupportedGapMeters":15,"maximumOriginalCoordinates":2000,"maximumResampledPoints":20000,"maximumWorkUnits":1000000,"earthRadiusMeters":6371008.8,"maximumStoredIntervals":20000,"numericalEpsilonMeters":1e-7,"outputDecimalPlaces":6,"model":"spherical-arcs-ecef-chord-correspondence-v1","ambiguity":"overlapping-support-with-alternative-position-over-15m-v1"}'::text;
$$;
REVOKE ALL ON FUNCTION private.shared_segment_assessment_parameters() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.get_shared_segment_geographic_assessment_context_for_server(
  p_movement_need_id uuid,p_requesting_member_id uuid,p_offering_movement_intent_id uuid,p_offering_member_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE
  n public.movement_needs%ROWTYPE; i private.offering_movement_intents%ROWTYPE;
  o private.offering_route_evidence%ROWTYPE; r private.requester_route_evidence%ROWTYPE;
  loc private.movement_location_references%ROWTYPE; refs jsonb:='[]';
  ctx jsonb; horizon timestamptz; stamp timestamptz; bindings record;
  unavailable jsonb:=jsonb_build_object('input_state','evidence_unavailable','reason',NULL,'context',NULL,
    'input_context_fingerprint',NULL,'expires_at',NULL,'offerer_shape',NULL,'requester_shape',NULL);
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Geographic assessment requires READ COMMITTED';
  END IF;
  -- Parent locks serialize route producers; do not hold them during TS computation.
  -- Requester context first, then offerer parent/context, then route evidence.
  SELECT x.* INTO n FROM public.movement_needs x WHERE x.id=p_movement_need_id FOR UPDATE;
  IF NOT FOUND OR n.member_id IS DISTINCT FROM p_requesting_member_id OR p_requesting_member_id IS NULL
    OR p_offering_member_id IS NULL OR p_requesting_member_id=p_offering_member_id THEN RETURN unavailable; END IF;
  SELECT * INTO bindings FROM private.lock_requester_route_generation_context(n.id,n.member_id);
  SELECT x.* INTO i FROM private.offering_movement_intents x WHERE x.id=p_offering_movement_intent_id FOR UPDATE;
  IF NOT FOUND OR i.offering_member_id IS DISTINCT FROM p_offering_member_id THEN RETURN unavailable; END IF;
  PERFORM x.role FROM private.offering_movement_intent_locations x WHERE x.intent_id=i.id ORDER BY x.role FOR SHARE;
  PERFORM private.assert_offering_movement_intent(i.id);
  -- Pre-own parent and endpoint context before old evidence->intent assertion.
  FOR loc IN SELECT x.* FROM private.movement_location_references x WHERE x.id IN (
    SELECT location_reference_id FROM private.offering_movement_intent_locations WHERE intent_id=i.id
  ) ORDER BY x.id FOR SHARE LOOP
    IF loc.owner_member_id<>p_offering_member_id OR loc.resolution_status<>'resolved' OR loc.source_kind<>'provider_resolved'
      OR loc.latitude IS NULL OR loc.longitude IS NULL THEN RETURN jsonb_set(unavailable,'{input_state}','"evidence_invalid"'); END IF;
  END LOOP;
  SELECT x.* INTO o FROM private.offering_route_evidence x WHERE x.offering_movement_intent_id=i.id AND x.status='current' FOR UPDATE;
  IF NOT FOUND THEN RETURN unavailable; END IF;
  SELECT x.* INTO r FROM private.requester_route_evidence x WHERE x.movement_need_id=n.id AND x.status='current' FOR UPDATE;
  IF NOT FOUND THEN RETURN unavailable; END IF;
  stamp:=clock_timestamp();
  horizon:=LEAST(o.expires_at,r.expires_at,i.expires_at,COALESCE(n.latest_departure_at,n.earliest_departure_at),i.earliest_departure_at);
  -- Endpoint records are immutable; canonical fields still bind their exact contents.
  FOR loc IN SELECT x.* FROM private.movement_location_references x WHERE x.id IN (
    o.origin_location_reference_id,o.destination_location_reference_id,r.origin_location_reference_id,r.destination_location_reference_id
  ) ORDER BY x.id FOR SHARE LOOP
    horizon:=LEAST(horizon,loc.expires_at);
    refs:=refs||jsonb_build_array(jsonb_build_object('id',loc.id,'owner',loc.owner_member_id,
      'latitude',loc.latitude,'longitude',loc.longitude,'source',loc.source_kind,'status',loc.resolution_status,
      'provider',loc.provider_namespace,'reference',loc.provider_place_reference,'version',loc.resolution_version,
      'resolved_at',loc.resolved_at,'expires_at',loc.expires_at));
  END LOOP;
  -- Need/intent status gates current-use production. Roster/admission lifecycle is
  -- consumer-owned and cannot change the meaning of this geometric evidence.
  IF n.status<>'discoverable' OR i.status<>'current' OR horizon IS NULL OR NOT isfinite(horizon) OR horizon<=clock_timestamp() THEN
    RETURN jsonb_set(unavailable,'{input_state}','"evidence_stale"');
  END IF;
  -- Explicit asymmetric semantic-schema allowlist; no provider calls.
  IF ROW(o.provider_namespace,o.provider_product,o.provider_version,o.evidence_schema_version,o.route_shape_format)
    IS DISTINCT FROM ROW('mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','offering_route_evidence_v1','geojson_linestring_v1')
    OR ROW(r.provider_namespace,r.provider_product,r.provider_version,r.evidence_schema_version,r.route_shape_format)
    IS DISTINCT FROM ROW('mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','requester_route_evidence_v1','geojson_linestring_v1') THEN
    RETURN jsonb_set(jsonb_set(unavailable,'{input_state}','"evidence_invalid"'),'{reason}','"unsupported_provider_contract"');
  END IF;
  IF o.offering_member_id<>p_offering_member_id OR r.requesting_member_id<>p_requesting_member_id THEN
    RETURN jsonb_set(unavailable,'{input_state}','"evidence_invalid"'); END IF;
  PERFORM private.assert_offering_route_evidence(o.id);
  PERFORM private.assert_requester_route_evidence(r.id);
  ctx:=jsonb_build_object('need_id',n.id,'requester_id',n.member_id,'need_status',n.status,
    'requester_earliest',n.earliest_departure_at,'requester_latest',n.latest_departure_at,
    'intent_id',i.id,'offerer_id',i.offering_member_id,'intent_version',i.version,'intent_status',i.status,
    'offerer_earliest',i.earliest_departure_at,'offerer_latest',i.latest_departure_at,'intent_expiry',i.expires_at,
    'offerer_evidence',to_jsonb(o)-'route_shape'-'created_at',
    'requester_evidence',to_jsonb(r)-'route_shape'-'created_at','endpoint_references',refs,'expires_at',horizon,
    'algorithm_version','shared_segment_geographic_assessment_v1',
    'parameter_fingerprint',encode(sha256(convert_to(private.shared_segment_assessment_parameters(),'UTF8')),'hex'));
  IF horizon<=clock_timestamp() THEN RETURN jsonb_set(unavailable,'{input_state}','"evidence_stale"'); END IF;
  RETURN jsonb_build_object('input_state','ready','reason',NULL,'context',ctx,
    'input_context_fingerprint',encode(sha256(convert_to(ctx::text,'UTF8')),'hex'),
    'expires_at',horizon,'offerer_shape',o.route_shape,'requester_shape',r.route_shape);
EXCEPTION WHEN SQLSTATE '23514' OR no_data_found OR too_many_rows THEN
  IF COALESCE(n.latest_departure_at,n.earliest_departure_at)<=clock_timestamp()
    OR i.earliest_departure_at<=clock_timestamp() OR i.expires_at<=clock_timestamp()
    OR EXISTS(SELECT 1 FROM private.movement_location_references x WHERE x.id IN (
      SELECT location_reference_id FROM private.movement_need_locations WHERE movement_need_id=p_movement_need_id
      UNION ALL SELECT location_reference_id FROM private.offering_movement_intent_locations WHERE intent_id=p_offering_movement_intent_id
    ) AND x.expires_at<=clock_timestamp()) THEN
    RETURN jsonb_set(unavailable,'{input_state}','"evidence_stale"');
  END IF;
  RETURN jsonb_set(unavailable,'{input_state}','"evidence_invalid"');
END;
$$;
REVOKE ALL ON FUNCTION public.get_shared_segment_geographic_assessment_context_for_server(uuid,uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_shared_segment_geographic_assessment_context_for_server(uuid,uuid,uuid,uuid) TO service_role;

-- Bounded validation of result facts, not geographic computation. SQL trusts the
-- internal producer's geometry calculation, never arbitrary participant input.
CREATE FUNCTION private.validate_shared_segment_assessment_result(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; v numeric; m jsonb; interval_os numeric; interval_oe numeric; interval_rs numeric; interval_re numeric;
  expected text[];
BEGIN
  expected:=ARRAY['algorithmVersion','inputState','assessmentState','geographicResult','reasons','alternativeCorridors',
    'authorizesAdmission','confirmsUsableSharedSegment','roadTopologyVerified','offererTotal','requesterTotal',
    'offererSupported','requesterSupported','offererFraction','requesterFraction','supportIntervals','ambiguityCount',
    'sameDirectionCount','reverseDirectionCount','offererPointCount','requesterPointCount','workUnits'];
  IF p IS NULL OR jsonb_typeof(p)<>'object' OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(p) x)
    IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(expected) x)
    OR p->>'algorithmVersion' IS DISTINCT FROM 'shared_segment_geographic_assessment_v1'
    OR p->>'alternativeCorridors' IS DISTINCT FROM 'unassessed'
    OR p->>'assessmentState' IS NULL OR p->>'assessmentState' NOT IN ('complete','not_run','assessment_unavailable')
    OR p->>'inputState' IS NULL OR p->>'inputState' NOT IN ('ready','evidence_invalid')
    OR p->'authorizesAdmission' IS DISTINCT FROM 'false'::jsonb
    OR p->'confirmsUsableSharedSegment' IS DISTINCT FROM 'false'::jsonb
    OR p->'roadTopologyVerified' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid canonical geographic assessment'; END IF;
  FOREACH k IN ARRAY ARRAY['offererTotal','requesterTotal','offererSupported','requesterSupported','offererFraction','requesterFraction',
    'ambiguityCount','sameDirectionCount','reverseDirectionCount','offererPointCount','requesterPointCount','workUnits'] LOOP
    IF jsonb_typeof(p->k)<>'number' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid assessment number'; END IF;
    v:=(p->>k)::numeric;
    IF v<0 OR v>100000000 OR v<>round(v,6) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid assessment number'; END IF;
    IF k IN ('ambiguityCount','sameDirectionCount','reverseDirectionCount','offererPointCount','requesterPointCount','workUnits') AND v<>trunc(v) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid assessment count'; END IF;
  END LOOP;
  IF (p->>'offererPointCount')::numeric>20000 OR (p->>'requesterPointCount')::numeric>20000 OR (p->>'workUnits')::numeric>1000000
    OR (p->>'offererSupported')::numeric>(p->>'offererTotal')::numeric OR (p->>'requesterSupported')::numeric>(p->>'requesterTotal')::numeric
    OR (p->>'offererFraction')::numeric>1 OR (p->>'requesterFraction')::numeric>1
    OR jsonb_typeof(p->'supportIntervals')<>'array' OR jsonb_array_length(p->'supportIntervals')>20000
    OR jsonb_typeof(p->'reasons')<>'array' OR jsonb_array_length(p->'reasons')>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment bound violated'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(p->'supportIntervals') LOOP
    IF jsonb_typeof(m)<>'object' OR (SELECT array_agg(x ORDER BY x) FROM jsonb_object_keys(m) x)
      IS DISTINCT FROM ARRAY['chain','offererEnd','offererStart','requesterEnd','requesterStart']::text[] THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid support interval'; END IF;
    IF jsonb_typeof(m->'chain')<>'number' OR (m->>'chain')::numeric<>trunc((m->>'chain')::numeric)
      OR (m->>'chain')::numeric<0 OR (m->>'chain')::numeric>=20000 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid support chain'; END IF;
    FOREACH k IN ARRAY ARRAY['offererStart','offererEnd','requesterStart','requesterEnd'] LOOP
      IF jsonb_typeof(m->k)<>'number' OR (m->>k)::numeric<>round((m->>k)::numeric,6) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid interval position'; END IF;
    END LOOP;
    interval_os:=(m->>'offererStart')::numeric;interval_oe:=(m->>'offererEnd')::numeric;interval_rs:=(m->>'requesterStart')::numeric;interval_re:=(m->>'requesterEnd')::numeric;
    IF interval_os<0 OR interval_rs<0 OR interval_oe<interval_os OR interval_re<interval_rs OR interval_oe>(p->>'offererTotal')::numeric OR interval_re>(p->>'requesterTotal')::numeric THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid monotonic interval'; END IF;
  END LOOP;
  -- Compare actual interval unions, so reciprocal/alternative facts cannot inflate lengths.
  FOR k IN SELECT unnest(ARRAY['offerer','requester']) LOOP
    SELECT COALESCE(sum(greatest(0,b-greatest(a,COALESCE(previous,0)))),0) INTO v FROM (
      SELECT a,b,max(b) OVER(ORDER BY a,b ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) previous FROM (
        SELECT (value->>(k||'Start'))::numeric a,(value->>(k||'End'))::numeric b FROM jsonb_array_elements(p->'supportIntervals')
      ) positions
    ) unions;
    -- 0.02m = 20,000 intervals * 10^-6m output precision; representation
    -- validation only. The TS positive gate uses unrounded supported lengths.
    IF abs(v-(p->>(k||'Supported'))::numeric)>0.02 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Support union mismatch'; END IF;
    IF (p->>(k||'Total'))::numeric>0 AND abs((p->>(k||'Fraction'))::numeric-(p->>(k||'Supported'))::numeric/(p->>(k||'Total'))::numeric)>0.000001 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Support fraction mismatch'; END IF;
  END LOOP;
  IF p->>'assessmentState'='complete' THEN
    IF p->>'inputState' IS DISTINCT FROM 'ready' OR p->>'geographicResult' NOT IN ('inconclusive','overlap_observed','geometric_corridor_support')
      OR p->'geographicResult'='null'::jsonb OR (p->>'offererTotal')::numeric<=0 OR (p->>'requesterTotal')::numeric<=0
      OR (p->>'offererPointCount')::integer<2 OR (p->>'requesterPointCount')::integer<2 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid complete assessment'; END IF;
    IF p->>'geographicResult'='geometric_corridor_support' THEN
      IF p->'reasons'<>'[]'::jsonb OR (p->>'ambiguityCount')::integer<>0
        OR (p->>'offererSupported')::numeric<100 OR (p->>'requesterSupported')::numeric<100 THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid positive support'; END IF;
      -- O(K log K) validation of producer interval facts, never geometry work.
      -- A positive chain must progress on BOTH axes, with no gap over 15m.
      IF EXISTS(SELECT 1 FROM (
        SELECT os,oe,rs,re,lag(os) OVER w previous_os,lag(rs) OVER w previous_rs,
          max(oe) OVER w2 previous_oe,max(re) OVER w2 previous_re FROM (
          SELECT (value->>'chain')::integer chain,(value->>'offererStart')::numeric os,(value->>'offererEnd')::numeric oe,
            (value->>'requesterStart')::numeric rs,(value->>'requesterEnd')::numeric re FROM jsonb_array_elements(p->'supportIntervals')
        ) positions WINDOW w AS(PARTITION BY chain ORDER BY os,rs,oe),
          w2 AS(PARTITION BY chain ORDER BY os,rs,oe ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
      ) progress WHERE os-previous_oe>15.000001 OR rs-previous_re>15.000001
        OR oe<previous_oe-0.000001 OR re<previous_re-0.000001 OR rs<previous_rs-0.000001) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid continuous forward support'; END IF;
      IF NOT EXISTS(SELECT 1 FROM (
        SELECT chain,sum(greatest(0,oe-greatest(os,COALESCE(po,0)))) ol,
          sum(greatest(0,re-greatest(rs,COALESCE(pr,0)))) rl FROM (
          SELECT chain,os,oe,rs,re,max(oe) OVER w po,max(re) OVER w pr FROM (
            SELECT (value->>'chain')::integer chain,(value->>'offererStart')::numeric os,(value->>'offererEnd')::numeric oe,
              (value->>'requesterStart')::numeric rs,(value->>'requesterEnd')::numeric re FROM jsonb_array_elements(p->'supportIntervals')
          ) positions WINDOW w AS(PARTITION BY chain ORDER BY os,rs,oe ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
        ) intervals GROUP BY chain
      ) supported WHERE ol>=99.999999 AND rl>=99.999999) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='No qualifying continuous support chain'; END IF;
    ELSIF p->>'geographicResult'='overlap_observed' THEN
      IF jsonb_array_length(p->'supportIntervals')=0 OR p->'reasons' NOT IN ('["ambiguous_traversal"]'::jsonb,'["below_positive_support_standard"]'::jsonb)
        OR ((p->>'ambiguityCount')::integer>0) IS DISTINCT FROM (p->'reasons'='["ambiguous_traversal"]'::jsonb) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid overlap result'; END IF;
    ELSE
      IF jsonb_array_length(p->'supportIntervals')<>0 OR p->'reasons' NOT IN ('["reverse_direction_only"]'::jsonb,'["no_positive_support_on_reference_route"]'::jsonb) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid inconclusive result'; END IF;
    END IF;
  ELSE
    IF NOT ((p->>'assessmentState'='assessment_unavailable' AND p->>'inputState'='ready'
      AND p->'reasons'='["processing_limit"]'::jsonb)
      OR (p->>'assessmentState'='not_run' AND p->>'inputState'='evidence_invalid' AND p->'reasons'='[]'::jsonb))
      OR p->'geographicResult' IS DISTINCT FROM 'null'::jsonb OR p->'supportIntervals'<>'[]'::jsonb
      OR (p->>'offererTotal')::numeric<>0 OR (p->>'requesterTotal')::numeric<>0
      OR (p->>'offererFraction')::numeric<>0 OR (p->>'requesterFraction')::numeric<>0 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid unavailable assessment'; END IF;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_shared_segment_assessment_result(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.publish_shared_segment_geographic_assessment_for_server(
  p_movement_need_id uuid,p_requesting_member_id uuid,p_offering_movement_intent_id uuid,p_offering_member_id uuid,
  p_context jsonb,p_result jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; ctx jsonb; fp text; oid uuid; rid uuid; new_id uuid;
  stored private.shared_segment_geographic_assessments%ROWTYPE; stamp timestamptz;
BEGIN
  snapshot:=public.get_shared_segment_geographic_assessment_context_for_server(
    p_movement_need_id,p_requesting_member_id,p_offering_movement_intent_id,p_offering_member_id);
  ctx:=snapshot->'context';fp:=snapshot->>'input_context_fingerprint';
  IF snapshot->>'input_state'<>'ready' OR p_context IS NULL OR ctx IS DISTINCT FROM p_context THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Geographic assessment inputs changed or unavailable'; END IF;
  PERFORM private.validate_shared_segment_assessment_result(p_result);
  oid:=(ctx->'offerer_evidence'->>'id')::uuid;rid:=(ctx->'requester_evidence'->>'id')::uuid;
  stamp:=clock_timestamp();
  IF (ctx->>'expires_at')::timestamptz<=stamp THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Geographic assessment inputs expired'; END IF;
  INSERT INTO private.shared_segment_geographic_assessments(offerer_route_evidence_id,requester_route_evidence_id,
    offerer_route_version,requester_route_version,offering_movement_intent_id,movement_need_id,offering_member_id,requesting_member_id,
    algorithm_version,parameter_fingerprint,input_context_fingerprint,canonical_context,canonical_result,generated_at,created_at,expires_at)
  VALUES(oid,rid,(ctx->'offerer_evidence'->>'version')::integer,(ctx->'requester_evidence'->>'version')::integer,
    p_offering_movement_intent_id,p_movement_need_id,p_offering_member_id,p_requesting_member_id,
    'shared_segment_geographic_assessment_v1',ctx->>'parameter_fingerprint',fp,ctx,p_result,stamp,stamp,(ctx->>'expires_at')::timestamptz)
  ON CONFLICT(offerer_route_evidence_id,requester_route_evidence_id,algorithm_version,input_context_fingerprint) DO NOTHING RETURNING id INTO new_id;
  IF new_id IS NOT NULL THEN
    IF (ctx->>'expires_at')::timestamptz<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Geographic assessment inputs expired'; END IF;
    RETURN jsonb_build_object('assessment_id',new_id,'publication_state','published');
  END IF;
  -- Separate statement: obtains a fresh READ COMMITTED snapshot after a UNIQUE wait.
  SELECT x.* INTO STRICT stored FROM private.shared_segment_geographic_assessments x
    WHERE x.offerer_route_evidence_id=oid AND x.requester_route_evidence_id=rid
      AND x.algorithm_version='shared_segment_geographic_assessment_v1' AND x.input_context_fingerprint=fp;
  IF stored.canonical_context IS DISTINCT FROM ctx OR stored.canonical_result IS DISTINCT FROM p_result
    OR stored.parameter_fingerprint IS DISTINCT FROM ctx->>'parameter_fingerprint' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Geographic assessment nondeterminism or identity collision'; END IF;
  IF stored.expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Geographic assessment inputs expired'; END IF;
  RETURN jsonb_build_object('assessment_id',stored.id,'publication_state','reuse_existing');
END;
$$;
REVOKE ALL ON FUNCTION public.publish_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid,jsonb,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.publish_shared_segment_geographic_assessment_for_server(uuid,uuid,uuid,uuid,jsonb,jsonb) TO service_role;

COMMIT;
