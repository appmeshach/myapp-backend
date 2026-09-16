BEGIN;

-- WE DO NOT CREATE JOURNEYS. This table stores a normalized private route
-- result for an offering member's independently declared movement intent.
-- It is not requester matching evidence, a pickup obligation, pricing, or a
-- live routing integration. No application/server writer is introduced here.
CREATE TABLE private.offering_route_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offering_movement_intent_id uuid NOT NULL REFERENCES private.offering_movement_intents(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  origin_location_reference_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  destination_location_reference_id uuid NOT NULL REFERENCES private.movement_location_references(id),
  version integer NOT NULL CHECK (version >= 1),
  evidence_schema_version text NOT NULL CHECK (evidence_schema_version = 'offering_route_evidence_v1'),
  provider_namespace text NOT NULL CHECK (
    provider_namespace = btrim(provider_namespace)
    AND length(provider_namespace) BETWEEN 1 AND 100
    AND provider_namespace ~ '[^[:space:]]'
  ),
  provider_product text NOT NULL CHECK (
    provider_product = btrim(provider_product)
    AND length(provider_product) BETWEEN 1 AND 100
    AND provider_product ~ '[^[:space:]]'
  ),
  provider_version text NOT NULL CHECK (
    provider_version = btrim(provider_version)
    AND length(provider_version) BETWEEN 1 AND 100
    AND provider_version ~ '[^[:space:]]'
  ),
  provider_route_reference text NOT NULL CHECK (
    provider_route_reference = btrim(provider_route_reference)
    AND length(provider_route_reference) BETWEEN 1 AND 500
    AND provider_route_reference ~ '[^[:space:]]'
  ),
  route_shape_format text NOT NULL CHECK (route_shape_format = 'geojson_linestring_v1'),
  route_shape jsonb NOT NULL,
  route_distance_meters bigint NOT NULL CHECK (route_distance_meters > 0),
  route_duration_seconds bigint NOT NULL CHECK (route_duration_seconds > 0),
  generated_at timestamptz NOT NULL CHECK (isfinite(generated_at)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  expires_at timestamptz CHECK (isfinite(expires_at)),
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded','expired')),
  UNIQUE (offering_movement_intent_id, version),
  UNIQUE (provider_namespace, provider_product, provider_version, provider_route_reference),
  CHECK (origin_location_reference_id <> destination_location_reference_id),
  CHECK (generated_at <= created_at),
  CHECK (expires_at IS NULL OR expires_at > generated_at)
);

CREATE UNIQUE INDEX offering_route_evidence_one_current
  ON private.offering_route_evidence(offering_movement_intent_id)
  WHERE status = 'current';

ALTER TABLE private.offering_route_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.offering_route_evidence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON private.offering_route_evidence TO service_role;

-- Validate the normalized route shape without selecting a routing vendor.
-- Coordinates are GeoJSON order [longitude, latitude]. No requester point is
-- represented here and this shape remains private.
CREATE FUNCTION private.assert_geojson_linestring_v1(p_shape jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  point jsonb;
  longitude_value numeric;
  latitude_value numeric;
BEGIN
  IF jsonb_typeof(p_shape) <> 'object'
    OR p_shape->>'type' <> 'LineString'
    OR jsonb_typeof(p_shape->'coordinates') <> 'array'
    OR jsonb_array_length(p_shape->'coordinates') < 2
    OR (p_shape - 'type' - 'coordinates') <> '{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape must be normalized GeoJSON LineString v1';
  END IF;

  FOR point IN SELECT value FROM jsonb_array_elements(p_shape->'coordinates')
  LOOP
    IF jsonb_typeof(point) <> 'array' OR jsonb_array_length(point) <> 2
      OR jsonb_typeof(point->0) <> 'number' OR jsonb_typeof(point->1) <> 'number' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape coordinates are invalid';
    END IF;
    longitude_value := (point->>0)::numeric;
    latitude_value := (point->>1)::numeric;
    IF longitude_value < -180 OR longitude_value > 180
      OR latitude_value < -90 OR latitude_value > 90 THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Route shape coordinates are out of range';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_geojson_linestring_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Eligibility check for one stored offering route. It proves application
-- consistency and provider-shaped structure, not physical presence or route
-- truth. A future trusted writer/consumer must call this in a reviewed lock
-- contract before relying on evidence.
CREATE FUNCTION private.assert_offering_route_evidence(p_evidence_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  evidence_row private.offering_route_evidence%ROWTYPE;
  intent_row private.offering_movement_intents%ROWTYPE;
  origin_row private.movement_location_references%ROWTYPE;
  destination_row private.movement_location_references%ROWTYPE;
BEGIN
  SELECT e.* INTO STRICT evidence_row
  FROM private.offering_route_evidence e
  WHERE e.id = p_evidence_id
  FOR UPDATE;

  IF evidence_row.status <> 'current'
    OR (evidence_row.expires_at IS NOT NULL AND evidence_row.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence is not current and unexpired';
  END IF;

  SELECT i.* INTO STRICT intent_row
  FROM private.offering_movement_intents i
  WHERE i.id = evidence_row.offering_movement_intent_id
  FOR SHARE;

  IF intent_row.offering_member_id <> evidence_row.offering_member_id
    OR intent_row.status <> 'current'
    OR (intent_row.expires_at IS NOT NULL AND intent_row.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence intent is not eligible';
  END IF;

  IF NOT EXISTS (
      SELECT 1 FROM private.offering_movement_intent_locations il
      WHERE il.intent_id=intent_row.id AND il.role='origin'
        AND il.location_reference_id=evidence_row.origin_location_reference_id
    ) OR NOT EXISTS (
      SELECT 1 FROM private.offering_movement_intent_locations il
      WHERE il.intent_id=intent_row.id AND il.role='destination'
        AND il.location_reference_id=evidence_row.destination_location_reference_id
    ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence endpoints do not match intent';
  END IF;

  SELECT lr.* INTO STRICT origin_row
  FROM private.movement_location_references lr
  WHERE lr.id=evidence_row.origin_location_reference_id;
  SELECT lr.* INTO STRICT destination_row
  FROM private.movement_location_references lr
  WHERE lr.id=evidence_row.destination_location_reference_id;

  IF origin_row.owner_member_id <> evidence_row.offering_member_id
    OR destination_row.owner_member_id <> evidence_row.offering_member_id
    OR origin_row.resolution_status <> 'resolved'
    OR destination_row.resolution_status <> 'resolved'
    OR origin_row.source_kind <> 'provider_resolved'
    OR destination_row.source_kind <> 'provider_resolved'
    OR (origin_row.expires_at IS NOT NULL AND origin_row.expires_at <= clock_timestamp())
    OR (destination_row.expires_at IS NOT NULL AND destination_row.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence requires resolved eligible endpoints';
  END IF;

  PERFORM private.assert_geojson_linestring_v1(evidence_row.route_shape);
END;
$$;
REVOKE ALL ON FUNCTION private.assert_offering_route_evidence(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.protect_offering_route_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence history cannot be deleted';
  END IF;

  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'current' THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Offering route evidence must start current';
    END IF;
    IF NEW.created_at > clock_timestamp()
      OR NEW.generated_at > clock_timestamp()
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
$$;
REVOKE ALL ON FUNCTION private.protect_offering_route_evidence() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_offering_route_evidence
BEFORE INSERT OR UPDATE OR DELETE ON private.offering_route_evidence
FOR EACH ROW EXECUTE FUNCTION private.protect_offering_route_evidence();

CREATE FUNCTION private.validate_offering_route_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.assert_offering_route_evidence(NEW.id);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_offering_route_evidence() FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER offering_route_evidence_complete
AFTER INSERT ON private.offering_route_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.validate_offering_route_evidence();

COMMIT;
