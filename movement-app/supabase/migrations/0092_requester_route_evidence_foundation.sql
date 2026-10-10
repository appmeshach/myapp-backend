BEGIN;

-- =========================================================
-- 0092 Requester route evidence foundation
-- =========================================================
--
-- WE DO NOT CREATE JOURNEYS.
--
-- This private table stores a normalized route result for a
-- requester's independently declared movement need. It is not a
-- route-match verdict, a pickup obligation, pricing evidence,
-- or a live routing integration.
--
-- It does NOT:
-- - create a movement offer or alignment;
-- - decide matching eligibility;
-- - establish legal or operational authority;
-- - replace provider route evidence for an offerer;
-- - prove a requester will travel the route exactly as shown.

CREATE TABLE private.requester_route_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  movement_need_id uuid NOT NULL
    REFERENCES public.movement_needs(id),

  requesting_member_id uuid NOT NULL
    REFERENCES public.members(id),

  origin_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  destination_location_reference_id uuid NOT NULL
    REFERENCES private.movement_location_references(id),

  version integer NOT NULL
    CHECK (version >= 1),

  evidence_schema_version text NOT NULL
    CHECK (
      evidence_schema_version = 'requester_route_evidence_v1'
    ),

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

  route_shape_format text NOT NULL CHECK (
    route_shape_format = 'geojson_linestring_v1'
  ),

  route_shape jsonb NOT NULL,

  route_distance_meters bigint NOT NULL
    CHECK (route_distance_meters > 0),

  route_duration_seconds bigint NOT NULL
    CHECK (route_duration_seconds > 0),

  generated_at timestamptz NOT NULL
    CHECK (isfinite(generated_at)),

  created_at timestamptz NOT NULL
    DEFAULT clock_timestamp()
    CHECK (isfinite(created_at)),

  expires_at timestamptz
    CHECK (isfinite(expires_at)),

  status text NOT NULL DEFAULT 'current'
    CHECK (
      status IN (
        'current',
        'superseded',
        'expired'
      )
    ),

  UNIQUE (
    movement_need_id,
    version
  ),

  UNIQUE (
    movement_need_id,
    provider_namespace,
    provider_product,
    provider_version,
    provider_route_reference
  ),

  CHECK (
    origin_location_reference_id
      <> destination_location_reference_id
  ),

  CHECK (
    generated_at <= created_at
  ),

  CHECK (
    expires_at IS NULL
    OR expires_at > generated_at
  )
);

-- Only one requester route-evidence record may be current for a
-- movement need. Later writers may supersede the current row without
-- inventing a second live route history for the same need.
CREATE UNIQUE INDEX requester_route_evidence_one_current
ON private.requester_route_evidence (movement_need_id)
WHERE status = 'current';

ALTER TABLE private.requester_route_evidence
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.requester_route_evidence
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON private.requester_route_evidence
TO service_role;

-- Structural validation preserves historical provenance and private
-- geometry integrity without making a superseded or expired row eligible
-- for current use.
CREATE FUNCTION private.validate_requester_route_evidence_structure(
  p_row private.requester_route_evidence
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  need_row public.movement_needs%ROWTYPE;
  origin_row private.movement_location_references%ROWTYPE;
  destination_row private.movement_location_references%ROWTYPE;
BEGIN
  SELECT n.* INTO STRICT need_row
  FROM public.movement_needs n
  WHERE n.id = p_row.movement_need_id
  FOR SHARE;

  IF need_row.member_id <> p_row.requesting_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence member mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.movement_need_locations ml
    WHERE ml.movement_need_id = need_row.id
      AND ml.role = 'origin'
      AND ml.location_reference_id = p_row.origin_location_reference_id
  ) OR NOT EXISTS (
    SELECT 1
    FROM private.movement_need_locations ml
    WHERE ml.movement_need_id = need_row.id
      AND ml.role = 'destination'
      AND ml.location_reference_id = p_row.destination_location_reference_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence endpoints do not match movement need';
  END IF;

  SELECT lr.* INTO STRICT origin_row
  FROM private.movement_location_references lr
  WHERE lr.id = p_row.origin_location_reference_id;

  SELECT lr.* INTO STRICT destination_row
  FROM private.movement_location_references lr
  WHERE lr.id = p_row.destination_location_reference_id;

  IF origin_row.owner_member_id <> p_row.requesting_member_id
    OR destination_row.owner_member_id <> p_row.requesting_member_id
    OR origin_row.resolution_status <> 'resolved'
    OR destination_row.resolution_status <> 'resolved'
    OR origin_row.source_kind <> 'provider_resolved'
    OR destination_row.source_kind <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence requires resolved eligible endpoints';
  END IF;

  PERFORM private.assert_geojson_linestring_v1(p_row.route_shape);
END;
$$;

REVOKE ALL
ON FUNCTION private.validate_requester_route_evidence_structure(private.requester_route_evidence)
FROM PUBLIC, anon, authenticated, service_role;

-- Current-eligibility check for one stored requester route. This is a
-- separate pass from structural validation so superseded and expired rows
-- remain preserved but cannot be used as current evidence.
CREATE FUNCTION private.assert_requester_route_evidence(p_evidence_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  evidence_row private.requester_route_evidence%ROWTYPE;
  origin_row private.movement_location_references%ROWTYPE;
  destination_row private.movement_location_references%ROWTYPE;
BEGIN
  SELECT e.* INTO STRICT evidence_row
  FROM private.requester_route_evidence e
  WHERE e.id = p_evidence_id
  FOR UPDATE;

  IF evidence_row.status <> 'current'
    OR (evidence_row.expires_at IS NOT NULL
        AND evidence_row.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence is not current and unexpired';
  END IF;

  SELECT lr.* INTO STRICT origin_row
  FROM private.movement_location_references lr
  WHERE lr.id = evidence_row.origin_location_reference_id;

  SELECT lr.* INTO STRICT destination_row
  FROM private.movement_location_references lr
  WHERE lr.id = evidence_row.destination_location_reference_id;

  IF (origin_row.expires_at IS NOT NULL
      AND origin_row.expires_at <= clock_timestamp())
    OR (destination_row.expires_at IS NOT NULL
        AND destination_row.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence endpoints are stale';
  END IF;

  PERFORM private.validate_requester_route_evidence_structure(evidence_row);
END;
$$;

REVOKE ALL
ON FUNCTION private.assert_requester_route_evidence(uuid)
FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.protect_requester_route_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence history cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'current' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Requester route evidence must start current';
    END IF;

    IF NEW.created_at > clock_timestamp()
      OR NEW.generated_at > clock_timestamp()
      OR (NEW.expires_at IS NOT NULL
          AND NEW.expires_at <= clock_timestamp()) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Requester route evidence timestamps are invalid';
    END IF;

    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence fields are immutable';
  END IF;

  IF OLD.status <> 'current' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence lifecycle cannot reopen or change terminal state';
  END IF;

  IF NEW.status NOT IN ('superseded', 'expired') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence lifecycle transition is invalid';
  END IF;

  IF NEW.status = 'expired'
    AND (NEW.expires_at IS NULL OR NEW.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Requester route evidence expiry has not elapsed';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION private.protect_requester_route_evidence()
FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER protect_requester_route_evidence
BEFORE INSERT OR UPDATE OR DELETE
ON private.requester_route_evidence
FOR EACH ROW EXECUTE FUNCTION private.protect_requester_route_evidence();

CREATE FUNCTION private.validate_requester_route_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.validate_requester_route_evidence_structure(NEW);
  RETURN NULL;
END;
$$;

REVOKE ALL
ON FUNCTION private.validate_requester_route_evidence()
FROM PUBLIC, anon, authenticated, service_role;

CREATE CONSTRAINT TRIGGER requester_route_evidence_complete
AFTER INSERT OR UPDATE
ON private.requester_route_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION private.validate_requester_route_evidence();

COMMIT;
