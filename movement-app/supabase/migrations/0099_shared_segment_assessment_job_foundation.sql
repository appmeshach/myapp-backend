BEGIN;

-- Private work scheduling only. Geometry remains the frozen 0096 TypeScript
-- engine; all evidence publication remains authoritative in 0096.
CREATE TABLE private.shared_segment_assessment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_id uuid NOT NULL REFERENCES private.offering_movement_availability(id),
  movement_need_id uuid NOT NULL REFERENCES public.movement_needs(id),
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offerer_route_evidence_id uuid NOT NULL REFERENCES private.offering_route_evidence(id),
  requester_route_evidence_id uuid NOT NULL REFERENCES private.requester_route_evidence(id),
  offerer_route_version integer NOT NULL CHECK (offerer_route_version>0),
  requester_route_version integer NOT NULL CHECK (requester_route_version>0),
  algorithm_version text NOT NULL CHECK (algorithm_version='shared_segment_geographic_assessment_v1'),
  parameter_fingerprint text NOT NULL CHECK (parameter_fingerprint ~ '^[a-f0-9]{64}$'),
  input_context_fingerprint text NOT NULL CHECK (input_context_fingerprint ~ '^[a-f0-9]{64}$'),
  canonical_context jsonb NOT NULL CHECK (jsonb_typeof(canonical_context)='object'),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed','stale','expired')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  lease_token uuid UNIQUE,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(next_attempt_at)),
  last_failure text CHECK (last_failure IN ('lease_expired','calculation_failed','compute_timeout','compute_terminated','transport_failure','context_changed','dependency_expired','invalid_evidence','contract_mismatch')),
  assessment_id uuid REFERENCES private.shared_segment_geographic_assessments(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(updated_at)),
  UNIQUE (offerer_route_evidence_id,requester_route_evidence_id,algorithm_version,input_context_fingerprint),
  CHECK (expires_at>created_at AND updated_at>=created_at),
  CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL)),
  CHECK (lease_expires_at IS NULL OR (isfinite(lease_expires_at) AND lease_expires_at<=expires_at)),
  CHECK (status<>'running' OR (lease_token IS NOT NULL AND attempt_count>0)),
  CHECK (status<>'pending' OR (lease_token IS NULL AND attempt_count<3)),
  CHECK ((status='completed')=(assessment_id IS NOT NULL))
);
ALTER TABLE private.shared_segment_assessment_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.shared_segment_assessment_jobs FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX shared_segment_assessment_jobs_claim_idx
  ON private.shared_segment_assessment_jobs(next_attempt_at,created_at,id)
  WHERE status IN ('pending','running');

CREATE FUNCTION private.protect_shared_segment_assessment_job()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','last_failure','assessment_id','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','last_failure','assessment_id','updated_at']) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job identity is immutable';
    END IF;
    IF OLD.status IN ('completed','failed','stale','expired') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job is terminal';
    END IF;
    IF NEW.attempt_count<OLD.attempt_count OR NEW.attempt_count>OLD.attempt_count+1 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job attempts cannot reset';
    END IF;
    IF NEW.attempt_count>OLD.attempt_count THEN
      IF NEW.status<>'running' OR NEW.lease_token IS NULL OR NEW.lease_token IS NOT DISTINCT FROM OLD.lease_token
        OR (OLD.status='running' AND OLD.lease_expires_at>clock_timestamp()) OR OLD.status NOT IN ('pending','running') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job claim is invalid';
      END IF;
    ELSIF NEW.lease_token IS NOT NULL AND NEW.lease_token IS DISTINCT FROM OLD.lease_token THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job lease requires a new attempt';
    END IF;
  END IF;
  IF NEW.canonical_context->>'need_id' IS DISTINCT FROM NEW.movement_need_id::text
    OR NEW.canonical_context->>'requester_id' IS DISTINCT FROM NEW.requesting_member_id::text
    OR NEW.canonical_context->>'intent_id' IS DISTINCT FROM NEW.offering_movement_intent_id::text
    OR NEW.canonical_context->>'offerer_id' IS DISTINCT FROM NEW.offering_member_id::text
    OR NEW.canonical_context->'offerer_evidence'->>'id' IS DISTINCT FROM NEW.offerer_route_evidence_id::text
    OR NEW.canonical_context->'requester_evidence'->>'id' IS DISTINCT FROM NEW.requester_route_evidence_id::text
    OR (NEW.canonical_context->'offerer_evidence'->>'version')::integer IS DISTINCT FROM NEW.offerer_route_version
    OR (NEW.canonical_context->'requester_evidence'->>'version')::integer IS DISTINCT FROM NEW.requester_route_version
    OR NEW.canonical_context->>'algorithm_version' IS DISTINCT FROM NEW.algorithm_version
    OR NEW.canonical_context->>'parameter_fingerprint' IS DISTINCT FROM NEW.parameter_fingerprint
    OR LEAST((NEW.canonical_context->>'expires_at')::timestamptz,
      (SELECT a.expires_at FROM private.offering_movement_availability a WHERE a.id=NEW.availability_id)) IS DISTINCT FROM NEW.expires_at
    OR encode(sha256(convert_to(NEW.canonical_context::text,'UTF8')),'hex') IS DISTINCT FROM NEW.input_context_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job canonical identity is invalid';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_shared_segment_assessment_job() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_shared_segment_assessment_job BEFORE INSERT OR UPDATE OR DELETE
  ON private.shared_segment_assessment_jobs FOR EACH ROW EXECUTE FUNCTION private.protect_shared_segment_assessment_job();

CREATE FUNCTION public.register_requester_availability_assessment_job_for_server(
  p_verified_member_id uuid,p_movement_need_id uuid,p_availability_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected record; snapshot jsonb; ctx jsonb; reused jsonb; j private.shared_segment_assessment_jobs%ROWTYPE; availability_horizon timestamptz;
BEGIN
  SELECT * INTO STRICT selected FROM public.get_requester_availability_matching_context_for_server(
    p_verified_member_id,p_movement_need_id,p_availability_id);
  reused:=public.get_current_shared_segment_geographic_assessment_for_server(
    p_movement_need_id,p_verified_member_id,selected.offering_movement_intent_id,selected.offering_member_id);
  IF reused->>'lookup_state'='reuse_existing' THEN
    PERFORM * FROM public.get_requester_availability_matching_context_for_server(p_verified_member_id,p_movement_need_id,p_availability_id);
    RETURN jsonb_build_object('state','assessment_reuse','assessment',reused);
  ELSIF reused->>'lookup_state'='not_ready' THEN RETURN jsonb_build_object('state','not_ready'); END IF;
  snapshot:=public.get_shared_segment_geographic_assessment_context_for_server(
    p_movement_need_id,p_verified_member_id,selected.offering_movement_intent_id,selected.offering_member_id);
  IF snapshot->>'input_state'<>'ready' THEN RETURN jsonb_build_object('state','not_ready'); END IF;
  ctx:=snapshot->'context';
  SELECT expires_at INTO STRICT availability_horizon FROM private.offering_movement_availability WHERE id=p_availability_id;
  IF (ctx->'offerer_evidence'->>'id')::uuid IS DISTINCT FROM selected.route_evidence_id
    OR (ctx->'offerer_evidence'->>'version')::integer IS DISTINCT FROM selected.route_evidence_version THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Selected assessment context changed'; END IF;
  INSERT INTO private.shared_segment_assessment_jobs(availability_id,movement_need_id,requesting_member_id,
    offering_movement_intent_id,offering_member_id,offerer_route_evidence_id,requester_route_evidence_id,
    offerer_route_version,requester_route_version,algorithm_version,parameter_fingerprint,input_context_fingerprint,canonical_context,expires_at)
  VALUES(p_availability_id,p_movement_need_id,p_verified_member_id,selected.offering_movement_intent_id,selected.offering_member_id,
    (ctx->'offerer_evidence'->>'id')::uuid,(ctx->'requester_evidence'->>'id')::uuid,
    (ctx->'offerer_evidence'->>'version')::integer,(ctx->'requester_evidence'->>'version')::integer,
    ctx->>'algorithm_version',ctx->>'parameter_fingerprint',snapshot->>'input_context_fingerprint',ctx,LEAST((snapshot->>'expires_at')::timestamptz,availability_horizon))
  ON CONFLICT(offerer_route_evidence_id,requester_route_evidence_id,algorithm_version,input_context_fingerprint) DO NOTHING;
  SELECT * INTO STRICT j FROM private.shared_segment_assessment_jobs
    WHERE offerer_route_evidence_id=(ctx->'offerer_evidence'->>'id')::uuid
      AND requester_route_evidence_id=(ctx->'requester_evidence'->>'id')::uuid
      AND algorithm_version=ctx->>'algorithm_version' AND input_context_fingerprint=snapshot->>'input_context_fingerprint'
    FOR UPDATE;
  IF j.canonical_context IS DISTINCT FROM ctx OR j.availability_id IS DISTINCT FROM p_availability_id
    OR j.parameter_fingerprint IS DISTINCT FROM ctx->>'parameter_fingerprint' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job identity collision'; END IF;
  PERFORM * FROM public.get_requester_availability_matching_context_for_server(p_verified_member_id,p_movement_need_id,p_availability_id);
  IF j.expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job inputs expired'; END IF;
  RETURN jsonb_build_object('state','job_registered','job_id',j.id,'status',j.status,'attempt_count',j.attempt_count);
END;
$$;

CREATE FUNCTION public.claim_shared_segment_assessment_job_for_server()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.shared_segment_assessment_jobs%ROWTYPE; stamp timestamptz;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Assessment jobs require READ COMMITTED'; END IF;
  -- Bounded maintenance; claims never acquire application dependency locks.
  FOR j IN SELECT * FROM private.shared_segment_assessment_jobs
    WHERE status IN ('pending','running') AND (expires_at<=clock_timestamp()
      OR status='pending' AND next_attempt_at<=clock_timestamp()
      OR status='running' AND lease_expires_at<=clock_timestamp())
    ORDER BY next_attempt_at,created_at,id LIMIT 16 FOR UPDATE SKIP LOCKED LOOP
    stamp:=clock_timestamp();
    IF j.expires_at<=stamp THEN
      UPDATE private.shared_segment_assessment_jobs SET status='expired',last_failure='dependency_expired',updated_at=stamp WHERE id=j.id;
    ELSIF j.attempt_count>=3 THEN
      UPDATE private.shared_segment_assessment_jobs SET status='failed',last_failure='lease_expired',updated_at=stamp WHERE id=j.id;
    ELSE
      UPDATE private.shared_segment_assessment_jobs SET status='running',attempt_count=attempt_count+1,
        lease_token=gen_random_uuid(),lease_expires_at=LEAST(stamp+interval '60 seconds',expires_at),updated_at=stamp,
        last_failure=CASE WHEN j.status='running' THEN 'lease_expired' ELSE last_failure END
        WHERE id=j.id RETURNING * INTO j;
      RETURN jsonb_build_object('state','claimed','job_id',j.id,'lease_token',j.lease_token,
        'lease_expires_at',j.lease_expires_at,'attempt_count',j.attempt_count);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('state','idle');
END;
$$;

-- Dependency locks precede the job lock. A claim locks only the job and commits;
-- no inverse dependency acquisition or lock survives local computation.
CREATE FUNCTION private.load_bound_shared_segment_assessment_job(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j private.shared_segment_assessment_jobs%ROWTYPE; selected record; snapshot jsonb; reused jsonb; invalid boolean:=false;
BEGIN
  SELECT * INTO j FROM private.shared_segment_assessment_jobs WHERE id=p_job_id;
  IF NOT FOUND OR p_lease_token IS NULL OR j.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN jsonb_build_object('state','lease_invalid'); END IF;
  IF j.status NOT IN ('running','completed') THEN RETURN jsonb_build_object('state',j.status); END IF;
  BEGIN
    SELECT * INTO STRICT selected FROM public.get_requester_availability_matching_context_for_server(
      j.requesting_member_id,j.movement_need_id,j.availability_id);
    snapshot:=public.get_shared_segment_geographic_assessment_context_for_server(
      j.movement_need_id,j.requesting_member_id,j.offering_movement_intent_id,j.offering_member_id);
    invalid:=snapshot->>'input_state'<>'ready' OR snapshot->'context' IS DISTINCT FROM j.canonical_context
      OR snapshot->>'input_context_fingerprint' IS DISTINCT FROM j.input_context_fingerprint
      OR selected.offering_movement_intent_id IS DISTINCT FROM j.offering_movement_intent_id
      OR selected.offering_member_id IS DISTINCT FROM j.offering_member_id
      OR selected.route_evidence_id IS DISTINCT FROM j.offerer_route_evidence_id
      OR selected.route_evidence_version IS DISTINCT FROM j.offerer_route_version;
  EXCEPTION WHEN SQLSTATE '23514' OR SQLSTATE '42501' OR SQLSTATE 'P0001' OR no_data_found THEN invalid:=true;
  END;
  SELECT * INTO STRICT j FROM private.shared_segment_assessment_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.lease_token IS DISTINCT FROM p_lease_token OR j.status NOT IN ('running','completed') THEN
    RETURN jsonb_build_object('state','lease_invalid'); END IF;
  IF j.expires_at<=clock_timestamp() THEN
    IF j.status='running' THEN UPDATE private.shared_segment_assessment_jobs SET status='expired',last_failure='dependency_expired',updated_at=clock_timestamp() WHERE id=j.id; END IF;
    RETURN jsonb_build_object('state','expired');
  END IF;
  IF j.status='running' AND j.lease_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('state','lease_invalid'); END IF;
  IF invalid THEN
    IF j.status='running' THEN UPDATE private.shared_segment_assessment_jobs SET status='stale',last_failure='context_changed',updated_at=clock_timestamp() WHERE id=j.id; END IF;
    RETURN jsonb_build_object('state','stale');
  END IF;
  reused:=public.get_current_shared_segment_geographic_assessment_for_server(
    j.movement_need_id,j.requesting_member_id,j.offering_movement_intent_id,j.offering_member_id);
  IF j.expires_at<=clock_timestamp() OR (j.status='running' AND j.lease_expires_at<=clock_timestamp()) THEN
    RETURN jsonb_build_object('state','lease_invalid'); END IF;
  RETURN jsonb_build_object('state','ready','job_id',j.id,'attempt_count',j.attempt_count,
    'lease_expires_at',j.lease_expires_at,'snapshot',snapshot,'assessment',reused);
END;
$$;
REVOKE ALL ON FUNCTION private.load_bound_shared_segment_assessment_job(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.load_shared_segment_assessment_job_context_for_server(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loaded jsonb; j private.shared_segment_assessment_jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM private.shared_segment_assessment_jobs WHERE id=p_job_id;
  IF NOT FOUND OR j.status<>'running' OR p_lease_token IS NULL OR j.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN jsonb_build_object('state','lease_invalid'); END IF;
  loaded:=private.load_bound_shared_segment_assessment_job(p_job_id,p_lease_token);
  IF loaded->>'state'='ready' THEN
    SELECT * INTO STRICT j FROM private.shared_segment_assessment_jobs WHERE id=p_job_id;
    IF j.status<>'running' OR j.lease_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('state','lease_invalid'); END IF;
  END IF;
  RETURN loaded;
END;
$$;

CREATE FUNCTION public.finalize_shared_segment_assessment_job_for_server(
  p_job_id uuid,p_lease_token uuid,p_context jsonb,p_result jsonb DEFAULT NULL,p_recovery_only boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loaded jsonb; j private.shared_segment_assessment_jobs%ROWTYPE; published jsonb; reused jsonb;
BEGIN
  IF p_recovery_only IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Assessment recovery mode is required'; END IF;
  loaded:=private.load_bound_shared_segment_assessment_job(p_job_id,p_lease_token);
  IF loaded->>'state'<>'ready' THEN RETURN jsonb_build_object('state',loaded->>'state'); END IF;
  SELECT * INTO STRICT j FROM private.shared_segment_assessment_jobs WHERE id=p_job_id FOR UPDATE;
  IF p_context IS DISTINCT FROM j.canonical_context THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job context mismatch'; END IF;
  reused:=loaded->'assessment';
  IF reused->>'lookup_state'='reuse_existing' THEN
    IF p_result IS NOT NULL AND reused->'canonical_result' IS DISTINCT FROM p_result THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job result mismatch'; END IF;
    published:=jsonb_build_object('assessment_id',reused->>'assessment_id','publication_state','reuse_existing');
  ELSE
    IF p_result IS NULL OR p_recovery_only THEN RETURN jsonb_build_object('state','not_found'); END IF;
    published:=public.publish_shared_segment_geographic_assessment_for_server(
      j.movement_need_id,j.requesting_member_id,j.offering_movement_intent_id,j.offering_member_id,p_context,p_result);
  END IF;
  PERFORM * FROM public.get_requester_availability_matching_context_for_server(j.requesting_member_id,j.movement_need_id,j.availability_id);
  -- Publication can wait on a unique conflict. Reject an expired fence after it
  -- returns, rolling back both the insert and completion in this transaction.
  IF j.expires_at<=clock_timestamp() OR (j.status='running' AND j.lease_expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment job fence expired'; END IF;
  IF j.status='completed' THEN
    IF j.assessment_id IS DISTINCT FROM (published->>'assessment_id')::uuid THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment completion identity mismatch'; END IF;
  ELSE
    UPDATE private.shared_segment_assessment_jobs SET status='completed',assessment_id=(published->>'assessment_id')::uuid,
      updated_at=clock_timestamp() WHERE id=j.id;
  END IF;
  IF j.expires_at<=clock_timestamp() OR (j.status='running' AND j.lease_expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Assessment completion fence expired'; END IF;
  RETURN jsonb_build_object('state','completed','assessment_id',published->>'assessment_id','publication_state',published->>'publication_state');
END;
$$;

CREATE FUNCTION public.fail_shared_segment_assessment_job_for_server(p_job_id uuid,p_lease_token uuid,p_category text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loaded jsonb; j private.shared_segment_assessment_jobs%ROWTYPE; stamp timestamptz;
BEGIN
  IF p_category IS NULL OR p_category NOT IN ('calculation_failed','compute_timeout','compute_terminated','transport_failure','invalid_evidence','contract_mismatch') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid assessment failure category'; END IF;
  loaded:=private.load_bound_shared_segment_assessment_job(p_job_id,p_lease_token);
  IF loaded->>'state'<>'ready' THEN RETURN jsonb_build_object('state',loaded->>'state'); END IF;
  SELECT * INTO STRICT j FROM private.shared_segment_assessment_jobs WHERE id=p_job_id FOR UPDATE;
  IF j.status='completed' THEN RETURN jsonb_build_object('state','completed'); END IF;
  stamp:=clock_timestamp();
  UPDATE private.shared_segment_assessment_jobs SET status=CASE WHEN p_category IN ('invalid_evidence','contract_mismatch') THEN 'stale' WHEN attempt_count>=3 THEN 'failed' ELSE 'pending' END,
    lease_token=NULL,lease_expires_at=NULL,last_failure=p_category,updated_at=stamp,
    next_attempt_at=stamp+CASE WHEN attempt_count=1 THEN interval '2 seconds' ELSE interval '10 seconds' END
    WHERE id=j.id RETURNING * INTO j;
  RETURN jsonb_build_object('state',j.status);
END;
$$;

REVOKE ALL ON FUNCTION public.register_requester_availability_assessment_job_for_server(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.claim_shared_segment_assessment_job_for_server() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.load_shared_segment_assessment_job_context_for_server(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.finalize_shared_segment_assessment_job_for_server(uuid,uuid,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.fail_shared_segment_assessment_job_for_server(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_requester_availability_assessment_job_for_server(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_shared_segment_assessment_job_for_server() TO service_role;
GRANT EXECUTE ON FUNCTION public.load_shared_segment_assessment_job_context_for_server(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_shared_segment_assessment_job_for_server(uuid,uuid,jsonb,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_shared_segment_assessment_job_for_server(uuid,uuid,text) TO service_role;
COMMIT;
