BEGIN;

-- The service authenticates the member and verifies the search proof before
-- calling intake. Only acceptance metadata, never a proof or search result, is stored.
REVOKE ALL ON FUNCTION public.record_selected_location_for_member(uuid,text,text,text)
FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.record_location_resolution_for_server(uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz)
FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE private.movement_location_selection_attestations (
  selection_request_id uuid PRIMARY KEY REFERENCES private.movement_location_selection_receipts(request_id) ON DELETE RESTRICT,
  attestation_version text NOT NULL DEFAULT 'trusted_selection_intake_v1' CHECK (attestation_version='trusted_selection_intake_v1'),
  proof_version text NOT NULL CHECK (proof_version='selection_proof_v1'),
  proof_issued_at timestamptz NOT NULL CHECK (isfinite(proof_issued_at)),
  proof_expires_at timestamptz NOT NULL CHECK (isfinite(proof_expires_at)),
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(verified_at)),
  CHECK (proof_issued_at<=verified_at AND verified_at<proof_expires_at)
);
ALTER TABLE private.movement_location_selection_attestations ENABLE ROW LEVEL SECURITY;
-- No direct service reads are needed: the narrowly scoped RPCs provide recovery.
REVOKE ALL ON private.movement_location_selection_attestations FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_movement_location_selection_attestation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $protect$
BEGIN
  RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selection attestation is immutable';
END;
$protect$;
REVOKE ALL ON FUNCTION private.protect_movement_location_selection_attestation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_movement_location_selection_attestation
BEFORE UPDATE OR DELETE ON private.movement_location_selection_attestations
FOR EACH ROW EXECUTE FUNCTION private.protect_movement_location_selection_attestation();

CREATE FUNCTION private.require_verified_location_selection(p_verified_member_id uuid,p_source_location_reference_id uuid)
RETURNS private.movement_location_references
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $require$
DECLARE
  s private.movement_location_references%ROWTYPE;
  r private.movement_location_selection_receipts%ROWTYPE;
  a private.movement_location_selection_attestations%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Verified selection requires READ COMMITTED';
  END IF;
  -- Same denial for missing and foreign sources. Lock source before evidence,
  -- consistent with 0026; receipt and attestation are immutable.
  SELECT l.* INTO s FROM private.movement_location_references l
  WHERE l.id=p_source_location_reference_id AND l.owner_member_id=p_verified_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Verified selected location unavailable';
  END IF;
  SELECT x.* INTO r FROM private.movement_location_selection_receipts x WHERE x.location_reference_id=s.id;
  SELECT x.* INTO a FROM private.movement_location_selection_attestations x WHERE x.selection_request_id=r.request_id;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=p_verified_member_id)
    OR s.source_kind IS DISTINCT FROM 'member_selected' OR s.resolution_status IS DISTINCT FROM 'unresolved'
    OR s.latitude IS NOT NULL OR s.longitude IS NOT NULL OR s.resolved_at IS NOT NULL OR s.resolution_version IS NOT NULL
    OR s.provider_namespace IS NULL OR s.provider_place_reference IS NULL
    OR a.verified_at IS DISTINCT FROM r.recorded_at OR a.verified_at IS DISTINCT FROM s.created_at
    OR a.verified_at>clock_timestamp() OR (s.expires_at IS NOT NULL AND s.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Verified selected location unavailable';
  END IF;
  PERFORM private.assert_movement_location_selection_receipt(r.request_id);
  -- Proof validity is checked at acceptance, not at recovery/resolution time.
  RETURN s;
END;
$require$;
REVOKE ALL ON FUNCTION private.require_verified_location_selection(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.validate_movement_location_selection_attestation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $validate$
DECLARE
  s private.movement_location_references%ROWTYPE;
BEGIN
  SELECT l.* INTO s FROM private.movement_location_selection_receipts r
  JOIN private.movement_location_references l ON l.id=r.location_reference_id
  WHERE r.request_id=NEW.selection_request_id;
  PERFORM private.require_verified_location_selection(s.owner_member_id,s.id);
  RETURN NEW;
END;
$validate$;
REVOKE ALL ON FUNCTION private.validate_movement_location_selection_attestation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER validate_movement_location_selection_attestation
AFTER INSERT ON private.movement_location_selection_attestations
FOR EACH ROW EXECUTE FUNCTION private.validate_movement_location_selection_attestation();

CREATE FUNCTION public.record_verified_selected_location_for_server(
  p_verified_member_id uuid,p_selection_request_id uuid,p_declared_label text,
  p_provider_namespace text,p_provider_place_reference text,p_proof_version text,
  p_proof_issued_at timestamptz,p_proof_expires_at timestamptz
)
RETURNS TABLE(location_reference_id uuid,declared_label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $intake$
DECLARE
  s private.movement_location_references%ROWTYPE;
  r private.movement_location_selection_receipts%ROWTYPE;
  a private.movement_location_selection_attestations%ROWTYPE;
  v_id uuid;
  v_now timestamptz;
  v_constraint text;
  v_table text;
  v_schema text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Verified selection requires READ COMMITTED';
  END IF;
  IF p_verified_member_id IS NULL OR p_selection_request_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=p_verified_member_id)
    OR p_declared_label IS NULL OR p_declared_label<>btrim(p_declared_label)
    OR length(p_declared_label) NOT BETWEEN 1 AND 300 OR p_declared_label !~ '[^[:space:]]'
    OR p_provider_namespace IS NULL OR p_provider_namespace<>btrim(p_provider_namespace)
    OR length(p_provider_namespace) NOT BETWEEN 1 AND 100 OR p_provider_namespace !~ '[^[:space:]]'
    OR p_provider_place_reference IS NULL OR p_provider_place_reference<>btrim(p_provider_place_reference)
    OR length(p_provider_place_reference) NOT BETWEEN 1 AND 500 OR p_provider_place_reference !~ '[^[:space:]]'
    OR p_proof_version IS DISTINCT FROM 'selection_proof_v1'
    OR p_proof_issued_at IS NULL OR p_proof_expires_at IS NULL
    OR NOT isfinite(p_proof_issued_at) OR NOT isfinite(p_proof_expires_at)
    OR p_proof_issued_at>=p_proof_expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Verified selection input is invalid';
  END IF;
  SELECT x.* INTO r FROM private.movement_location_selection_receipts x WHERE x.request_id=p_selection_request_id;
  IF NOT FOUND THEN
    BEGIN
      v_now := clock_timestamp();
      IF p_proof_issued_at>v_now OR p_proof_expires_at<=v_now THEN
        RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Selection proof is not currently valid';
      END IF;
      INSERT INTO private.movement_location_references(
        owner_member_id,declared_label,source_kind,resolution_status,provider_namespace,provider_place_reference,
        latitude,longitude,resolution_version,resolved_at,expires_at,created_at
      ) VALUES (p_verified_member_id,p_declared_label,'member_selected','unresolved',p_provider_namespace,p_provider_place_reference,
        NULL,NULL,NULL,NULL,NULL,v_now) RETURNING id INTO v_id;
      INSERT INTO private.movement_location_selection_receipts(request_id,location_reference_id,recorded_at)
      VALUES (p_selection_request_id,v_id,v_now);
      INSERT INTO private.movement_location_selection_attestations(
        selection_request_id,proof_version,proof_issued_at,proof_expires_at,verified_at
      ) VALUES (p_selection_request_id,p_proof_version,p_proof_issued_at,p_proof_expires_at,v_now);
    EXCEPTION WHEN unique_violation THEN
      -- All three attempted inserts roll back before reading a concurrent winner.
      -- Only the receipt request-key race is recoverable, never unrelated errors.
      GET STACKED DIAGNOSTICS v_constraint=CONSTRAINT_NAME,v_table=TABLE_NAME,v_schema=SCHEMA_NAME;
      IF v_constraint<>'movement_location_selection_receipts_pkey'
        OR v_table<>'movement_location_selection_receipts' OR v_schema<>'private' THEN
        RAISE;
      END IF;
      SELECT x.* INTO r FROM private.movement_location_selection_receipts x WHERE x.request_id=p_selection_request_id;
      IF NOT FOUND THEN RAISE; END IF;
    END;
  END IF;
  SELECT x.* INTO r FROM private.movement_location_selection_receipts x WHERE x.request_id=p_selection_request_id;
  s := private.require_verified_location_selection(p_verified_member_id,r.location_reference_id);
  SELECT x.* INTO STRICT a FROM private.movement_location_selection_attestations x WHERE x.selection_request_id=r.request_id;
  IF s.declared_label IS DISTINCT FROM p_declared_label OR s.provider_namespace IS DISTINCT FROM p_provider_namespace
    OR s.provider_place_reference IS DISTINCT FROM p_provider_place_reference
    OR a.proof_version IS DISTINCT FROM p_proof_version OR a.proof_issued_at IS DISTINCT FROM p_proof_issued_at
    OR a.proof_expires_at IS DISTINCT FROM p_proof_expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Verified selection replay does not match';
  END IF;
  RETURN QUERY SELECT s.id,s.declared_label;
END;
$intake$;
REVOKE ALL ON FUNCTION public.record_verified_selected_location_for_server(uuid,uuid,text,text,text,text,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_verified_selected_location_for_server(uuid,uuid,text,text,text,text,timestamptz,timestamptz) TO service_role;

CREATE FUNCTION public.get_verified_selected_location_for_server(p_verified_member_id uuid,p_selection_request_id uuid)
RETURNS TABLE(location_reference_id uuid,declared_label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $recover$
DECLARE
  v_id uuid;
  s private.movement_location_references%ROWTYPE;
BEGIN
  SELECT r.location_reference_id INTO v_id FROM private.movement_location_selection_receipts r WHERE r.request_id=p_selection_request_id;
  s := private.require_verified_location_selection(p_verified_member_id,v_id);
  RETURN QUERY SELECT s.id,s.declared_label;
END;
$recover$;
REVOKE ALL ON FUNCTION public.get_verified_selected_location_for_server(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_verified_selected_location_for_server(uuid,uuid) TO service_role;

CREATE FUNCTION public.get_selected_location_resolution_context_for_server(
  p_verified_member_id uuid,p_source_location_reference_id uuid,p_producer_request_id uuid
)
RETURNS TABLE(provider_namespace text,provider_place_reference text,source_created_at timestamptz,source_expires_at timestamptz,
  evidence_id uuid,resolved_location_reference_id uuid,version integer,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $context$
DECLARE
  s private.movement_location_references%ROWTYPE;
  e private.movement_location_resolution_evidence%ROWTYPE;
  v_expiry timestamptz;
BEGIN
  s := private.require_verified_location_selection(p_verified_member_id,p_source_location_reference_id);
  IF p_producer_request_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Resolution operation identity is required';
  END IF;
  SELECT x.* INTO e FROM private.movement_location_resolution_evidence x WHERE x.producer_request_id=p_producer_request_id;
  IF FOUND THEN
    IF e.source_location_reference_id IS DISTINCT FROM s.id THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Resolution operation unavailable';
    END IF;
    PERFORM private.assert_movement_location_resolution_evidence(e.id);
    SELECT l.expires_at INTO v_expiry FROM private.movement_location_references l WHERE l.id=e.resolved_location_reference_id;
  END IF;
  RETURN QUERY SELECT s.provider_namespace,s.provider_place_reference,s.created_at,s.expires_at,
    e.id,e.resolved_location_reference_id,e.version,v_expiry;
END;
$context$;
REVOKE ALL ON FUNCTION public.get_selected_location_resolution_context_for_server(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_selected_location_resolution_context_for_server(uuid,uuid,uuid) TO service_role;

CREATE FUNCTION public.record_attested_location_resolution_for_server(
  p_verified_member_id uuid,p_source_location_reference_id uuid,p_producer_request_id uuid,
  p_provider_namespace text,p_provider_product text,p_provider_version text,p_provider_place_reference text,
  p_resolution_version text,p_latitude numeric,p_longitude numeric,p_resolved_at timestamptz,p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE(evidence_id uuid,resolved_location_reference_id uuid,version integer,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $resolve$
DECLARE
  s private.movement_location_references%ROWTYPE;
BEGIN
  s := private.require_verified_location_selection(p_verified_member_id,p_source_location_reference_id);
  IF s.provider_namespace IS DISTINCT FROM p_provider_namespace OR s.provider_place_reference IS DISTINCT FROM p_provider_place_reference THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Resolution provider selection identity does not match';
  END IF;
  -- Deployment owner retains execution; service_role cannot invoke 0026 directly.
  -- Preserve its authoritative validation, source lock, versioning and retry logic.
  RETURN QUERY SELECT r.* FROM public.record_location_resolution_for_server(
    p_source_location_reference_id,p_producer_request_id,p_provider_namespace,p_provider_product,p_provider_version,
    p_provider_place_reference,p_resolution_version,p_latitude,p_longitude,p_resolved_at,p_expires_at
  ) r;
END;
$resolve$;
REVOKE ALL ON FUNCTION public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_attested_location_resolution_for_server(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,timestamptz,timestamptz) TO service_role;

COMMIT;
