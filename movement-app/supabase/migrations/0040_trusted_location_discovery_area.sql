BEGIN;

CREATE TABLE private.trusted_location_discovery_areas (
  resolution_evidence_id uuid PRIMARY KEY
    REFERENCES private.movement_location_resolution_evidence(id)
    ON DELETE RESTRICT,

  resolved_location_reference_id uuid NOT NULL UNIQUE
    REFERENCES private.movement_location_references(id)
    ON DELETE RESTRICT,

  discovery_area_label text NOT NULL
    CHECK (
      discovery_area_label=btrim(discovery_area_label)
      AND length(discovery_area_label) BETWEEN 1 AND 500
      AND discovery_area_label ~ '[^[:space:]]'
    ),

  schema_version text NOT NULL DEFAULT 'trusted_location_discovery_area_v1'
    CHECK (
      schema_version='trusted_location_discovery_area_v1'
    ),

  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
    CHECK (isfinite(recorded_at))
);

ALTER TABLE private.trusted_location_discovery_areas
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.trusted_location_discovery_areas
FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT
ON private.trusted_location_discovery_areas
TO service_role;


CREATE FUNCTION private.protect_trusted_location_discovery_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect_discovery_area$
BEGIN
  RAISE EXCEPTION
    USING ERRCODE='23514',
    MESSAGE='Trusted location discovery area is immutable';
END;
$protect_discovery_area$;

REVOKE ALL
ON FUNCTION private.protect_trusted_location_discovery_area()
FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION private.assert_trusted_location_discovery_area(
  p_resolution_evidence_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_discovery_area$
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
    OR d.recorded_at < e.recorded_at
    OR d.recorded_at > clock_timestamp()
  THEN
    RAISE EXCEPTION
      USING ERRCODE='23514',
      MESSAGE='Trusted location discovery area evidence is invalid';
  END IF;
END;
$assert_discovery_area$;

REVOKE ALL
ON FUNCTION private.assert_trusted_location_discovery_area(uuid)
FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION private.validate_trusted_location_discovery_area()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $validate_discovery_area$
BEGIN
  PERFORM private.assert_trusted_location_discovery_area(
    NEW.resolution_evidence_id
  );

  RETURN NULL;
END;
$validate_discovery_area$;

REVOKE ALL
ON FUNCTION private.validate_trusted_location_discovery_area()
FROM PUBLIC,anon,authenticated,service_role;


CREATE TRIGGER protect_trusted_location_discovery_area
BEFORE UPDATE OR DELETE
ON private.trusted_location_discovery_areas
FOR EACH ROW
EXECUTE FUNCTION private.protect_trusted_location_discovery_area();


CREATE TRIGGER validate_trusted_location_discovery_area
AFTER INSERT
ON private.trusted_location_discovery_areas
FOR EACH ROW
EXECUTE FUNCTION private.validate_trusted_location_discovery_area();


CREATE FUNCTION public.record_attested_location_resolution_for_server(
  p_verified_member_id uuid,
  p_source_location_reference_id uuid,
  p_producer_request_id uuid,
  p_provider_namespace text,
  p_provider_product text,
  p_provider_version text,
  p_provider_place_reference text,
  p_resolution_version text,
  p_discovery_area_label text,
  p_latitude numeric,
  p_longitude numeric,
  p_resolved_at timestamptz,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS TABLE(
  evidence_id uuid,
  resolved_location_reference_id uuid,
  version integer,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $resolve_with_discovery_area$
DECLARE
  v_evidence_id uuid;
  v_resolved_location_reference_id uuid;
  v_version integer;
  v_expires_at timestamptz;
  v_existing private.trusted_location_discovery_areas%ROWTYPE;
BEGIN
  IF
    p_discovery_area_label IS NULL
    OR p_discovery_area_label<>btrim(p_discovery_area_label)
    OR length(p_discovery_area_label) NOT BETWEEN 1 AND 500
    OR p_discovery_area_label !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION
      USING ERRCODE='23514',
      MESSAGE='Trusted discovery area label is invalid';
  END IF;

  SELECT
    r.evidence_id,
    r.resolved_location_reference_id,
    r.version,
    r.expires_at
  INTO STRICT
    v_evidence_id,
    v_resolved_location_reference_id,
    v_version,
    v_expires_at
  FROM public.record_attested_location_resolution_for_server(
    p_verified_member_id,
    p_source_location_reference_id,
    p_producer_request_id,
    p_provider_namespace,
    p_provider_product,
    p_provider_version,
    p_provider_place_reference,
    p_resolution_version,
    p_latitude,
    p_longitude,
    p_resolved_at,
    p_expires_at
  ) r;

  SELECT d.*
  INTO v_existing
  FROM private.trusted_location_discovery_areas d
  WHERE d.resolution_evidence_id=v_evidence_id;

  IF FOUND THEN
    IF
      v_existing.resolved_location_reference_id
        IS DISTINCT FROM v_resolved_location_reference_id
      OR v_existing.discovery_area_label
        IS DISTINCT FROM p_discovery_area_label
    THEN
      RAISE EXCEPTION
        USING ERRCODE='23514',
        MESSAGE='Trusted discovery area does not match recorded resolution';
    END IF;
  ELSE
    INSERT INTO private.trusted_location_discovery_areas(
      resolution_evidence_id,
      resolved_location_reference_id,
      discovery_area_label
    )
    VALUES (
      v_evidence_id,
      v_resolved_location_reference_id,
      p_discovery_area_label
    );
  END IF;

  PERFORM private.assert_trusted_location_discovery_area(
    v_evidence_id
  );

  RETURN QUERY
  SELECT
    v_evidence_id,
    v_resolved_location_reference_id,
    v_version,
    v_expires_at;
END;
$resolve_with_discovery_area$;


REVOKE ALL
ON FUNCTION public.record_attested_location_resolution_for_server(
  uuid,uuid,uuid,text,text,text,text,text,
  numeric,numeric,timestamptz,timestamptz
)
FROM PUBLIC,anon,authenticated,service_role;


REVOKE ALL
ON FUNCTION public.record_attested_location_resolution_for_server(
  uuid,uuid,uuid,text,text,text,text,text,text,
  numeric,numeric,timestamptz,timestamptz
)
FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE
ON FUNCTION public.record_attested_location_resolution_for_server(
  uuid,uuid,uuid,text,text,text,text,text,text,
  numeric,numeric,timestamptz,timestamptz
)
TO service_role;

COMMIT;