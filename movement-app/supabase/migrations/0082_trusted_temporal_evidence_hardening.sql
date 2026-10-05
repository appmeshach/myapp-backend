BEGIN;

-- Development filename: do not install alongside the paused completion 0082.
-- Trusted clocks record events; they do not prove causal order across samples.
-- Compatibility is checked before schema/function cutover. Never backfill clocks.
DO $compatibility$
BEGIN
  IF EXISTS (SELECT 1 FROM private.alignment_face_verifications)
    OR EXISTS (SELECT 1 FROM private.funded_movement_activation_faces) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Temporal hardening requires an empty face history; no inferred ordinal backfill';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.movement_location_resolution_evidence e
    LEFT JOIN private.movement_location_references t ON t.id=e.resolved_location_reference_id
    LEFT JOIN private.movement_location_references s ON s.id=e.source_location_reference_id
    WHERE t.id IS NULL OR s.id IS NULL OR t.id=s.id
      OR t.owner_member_id IS DISTINCT FROM s.owner_member_id
      OR t.declared_label IS DISTINCT FROM s.declared_label
      OR t.source_kind IS DISTINCT FROM 'provider_resolved' OR t.resolution_status IS DISTINCT FROM 'resolved'
      OR s.source_kind NOT IN ('member_declared','member_selected') OR s.resolution_status IS DISTINCT FROM 'unresolved'
      OR t.resolved_at IS NULL OR NOT isfinite(t.resolved_at) OR NOT isfinite(t.created_at) OR NOT isfinite(e.recorded_at)
      OR t.created_at IS DISTINCT FROM e.recorded_at OR t.resolved_at>e.recorded_at OR t.resolved_at<s.created_at
      OR (s.provider_namespace IS NOT NULL AND (t.provider_namespace IS DISTINCT FROM s.provider_namespace
        OR t.provider_place_reference IS DISTINCT FROM s.provider_place_reference))
      OR t.expires_at IS DISTINCT FROM LEAST(e.requested_expires_at,s.expires_at)
      OR (t.expires_at IS NOT NULL AND (NOT isfinite(t.expires_at) OR t.expires_at<=e.recorded_at))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Incompatible historical location attestation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.trusted_location_discovery_areas d
    LEFT JOIN private.movement_location_resolution_evidence e ON e.id=d.resolution_evidence_id
    WHERE e.id IS NULL OR d.resolved_location_reference_id IS DISTINCT FROM e.resolved_location_reference_id
      OR NOT isfinite(d.recorded_at) OR d.schema_version IS DISTINCT FROM 'trusted_location_discovery_area_v1'
      OR d.discovery_area_label IS DISTINCT FROM btrim(d.discovery_area_label)
      OR length(d.discovery_area_label) NOT BETWEEN 1 AND 500 OR d.discovery_area_label !~ '[^[:space:]]'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Incompatible historical discovery attestation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.trusted_location_state_evidence s
    LEFT JOIN private.movement_location_resolution_evidence e ON e.id=s.resolution_evidence_id
    LEFT JOIN private.movement_location_references r ON r.id=s.resolved_location_reference_id
    WHERE e.id IS NULL OR r.id IS NULL OR e.resolved_location_reference_id IS DISTINCT FROM s.resolved_location_reference_id
      OR s.provider_namespace IS DISTINCT FROM r.provider_namespace OR NOT isfinite(s.recorded_at)
      OR s.schema_version IS DISTINCT FROM 'trusted_location_state_v1'
      OR private.canonical_nigerian_state_key(s.state_name) IS NULL
      OR s.state_key IS DISTINCT FROM private.canonical_nigerian_state_key(s.state_name)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Incompatible historical state attestation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.offering_route_evidence e
    LEFT JOIN private.offering_movement_intents i ON i.id=e.offering_movement_intent_id
    LEFT JOIN private.movement_location_references o ON o.id=e.origin_location_reference_id
    LEFT JOIN private.movement_location_references d ON d.id=e.destination_location_reference_id
    WHERE i.id IS NULL OR o.id IS NULL OR d.id IS NULL
      OR e.offering_member_id IS DISTINCT FROM i.offering_member_id
      OR o.owner_member_id IS DISTINCT FROM i.offering_member_id OR d.owner_member_id IS DISTINCT FROM i.offering_member_id
      OR NOT EXISTS (SELECT 1 FROM private.offering_movement_intent_locations x WHERE x.intent_id=i.id AND x.role='origin' AND x.location_reference_id=o.id)
      OR NOT EXISTS (SELECT 1 FROM private.offering_movement_intent_locations x WHERE x.intent_id=i.id AND x.role='destination' AND x.location_reference_id=d.id)
      OR NOT isfinite(e.generated_at) OR NOT isfinite(e.created_at) OR e.generated_at>e.created_at
      OR e.generated_at<i.created_at OR e.generated_at<o.resolved_at OR e.generated_at<d.resolved_at
      OR (e.expires_at IS NOT NULL AND (NOT isfinite(e.expires_at) OR e.expires_at<=e.created_at))
      OR (i.expires_at IS NOT NULL AND (e.expires_at IS NULL OR e.expires_at>i.expires_at))
      OR (o.expires_at IS NOT NULL AND (e.expires_at IS NULL OR e.expires_at>o.expires_at))
      OR (d.expires_at IS NOT NULL AND (e.expires_at IS NULL OR e.expires_at>d.expires_at))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Incompatible historical route attestation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.trusted_route_match_evidence m
    LEFT JOIN private.offering_route_evidence r ON r.id=m.route_evidence_id
    LEFT JOIN private.offering_movement_intents i ON i.id=m.offering_movement_intent_id
    LEFT JOIN private.movement_location_references o ON o.id=m.requester_origin_location_reference_id
    LEFT JOIN private.movement_location_references d ON d.id=m.requester_destination_location_reference_id
    LEFT JOIN public.movement_needs n ON n.id=m.movement_need_id
    WHERE r.id IS NULL OR i.id IS NULL OR o.id IS NULL OR d.id IS NULL OR n.id IS NULL
      OR m.requesting_member_id IS DISTINCT FROM n.member_id
      OR o.owner_member_id IS DISTINCT FROM n.member_id OR d.owner_member_id IS DISTINCT FROM n.member_id
      OR NOT EXISTS (SELECT 1 FROM private.movement_need_locations x WHERE x.movement_need_id=n.id AND x.role='origin' AND x.location_reference_id=o.id)
      OR NOT EXISTS (SELECT 1 FROM private.movement_need_locations x WHERE x.movement_need_id=n.id AND x.role='destination' AND x.location_reference_id=d.id)
      OR m.offering_member_id IS DISTINCT FROM i.offering_member_id
      OR m.offering_movement_intent_id IS DISTINCT FROM r.offering_movement_intent_id
      OR m.offering_intent_version IS DISTINCT FROM i.version OR m.route_evidence_version IS DISTINCT FROM r.version
      OR NOT isfinite(m.calculated_at) OR NOT isfinite(m.created_at) OR m.calculated_at>m.created_at OR m.calculated_at<r.generated_at
      OR (m.expires_at IS NOT NULL AND (NOT isfinite(m.expires_at) OR m.expires_at<=m.created_at))
      OR (r.expires_at IS NOT NULL AND (m.expires_at IS NULL OR m.expires_at>r.expires_at))
      OR (i.expires_at IS NOT NULL AND (m.expires_at IS NULL OR m.expires_at>i.expires_at))
      OR (o.expires_at IS NOT NULL AND (m.expires_at IS NULL OR m.expires_at>o.expires_at))
      OR (d.expires_at IS NOT NULL AND (m.expires_at IS NULL OR m.expires_at>d.expires_at))
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Incompatible historical match attestation';
  END IF;
END $compatibility$;

CREATE SEQUENCE private.alignment_face_attempt_ordinal_seq AS bigint START WITH 1 INCREMENT BY 1 NO CYCLE CACHE 1;
REVOKE ALL ON SEQUENCE private.alignment_face_attempt_ordinal_seq FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE private.alignment_face_verifications ADD COLUMN attempt_ordinal bigint NOT NULL
  CONSTRAINT alignment_face_attempt_ordinal_positive CHECK (attempt_ordinal>0)
  CONSTRAINT alignment_face_attempt_ordinal_unique UNIQUE;
ALTER SEQUENCE private.alignment_face_attempt_ordinal_seq OWNED BY private.alignment_face_verifications.attempt_ordinal;
CREATE INDEX alignment_face_latest_attempt ON private.alignment_face_verifications(alignment_id,member_id,attempt_ordinal DESC);
CREATE FUNCTION private.protect_alignment_face_attempt_ordinal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
BEGIN
  IF NEW.attempt_ordinal IS DISTINCT FROM OLD.attempt_ordinal THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Face attempt ordinal is immutable';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.protect_alignment_face_attempt_ordinal() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER alignment_face_attempt_ordinal_immutable BEFORE UPDATE ON private.alignment_face_verifications
FOR EACH ROW EXECUTE FUNCTION private.protect_alignment_face_attempt_ordinal();

ALTER TABLE private.offering_movement_availability DROP CONSTRAINT offering_movement_availability_check1;
ALTER TABLE private.requester_movement_interests DROP CONSTRAINT requester_movement_interests_check1;
ALTER TABLE private.financial_proposals DROP CONSTRAINT financial_proposals_check5,
  DROP CONSTRAINT financial_proposals_requester_consent_check, DROP CONSTRAINT financial_proposals_check6,
  ADD CONSTRAINT financial_proposals_check5 CHECK (offering_accepted_at IS NULL OR
    (isfinite(offering_accepted_at) AND (expires_at IS NULL OR offering_accepted_at<expires_at))),
  ADD CONSTRAINT financial_proposals_requester_consent_check CHECK (requester_accepted_at IS NULL OR
    (offering_accepted_at IS NOT NULL AND isfinite(requester_accepted_at) AND (expires_at IS NULL OR requester_accepted_at<expires_at))),
  ADD CONSTRAINT financial_proposals_check6 CHECK (
    (alignment_id IS NULL AND financial_agreement_id IS NULL AND materialized_at IS NULL) OR
    (alignment_id IS NOT NULL AND financial_agreement_id IS NOT NULL AND materialized_at IS NOT NULL
      AND movement_offer_id IS NOT NULL AND offering_accepted_at IS NOT NULL AND requester_accepted_at IS NOT NULL
      AND isfinite(materialized_at) AND (expires_at IS NULL OR materialized_at<expires_at)));
ALTER TABLE private.alignment_face_verifications DROP CONSTRAINT alignment_face_verifications_check1,
  ADD CONSTRAINT alignment_face_verifications_check1 CHECK (status<>'succeeded' OR
    (liveness_passed IS TRUE AND face_match_passed IS TRUE AND completed_at IS NOT NULL AND completed_at<expires_at)),
  ADD CONSTRAINT alignment_face_timestamps_finite CHECK (isfinite(started_at) AND isfinite(expires_at) AND
    (completed_at IS NULL OR isfinite(completed_at)));
ALTER TABLE private.offering_route_generation_claims DROP CONSTRAINT offering_route_generation_claims_check2;
ALTER TABLE private.offering_route_evidence ADD CONSTRAINT offering_route_attestation_lifetime CHECK (expires_at IS NULL OR expires_at>created_at);
ALTER TABLE private.trusted_route_match_evidence ADD CONSTRAINT route_match_attestation_lifetime CHECK (expires_at IS NULL OR expires_at>created_at);

-- Audited replacement: private.protect_movement_context_record
CREATE OR REPLACE FUNCTION private.protect_movement_context_record()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NOT isfinite(NEW.created_at) OR (NEW.expires_at IS NOT NULL AND NEW.expires_at<=clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context creation time or expiry is invalid';
    END IF;
    IF TG_TABLE_NAME='movement_location_references' THEN
      IF NEW.resolved_at IS NOT NULL AND (NOT isfinite(NEW.resolved_at) OR NEW.resolved_at>NEW.created_at) THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Location resolution cannot be future-dated';
      END IF;
    ELSIF NEW.status<>'current' THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context versions must start current';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME='movement_location_references' THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Location inputs are immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context fields are immutable';
  END IF;
  IF OLD.status<>'current' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Movement context lifecycle cannot reopen or change terminal state';
  END IF;
  IF TG_TABLE_NAME='offering_movement_intents' AND NEW.status='expired' AND OLD.status='current'
    AND (NEW.expires_at IS NULL OR NEW.expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Intent expiry has not elapsed';
  END IF;
  RETURN NEW;
END;
$function$;

-- Audited replacement: private.require_verified_location_selection
CREATE OR REPLACE FUNCTION private.require_verified_location_selection(p_verified_member_id uuid, p_source_location_reference_id uuid)
 RETURNS private.movement_location_references
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    OR (s.expires_at IS NOT NULL AND s.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Verified selected location unavailable';
  END IF;
  PERFORM private.assert_movement_location_selection_receipt(r.request_id);
  -- Proof validity is checked at acceptance, not at recovery/resolution time.
  RETURN s;
END;
$function$;

-- Audited replacement: private.assert_movement_location_resolution_evidence
CREATE OR REPLACE FUNCTION private.assert_movement_location_resolution_evidence(p_evidence_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  e private.movement_location_resolution_evidence%ROWTYPE;
  s private.movement_location_references%ROWTYPE;
  t private.movement_location_references%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT r.* INTO STRICT e FROM private.movement_location_resolution_evidence r WHERE r.id=p_evidence_id;
  SELECT r.* INTO STRICT s FROM private.movement_location_references r WHERE r.id=e.source_location_reference_id FOR UPDATE;
  SELECT r.* INTO STRICT t FROM private.movement_location_references r WHERE r.id=e.resolved_location_reference_id FOR SHARE;
  v_now := clock_timestamp();
  IF s.resolution_status IS DISTINCT FROM 'unresolved'
    OR s.source_kind NOT IN ('member_declared','member_selected')
    OR s.latitude IS NOT NULL OR s.longitude IS NOT NULL
    OR s.resolved_at IS NOT NULL OR s.resolution_version IS NOT NULL
    OR (s.provider_namespace IS NULL)<>(s.provider_place_reference IS NULL)
    OR s.id=t.id OR s.owner_member_id IS DISTINCT FROM t.owner_member_id
    OR s.declared_label IS DISTINCT FROM t.declared_label THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution source binding is invalid';
  END IF;
  IF t.source_kind IS DISTINCT FROM 'provider_resolved' OR t.resolution_status IS DISTINCT FROM 'resolved'
    OR t.latitude IS NULL OR t.longitude IS NULL
    OR NOT (t.latitude BETWEEN -90 AND 90) OR NOT (t.longitude BETWEEN -180 AND 180)
    OR t.latitude::text IN ('NaN','Infinity','-Infinity') OR t.longitude::text IN ('NaN','Infinity','-Infinity')
    OR t.provider_namespace IS NULL OR t.provider_place_reference IS NULL OR t.resolution_version IS NULL
    OR t.provider_namespace !~ '[^[:space:]]' OR t.provider_place_reference !~ '[^[:space:]]'
    OR t.resolution_version !~ '[^[:space:]]'
    OR e.version<1 OR e.resolution_schema_version IS DISTINCT FROM 'movement_location_resolution_v1'
    OR e.provider_product !~ '[^[:space:]]' OR e.provider_version !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution target evidence is invalid';
  END IF;
  IF s.provider_namespace IS NOT NULL AND
    (s.provider_namespace IS DISTINCT FROM t.provider_namespace
      OR s.provider_place_reference IS DISTINCT FROM t.provider_place_reference) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution must preserve provider selection identity';
  END IF;
  IF t.resolved_at IS NULL OR NOT isfinite(t.resolved_at)
    OR t.resolved_at<s.created_at OR t.resolved_at>t.created_at
    OR t.created_at IS DISTINCT FROM e.recorded_at
    OR (s.expires_at IS NOT NULL AND s.expires_at<=v_now)
    OR (t.expires_at IS NOT NULL AND (t.expires_at<=v_now OR t.expires_at<=t.created_at))
    OR t.expires_at IS DISTINCT FROM LEAST(e.requested_expires_at,s.expires_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution timing or expiry is invalid';
  END IF;
END;
$function$;

-- Audited replacement: private.assert_trusted_location_discovery_area
CREATE OR REPLACE FUNCTION private.assert_trusted_location_discovery_area(p_resolution_evidence_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  d private.trusted_location_discovery_areas%ROWTYPE;
  e private.movement_location_resolution_evidence%ROWTYPE;
  r private.movement_location_references%ROWTYPE;
BEGIN
  SELECT x.*
  INTO STRICT d
  FROM private.trusted_location_discovery_areas x
  WHERE x.resolution_evidence_id=p_resolution_evidence_id;

  SELECT x.*
  INTO STRICT e
  FROM private.movement_location_resolution_evidence x
  WHERE x.id=d.resolution_evidence_id;

  SELECT x.*
  INTO STRICT r
  FROM private.movement_location_references x
  WHERE x.id=d.resolved_location_reference_id;

  IF
    e.resolved_location_reference_id
      IS DISTINCT FROM d.resolved_location_reference_id
    OR r.source_kind IS DISTINCT FROM 'provider_resolved'
    OR r.resolution_status IS DISTINCT FROM 'resolved'
    OR r.latitude IS NULL
    OR r.longitude IS NULL
    OR r.provider_namespace IS NULL
    OR r.provider_place_reference IS NULL
    OR r.resolution_version IS NULL
    OR d.schema_version
      IS DISTINCT FROM 'trusted_location_discovery_area_v1'
    OR d.discovery_area_label
      IS DISTINCT FROM btrim(d.discovery_area_label)
    OR length(d.discovery_area_label) NOT BETWEEN 1 AND 500
    OR d.discovery_area_label !~ '[^[:space:]]'
    OR NOT isfinite(d.recorded_at)
  THEN
    RAISE EXCEPTION
      USING ERRCODE='23514',
      MESSAGE='Trusted location discovery area evidence is invalid';
  END IF;
END;
$function$;

-- Audited replacement: private.assert_trusted_location_state_evidence
CREATE OR REPLACE FUNCTION private.assert_trusted_location_state_evidence(p_resolution_evidence_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s private.trusted_location_state_evidence%ROWTYPE;
  e private.movement_location_resolution_evidence%ROWTYPE;
  r private.movement_location_references%ROWTYPE;
  v_expected_state_key text;
BEGIN
  SELECT x.*
  INTO STRICT s
  FROM private.trusted_location_state_evidence x
  WHERE x.resolution_evidence_id=p_resolution_evidence_id;

  SELECT x.*
  INTO STRICT e
  FROM private.movement_location_resolution_evidence x
  WHERE x.id=s.resolution_evidence_id;

  SELECT x.*
  INTO STRICT r
  FROM private.movement_location_references x
  WHERE x.id=s.resolved_location_reference_id;

  v_expected_state_key :=
    private.canonical_nigerian_state_key(
      s.state_name
    );

  IF
    e.resolved_location_reference_id
      IS DISTINCT FROM s.resolved_location_reference_id

    OR r.source_kind
      IS DISTINCT FROM 'provider_resolved'

    OR r.resolution_status
      IS DISTINCT FROM 'resolved'

    OR r.provider_namespace IS NULL

    OR r.provider_place_reference IS NULL

    OR r.resolution_version IS NULL

    OR s.provider_namespace
      IS DISTINCT FROM r.provider_namespace

    OR s.provider_namespace
      IS DISTINCT FROM btrim(s.provider_namespace)

    OR length(s.provider_namespace)
      NOT BETWEEN 1 AND 100

    OR s.provider_namespace
      !~ '[^[:space:]]'

    OR s.state_provider_reference
      IS DISTINCT FROM btrim(s.state_provider_reference)

    OR length(s.state_provider_reference)
      NOT BETWEEN 1 AND 500

    OR s.state_provider_reference
      !~ '[^[:space:]]'


    OR s.state_name
      IS DISTINCT FROM btrim(s.state_name)

    OR length(s.state_name)
      NOT BETWEEN 1 AND 300

    OR s.state_name
      !~ '[^[:space:]]'

    OR v_expected_state_key IS NULL

    OR s.state_key
      IS DISTINCT FROM v_expected_state_key

    OR s.schema_version
      IS DISTINCT FROM 'trusted_location_state_v1'

    OR NOT isfinite(s.recorded_at)


  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted location state evidence is invalid';
  END IF;
END;
$function$;

-- Audited replacement: private.protect_movement_need_creation_receipt
CREATE OR REPLACE FUNCTION private.protect_movement_need_creation_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need creation receipts are immutable';
  END IF;

  IF NOT isfinite(NEW.recorded_at) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement need creation receipt time is invalid';
  END IF;

  RETURN NEW;
END;
$function$;

-- Audited replacement: private.protect_offering_movement_intent_creation_receipt
CREATE OR REPLACE FUNCTION private.protect_offering_movement_intent_creation_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent creation receipts are immutable';
  END IF;

  IF NOT isfinite(NEW.recorded_at) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Offering movement intent creation receipt time is invalid';
  END IF;

  RETURN NEW;
END;
$function$;

-- Audited replacement: private.protect_offering_route_evidence
CREATE OR REPLACE FUNCTION private.protect_offering_route_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence history cannot be deleted';
  END IF;

  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'current' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence must start current';
    END IF;
    IF NOT isfinite(NEW.created_at)
      OR NOT isfinite(NEW.generated_at) OR NEW.generated_at > NEW.created_at
      OR (NEW.expires_at IS NOT NULL AND NEW.expires_at <= clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence timestamps are invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence fields are immutable';
  END IF;
  IF OLD.status <> 'current' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence lifecycle cannot reopen or change terminal state';
  END IF;
  IF NEW.status NOT IN ('superseded','expired') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence lifecycle transition is invalid';
  END IF;
  IF NEW.status='expired' AND (NEW.expires_at IS NULL OR NEW.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence expiry has not elapsed';
  END IF;
  RETURN NEW;
END;
$function$;

-- Audited replacement: private.protect_trusted_route_match_evidence
CREATE OR REPLACE FUNCTION private.protect_trusted_route_match_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence history cannot be deleted';
  END IF;


  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'current' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match evidence must start current';
    END IF;


    IF NOT isfinite(NEW.created_at)
       OR NOT isfinite(NEW.calculated_at) OR NEW.calculated_at > NEW.created_at
       OR (
         NEW.expires_at IS NOT NULL
         AND NEW.expires_at <= clock_timestamp()
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match evidence timestamps are invalid';
    END IF;


    RETURN NEW;
  END IF;


  -- Evidence facts are immutable.
  -- Only lifecycle status may change.
  IF (
    to_jsonb(NEW) - 'status'
  ) IS DISTINCT FROM (
    to_jsonb(OLD) - 'status'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence fields are immutable';
  END IF;


  IF OLD.status <> 'current'
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence lifecycle cannot reopen';
  END IF;


  IF NEW.status NOT IN (
    'superseded',
    'expired'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence lifecycle transition is invalid';
  END IF;


  IF NEW.status = 'expired'
     AND (
       NEW.expires_at IS NULL
       OR NEW.expires_at > clock_timestamp()
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence expiry has not elapsed';
  END IF;


  RETURN NEW;
END;
$function$;

-- Audited replacement: private.protect_pricing_geography_evidence
CREATE OR REPLACE FUNCTION private.protect_pricing_geography_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'current' OR NOT isfinite(NEW.created_at) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence must start current with valid timestamps';
    END IF;
    PERFORM private.assert_pricing_geography_context(NEW);
    PERFORM private.assert_pricing_geography_events(NEW.geographic_events,NEW.pricing_corridor_distance_meters);
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence facts are immutable';
  END IF;
  IF OLD.status<>'current' OR NEW.status NOT IN ('superseded','expired') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence lifecycle cannot reopen or change terminal state';
  END IF;
  IF NEW.status='expired' AND NEW.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence expiry has not elapsed';
  END IF;
  RETURN NEW;
END;
$function$;

-- Audited replacement: private.assert_pricing_geography_context
CREATE OR REPLACE FUNCTION private.assert_pricing_geography_context(p private.pricing_geography_evidence)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m private.trusted_route_match_evidence%ROWTYPE; deadline timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Pricing geography evidence requires READ COMMITTED';
  END IF;
  PERFORM 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography movement need unavailable';
  END IF;
  -- Check the immutable need binding before entering the canonical context, so
  -- malformed input cannot make it acquire a second, differently ordered need.
  SELECT e.* INTO STRICT m FROM private.trusted_route_match_evidence e WHERE e.id=p.route_match_evidence_id;
  IF m.movement_need_id IS DISTINCT FROM p.movement_need_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography context mismatch';
  END IF;
  PERFORM private.assert_trusted_route_match_evidence(m.id);
  SELECT e.* INTO STRICT m FROM private.trusted_route_match_evidence e WHERE e.id=p.route_match_evidence_id FOR SHARE;
  IF ROW(p.route_match_evidence_version,p.requesting_member_id,p.offering_member_id,
      p.offering_movement_intent_id,p.offering_intent_version,p.route_evidence_id,p.route_evidence_version,p.state_location_reference_id)
    IS DISTINCT FROM ROW(m.version,m.requesting_member_id,m.offering_member_id,
      m.offering_movement_intent_id,m.offering_intent_version,m.route_evidence_id,m.route_evidence_version,m.requester_origin_location_reference_id)
    OR m.status<>'current' OR (m.expires_at IS NOT NULL AND m.expires_at<=clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography context mismatch or stale match';
  END IF;
  SELECT coalesce(n.latest_departure_at,n.earliest_departure_at) INTO STRICT deadline
    FROM public.movement_needs n WHERE n.id=p.movement_need_id;
  IF p.status IS DISTINCT FROM 'current' OR p.expires_at IS NULL
    OR NOT isfinite(p.expires_at) OR p.expires_at<=clock_timestamp()
    OR p.expires_at>deadline OR (m.expires_at IS NOT NULL AND p.expires_at>m.expires_at)
    OR p.generated_at IS NULL OR NOT isfinite(p.generated_at)
    OR p.generated_at IS DISTINCT FROM p.created_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing geography evidence time or lifecycle invalid';
  END IF;
END;
$function$;

-- Audited replacement: private.assert_pricing_quote_context
CREATE OR REPLACE FUNCTION private.assert_pricing_quote_context(p private.pricing_quotes)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e private.pricing_geography_evidence%ROWTYPE;
BEGIN
  SELECT x.* INTO e FROM private.pricing_geography_evidence x WHERE x.id=p.pricing_geography_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pricing geography evidence unavailable';
  END IF;
  IF ROW(p.pricing_geography_evidence_version,p.movement_need_id,p.requesting_member_id,
      p.offering_member_id,p.offering_movement_intent_id,p.offering_intent_version,p.state_location_reference_id)
    IS DISTINCT FROM ROW(e.version,e.movement_need_id,e.requesting_member_id,
      e.offering_member_id,e.offering_movement_intent_id,e.offering_intent_version,e.state_location_reference_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote does not match exact pricing geography bindings';
  END IF;
  -- Owns READ COMMITTED and need -> endpoints -> intent -> route -> match ->
  -- geography locks and fresh eligibility. Do not take a quote lock first.
  PERFORM private.assert_pricing_geography_evidence(e.id);
  SELECT x.* INTO STRICT e FROM private.pricing_geography_evidence x WHERE x.id=p.pricing_geography_evidence_id FOR SHARE;
  IF e.pricing_range_supported IS DISTINCT FROM true
    OR e.pricing_corridor_distance_meters<=0 OR e.pricing_corridor_distance_meters>100000 THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote requires supported pricing geography evidence';
  END IF;
  IF p.status IS DISTINCT FROM 'current' OR p.created_at IS NULL OR NOT isfinite(p.created_at)
    OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=p.created_at OR p.expires_at<=clock_timestamp() OR p.expires_at>e.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote lifecycle or evidence-bounded timestamps invalid';
  END IF;
END;
$function$;

-- Audited replacement: private.protect_offering_movement_availability
CREATE OR REPLACE FUNCTION private.protect_offering_movement_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'open' OR NEW.remaining_places<>NEW.total_places
      OR NOT isfinite(NEW.created_at) OR NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability must start open with its declared capacity';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'remaining_places'-'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD)-'status'-'remaining_places'-'updated_at') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability bindings and total capacity are immutable';
  END IF;
  IF OLD.status<>'open' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Terminal availability cannot reopen or change';
  END IF;
  IF NEW.remaining_places>OLD.remaining_places
    OR (NEW.remaining_places<>OLD.remaining_places AND NEW.status NOT IN ('open','full')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability capacity transition is invalid';
  END IF;
  IF NEW.status='expired' AND OLD.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Availability expiry has not elapsed';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$function$;

-- Audited replacement: private.protect_requester_movement_interest
CREATE OR REPLACE FUNCTION private.protect_requester_movement_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest history cannot be deleted';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'active' OR NOT isfinite(NEW.created_at) OR NEW.expires_at<=clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest must start active and unexpired';
    END IF;
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status'-'updated_at') IS DISTINCT FROM
     (to_jsonb(OLD)-'status'-'updated_at') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest bindings are immutable';
  END IF;
  IF OLD.status<>'active' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inactive interest cannot reopen or change';
  END IF;
  IF NEW.status='expired' AND OLD.expires_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Interest expiry has not elapsed';
  END IF;
  IF NEW IS DISTINCT FROM OLD THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$function$;

-- Audited replacement: private.protect_financial_proposal
CREATE OR REPLACE FUNCTION private.protect_financial_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s private.movement_context_snapshots%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal history cannot be deleted';
  END IF;
  PERFORM private.assert_financial_proposal_quote_binding(NEW);
  PERFORM private.assert_financial_proposal_movement_context_binding(NEW);
  PERFORM private.assert_financial_proposal_source_compatibility(NEW);
  IF TG_OP='INSERT' THEN
    SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x
      WHERE x.id=NEW.movement_context_snapshot_id;
    -- Stronger locks FIRST: 0045 owns need UPDATE -> offer UPDATE -> requester
    -- endpoints -> intent UPDATE -> route -> availability UPDATE -> vehicle/access.
    -- Never upgrade quote SHARE locks into this chain. Future writers must take
    -- these dependencies before existing proposal history rows.
    PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
    PERFORM private.assert_pricing_quote(NEW.pricing_quote_id);
    -- Dependencies are already locked. Retain snapshot SHARE until transaction
    -- end; FK KEY SHARE alone would not block a non-key status UPDATE.
    PERFORM private.assert_movement_context_snapshot(NEW.movement_context_snapshot_id);
    -- Fresh clock eligibility after quote/snapshot waits, with locks held.
    PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
    PERFORM private.assert_pricing_quote(NEW.pricing_quote_id);
    IF NEW.status<>'current' OR NEW.offering_accepted_at IS NOT NULL OR NEW.requester_accepted_at IS NOT NULL
      OR NEW.movement_offer_id IS NOT NULL OR NEW.alignment_id IS NOT NULL
      OR NEW.financial_agreement_id IS NOT NULL OR NEW.materialized_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Create an unaccepted unbound current proposal first';
    END IF;
    IF NOT isfinite(NEW.created_at) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal creation time cannot be future-dated';
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal cannot be created already expired';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','offering_accepted_at','requester_accepted_at',
      'movement_offer_id','alignment_id','financial_agreement_id','materialized_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','offering_accepted_at','requester_accepted_at',
      'movement_offer_id','alignment_id','financial_agreement_id','materialized_at']) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal economics and snapshots are immutable';
  END IF;
  IF OLD.status='superseded' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Superseded proposal is immutable';
  END IF;
  IF OLD.materialized_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Materialized proposal is immutable';
  END IF;
  IF (OLD.offering_accepted_at IS NOT NULL AND NEW.offering_accepted_at IS DISTINCT FROM OLD.offering_accepted_at)
    OR (OLD.requester_accepted_at IS NOT NULL AND NEW.requester_accepted_at IS DISTINCT FROM OLD.requester_accepted_at)
    OR (OLD.movement_offer_id IS NOT NULL AND NEW.movement_offer_id IS DISTINCT FROM OLD.movement_offer_id)
    OR (OLD.alignment_id IS NOT NULL AND NEW.alignment_id IS DISTINCT FROM OLD.alignment_id)
    OR (OLD.financial_agreement_id IS NOT NULL AND NEW.financial_agreement_id IS DISTINCT FROM OLD.financial_agreement_id)
    OR (OLD.materialized_at IS NOT NULL AND NEW.materialized_at IS DISTINCT FROM OLD.materialized_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal consent and links are write-once';
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    IF NEW.status<>'current' OR (NEW.expires_at IS NOT NULL AND NEW.expires_at<=clock_timestamp()) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal is not current and unexpired';
    END IF;
    IF (NEW.offering_accepted_at IS NOT NULL AND NOT isfinite(NEW.offering_accepted_at))
      OR (NEW.requester_accepted_at IS NOT NULL AND NOT isfinite(NEW.requester_accepted_at))
      OR (NEW.materialized_at IS NOT NULL AND NOT isfinite(NEW.materialized_at)) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal evidence cannot be future-dated';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Audited replacement: public.accept_my_financial_proposal_as_offerer
CREATE OR REPLACE FUNCTION public.accept_my_financial_proposal_as_offerer(p_financial_proposal_id uuid, p_expected_proposal_version integer, p_movement_offer_id uuid)
 RETURNS TABLE(proposal_id uuid, proposal_version integer, proposal_status text, movement_offer_id uuid, offering_accepted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  caller uuid := auth.uid();
  p private.financial_proposals%ROWTYPE;
  s private.movement_context_snapshots%ROWTYPE;
  accepted_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Financial proposal consent requires READ COMMITTED';
  END IF;
  IF p_financial_proposal_id IS NULL OR p_expected_proposal_version IS NULL OR p_movement_offer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete exact proposal and offer identities required';
  END IF;
  IF p_expected_proposal_version<1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive expected proposal version required';
  END IF;
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  -- Discover immutable selectors only; reject foreign principals/offers before
  -- locking another movement need. Never lock proposal history first.
  SELECT x.* INTO p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  IF NOT FOUND OR p.offering_member_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own financial proposal required';
  END IF;
  IF p.version IS DISTINCT FROM p_expected_proposal_version OR p.status<>'current'
    OR p.expires_at IS NULL OR p.expires_at<=clock_timestamp()
    OR p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact current unmaterialized proposal required';
  END IF;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  IF s.movement_offer_id IS DISTINCT FROM p_movement_offer_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal operational offer must equal its historical snapshot source';
  END IF;
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);

  -- Same strong-dependency order as 0074/0045: need UPDATE -> offer UPDATE ->
  -- requester endpoints -> intent UPDATE -> route -> availability UPDATE ->
  -- vehicle/access -> quote SHARE -> snapshot SHARE -> proposal history UPDATE.
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM x.id FROM private.financial_proposals x
    WHERE x.movement_need_id=p.movement_need_id AND x.offering_member_id=p.offering_member_id
    ORDER BY x.version FOR UPDATE;

  -- READ COMMITTED fresh reads after every possible blocking dependency/history
  -- wait. Existing immutable selectors cannot change; live sources can expire.
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  IF p.offering_member_id IS DISTINCT FROM caller OR p.version IS DISTINCT FROM p_expected_proposal_version
    OR p.status<>'current' OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=clock_timestamp()
    OR p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL
    OR s.movement_offer_id IS DISTINCT FROM p_movement_offer_id
    OR (p.movement_offer_id IS NOT NULL AND p.movement_offer_id IS DISTINCT FROM p_movement_offer_id)
    OR (p.offering_accepted_at IS NULL) IS DISTINCT FROM (p.movement_offer_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact current unmaterialized proposal required';
  END IF;
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_context(p.id);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  IF NOT EXISTS (SELECT 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id AND n.status='discoverable')
    OR EXISTS (SELECT 1 FROM public.alignments a WHERE a.movement_need_id=p.movement_need_id
      AND a.status IN ('awaiting_activation_payment','activated','in_progress','completed')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unmaterialized proposal requires an available movement need';
  END IF;
  accepted_at:=clock_timestamp();
  IF accepted_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal expired before consent';
  END IF;
  IF p.offering_accepted_at IS NOT NULL THEN
    IF NOT isfinite(p.offering_accepted_at)
      OR p.offering_accepted_at>=p.expires_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid existing offering consent';
    END IF;
    RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.offering_accepted_at;
    RETURN;
  END IF;

  -- One UPDATE supplies both fields: no intermediate incomplete consent state,
  -- even when the caller already has completeness constraints IMMEDIATE.
  UPDATE private.financial_proposals x
    SET movement_offer_id=p_movement_offer_id, offering_accepted_at=accepted_at
    WHERE x.id=p.id RETURNING x.* INTO p;
  -- Drain only the two parent UPDATE checks, then restore the established
  -- producer convention (INITIALLY DEFERRED). Errors roll back the whole call.
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_movement_context_complete IMMEDIATE;
  SET CONSTRAINTS private.financial_proposal_complete,private.financial_proposal_movement_context_complete DEFERRED;
  RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.offering_accepted_at;
END;
$function$;

-- Audited replacement: public.accept_my_financial_proposal_as_requester
CREATE OR REPLACE FUNCTION public.accept_my_financial_proposal_as_requester(p_financial_proposal_id uuid, p_expected_proposal_version integer)
 RETURNS TABLE(proposal_id uuid, proposal_version integer, proposal_status text, movement_offer_id uuid, alignment_id uuid, alignment_status text, financial_agreement_id uuid, requester_accepted_at timestamp with time zone, materialized_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE caller uuid:=auth.uid(); p private.financial_proposals%ROWTYPE;
  s private.movement_context_snapshots%ROWTYPE; n public.movement_needs%ROWTYPE;
  operational record; replay_alignment_status text; created_agreement_id uuid; agreement_version bigint; accepted_at timestamptz; completed_at timestamptz;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Financial materialization requires READ COMMITTED';
  END IF;
  IF p_financial_proposal_id IS NULL OR p_expected_proposal_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Exact proposal identity and version required';
  END IF;
  IF p_expected_proposal_version<1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive expected proposal version required';
  END IF;
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authenticated member required';
  END IF;
  -- Immutable discovery only; no history/FK locks before the need boundary.
  SELECT x.* INTO p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  IF NOT FOUND OR p.member_needing_movement_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Own requester financial proposal required';
  END IF;
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  -- Isolate construction locks. If another requester finishes while our need
  -- lock waits, roll this subtransaction back before entering historical replay.
  -- Payment/face readiness locks alignment BEFORE need; retaining construction's
  -- need lock while waiting for that alignment would create a reverse-order cycle.
  BEGIN
  IF p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='Z7701', MESSAGE='Switch to materialization replay';
  END IF;
  SELECT x.* INTO STRICT n FROM public.movement_needs x WHERE x.id=p.movement_need_id FOR UPDATE;
  IF n.member_id IS DISTINCT FROM caller THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Authoritative movement requester required';
  END IF;
  -- A concurrent duplicate can have completed while the need lock waited.
  -- Fresh-read BEFORE pending-offer/availability assertions: replay must not
  -- reserve capacity again or validate consumed support as a pending offer.
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  IF p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='Z7701', MESSAGE='Switch to materialization replay';
  END IF;
  IF p.member_needing_movement_id IS DISTINCT FROM caller OR p.version IS DISTINCT FROM p_expected_proposal_version
    OR p.status<>'current' OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=clock_timestamp()
    OR p.offering_accepted_at IS NULL OR p.movement_offer_id IS NULL
    OR p.movement_offer_id IS DISTINCT FROM s.movement_offer_id THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact current offerer-consented proposal required';
  END IF;


  IF n.status<>'discoverable' OR EXISTS (SELECT 1 FROM public.alignments a
    WHERE a.movement_need_id=n.id AND a.status IN ('awaiting_activation_payment','activated','in_progress','completed')) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unmaterialized proposal requires an available movement need';
  END IF;
  PERFORM x.id FROM public.movement_offers x WHERE x.id=s.movement_offer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact movement offer unavailable';
  END IF;

  -- Same canonical strong dependencies as 0074/0076 before proposal history:
  -- need UPDATE -> offer UPDATE -> endpoints -> intent UPDATE -> route ->
  -- availability UPDATE -> vehicle/access -> quote SHARE -> snapshot SHARE.
  PERFORM private.assert_movement_offer_availability_binding(s.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM x.id FROM private.financial_proposals x
    WHERE x.movement_need_id=p.movement_need_id AND x.offering_member_id=p.offering_member_id
    ORDER BY x.version FOR UPDATE;
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id;
  SELECT x.* INTO STRICT s FROM private.movement_context_snapshots x WHERE x.id=p.movement_context_snapshot_id;
  SELECT x.* INTO STRICT n FROM public.movement_needs x WHERE x.id=p.movement_need_id;
  IF p.version IS DISTINCT FROM p_expected_proposal_version OR p.status<>'current'
    OR p.member_needing_movement_id IS DISTINCT FROM caller OR n.member_id IS DISTINCT FROM caller
    OR p.expires_at<=clock_timestamp()
    OR p.offering_accepted_at IS NULL OR NOT isfinite(p.offering_accepted_at)
    OR p.offering_accepted_at>=p.expires_at OR p.movement_offer_id IS DISTINCT FROM s.movement_offer_id
    OR p.requester_accepted_at IS NOT NULL OR p.alignment_id IS NOT NULL
    OR p.financial_agreement_id IS NOT NULL OR p.materialized_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact unmaterialized offerer-consented proposal required';
  END IF;
  PERFORM private.assert_movement_offer_availability_binding(p.movement_offer_id);
  PERFORM private.assert_pricing_quote(p.pricing_quote_id);
  PERFORM private.assert_movement_context_snapshot_offer_binding(s);
  PERFORM private.assert_movement_context_snapshot(s.id);
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_context(p.id);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  accepted_at:=clock_timestamp();
  IF accepted_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal expired before requester acceptance';
  END IF;
  -- If trusted snapshot construction happened earlier in this transaction,
  -- drain its INSERT checks while the offer/need are still pending/available.
  -- Those construction-only validators cannot be deferred past consumption.
  SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete IMMEDIATE;
  SET CONSTRAINTS private.movement_context_snapshot_complete,private.movement_context_travellers_complete DEFERRED;

  -- Reuse 0045 exactly, under already-owned stronger dependencies/history.
  -- It asserts live eligibility again and atomically consumes people_count,
  -- creates the pre-payment alignment, accepts/closes/rejects operational rows.
  -- No proposal row is written until the complete financial graph exists.
  SELECT x.* INTO STRICT operational FROM private.accept_movement_offer_legacy_internal(p.movement_offer_id) x;
  IF operational.movement_offer_id IS DISTINCT FROM p.movement_offer_id
    OR operational.movement_need_id IS DISTINCT FROM p.movement_need_id
    OR operational.alignment_status IS DISTINCT FROM 'awaiting_activation_payment' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Operational materialization identity mismatch';
  END IF;
  -- Construction alone must prove the exact initial legacy alignment shape.
  PERFORM x.id FROM public.alignments x WHERE x.id=operational.alignment_id
    AND x.status='awaiting_activation_payment' AND x.activated_at IS NULL
    AND x.activation_fee_minor IS NULL AND x.activation_currency='NGN'
    AND ROW(x.movement_need_id,x.movement_offer_id,x.offering_member_id,x.member_needing_movement_id)
      IS NOT DISTINCT FROM ROW(p.movement_need_id,p.movement_offer_id,p.offering_member_id,p.member_needing_movement_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact initial pre-payment alignment required';
  END IF;
  -- New alignment is transaction-owned, with no prior agreement history. The
  -- 0020 history scope is alignment_id, NOT proposal history's version scope.
  SELECT coalesce(max(x.version)::bigint,0)+1 INTO agreement_version
    FROM private.financial_agreements x WHERE x.alignment_id=operational.alignment_id;
  IF agreement_version<>1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='New alignment must have empty agreement history';
  END IF;
  SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete DEFERRED;
  INSERT INTO private.financial_agreements(alignment_id,offering_member_id,member_needing_movement_id,version,
    financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,currency,
    quoted_platform_fee_total_minor,created_at,status)
  VALUES(operational.alignment_id,p.offering_member_id,p.member_needing_movement_id,agreement_version::integer,
    p.financial_model_version,p.pricing_policy_version,p.platform_fee_allocation_policy_version,p.currency,
    p.quoted_platform_fee_total_minor,clock_timestamp(),'current') RETURNING id INTO created_agreement_id;
  INSERT INTO private.financial_components(agreement_id,component_key,amount_minor,responsible_member_id,
    beneficiary_kind,beneficiary_member_id,created_at) VALUES
    (created_agreement_id,'offering_platform_share',p.quoted_platform_fee_total_minor/2,p.offering_member_id,'platform',NULL,clock_timestamp()),
    (created_agreement_id,'requester_platform_share',p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor/2,p.member_needing_movement_id,'platform',NULL,clock_timestamp()),
    (created_agreement_id,'movement_contribution',p.quoted_movement_contribution_minor,p.member_needing_movement_id,'member',p.offering_member_id,clock_timestamp());
  UPDATE private.financial_agreements x SET offering_accepted_at=p.offering_accepted_at,requester_accepted_at=accepted_at
    WHERE x.id=created_agreement_id;
  completed_at:=clock_timestamp();
  IF completed_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal expired during materialization';
  END IF;
  UPDATE private.financial_proposals x SET requester_accepted_at=accepted_at,alignment_id=operational.alignment_id,
    financial_agreement_id=created_agreement_id,materialized_at=completed_at WHERE x.id=p.id RETURNING x.* INTO p;
  PERFORM private.assert_financial_proposal_materialization(p);
  SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete,
    private.financial_proposal_complete,private.financial_proposal_movement_context_complete IMMEDIATE;
  SET CONSTRAINTS private.financial_agreement_complete,private.financial_components_complete,
    private.financial_proposal_complete,private.financial_proposal_movement_context_complete DEFERRED;
  RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.alignment_id,
    operational.alignment_status,p.financial_agreement_id,p.requester_accepted_at,p.materialized_at;
  RETURN;
  EXCEPTION WHEN SQLSTATE 'Z7701' THEN
    -- Rollback releases ONLY locks acquired in this construction subtransaction.
    -- No write has happened on either switch path, and all other errors propagate.
    NULL;
  END;

  -- Persisted graph replay: no live need/intent/availability/quote locks and no
  -- mutations. Never upgrade historical locks back into construction support.
  -- Original expiry bounds recorded consent/materialization, not historical reads.
  -- 0021 makes materialized proposals immutable, including their current status.
  SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.id=p_financial_proposal_id FOR UPDATE;
  IF p.member_needing_movement_id IS DISTINCT FROM caller OR p.version IS DISTINCT FROM p_expected_proposal_version
    OR p.status<>'current' OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)

    OR NOT EXISTS(SELECT 1 FROM public.movement_needs replay_need WHERE replay_need.id=p.movement_need_id AND replay_need.member_id=caller) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Own exact materialized proposal required';
  END IF;
  replay_alignment_status:=private.assert_financial_proposal_materialization(p);
  RETURN QUERY SELECT p.id,p.version,p.status,p.movement_offer_id,p.alignment_id,
    replay_alignment_status,p.financial_agreement_id,p.requester_accepted_at,p.materialized_at;
END;
$function$;

-- Audited replacement: private.assert_financial_proposal_materialization
CREATE OR REPLACE FUNCTION private.assert_financial_proposal_materialization(p private.financial_proposals)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
BEGIN
  PERFORM private.assert_financial_proposal_quote_binding(p);
  PERFORM private.assert_financial_proposal_movement_context_binding(p);
  PERFORM private.assert_financial_proposal_source_compatibility(p);
  PERFORM private.assert_financial_proposal_snapshot_roster(p.id);
  IF p.offering_accepted_at IS NULL OR p.movement_offer_id IS NULL OR p.requester_accepted_at IS NULL
    OR p.alignment_id IS NULL OR p.financial_agreement_id IS NULL OR p.materialized_at IS NULL
    OR p.created_at IS NULL OR NOT isfinite(p.created_at) OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=p.created_at OR NOT isfinite(p.offering_accepted_at) OR NOT isfinite(p.requester_accepted_at) OR NOT isfinite(p.materialized_at)
    OR p.offering_accepted_at>=p.expires_at OR p.requester_accepted_at>=p.expires_at
    OR p.materialized_at>=p.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Complete consistent financial materialization required';
  END IF;
  -- Replay owns only proposal UPDATE; it never locks need. Take alignment SHARE before
  -- offer SHARE, matching activation's alignment -> offer dependency; taking
  -- offer UPDATE first on replay could deadlock its journey trigger. First
  -- construction already owns offer UPDATE and its new alignment is private
  -- to this transaction. Replay never upgrades locks into live pending checks.
  SELECT x.* INTO a FROM public.alignments x WHERE x.id=p.alignment_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Materialized alignment unavailable';
  END IF;
  PERFORM x.id FROM public.movement_offers x WHERE x.id=p.movement_offer_id FOR SHARE;
  SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=p.financial_agreement_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Materialized financial agreement unavailable';
  END IF;
  -- Replay validates historical identity; operational lifecycle and legacy fee
  -- may progress after acceptance. 0019 also permits no-travel cancellation.
  IF a.status NOT IN ('awaiting_activation_payment','activated','in_progress','completed','cancelled')
    OR a.activation_currency<>p.currency
    OR ROW(a.movement_need_id,a.movement_offer_id,a.offering_member_id,a.member_needing_movement_id)
      IS DISTINCT FROM ROW(p.movement_need_id,p.movement_offer_id,p.offering_member_id,p.member_needing_movement_id)
    -- 0020 permits consent-preserving supersession; validate the exact original
    -- agreement, not whichever version is current later.
    OR g.status NOT IN ('current','superseded') OR g.version<>1
    OR ROW(g.alignment_id,g.offering_member_id,g.member_needing_movement_id,g.financial_model_version,
      g.pricing_policy_version,g.platform_fee_allocation_policy_version,g.currency,g.quoted_platform_fee_total_minor,
      g.offering_accepted_at,g.requester_accepted_at)
      IS DISTINCT FROM ROW(p.alignment_id,p.offering_member_id,p.member_needing_movement_id,p.financial_model_version,
      p.pricing_policy_version,p.platform_fee_allocation_policy_version,p.currency,p.quoted_platform_fee_total_minor,
      p.offering_accepted_at,p.requester_accepted_at)
    OR NOT EXISTS (SELECT 1 FROM public.movement_needs n WHERE n.id=p.movement_need_id
      AND n.member_id=p.member_needing_movement_id AND n.status='closed')
    OR NOT EXISTS (SELECT 1 FROM public.movement_offers o WHERE o.id=p.movement_offer_id AND o.status='accepted')
    OR EXISTS (SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p.movement_need_id
      AND x.id<>p.alignment_id AND x.status IN ('awaiting_activation_payment','activated','in_progress','completed'))
    OR (SELECT count(*) FROM private.financial_components c WHERE c.agreement_id=g.id)<>3
    OR EXISTS (SELECT 1 FROM public.movement_offers o WHERE o.movement_need_id=p.movement_need_id AND o.status='pending')
    OR EXISTS (
      SELECT component_key,amount_minor,responsible_member_id,beneficiary_kind,beneficiary_member_id
      FROM private.financial_components c WHERE c.agreement_id=g.id
      EXCEPT
      SELECT * FROM (VALUES
        ('offering_platform_share'::text,p.quoted_platform_fee_total_minor/2,p.offering_member_id,'platform'::text,NULL::uuid),
        ('requester_platform_share'::text,p.quoted_platform_fee_total_minor-p.quoted_platform_fee_total_minor/2,p.member_needing_movement_id,'platform'::text,NULL::uuid),
        ('movement_contribution'::text,p.quoted_movement_contribution_minor,p.member_needing_movement_id,'member'::text,p.offering_member_id)
      ) expected
    ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Financial materialization graph does not match proposal';
  END IF;
  -- Return status from the same SHARE-locked row whose graph was validated.
  RETURN a.status;
END;
$function$;

-- Audited replacement: private.movement_funding_evidence
CREATE OR REPLACE FUNCTION private.movement_funding_evidence(g private.financial_agreements)
 RETURNS TABLE(required_minor bigint, held_minor bigint, fully_held_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c private.financial_components%ROWTYPE; t private.wallet_transactions%ROWTYPE;
  receipt private.movement_funding_holds%ROWTYPE; total numeric; available_id uuid; held_id uuid;
  latest timestamptz; positive_count integer:=0; posting_count bigint; matching_count bigint;
BEGIN
  SELECT sum(x.amount_minor::numeric) INTO total FROM private.financial_components x
    WHERE x.agreement_id=g.id AND x.component_key IN ('requester_platform_share','movement_contribution');
  IF total IS NULL OR total<0 OR total>9223372036854775807::numeric THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Requester obligation outside supported range'; END IF;
  SELECT x.* INTO receipt FROM private.movement_funding_holds x WHERE x.financial_agreement_id=g.id;
  IF receipt.financial_agreement_id IS NULL THEN
    IF EXISTS(SELECT 1 FROM private.wallet_transactions x JOIN private.financial_components fc ON fc.id=x.financial_component_id
      WHERE fc.agreement_id=g.id AND fc.component_key IN ('requester_platform_share','movement_contribution') AND x.transaction_kind='movement_hold')
      OR EXISTS(SELECT 1 FROM private.wallet_transactions x JOIN private.financial_components fc
        ON x.idempotency_key='movement_hold:'||fc.id::text WHERE fc.agreement_id=g.id
        AND fc.component_key IN ('requester_platform_share','movement_contribution')) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Partial funding history cannot be repaired'; END IF;
    RETURN QUERY SELECT total::bigint,0::bigint,NULL::timestamptz; RETURN;
  END IF;
  -- Historical account identities remain valid even if a later zero-balance
  -- closure occurred. Aggregate balances are deliberately not replay evidence.
  SELECT x.id INTO available_id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id
    AND x.currency=g.currency AND x.account_kind='member_available';
  SELECT x.id INTO held_id FROM private.wallet_accounts x WHERE x.member_id=g.member_needing_movement_id
    AND x.currency=g.currency AND x.account_kind='member_held';
  IF available_id IS NULL OR held_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Historical funding accounts unavailable'; END IF;
  FOR c IN SELECT x.* FROM private.financial_components x WHERE x.agreement_id=g.id
    AND x.component_key IN ('requester_platform_share','movement_contribution') ORDER BY x.id LOOP
    SELECT x.* INTO t FROM private.wallet_transactions x WHERE x.idempotency_key='movement_hold:'||c.id::text;
    IF c.amount_minor=0 THEN
      IF t.id IS NOT NULL OR EXISTS(SELECT 1 FROM private.wallet_transactions x
        WHERE x.financial_component_id=c.id AND x.transaction_kind='movement_hold') THEN
        RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Zero obligation must have no hold transaction'; END IF;
      CONTINUE;
    END IF;
    positive_count:=positive_count+1;
    IF t.id IS NULL OR t.transaction_kind<>'movement_hold' OR t.financial_component_id IS DISTINCT FROM c.id
      OR t.alignment_id IS DISTINCT FROM g.alignment_id OR t.currency<>g.currency
      OR t.provider IS NOT NULL OR t.provider_reference IS NOT NULL
      OR NOT isfinite(t.created_at) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical component hold required'; END IF;
    SELECT count(*),count(*) FILTER(WHERE x.amount_minor=c.amount_minor AND
      ((x.account_id=available_id AND x.direction='debit') OR (x.account_id=held_id AND x.direction='credit')))
      INTO posting_count,matching_count FROM private.wallet_postings x WHERE x.transaction_id=t.id;
    IF posting_count<>2 OR matching_count<>2 THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical hold postings required'; END IF;
    PERFORM private.assert_wallet_transaction_balanced(t.id);
    latest:=greatest(latest,t.created_at);
  END LOOP;
  IF NOT isfinite(receipt.fully_held_at)
    OR (positive_count>0 AND receipt.fully_held_at IS DISTINCT FROM latest) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact persisted funding timestamp required'; END IF;
  RETURN QUERY SELECT total::bigint,total::bigint,receipt.fully_held_at;
END;
$function$;

-- Audited replacement: private.assert_funded_activation
CREATE OR REPLACE FUNCTION private.assert_funded_activation(g private.financial_agreements, a alignments)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE receipt private.funded_movement_activations%ROWTYPE; evidence record; p private.financial_proposals%ROWTYPE;
BEGIN
 SELECT x.* INTO receipt FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id;
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 IF receipt.financial_agreement_id IS NULL OR receipt.alignment_id IS DISTINCT FROM a.id
  OR g.alignment_id IS DISTINCT FROM a.id OR receipt.activated_at IS DISTINCT FROM a.activated_at
  OR a.status NOT IN ('activated','in_progress','completed','cancelled')
  OR evidence.fully_held_at IS NULL OR evidence.held_minor<>evidence.required_minor
  OR NOT isfinite(receipt.activated_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical funded activation required'; END IF;
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 -- Receipt certifies current prepared/verified media and member flags at the
 -- original gate. Historical checks do not demand that media remain current now.
 IF EXISTS (
  (SELECT g.offering_member_id AS member_id UNION SELECT t.member_id FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id)
  EXCEPT SELECT x.member_id FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id=g.id
 ) OR EXISTS (
  SELECT x.member_id FROM private.funded_movement_activation_faces x WHERE x.financial_agreement_id=g.id
  EXCEPT (SELECT g.offering_member_id UNION SELECT t.member_id FROM private.movement_context_snapshot_travellers t WHERE t.snapshot_id=p.movement_context_snapshot_id)
 ) OR EXISTS (
  SELECT 1 FROM private.funded_movement_activation_faces x
  LEFT JOIN private.alignment_face_verifications f ON f.id=x.face_verification_id
  WHERE x.financial_agreement_id=g.id AND (f.id IS NULL OR f.alignment_id IS DISTINCT FROM a.id
   OR f.member_id IS DISTINCT FROM x.member_id OR f.status<>'succeeded'
   OR f.liveness_passed IS DISTINCT FROM true OR f.face_match_passed IS DISTINCT FROM true
   OR f.completed_at IS NULL
   OR f.completed_at>=f.expires_at OR f.expires_at<=receipt.activated_at
   OR NOT isfinite(f.started_at) OR NOT isfinite(f.completed_at) OR NOT isfinite(f.expires_at)
   OR f.attempt_ordinal IS NULL OR f.attempt_ordinal<=0)
 ) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical activation face evidence required'; END IF;
END;
$function$;

-- Audited replacement: private.assert_funded_coordination_entry
CREATE OR REPLACE FUNCTION private.assert_funded_coordination_entry(p_alignment uuid)
 RETURNS journeys
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
 a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
 request private.funded_movement_start_requests%ROWTYPE; started private.funded_movement_starts%ROWTYPE; mp private.journey_meeting_points%ROWTYPE;
BEGIN
 SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=p_alignment;
 SELECT x.* INTO a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=r.financial_agreement_id;
 SELECT x.* INTO j FROM public.journeys x WHERE x.id=r.journey_id;
 IF r.alignment_id IS NULL OR j.id IS NULL OR g.id IS NULL
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=p_alignment)<>1
  OR g.alignment_id IS DISTINCT FROM a.id OR j.alignment_id IS DISTINCT FROM a.id
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM r.created_at OR NOT isfinite(r.created_at)
  OR j.completion_requested_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.movement_settlements c WHERE c.journey_id=j.id OR c.alignment_id=a.id)
  OR j.completed_at IS NOT NULL OR j.end_requested_by_member_id IS NOT NULL OR j.end_requested_at IS NOT NULL
  OR j.end_confirmed_by_member_id IS NOT NULL OR j.end_confirmed_at IS NOT NULL OR j.end_reason IS NOT NULL OR j.end_method IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact coordination entry required'; END IF;
 SELECT x.* INTO request FROM private.funded_movement_start_requests x WHERE x.alignment_id=a.id;
 SELECT x.* INTO started FROM private.funded_movement_starts x WHERE x.alignment_id=a.id;
 SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id;
 IF request.alignment_id IS NULL THEN
  IF started.alignment_id IS NOT NULL OR a.status<>'activated' OR j.status<>'not_started'
   OR j.start_requested_at IS NOT NULL OR j.started_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start request required'; END IF;
 ELSE
  IF request.journey_id IS DISTINCT FROM j.id OR request.requested_at IS DISTINCT FROM j.start_requested_at
   OR NOT isfinite(request.requested_at)
   OR mp.journey_id IS NULL OR mp.revision IS DISTINCT FROM request.meeting_point_revision
   OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen meeting point and start request required'; END IF;
  IF started.alignment_id IS NULL THEN
   IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start confirmation required'; END IF;
  ELSIF started.journey_id IS DISTINCT FROM j.id OR started.started_at IS DISTINCT FROM j.started_at
   OR NOT isfinite(started.started_at)
   OR a.status<>'in_progress' OR j.status<>'in_progress' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact financial start required';
  END IF;
 END IF;
 PERFORM private.assert_funded_activation(g,a);
 RETURN j;
END;
$function$;

-- Audited replacement: private.require_funded_start_actor
CREATE OR REPLACE FUNCTION private.require_funded_start_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; request private.funded_movement_start_requests%ROWTYPE;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.alignment_id;
 j:=private.assert_funded_coordination_entry(a.id);
 IF NEW.journey_id IS DISTINCT FROM j.id OR a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pre-start graph required'; END IF;
 IF TG_TABLE_NAME='funded_movement_start_requests' THEN
  IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
  IF j.start_requested_at IS NOT NULL OR NOT isfinite(NEW.requested_at)
   OR NOT EXISTS(SELECT 1 FROM private.journey_meeting_points mp WHERE mp.journey_id=j.id AND mp.revision=NEW.meeting_point_revision
    AND mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact valid meeting point required'; END IF;
 ELSE
  IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
  SELECT x.* INTO request FROM private.funded_movement_start_requests x WHERE x.alignment_id=a.id;
  IF request.alignment_id IS NULL OR request.journey_id<>j.id OR NOT isfinite(NEW.started_at) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer request required'; END IF;
 END IF;
 RETURN NEW;
END;
$function$;

-- Audited replacement: private.assert_movement_context_snapshot_offer_binding
CREATE OR REPLACE FUNCTION private.assert_movement_context_snapshot_offer_binding(p private.movement_context_snapshots)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  o public.movement_offers%ROWTYPE;
  rb private.movement_offer_route_match_bindings%ROWTYPE;
  ab private.movement_offer_availability_bindings%ROWTYPE;
  m private.trusted_route_match_evidence%ROWTYPE;
  a private.offering_movement_availability%ROWTYPE;
  e private.offering_route_evidence%ROWTYPE;
BEGIN
  IF p.movement_offer_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Produced movement snapshot requires exact movement offer provenance';
  END IF;

  SELECT x.*
  INTO o
  FROM public.movement_offers x
  WHERE x.id = p.movement_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot offer provenance unavailable';
  END IF;

  SELECT x.*
  INTO rb
  FROM private.movement_offer_route_match_bindings x
  WHERE x.movement_offer_id = o.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot requires route-match authorization provenance';
  END IF;

  SELECT x.*
  INTO ab
  FROM private.movement_offer_availability_bindings x
  WHERE x.movement_offer_id = o.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot requires availability authorization provenance';
  END IF;

  SELECT x.*
  INTO STRICT m
  FROM private.trusted_route_match_evidence x
  WHERE x.id = rb.route_match_evidence_id;

  SELECT x.*
  INTO STRICT a
  FROM private.offering_movement_availability x
  WHERE x.id = ab.availability_id;

  SELECT x.*
  INTO STRICT e
  FROM private.offering_route_evidence x
  WHERE x.id = a.route_evidence_id;

  IF ROW(
      o.movement_need_id,
      o.offering_member_id,
      o.vehicle_id,
      o.seats_offered,
      o.proposed_pickup_area,
      o.proposed_dropoff_area,
      o.estimated_arrival_minutes
    )
    IS DISTINCT FROM ROW(
      p.movement_need_id,
      p.offering_member_id,
      p.vehicle_id,
      p.seats_offered,
      p.proposed_pickup_area,
      p.proposed_dropoff_area,
      p.declared_arrival_minutes
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot facts do not match exact movement offer';
  END IF;

  IF ROW(
      rb.movement_need_id,
      rb.offering_member_id,
      rb.offering_movement_intent_id,
      rb.route_match_evidence_version
    )
    IS DISTINCT FROM ROW(
      p.movement_need_id,
      p.offering_member_id,
      p.offering_movement_intent_id,
      m.version
    )
    OR m.id IS DISTINCT FROM rb.route_match_evidence_id
    OR m.requesting_member_id IS DISTINCT FROM p.requesting_member_id
    OR m.offering_intent_version IS DISTINCT FROM p.offering_intent_version
    OR m.requester_origin_location_reference_id
         IS DISTINCT FROM p.requester_origin_location_id
    OR m.requester_destination_location_reference_id
         IS DISTINCT FROM p.requester_destination_location_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot route-match provenance does not match';
  END IF;

  IF ROW(
      ab.movement_need_id,
      ab.offering_member_id,
      ab.offering_movement_intent_id,
      a.id,
      a.vehicle_id,
      a.route_evidence_id,
      a.route_evidence_version
    )
    IS DISTINCT FROM ROW(
      p.movement_need_id,
      p.offering_member_id,
      p.offering_movement_intent_id,
      ab.availability_id,
      p.vehicle_id,
      m.route_evidence_id,
      m.route_evidence_version
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot availability provenance does not match';
  END IF;

  IF ROW(
      e.offering_member_id,
      e.offering_movement_intent_id,
      e.version,
      e.origin_location_reference_id,
      e.destination_location_reference_id
    )
    IS DISTINCT FROM ROW(
      p.offering_member_id,
      p.offering_movement_intent_id,
      m.route_evidence_version,
      p.offering_origin_location_id,
      p.offering_destination_location_id
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot offering route provenance does not match';
  END IF;

  IF p.expires_at IS NULL
    OR p.expires_at > a.expires_at
    OR (
      m.expires_at IS NOT NULL
      AND p.expires_at > m.expires_at
    ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Movement snapshot lifetime exceeds trusted source lifetime';
  END IF;
END;
$function$;

-- Audited replacement: private.assert_financial_proposal_quote_binding
CREATE OR REPLACE FUNCTION private.assert_financial_proposal_quote_binding(p private.financial_proposals)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE q private.pricing_quotes%ROWTYPE;
BEGIN
  SELECT x.* INTO q FROM private.pricing_quotes x WHERE x.id=p.pricing_quote_id;
  IF NOT FOUND OR p.pricing_quote_version IS NULL OR
    ROW(p.pricing_quote_version,p.movement_need_id,p.member_needing_movement_id,
      p.offering_member_id,p.currency,p.pricing_policy_version)
    IS DISTINCT FROM ROW(q.version,q.movement_need_id,q.requesting_member_id,
      q.offering_member_id,q.currency,q.pricing_policy_version) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal requires exact pricing quote provenance';
  END IF;
  IF p.created_at IS NULL OR NOT isfinite(p.created_at)
    OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=p.created_at OR p.expires_at>q.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Proposal lifetime must be finite and quote-bounded';
  END IF;
END;
$function$;

-- Audited replacement: private.assert_financial_proposal_movement_context_binding
CREATE OR REPLACE FUNCTION private.assert_financial_proposal_movement_context_binding(p private.financial_proposals)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s private.movement_context_snapshots%ROWTYPE;
BEGIN
  SELECT x.* INTO s FROM private.movement_context_snapshots x
    WHERE x.id=p.movement_context_snapshot_id;
  IF NOT FOUND OR s.context_schema_version IS DISTINCT FROM 'movement_context_v1'
    OR s.movement_offer_id IS NULL OR p.movement_context_snapshot_version IS NULL
    OR ROW(p.movement_context_snapshot_version,p.movement_need_id,p.member_needing_movement_id,
      p.offering_member_id,p.vehicle_id,p.people_count,p.seats_offered,p.vehicle_seat_capacity,
      p.origin_area,p.destination_area,p.earliest_departure_at,p.latest_departure_at,
      p.proposed_pickup_area,p.proposed_dropoff_area,p.estimated_arrival_minutes)
    IS DISTINCT FROM ROW(s.version,s.movement_need_id,s.requesting_member_id,
      s.offering_member_id,s.vehicle_id,s.people_count,s.seats_offered,s.vehicle_seat_capacity,
      s.requester_origin_area,s.requester_destination_area,s.requester_earliest_departure_at,
      s.requester_latest_departure_at,s.proposed_pickup_area,s.proposed_dropoff_area,s.declared_arrival_minutes) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal requires exact movement context provenance';
  END IF;
  IF p.created_at IS NULL OR NOT isfinite(p.created_at)
    OR p.expires_at IS NULL OR NOT isfinite(p.expires_at) OR p.expires_at<=p.created_at
    OR s.expires_at IS NULL OR NOT isfinite(s.expires_at) OR p.expires_at>s.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal lifetime must be finite and snapshot-bounded';
  END IF;
  IF p.movement_offer_id IS NOT NULL AND p.movement_offer_id IS DISTINCT FROM s.movement_offer_id THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Proposal operational offer must equal its historical snapshot source';
  END IF;
END;
$function$;

-- Audited replacement: public.record_location_resolution_for_server
CREATE OR REPLACE FUNCTION public.record_location_resolution_for_server(p_source_location_reference_id uuid, p_producer_request_id uuid, p_provider_namespace text, p_provider_product text, p_provider_version text, p_provider_place_reference text, p_resolution_version text, p_latitude numeric, p_longitude numeric, p_resolved_at timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(evidence_id uuid, resolved_location_reference_id uuid, version integer, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_source private.movement_location_references%ROWTYPE;
  v_existing private.movement_location_resolution_evidence%ROWTYPE;
  v_target private.movement_location_references%ROWTYPE;
  v_now timestamptz;
  v_attested_at timestamptz;
  v_expiry timestamptz;
  v_version integer;
  v_target_id uuid;
  v_evidence_id uuid;
  v_text text;
BEGIN
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Location resolution requires READ COMMITTED';
  END IF;
  IF p_source_location_reference_id IS NULL OR p_producer_request_id IS NULL
    OR p_provider_namespace IS NULL OR p_provider_product IS NULL OR p_provider_version IS NULL
    OR p_provider_place_reference IS NULL OR p_resolution_version IS NULL
    OR p_latitude IS NULL OR p_longitude IS NULL OR p_resolved_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Complete trusted location resolution is required';
  END IF;
  FOREACH v_text IN ARRAY ARRAY[p_provider_namespace,p_provider_product,p_provider_version,p_resolution_version]
  LOOP
    IF v_text<>btrim(v_text) OR length(v_text) NOT BETWEEN 1 AND 100 OR v_text !~ '[^[:space:]]' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution provider metadata is invalid';
    END IF;
  END LOOP;
  IF p_provider_place_reference<>btrim(p_provider_place_reference)
    OR length(p_provider_place_reference) NOT BETWEEN 1 AND 500 OR p_provider_place_reference !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution provider place reference is invalid';
  END IF;
  IF NOT (p_latitude BETWEEN -90 AND 90) OR NOT (p_longitude BETWEEN -180 AND 180)
    OR p_latitude::text IN ('NaN','Infinity','-Infinity') OR p_longitude::text IN ('NaN','Infinity','-Infinity') THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution coordinates are invalid';
  END IF;

  SELECT r.* INTO v_source FROM private.movement_location_references r
  WHERE r.id=p_source_location_reference_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution source not found';
  END IF;
  v_now := clock_timestamp();
  IF v_source.resolution_status IS DISTINCT FROM 'unresolved'
    OR v_source.source_kind NOT IN ('member_declared','member_selected')
    OR v_source.latitude IS NOT NULL OR v_source.longitude IS NOT NULL
    OR v_source.resolved_at IS NOT NULL OR v_source.resolution_version IS NOT NULL
    OR (v_source.provider_namespace IS NULL)<>(v_source.provider_place_reference IS NULL)
    OR (v_source.expires_at IS NOT NULL AND v_source.expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution source is not eligible';
  END IF;
  IF v_source.provider_namespace IS NOT NULL AND
    (v_source.provider_namespace IS DISTINCT FROM p_provider_namespace
      OR v_source.provider_place_reference IS DISTINCT FROM p_provider_place_reference) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution must preserve provider selection identity';
  END IF;
  IF NOT isfinite(p_resolved_at) OR p_resolved_at<v_source.created_at OR p_resolved_at>v_now
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_now)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution timestamps are invalid';
  END IF;

  SELECT e.* INTO v_existing FROM private.movement_location_resolution_evidence e
  WHERE e.producer_request_id=p_producer_request_id;
  IF FOUND THEN
    SELECT r.* INTO STRICT v_target FROM private.movement_location_references r
    WHERE r.id=v_existing.resolved_location_reference_id FOR SHARE;
    IF v_existing.source_location_reference_id IS DISTINCT FROM v_source.id
      OR v_existing.provider_product IS DISTINCT FROM p_provider_product
      OR v_existing.provider_version IS DISTINCT FROM p_provider_version
      OR v_existing.requested_expires_at IS DISTINCT FROM p_expires_at
      OR v_target.provider_namespace IS DISTINCT FROM p_provider_namespace
      OR v_target.provider_place_reference IS DISTINCT FROM p_provider_place_reference
      OR v_target.resolution_version IS DISTINCT FROM p_resolution_version
      OR v_target.latitude IS DISTINCT FROM p_latitude OR v_target.longitude IS DISTINCT FROM p_longitude
      OR v_target.resolved_at IS DISTINCT FROM p_resolved_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution request does not match recorded evidence';
    END IF;
    -- Reacquires source/target in the same order and checks time AFTER all waits.
    PERFORM private.assert_movement_location_resolution_evidence(v_existing.id);
    RETURN QUERY SELECT v_existing.id,v_target.id,v_existing.version,v_target.expires_at;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(e.version),0)+1 INTO v_version
  FROM private.movement_location_resolution_evidence e WHERE e.source_location_reference_id=v_source.id;
  v_attested_at := clock_timestamp();
  IF NOT isfinite(p_resolved_at) OR p_resolved_at<v_source.created_at OR p_resolved_at>v_attested_at
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_attested_at)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution timestamps are invalid';
  END IF;
  -- PostgreSQL LEAST ignores NULL; two NULL deadlines deliberately mean no expiry.
  v_expiry := LEAST(p_expires_at,v_source.expires_at);
  IF v_expiry IS NOT NULL AND v_expiry<=v_attested_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Location resolution expiry elapsed before recording';
  END IF;
  INSERT INTO private.movement_location_references(
    owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,
    provider_namespace,provider_place_reference,resolution_version,resolved_at,created_at,expires_at
  ) VALUES (
    v_source.owner_member_id,v_source.declared_label,'provider_resolved','resolved',p_latitude,p_longitude,
    p_provider_namespace,p_provider_place_reference,p_resolution_version,p_resolved_at,v_attested_at,v_expiry
  ) RETURNING id INTO v_target_id;
  INSERT INTO private.movement_location_resolution_evidence(
    source_location_reference_id,resolved_location_reference_id,version,producer_request_id,
    provider_product,provider_version,resolution_schema_version,requested_expires_at,recorded_at
  ) VALUES (
    v_source.id,v_target_id,v_version,p_producer_request_id,p_provider_product,p_provider_version,
    'movement_location_resolution_v1',p_expires_at,v_attested_at
  ) RETURNING id INTO v_evidence_id;
  -- No caught uniqueness errors: statement atomicity removes a losing target too.
  PERFORM private.assert_movement_location_resolution_evidence(v_evidence_id);
  RETURN QUERY SELECT v_evidence_id,v_target_id,v_version,v_expiry;
END;
$function$;

-- Audited replacement: public.record_offering_route_evidence_for_server
CREATE OR REPLACE FUNCTION public.record_offering_route_evidence_for_server(p_offering_movement_intent_id uuid, p_provider_namespace text, p_provider_product text, p_provider_version text, p_provider_route_reference text, p_route_shape jsonb, p_route_distance_meters bigint, p_route_duration_seconds bigint, p_generated_at timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(route_evidence_id uuid, route_evidence_version integer, route_evidence_status text, route_evidence_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_intent private.offering_movement_intents%ROWTYPE;
  v_origin private.movement_location_references%ROWTYPE;
  v_destination private.movement_location_references%ROWTYPE;
  v_existing private.offering_route_evidence%ROWTYPE;
  v_origin_id uuid;
  v_destination_id uuid;
  v_effective_expires_at timestamptz;
  v_next_version integer;
  v_new_id uuid;
  v_now timestamptz;
  v_attested_at timestamptz;
BEGIN
  IF p_offering_movement_intent_id IS NULL
    OR p_provider_namespace IS NULL
    OR p_provider_product IS NULL
    OR p_provider_version IS NULL
    OR p_provider_route_reference IS NULL
    OR p_route_shape IS NULL
    OR p_route_distance_meters IS NULL
    OR p_route_duration_seconds IS NULL
    OR p_generated_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete trusted route evidence is required';
  END IF;

  SELECT i.* INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id=p_offering_movement_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='Offering movement intent not found';
  END IF;

  v_now := clock_timestamp();
  IF v_intent.status<>'current'
    OR (v_intent.expires_at IS NOT NULL AND v_intent.expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering movement intent is not eligible for route evidence';
  END IF;

  PERFORM private.assert_offering_movement_intent(v_intent.id);

  SELECT il.location_reference_id INTO STRICT v_origin_id
  FROM private.offering_movement_intent_locations il
  WHERE il.intent_id=v_intent.id AND il.role='origin';

  SELECT il.location_reference_id INTO STRICT v_destination_id
  FROM private.offering_movement_intent_locations il
  WHERE il.intent_id=v_intent.id AND il.role='destination';

  SELECT lr.* INTO STRICT v_origin
  FROM private.movement_location_references lr
  WHERE lr.id=v_origin_id FOR SHARE;

  SELECT lr.* INTO STRICT v_destination
  FROM private.movement_location_references lr
  WHERE lr.id=v_destination_id FOR SHARE;

  v_now := clock_timestamp();
  IF v_origin.owner_member_id<>v_intent.offering_member_id
    OR v_destination.owner_member_id<>v_intent.offering_member_id
    OR v_origin.resolution_status<>'resolved'
    OR v_destination.resolution_status<>'resolved'
    OR v_origin.source_kind<>'provider_resolved'
    OR v_destination.source_kind<>'provider_resolved'
    OR (v_origin.expires_at IS NOT NULL AND v_origin.expires_at<=v_now)
    OR (v_destination.expires_at IS NOT NULL AND v_destination.expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence requires resolved eligible intent endpoints';
  END IF;

  IF NOT isfinite(p_generated_at)
    OR p_generated_at>v_now
    OR p_generated_at<v_intent.created_at
    OR p_generated_at<v_origin.resolved_at
    OR p_generated_at<v_destination.resolved_at THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence generation time is invalid';
  END IF;

  IF p_expires_at IS NOT NULL
    AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence expiry is invalid';
  END IF;

  IF p_route_distance_meters<=0 OR p_route_duration_seconds<=0 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence distance and duration must be positive';
  END IF;

  PERFORM private.assert_geojson_linestring_v1(p_route_shape);

  v_effective_expires_at := LEAST(
    p_expires_at,
    v_intent.expires_at,
    v_origin.expires_at,
    v_destination.expires_at
  );

  IF v_effective_expires_at IS NOT NULL AND v_effective_expires_at<=v_now THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence dependencies are expired';
  END IF;

  SELECT e.* INTO v_existing
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id=v_intent.id
    AND e.provider_namespace=p_provider_namespace
    AND e.provider_product=p_provider_product
    AND e.provider_version=p_provider_version
    AND e.provider_route_reference=p_provider_route_reference
  FOR UPDATE;

  -- Replay preserves the stored generation time despite a later observation.
  IF FOUND THEN
    v_now := clock_timestamp();
    IF v_existing.offering_movement_intent_id IS DISTINCT FROM v_intent.id
      OR v_existing.offering_member_id IS DISTINCT FROM v_intent.offering_member_id
      OR v_existing.origin_location_reference_id IS DISTINCT FROM v_origin.id
      OR v_existing.destination_location_reference_id IS DISTINCT FROM v_destination.id
      OR v_existing.evidence_schema_version IS DISTINCT FROM 'offering_route_evidence_v1'
      OR v_existing.route_shape_format IS DISTINCT FROM 'geojson_linestring_v1'
      OR v_existing.route_shape IS DISTINCT FROM p_route_shape
      OR v_existing.route_distance_meters IS DISTINCT FROM p_route_distance_meters
      OR v_existing.route_duration_seconds IS DISTINCT FROM p_route_duration_seconds
      OR v_existing.expires_at IS DISTINCT FROM v_effective_expires_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Provider route reference does not match recorded evidence';
    END IF;

    IF v_existing.status<>'current'
      OR (v_existing.expires_at IS NOT NULL AND v_existing.expires_at<=v_now) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Provider route reference belongs to stale evidence';
    END IF;

    PERFORM private.assert_offering_route_evidence(v_existing.id);
    RETURN QUERY SELECT v_existing.id, v_existing.version, v_existing.status, v_existing.expires_at;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(e.version),0)+1 INTO v_next_version
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id=v_intent.id;

  UPDATE private.offering_route_evidence e
  SET status='superseded'
  WHERE e.offering_movement_intent_id=v_intent.id
    AND e.status='current';

  v_attested_at := clock_timestamp();
  IF NOT isfinite(p_generated_at) OR p_generated_at>v_attested_at
    OR p_generated_at<v_intent.created_at OR p_generated_at<v_origin.resolved_at OR p_generated_at<v_destination.resolved_at
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_attested_at))
    OR (v_effective_expires_at IS NOT NULL AND v_effective_expires_at<=v_attested_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route evidence attestation time is invalid';
  END IF;
  INSERT INTO private.offering_route_evidence(
    offering_movement_intent_id, offering_member_id,
    origin_location_reference_id, destination_location_reference_id,
    version, evidence_schema_version,
    provider_namespace, provider_product, provider_version, provider_route_reference,
    route_shape_format, route_shape, route_distance_meters, route_duration_seconds,
    generated_at, expires_at, status, created_at
  )
  VALUES(
    v_intent.id, v_intent.offering_member_id,
    v_origin.id, v_destination.id,
    v_next_version, 'offering_route_evidence_v1',
    p_provider_namespace, p_provider_product, p_provider_version, p_provider_route_reference,
    'geojson_linestring_v1', p_route_shape, p_route_distance_meters, p_route_duration_seconds,
    p_generated_at, v_effective_expires_at, 'current', v_attested_at
  )
  RETURNING id INTO v_new_id;

  PERFORM private.assert_offering_route_evidence(v_new_id);

  -- Drain pending INSERT checks while this version is still current. Otherwise
  -- a later call in this transaction could supersede it before validation.
  SET CONSTRAINTS private.offering_route_evidence_complete IMMEDIATE;
  SET CONSTRAINTS private.offering_route_evidence_complete DEFERRED;

  RETURN QUERY
  SELECT e.id,e.version,e.status,e.expires_at
  FROM private.offering_route_evidence e
  WHERE e.id=v_new_id;
END;
$function$;

-- Audited replacement: public.record_trusted_route_match_evidence_for_server
CREATE OR REPLACE FUNCTION public.record_trusted_route_match_evidence_for_server(p_movement_need_id uuid, p_offering_movement_intent_id uuid, p_expected_route_evidence_id uuid, p_expected_route_evidence_version integer, p_requester_origin_distance_to_route_meters bigint, p_requester_destination_distance_to_route_meters bigint, p_calculated_route_shape_length_meters bigint, p_requester_origin_position_along_route_meters bigint, p_requester_destination_position_along_route_meters bigint, p_requester_origin_closest_route_latitude numeric, p_requester_origin_closest_route_longitude numeric, p_requester_destination_closest_route_latitude numeric, p_requester_destination_closest_route_longitude numeric, p_calculated_at timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(route_match_evidence_id uuid, route_match_evidence_version integer, route_match_evidence_status text, route_match_evidence_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_context record;

  v_offering_member_id uuid;

  v_existing
    private.trusted_route_match_evidence%ROWTYPE;

  v_requester_origin_expires_at timestamptz;
  v_requester_destination_expires_at timestamptz;
  v_offering_intent_expires_at timestamptz;

  v_effective_expires_at timestamptz;

  v_route_order text;

  v_next_version integer;
  v_new_id uuid;

  v_now timestamptz;
  v_attested_at timestamptz;
BEGIN
  -- The trusted matching-context function is deliberately
  -- READ COMMITTED only. Keep this writer on the same
  -- transaction-isolation contract.
  IF current_setting('transaction_isolation')
       IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25001',
      MESSAGE =
        'Trusted route-match evidence requires READ COMMITTED';
  END IF;


  IF p_movement_need_id IS NULL
     OR p_offering_movement_intent_id IS NULL

     OR p_expected_route_evidence_id IS NULL
     OR p_expected_route_evidence_version IS NULL

     OR p_requester_origin_distance_to_route_meters IS NULL
     OR p_requester_destination_distance_to_route_meters IS NULL

     OR p_calculated_route_shape_length_meters IS NULL

     OR p_requester_origin_position_along_route_meters IS NULL
     OR p_requester_destination_position_along_route_meters IS NULL

     OR p_requester_origin_closest_route_latitude IS NULL
     OR p_requester_origin_closest_route_longitude IS NULL

     OR p_requester_destination_closest_route_latitude IS NULL
     OR p_requester_destination_closest_route_longitude IS NULL

     OR p_calculated_at IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Complete trusted route-match evidence is required';
  END IF;


  -- No maximum-distance rule exists.
  --
  -- Large requester-to-route distances are legitimate
  -- objective facts and must not be rejected here.
  IF p_requester_origin_distance_to_route_meters < 0
     OR p_requester_destination_distance_to_route_meters < 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match distances cannot be negative';
  END IF;


  IF p_calculated_route_shape_length_meters <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match route-shape length must be positive';
  END IF;


  IF p_requester_origin_position_along_route_meters < 0
     OR p_requester_destination_position_along_route_meters < 0
     OR p_requester_origin_position_along_route_meters
          > p_calculated_route_shape_length_meters
     OR p_requester_destination_position_along_route_meters
          > p_calculated_route_shape_length_meters THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match route positions are invalid';
  END IF;


  IF p_requester_origin_closest_route_latitude
       NOT BETWEEN -90 AND 90
     OR p_requester_origin_closest_route_longitude
       NOT BETWEEN -180 AND 180
     OR p_requester_destination_closest_route_latitude
       NOT BETWEEN -90 AND 90
     OR p_requester_destination_closest_route_longitude
       NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match closest route coordinates are invalid';
  END IF;


  -- Route order is a deterministic fact derived from the
  -- calculated positions. The caller does not choose it.
  IF p_requester_origin_position_along_route_meters
       < p_requester_destination_position_along_route_meters THEN
    v_route_order := 'forward';

  ELSIF p_requester_origin_position_along_route_meters
       = p_requester_destination_position_along_route_meters THEN
    v_route_order := 'same_position';

  ELSE
    v_route_order := 'reverse';
  END IF;


  -- Serialize route-match history for one requester need.
  --
  -- The existing trusted matching-context function also begins
  -- with the movement-need lock. Taking the stronger lock here
  -- preserves that lock order and prevents concurrent writers
  -- from allocating competing route-match versions.
  PERFORM 1
  FROM public.movement_needs mn
  WHERE mn.id = p_movement_need_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Movement need not found';
  END IF;


  -- Offering intent ownership is immutable. Read the member id
  -- only so the existing trusted matching-context function can
  -- perform its authoritative ownership and eligibility checks.
  SELECT i.offering_member_id
  INTO v_offering_member_id
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Offering movement intent not found';
  END IF;


  SELECT c.*
  INTO STRICT v_context
  FROM public.get_trusted_matching_context_for_server(
    p_movement_need_id,
    p_offering_movement_intent_id,
    v_offering_member_id
  ) c;


  -- The geometry facts must have been calculated from the exact
  -- trusted route version that is still current now.
  --
  -- Without this check, route A could be calculated by the
  -- matcher and then silently recorded against newer route B.
  IF v_context.route_evidence_id
       IS DISTINCT FROM p_expected_route_evidence_id
     OR v_context.route_evidence_version
       IS DISTINCT FROM p_expected_route_evidence_version THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match calculation route is no longer current';
  END IF;


  v_now := clock_timestamp();

  IF NOT isfinite(p_calculated_at)
     OR p_calculated_at > v_now
     OR p_calculated_at < v_context.route_generated_at THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match calculation time is invalid';
  END IF;


  IF p_expires_at IS NOT NULL
     AND (
       NOT isfinite(p_expires_at)
       OR p_expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match requested expiry is invalid';
  END IF;


  -- These rows are already protected by the trusted matching
  -- context acquired above. Read their dependency expiries so
  -- this writer, rather than the caller, determines the maximum
  -- lifetime of the recorded evidence.
  SELECT lr.expires_at
  INTO STRICT v_requester_origin_expires_at
  FROM private.movement_location_references lr
  WHERE lr.id =
    v_context.requester_origin_location_reference_id;


  SELECT lr.expires_at
  INTO STRICT v_requester_destination_expires_at
  FROM private.movement_location_references lr
  WHERE lr.id =
    v_context.requester_destination_location_reference_id;


  SELECT i.expires_at
  INTO STRICT v_offering_intent_expires_at
  FROM private.offering_movement_intents i
  WHERE i.id =
    v_context.offering_movement_intent_id;


  v_effective_expires_at := LEAST(
    p_expires_at,
    v_requester_origin_expires_at,
    v_requester_destination_expires_at,
    v_offering_intent_expires_at,
    v_context.route_expires_at
  );


  v_now := clock_timestamp();

  IF v_effective_expires_at IS NOT NULL
     AND v_effective_expires_at <= v_now THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Trusted route-match evidence dependencies are expired';
  END IF;


  -- One trusted route evidence + algorithm pair identifies one
  -- replayable calculation for this requester need.
  SELECT e.*
  INTO v_existing
  FROM private.trusted_route_match_evidence e
  WHERE e.movement_need_id = p_movement_need_id
    AND e.route_evidence_id = v_context.route_evidence_id
    AND e.algorithm_version = 'route_match_geometry_v1'
  FOR UPDATE;


  IF FOUND THEN
    v_now := clock_timestamp();

    IF v_existing.requesting_member_id
         IS DISTINCT FROM v_context.requesting_member_id

       OR v_existing.requester_origin_location_reference_id
         IS DISTINCT FROM
           v_context.requester_origin_location_reference_id

       OR v_existing.requester_destination_location_reference_id
         IS DISTINCT FROM
           v_context.requester_destination_location_reference_id

       OR v_existing.offering_member_id
         IS DISTINCT FROM v_context.offering_member_id

       OR v_existing.offering_movement_intent_id
         IS DISTINCT FROM
           v_context.offering_movement_intent_id

       OR v_existing.offering_intent_version
         IS DISTINCT FROM
           v_context.offering_intent_version

       OR v_existing.route_evidence_version
         IS DISTINCT FROM
           v_context.route_evidence_version

       OR v_existing.evidence_schema_version
         IS DISTINCT FROM
           'trusted_route_match_evidence_v1'

       OR v_existing.algorithm_version
         IS DISTINCT FROM
           'route_match_geometry_v1'

       OR v_existing.requester_origin_distance_to_route_meters
         IS DISTINCT FROM
           p_requester_origin_distance_to_route_meters

       OR v_existing.requester_destination_distance_to_route_meters
         IS DISTINCT FROM
           p_requester_destination_distance_to_route_meters

       OR v_existing.calculated_route_shape_length_meters
         IS DISTINCT FROM
           p_calculated_route_shape_length_meters

       OR v_existing.requester_origin_position_along_route_meters
         IS DISTINCT FROM
           p_requester_origin_position_along_route_meters

       OR v_existing.requester_destination_position_along_route_meters
         IS DISTINCT FROM
           p_requester_destination_position_along_route_meters

       OR v_existing.requester_origin_closest_route_latitude
         IS DISTINCT FROM
           p_requester_origin_closest_route_latitude

       OR v_existing.requester_origin_closest_route_longitude
         IS DISTINCT FROM
           p_requester_origin_closest_route_longitude

       OR v_existing.requester_destination_closest_route_latitude
         IS DISTINCT FROM
           p_requester_destination_closest_route_latitude

       OR v_existing.requester_destination_closest_route_longitude
         IS DISTINCT FROM
           p_requester_destination_closest_route_longitude

       OR v_existing.route_order
         IS DISTINCT FROM v_route_order

       OR v_existing.calculated_at
         IS DISTINCT FROM p_calculated_at

       OR v_existing.expires_at
         IS DISTINCT FROM v_effective_expires_at THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match replay does not match recorded evidence';
    END IF;


    IF v_existing.status <> 'current'
       OR (
         v_existing.expires_at IS NOT NULL
         AND v_existing.expires_at <= v_now
       ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE =
          'Trusted route-match replay belongs to stale evidence';
    END IF;


    PERFORM
      private.assert_trusted_route_match_evidence(
        v_existing.id
      );


    RETURN QUERY
    SELECT
      v_existing.id,
      v_existing.version,
      v_existing.status,
      v_existing.expires_at;

    RETURN;
  END IF;


  SELECT
    COALESCE(MAX(e.version), 0) + 1
  INTO v_next_version
  FROM private.trusted_route_match_evidence e
  WHERE e.movement_need_id = p_movement_need_id
    AND e.offering_movement_intent_id =
      v_context.offering_movement_intent_id;


  UPDATE private.trusted_route_match_evidence e
  SET status = 'superseded'
  WHERE e.movement_need_id = p_movement_need_id
    AND e.offering_movement_intent_id =
      v_context.offering_movement_intent_id
    AND e.status = 'current';


  v_attested_at := clock_timestamp();
  IF NOT isfinite(p_calculated_at) OR p_calculated_at>v_attested_at OR p_calculated_at<v_context.route_generated_at
    OR (p_expires_at IS NOT NULL AND (NOT isfinite(p_expires_at) OR p_expires_at<=v_attested_at))
    OR (v_effective_expires_at IS NOT NULL AND v_effective_expires_at<=v_attested_at) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Trusted route-match attestation time is invalid';
  END IF;
  INSERT INTO private.trusted_route_match_evidence (
    movement_need_id,

    requesting_member_id,

    requester_origin_location_reference_id,
    requester_destination_location_reference_id,

    offering_member_id,
    offering_movement_intent_id,
    offering_intent_version,

    route_evidence_id,
    route_evidence_version,

    version,
    evidence_schema_version,
    algorithm_version,

    requester_origin_distance_to_route_meters,
    requester_destination_distance_to_route_meters,

    calculated_route_shape_length_meters,

    requester_origin_position_along_route_meters,
    requester_destination_position_along_route_meters,

    requester_origin_closest_route_latitude,
    requester_origin_closest_route_longitude,

    requester_destination_closest_route_latitude,
    requester_destination_closest_route_longitude,

    route_order,

    calculated_at,
    expires_at,
    status,
    created_at
  )
  VALUES (
    p_movement_need_id,

    v_context.requesting_member_id,

    v_context.requester_origin_location_reference_id,
    v_context.requester_destination_location_reference_id,

    v_context.offering_member_id,
    v_context.offering_movement_intent_id,
    v_context.offering_intent_version,

    v_context.route_evidence_id,
    v_context.route_evidence_version,

    v_next_version,
    'trusted_route_match_evidence_v1',
    'route_match_geometry_v1',

    p_requester_origin_distance_to_route_meters,
    p_requester_destination_distance_to_route_meters,

    p_calculated_route_shape_length_meters,

    p_requester_origin_position_along_route_meters,
    p_requester_destination_position_along_route_meters,

    p_requester_origin_closest_route_latitude,
    p_requester_origin_closest_route_longitude,

    p_requester_destination_closest_route_latitude,
    p_requester_destination_closest_route_longitude,

    v_route_order,

    p_calculated_at,
    v_effective_expires_at,
    'current',
    v_attested_at
  )
  RETURNING id
  INTO v_new_id;


  PERFORM
    private.assert_trusted_route_match_evidence(
      v_new_id
    );


  -- Drain the deferred INSERT validator while this newly created
  -- version is still current. A later call in the same
  -- transaction may legitimately supersede it.
  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    IMMEDIATE;

  SET CONSTRAINTS
    private.trusted_route_match_evidence_complete
    DEFERRED;


  RETURN QUERY
  SELECT
    e.id,
    e.version,
    e.status,
    e.expires_at
  FROM private.trusted_route_match_evidence e
  WHERE e.id = v_new_id;
END;
$function$;

-- Audited replacement: public.activate_my_funded_movement
CREATE OR REPLACE FUNCTION public.activate_my_funded_movement(p_financial_agreement_id uuid, p_expected_agreement_version integer)
 RETURNS TABLE(financial_agreement_id uuid, agreement_version integer, alignment_id uuid, alignment_status text, activated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE g private.financial_agreements%ROWTYPE; a public.alignments%ROWTYPE; evidence record; stamp timestamptz;
BEGIN
 g:=private.funded_activation_agreement(p_financial_agreement_id,p_expected_agreement_version,true);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=g.alignment_id;
 IF EXISTS(SELECT 1 FROM private.funded_movement_activations x WHERE x.financial_agreement_id=g.id) THEN
  PERFORM private.assert_funded_activation(g,a);
  RETURN QUERY SELECT g.id,g.version,a.id,a.status,a.activated_at; RETURN;
 END IF;
 IF g.status<>'current' OR a.status<>'awaiting_activation_payment' OR a.activated_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Current pre-activation agreement required'; END IF;
 -- Existing gate owns alignment -> need -> every required member in UUID order.
 PERFORM private.assert_alignment_face_ready(a.id);
 SELECT * INTO evidence FROM private.movement_funding_evidence(g);
 IF evidence.fully_held_at IS NULL OR evidence.held_minor<>evidence.required_minor THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Completed exact requester funding required'; END IF;
 -- Capture time AFTER every wait, and check the same authoritative face predicate
 -- at precisely the timestamp to be recorded (not a statement-start timestamp).
 stamp:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM private.required_face_members(a.id) r
  WHERE NOT private.has_current_alignment_face_check(a.id,r.member_id,stamp)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Fresh face verification required'; END IF;
 INSERT INTO private.funded_movement_activations VALUES(g.id,a.id,stamp);
 INSERT INTO private.funded_movement_activation_faces(financial_agreement_id,member_id,face_verification_id)
 SELECT g.id,r.member_id,(SELECT f.id FROM private.alignment_face_verifications f WHERE f.alignment_id=a.id AND f.member_id=r.member_id
  ORDER BY f.attempt_ordinal DESC LIMIT 1) FROM private.required_face_members(a.id) r;
 UPDATE public.alignments x SET status='activated',activated_at=stamp,updated_at=stamp WHERE x.id=a.id RETURNING x.* INTO a;
 PERFORM private.assert_funded_activation(g,a);
 RETURN QUERY SELECT g.id,g.version,a.id,a.status,a.activated_at;
END;
$function$;

-- Audited replacement: public.start_alignment_face_verification_for_server
CREATE OR REPLACE FUNCTION public.start_alignment_face_verification_for_server(p_alignment_id uuid, p_member_id uuid, p_provider text, p_provider_reference text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_media uuid; v_id uuid; v_now timestamptz;
BEGIN
  PERFORM 1 FROM public.alignments WHERE id=p_alignment_id AND status='awaiting_activation_payment' FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM private.required_face_members(p_alignment_id) r WHERE r.member_id=p_member_id) THEN
    RAISE EXCEPTION 'Face verification unavailable';
  END IF;
  PERFORM 1 FROM public.members WHERE id=p_member_id FOR UPDATE;
  -- Only prepare_profile_photo_submission_for_server establishes this binding.
  -- Successful live checks leave the submission ready, allowing later reuse.
  SELECT mm.id INTO v_media FROM public.member_media mm
    JOIN private.profile_photo_submissions ps ON ps.media_id=mm.id AND ps.member_id=mm.member_id
      AND ps.status='ready' AND ps.processed_at IS NOT NULL
    WHERE mm.member_id=p_member_id AND mm.media_type='photo' AND mm.is_current
    FOR SHARE OF ps;
  IF v_media IS NULL THEN RAISE EXCEPTION 'Prepared current face photo required'; END IF;
  UPDATE private.alignment_face_verifications SET status='superseded'
    WHERE alignment_id=p_alignment_id AND member_id=p_member_id AND status='pending';
  v_now:=clock_timestamp();
  INSERT INTO private.alignment_face_verifications(alignment_id,member_id,media_id,provider,provider_reference,started_at,expires_at,attempt_ordinal)
  VALUES (p_alignment_id,p_member_id,v_media,p_provider,p_provider_reference,v_now,v_now+interval '10 minutes',nextval('private.alignment_face_attempt_ordinal_seq'::regclass)) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Audited replacement: private.has_current_alignment_face_check
CREATE OR REPLACE FUNCTION private.has_current_alignment_face_check(p_alignment_id uuid, p_member_id uuid, p_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM private.alignment_face_verifications f
    JOIN public.member_media mm ON mm.id=f.media_id AND mm.member_id=f.member_id
      AND mm.media_type='photo' AND mm.is_current AND mm.verified
    JOIN private.profile_photo_submissions ps ON ps.media_id=mm.id AND ps.member_id=mm.member_id
      AND ps.status='ready' AND ps.processed_at IS NOT NULL
    JOIN public.members m ON m.id=f.member_id AND m.profile_media_verified
    WHERE f.alignment_id=p_alignment_id AND f.member_id=p_member_id
      AND f.status='succeeded' AND f.liveness_passed AND f.face_match_passed
      -- A newly started attempt replaces authorization, not historical evidence.
      AND f.id=(SELECT latest.id FROM private.alignment_face_verifications latest
        WHERE latest.alignment_id=f.alignment_id AND latest.member_id=f.member_id
        ORDER BY latest.attempt_ordinal DESC LIMIT 1)
      AND f.completed_at IS NOT NULL AND isfinite(f.started_at) AND isfinite(f.completed_at) AND isfinite(f.expires_at) AND f.completed_at<f.expires_at AND f.expires_at>p_at);
$function$;

-- Audited replacement: public.get_my_alignment_face_verification_status
CREATE OR REPLACE FUNCTION public.get_my_alignment_face_verification_status(p_movement_need_id uuid)
 RETURNS TABLE(status text, completed_at timestamp with time zone, expires_at timestamp with time zone, ready_for_activation boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH read_time AS MATERIALIZED (SELECT clock_timestamp() AS at)
  SELECT CASE WHEN f.id IS NULL THEN 'not_started'
    WHEN f.status IN ('pending','succeeded') AND f.expires_at<=t.at THEN 'expired'
    ELSE f.status END,f.completed_at,f.expires_at,
    a.status='awaiting_activation_payment' AND private.has_current_alignment_face_check(a.id,auth.uid(),t.at)
  FROM public.alignments a CROSS JOIN read_time t
  LEFT JOIN LATERAL (SELECT s.* FROM private.alignment_face_verifications s
    WHERE s.alignment_id=a.id AND s.member_id=auth.uid() ORDER BY s.attempt_ordinal DESC LIMIT 1) f ON true
  WHERE a.movement_need_id=p_movement_need_id AND a.status IN ('awaiting_activation_payment','activated','in_progress','completed')
    AND EXISTS (SELECT 1 FROM private.required_face_members(a.id) r WHERE r.member_id=auth.uid());
$function$;

COMMIT;
