BEGIN;

-- WE DO NOT CREATE JOURNEYS.
-- Foundation only: registers immutable, approved transport-geography dataset
-- snapshots that a future trusted classifier may use.
--
-- No classifier runtime.
-- No route matching.
-- No pricing arithmetic.
-- No pricing-geography write.
-- No quote/proposal/agreement/payment mutation.
-- 0059/0060 are deliberately not cut over to this registry yet.

CREATE TABLE private.transport_geography_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- This token is the future value referenced by
  -- pricing_geography_evidence.transport_geography_version.
  transport_geography_version text NOT NULL UNIQUE
    CHECK (
      transport_geography_version ~
      '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    ),

  dataset_family text NOT NULL
    CHECK (
      dataset_family ~
      '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    ),

  dataset_release text NOT NULL
    CHECK (
      dataset_release ~
      '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    ),

  schema_version text NOT NULL
    CHECK (
      schema_version ~
      '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    ),

  theme text NOT NULL
    CHECK (
      theme ~
      '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    ),

  feature_type text NOT NULL
    CHECK (
      feature_type ~
      '^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$'
    ),

  extract_format text NOT NULL
    CHECK (extract_format IN ('geoparquet')),

  source_license text NOT NULL
    CHECK (
      length(source_license) BETWEEN 1 AND 100
      AND source_license = btrim(source_license)
    ),

  source_attribution text NOT NULL
    CHECK (
      length(source_attribution) BETWEEN 1 AND 500
      AND source_attribution = btrim(source_attribution)
    ),

  -- Provenance only. This may identify the upstream release location from
  -- which the approved extract was produced. It must never contain secrets.
  source_locator text NOT NULL
    CHECK (
      length(source_locator) BETWEEN 1 AND 2000
      AND source_locator = btrim(source_locator)
    ),

  -- Geographic coverage uses WGS84 longitude/latitude coordinates.
  -- Making the CRS explicit prevents a future classifier from silently
  -- interpreting the same numeric bbox under a different coordinate system.
  coverage_crs text NOT NULL
    CHECK (coverage_crs = 'EPSG:4326'),

  -- Geographic coverage of this exact extract.
  -- Object shape is validated by private.assert_transport_geography_bbox().
  coverage_bbox jsonb NOT NULL,

  -- Fingerprint of the exact approved extract bytes.
  -- Lowercase SHA-256 hexadecimal only.
  content_sha256 text NOT NULL
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),

  byte_length bigint NOT NULL
    CHECK (byte_length > 0),

  feature_count bigint NOT NULL
    CHECK (feature_count > 0),

  status text NOT NULL
    CHECK (status IN ('approved', 'superseded', 'retired')),

  registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
    CHECK (registered_at <= clock_timestamp()),

  UNIQUE (
    dataset_family,
    dataset_release,
    theme,
    feature_type,
    content_sha256
  )
);

ALTER TABLE private.transport_geography_datasets ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON TABLE private.transport_geography_datasets
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE private.transport_geography_datasets
TO service_role;


CREATE FUNCTION private.assert_transport_geography_bbox(
  p_bbox jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_xmin numeric;
  v_ymin numeric;
  v_xmax numeric;
  v_ymax numeric;
BEGIN
  IF p_bbox IS NULL
     OR jsonb_typeof(p_bbox) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography coverage bbox must be an object';
  END IF;

  IF (
    SELECT array_agg(k ORDER BY k)
    FROM jsonb_object_keys(p_bbox) AS k
  ) IS DISTINCT FROM ARRAY['xmax','xmin','ymax','ymin']::text[] THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography coverage bbox has invalid fields';
  END IF;

  IF jsonb_typeof(p_bbox->'xmin') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_bbox->'ymin') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_bbox->'xmax') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_bbox->'ymax') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography coverage bbox coordinates must be numeric';
  END IF;

  BEGIN
    v_xmin := (p_bbox->>'xmin')::numeric;
    v_ymin := (p_bbox->>'ymin')::numeric;
    v_xmax := (p_bbox->>'xmax')::numeric;
    v_ymax := (p_bbox->>'ymax')::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Transport geography coverage bbox coordinates must be numeric';
  END;

  IF v_xmin IS NULL
     OR v_ymin IS NULL
     OR v_xmax IS NULL
     OR v_ymax IS NULL
     OR v_xmin < -180
     OR v_xmax > 180
     OR v_ymin < -90
     OR v_ymax > 90
     OR v_xmin >= v_xmax
     OR v_ymin >= v_ymax THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography coverage bbox is invalid';
  END IF;
END;
$$;

REVOKE ALL
ON FUNCTION private.assert_transport_geography_bbox(jsonb)
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION private.assert_transport_geography_dataset(
  p_transport_geography_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dataset private.transport_geography_datasets%ROWTYPE;
BEGIN
  IF p_transport_geography_version IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Transport geography version required';
  END IF;

  SELECT d.*
  INTO STRICT v_dataset
  FROM private.transport_geography_datasets d
  WHERE d.transport_geography_version = p_transport_geography_version;

  PERFORM private.assert_transport_geography_bbox(v_dataset.coverage_bbox);

  IF v_dataset.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography dataset is not approved for new classification';
  END IF;

  -- Lock only after validating the factual record. Re-read status so a
  -- concurrent retirement/supersession cannot be treated as approved.
  SELECT d.*
  INTO STRICT v_dataset
  FROM private.transport_geography_datasets d
  WHERE d.transport_geography_version = p_transport_geography_version
  FOR SHARE;

  PERFORM private.assert_transport_geography_bbox(v_dataset.coverage_bbox);

  IF v_dataset.status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography dataset is not approved for new classification';
  END IF;
EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Exact approved transport geography dataset unavailable';
END;
$$;

REVOKE ALL
ON FUNCTION private.assert_transport_geography_dataset(text)
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION private.protect_transport_geography_dataset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography dataset history cannot be removed';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'approved'
       OR NEW.registered_at > clock_timestamp() THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Transport geography dataset must start approved with valid registration time';
    END IF;

    PERFORM private.assert_transport_geography_bbox(NEW.coverage_bbox);

    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'status')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography dataset facts are immutable';
  END IF;

  IF OLD.status IS DISTINCT FROM 'approved'
     OR NEW.status NOT IN ('superseded', 'retired')
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Transport geography dataset lifecycle cannot reopen or change terminal state';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION private.protect_transport_geography_dataset()
FROM PUBLIC, anon, authenticated, service_role;


CREATE TRIGGER protect_transport_geography_dataset
BEFORE INSERT OR UPDATE
ON private.transport_geography_datasets
FOR EACH ROW
EXECUTE FUNCTION private.protect_transport_geography_dataset();


CREATE TRIGGER prevent_transport_geography_dataset_removal
BEFORE DELETE OR TRUNCATE
ON private.transport_geography_datasets
FOR EACH STATEMENT
EXECUTE FUNCTION private.protect_transport_geography_dataset();


COMMIT;
