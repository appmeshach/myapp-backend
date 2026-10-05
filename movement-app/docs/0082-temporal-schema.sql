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
