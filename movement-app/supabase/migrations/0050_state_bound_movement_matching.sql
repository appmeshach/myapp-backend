BEGIN;

-- =========================================================
-- 0050 State-bound movement matching
-- =========================================================
--
-- Core rule:
--
-- A connectable movement must remain inside one Nigerian
-- state/state-equivalent jurisdiction, and both sides of a
-- movement connection must carry the same authoritative
-- trusted state identity.
--
-- State identity comes only from trusted provider resolution
-- evidence. Client labels, movement_needs.origin_area,
-- movement_needs.destination_area and profile/home state are
-- never security inputs.
--
-- This first section extends trusted location resolution with
-- immutable Nigerian-state evidence. Matching enforcement is
-- added later in this migration before deployment.
-- =========================================================


-- =========================================================
-- Canonical Nigerian state identity
-- =========================================================

CREATE FUNCTION private.canonical_nigerian_state_key(
  p_state_name text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = ''
AS $canonical_nigerian_state_key$
DECLARE
  v_name text;
BEGIN
  IF
    p_state_name <> btrim(p_state_name)
    OR length(p_state_name) NOT BETWEEN 1 AND 300
    OR p_state_name !~ '[^[:space:]]'
  THEN
    RETURN NULL;
  END IF;

  v_name := lower(p_state_name);

  -- Provider region names may use either "Lagos" or
  -- "Lagos State". Normalize only that explicit suffix and
  -- still require the result to match the fixed Nigerian
  -- jurisdiction allowlist below.
  IF right(v_name, 6) = ' state' THEN
    v_name := left(
      v_name,
      length(v_name) - 6
    );
  END IF;

  RETURN CASE v_name
    WHEN 'abia' THEN 'abia'
    WHEN 'adamawa' THEN 'adamawa'
    WHEN 'akwa ibom' THEN 'akwa_ibom'
    WHEN 'anambra' THEN 'anambra'
    WHEN 'bauchi' THEN 'bauchi'
    WHEN 'bayelsa' THEN 'bayelsa'
    WHEN 'benue' THEN 'benue'
    WHEN 'borno' THEN 'borno'
    WHEN 'cross river' THEN 'cross_river'
    WHEN 'delta' THEN 'delta'
    WHEN 'ebonyi' THEN 'ebonyi'
    WHEN 'edo' THEN 'edo'
    WHEN 'ekiti' THEN 'ekiti'
    WHEN 'enugu' THEN 'enugu'
    WHEN 'gombe' THEN 'gombe'
    WHEN 'imo' THEN 'imo'
    WHEN 'jigawa' THEN 'jigawa'
    WHEN 'kaduna' THEN 'kaduna'
    WHEN 'kano' THEN 'kano'
    WHEN 'katsina' THEN 'katsina'
    WHEN 'kebbi' THEN 'kebbi'
    WHEN 'kogi' THEN 'kogi'
    WHEN 'kwara' THEN 'kwara'
    WHEN 'lagos' THEN 'lagos'
    WHEN 'nasarawa' THEN 'nasarawa'
    WHEN 'niger' THEN 'niger'
    WHEN 'ogun' THEN 'ogun'
    WHEN 'ondo' THEN 'ondo'
    WHEN 'osun' THEN 'osun'
    WHEN 'oyo' THEN 'oyo'
    WHEN 'plateau' THEN 'plateau'
    WHEN 'rivers' THEN 'rivers'
    WHEN 'sokoto' THEN 'sokoto'
    WHEN 'taraba' THEN 'taraba'
    WHEN 'yobe' THEN 'yobe'
    WHEN 'zamfara' THEN 'zamfara'
    WHEN 'federal capital territory' THEN 'fct'
    ELSE NULL
  END;
END;
$canonical_nigerian_state_key$;

REVOKE ALL
ON FUNCTION private.canonical_nigerian_state_key(text)
FROM PUBLIC,anon,authenticated,service_role;


-- =========================================================
-- Immutable trusted state evidence
-- =========================================================

CREATE TABLE private.trusted_location_state_evidence (
  resolution_evidence_id uuid PRIMARY KEY
    REFERENCES private.movement_location_resolution_evidence(id)
    ON DELETE RESTRICT,

  resolved_location_reference_id uuid NOT NULL UNIQUE
    REFERENCES private.movement_location_references(id)
    ON DELETE RESTRICT,

  provider_namespace text NOT NULL
    CHECK (
      provider_namespace=btrim(provider_namespace)
      AND length(provider_namespace) BETWEEN 1 AND 100
      AND provider_namespace ~ '[^[:space:]]'
    ),

  state_provider_reference text NOT NULL
    CHECK (
      state_provider_reference=btrim(state_provider_reference)
      AND length(state_provider_reference) BETWEEN 1 AND 500
      AND state_provider_reference ~ '[^[:space:]]'
    ),

  state_name text NOT NULL
    CHECK (
      state_name=btrim(state_name)
      AND length(state_name) BETWEEN 1 AND 300
      AND state_name ~ '[^[:space:]]'
    ),

  state_key text NOT NULL
    CHECK (
      state_key IN (
        'abia',
        'adamawa',
        'akwa_ibom',
        'anambra',
        'bauchi',
        'bayelsa',
        'benue',
        'borno',
        'cross_river',
        'delta',
        'ebonyi',
        'edo',
        'ekiti',
        'enugu',
        'gombe',
        'imo',
        'jigawa',
        'kaduna',
        'kano',
        'katsina',
        'kebbi',
        'kogi',
        'kwara',
        'lagos',
        'nasarawa',
        'niger',
        'ogun',
        'ondo',
        'osun',
        'oyo',
        'plateau',
        'rivers',
        'sokoto',
        'taraba',
        'yobe',
        'zamfara',
        'fct'
      )
    ),

  schema_version text NOT NULL
    DEFAULT 'trusted_location_state_v1'
    CHECK (
      schema_version='trusted_location_state_v1'
    ),

  recorded_at timestamptz NOT NULL
    DEFAULT clock_timestamp()
    CHECK (isfinite(recorded_at))
);

ALTER TABLE private.trusted_location_state_evidence
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.trusted_location_state_evidence
FROM PUBLIC,anon,authenticated,service_role;

GRANT SELECT
ON private.trusted_location_state_evidence
TO service_role;


-- =========================================================
-- State-evidence immutability
-- =========================================================

CREATE FUNCTION private.protect_trusted_location_state_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $protect_trusted_location_state$
BEGIN
  RAISE EXCEPTION
    USING
      ERRCODE='23514',
      MESSAGE='Trusted location state evidence is immutable';
END;
$protect_trusted_location_state$;

REVOKE ALL
ON FUNCTION private.protect_trusted_location_state_evidence()
FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER protect_trusted_location_state_evidence
BEFORE UPDATE OR DELETE
ON private.trusted_location_state_evidence
FOR EACH ROW
EXECUTE FUNCTION private.protect_trusted_location_state_evidence();


-- =========================================================
-- State-evidence assertion
-- =========================================================

CREATE FUNCTION private.assert_trusted_location_state_evidence(
  p_resolution_evidence_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_trusted_location_state$
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

    OR s.recorded_at < e.recorded_at

    OR s.recorded_at > clock_timestamp()
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted location state evidence is invalid';
  END IF;
END;
$assert_trusted_location_state$;

REVOKE ALL
ON FUNCTION private.assert_trusted_location_state_evidence(uuid)
FROM PUBLIC,anon,authenticated,service_role;


CREATE FUNCTION private.validate_trusted_location_state_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $validate_trusted_location_state$
BEGIN
  PERFORM private.assert_trusted_location_state_evidence(
    NEW.resolution_evidence_id
  );

  RETURN NULL;
END;
$validate_trusted_location_state$;

REVOKE ALL
ON FUNCTION private.validate_trusted_location_state_evidence()
FROM PUBLIC,anon,authenticated,service_role;

CREATE TRIGGER validate_trusted_location_state_evidence
AFTER INSERT
ON private.trusted_location_state_evidence
FOR EACH ROW
EXECUTE FUNCTION private.validate_trusted_location_state_evidence();

-- =========================================================
-- State-aware resolution context
-- =========================================================
--
-- Existing resolution evidence predates 0050. The resolver
-- must therefore know whether immutable trusted state evidence
-- has already been attached.
--
-- A pre-0050 resolution remains historical and immutable.
-- Missing state evidence makes it eligible for a fresh
-- provider observation, not for mutation of the old location
-- resolution.
-- =========================================================

CREATE FUNCTION
public.get_selected_location_resolution_context_with_state_for_server(
  p_verified_member_id uuid,
  p_source_location_reference_id uuid,
  p_producer_request_id uuid
)
RETURNS TABLE(
  provider_namespace text,
  provider_place_reference text,
  source_created_at timestamptz,
  source_expires_at timestamptz,
  evidence_id uuid,
  resolved_location_reference_id uuid,
  version integer,
  expires_at timestamptz,
  has_trusted_state_evidence boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $state_resolution_context$
DECLARE
  s private.movement_location_references%ROWTYPE;
  e private.movement_location_resolution_evidence%ROWTYPE;

  v_expiry timestamptz;
  v_has_state boolean := false;
BEGIN
  s :=
    private.require_verified_location_selection(
      p_verified_member_id,
      p_source_location_reference_id
    );

  IF p_producer_request_id IS NULL THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Resolution operation identity is required';
  END IF;

  SELECT x.*
  INTO e
  FROM private.movement_location_resolution_evidence x
  WHERE x.producer_request_id
        =p_producer_request_id;

  IF FOUND THEN
    IF
      e.source_location_reference_id
        IS DISTINCT FROM s.id
    THEN
      RAISE EXCEPTION
        USING
          ERRCODE='23514',
          MESSAGE='Resolution operation unavailable';
    END IF;

    PERFORM
      private.assert_movement_location_resolution_evidence(
        e.id
      );

    SELECT l.expires_at
    INTO v_expiry
    FROM private.movement_location_references l
    WHERE l.id=e.resolved_location_reference_id;

    SELECT EXISTS (
      SELECT 1
      FROM private.trusted_location_state_evidence state
      WHERE state.resolution_evidence_id=e.id
    )
    INTO v_has_state;

    IF v_has_state THEN
      PERFORM
        private.assert_trusted_location_state_evidence(
          e.id
        );
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    s.provider_namespace,
    s.provider_place_reference,
    s.created_at,
    s.expires_at,
    e.id,
    e.resolved_location_reference_id,
    e.version,
    v_expiry,
    v_has_state;
END;
$state_resolution_context$;


REVOKE ALL
ON FUNCTION
public.get_selected_location_resolution_context_with_state_for_server(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE
ON FUNCTION
public.get_selected_location_resolution_context_with_state_for_server(
  uuid,
  uuid,
  uuid
)
TO service_role;

-- =========================================================
-- State-aware trusted resolution wrapper
-- =========================================================
--
-- Keep the mature 0040 resolution/discovery-area writer as the
-- internal construction path. The new overload adds immutable
-- state evidence to the same resolution.
--
-- The old service-role callable overload is revoked below so
-- application/server code cannot bypass state recording.
-- =========================================================

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
  p_state_provider_reference text,
  p_state_name text,
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
AS $resolve_with_state$
DECLARE
  v_evidence_id uuid;
  v_resolved_location_reference_id uuid;
  v_version integer;
  v_expires_at timestamptz;

  v_state_key text;
  v_now timestamptz;

  v_source
    private.movement_location_references%ROWTYPE;

  v_prior_evidence
    private.movement_location_resolution_evidence%ROWTYPE;

  v_existing
    private.trusted_location_state_evidence%ROWTYPE;

  v_resolved_reference
    private.movement_location_references%ROWTYPE;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION
      USING
        ERRCODE='25000',
        MESSAGE='Trusted location state recording requires READ COMMITTED';
  END IF;


  -- =======================================================
  -- Required state evidence
  -- =======================================================

  IF
    p_state_provider_reference IS NULL
    OR p_state_provider_reference
      <> btrim(p_state_provider_reference)
    OR length(p_state_provider_reference)
      NOT BETWEEN 1 AND 500
    OR p_state_provider_reference
      !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted state provider reference is invalid';
  END IF;

  IF
    p_state_name IS NULL
    OR p_state_name <> btrim(p_state_name)
    OR length(p_state_name) NOT BETWEEN 1 AND 300
    OR p_state_name !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted state name is invalid';
  END IF;

  v_state_key :=
    private.canonical_nigerian_state_key(
      p_state_name
    );

  IF v_state_key IS NULL THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted location is not in a recognized Nigerian state jurisdiction';
  END IF;


  -- =======================================================
  -- Fresh provider observation validation
  --
  -- These values came from the server-side provider call.
  -- Even when we are upgrading an old immutable resolution,
  -- validate the new observation rather than treating unused
  -- writer parameters as arbitrary data.
  -- =======================================================

  IF
    p_verified_member_id IS NULL
    OR p_source_location_reference_id IS NULL
    OR p_producer_request_id IS NULL
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='22004',
        MESSAGE='Trusted resolution identities are required';
  END IF;

  IF
    p_provider_namespace IS NULL
    OR p_provider_namespace <> btrim(p_provider_namespace)
    OR length(p_provider_namespace) NOT BETWEEN 1 AND 100
    OR p_provider_namespace !~ '[^[:space:]]'

    OR p_provider_product IS NULL
    OR p_provider_product <> btrim(p_provider_product)
    OR length(p_provider_product) NOT BETWEEN 1 AND 100
    OR p_provider_product !~ '[^[:space:]]'

    OR p_provider_version IS NULL
    OR p_provider_version <> btrim(p_provider_version)
    OR length(p_provider_version) NOT BETWEEN 1 AND 100
    OR p_provider_version !~ '[^[:space:]]'

    OR p_provider_place_reference IS NULL
    OR p_provider_place_reference
      <> btrim(p_provider_place_reference)
    OR length(p_provider_place_reference)
      NOT BETWEEN 1 AND 500
    OR p_provider_place_reference
      !~ '[^[:space:]]'

    OR p_resolution_version IS NULL
    OR p_resolution_version <> btrim(p_resolution_version)
    OR length(p_resolution_version) NOT BETWEEN 1 AND 100
    OR p_resolution_version !~ '[^[:space:]]'

    OR p_discovery_area_label IS NULL
    OR p_discovery_area_label
      <> btrim(p_discovery_area_label)
    OR length(p_discovery_area_label)
      NOT BETWEEN 1 AND 500
    OR p_discovery_area_label
      !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted provider resolution metadata is invalid';
  END IF;

  IF
    p_latitude IS NULL
    OR p_longitude IS NULL
    OR NOT (
      p_latitude BETWEEN -90 AND 90
    )
    OR NOT (
      p_longitude BETWEEN -180 AND 180
    )
    OR p_latitude::text
      IN ('NaN','Infinity','-Infinity')
    OR p_longitude::text
      IN ('NaN','Infinity','-Infinity')
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted provider resolution coordinates are invalid';
  END IF;


  -- =======================================================
  -- Re-establish the exact verified selected source.
  --
  -- This prevents the legacy-upgrade branch from becoming a
  -- generic state-attestation writer for arbitrary resolution
  -- evidence.
  -- =======================================================

  v_source :=
    private.require_verified_location_selection(
      p_verified_member_id,
      p_source_location_reference_id
    );

  IF
    v_source.provider_namespace
      IS DISTINCT FROM p_provider_namespace

    OR v_source.provider_place_reference
      IS DISTINCT FROM p_provider_place_reference
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Resolution provider selection identity does not match';
  END IF;

  v_now := clock_timestamp();

  IF
    NOT isfinite(p_resolved_at)
    OR p_resolved_at < v_source.created_at
    OR p_resolved_at > v_now

    OR (
      p_expires_at IS NOT NULL
      AND (
        NOT isfinite(p_expires_at)
        OR p_expires_at <= v_now
      )
    )
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted provider resolution timestamps are invalid';
  END IF;


  -- =======================================================
  -- Legacy-resolution upgrade
  --
  -- 0026 makes resolution evidence immutable and deliberately
  -- rejects non-exact replay. Therefore a pre-0050 resolution
  -- must NOT be replayed using the new normalization version.
  --
  -- Instead:
  --   * retain the original evidence and resolved location;
  --   * revalidate that mature evidence;
  --   * require the fresh provider observation to be for the
  --     same selected provider identity;
  --   * attach only the missing immutable state evidence.
  -- =======================================================

  SELECT e.*
  INTO v_prior_evidence
  FROM private.movement_location_resolution_evidence e
  WHERE e.producer_request_id
        =p_producer_request_id;

  IF FOUND THEN
    IF
      v_prior_evidence.source_location_reference_id
        IS DISTINCT FROM v_source.id

      OR v_prior_evidence.provider_product
        IS DISTINCT FROM p_provider_product

      OR v_prior_evidence.provider_version
        IS DISTINCT FROM p_provider_version
    THEN
      RAISE EXCEPTION
        USING
          ERRCODE='23514',
          MESSAGE='Existing trusted resolution does not match provider observation';
    END IF;

    -- Uses the mature source -> target lock/validation order
    -- from 0026 and leaves both historical rows unchanged.
    PERFORM
      private.assert_movement_location_resolution_evidence(
        v_prior_evidence.id
      );

    SELECT x.*
    INTO STRICT v_resolved_reference
    FROM private.movement_location_references x
    WHERE x.id
          =v_prior_evidence.resolved_location_reference_id
    FOR SHARE;

    IF
      v_resolved_reference.provider_namespace
        IS DISTINCT FROM p_provider_namespace

      OR v_resolved_reference.provider_place_reference
        IS DISTINCT FROM p_provider_place_reference
    THEN
      RAISE EXCEPTION
        USING
          ERRCODE='23514',
          MESSAGE='Existing trusted resolution provider identity is invalid';
    END IF;

    SELECT x.*
    INTO v_existing
    FROM private.trusted_location_state_evidence x
    WHERE x.resolution_evidence_id
          =v_prior_evidence.id;

    IF FOUND THEN
      IF
        v_existing.resolved_location_reference_id
          IS DISTINCT FROM v_prior_evidence
            .resolved_location_reference_id

        OR v_existing.provider_namespace
          IS DISTINCT FROM p_provider_namespace

        OR v_existing.state_provider_reference
          IS DISTINCT FROM p_state_provider_reference

        OR v_existing.state_name
          IS DISTINCT FROM p_state_name

        OR v_existing.state_key
          IS DISTINCT FROM v_state_key
      THEN
        RAISE EXCEPTION
          USING
            ERRCODE='23514',
            MESSAGE='Trusted state evidence does not match recorded resolution';
      END IF;
    ELSE
      INSERT INTO private.trusted_location_state_evidence(
        resolution_evidence_id,
        resolved_location_reference_id,
        provider_namespace,
        state_provider_reference,
        state_name,
        state_key
      )
      VALUES (
        v_prior_evidence.id,
        v_prior_evidence.resolved_location_reference_id,
        p_provider_namespace,
        p_state_provider_reference,
        p_state_name,
        v_state_key
      );
    END IF;

    PERFORM private.assert_trusted_location_state_evidence(
      v_prior_evidence.id
    );

    RETURN QUERY
    SELECT
      v_prior_evidence.id,
      v_prior_evidence.resolved_location_reference_id,
      v_prior_evidence.version,
      v_resolved_reference.expires_at;

    RETURN;
  END IF;


  -- =======================================================
  -- Brand-new resolution
  --
  -- No prior resolution exists for this stable operation ID.
  -- Delegate creation to the mature 0040 writer, which itself
  -- preserves all 0026 resolution validation and discovery-
  -- area evidence behavior.
  -- =======================================================

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
    p_discovery_area_label,
    p_latitude,
    p_longitude,
    p_resolved_at,
    p_expires_at
  ) r;


  SELECT x.*
  INTO STRICT v_resolved_reference
  FROM private.movement_location_references x
  WHERE x.id=v_resolved_location_reference_id;

  IF
    v_resolved_reference.provider_namespace
      IS DISTINCT FROM p_provider_namespace

    OR v_resolved_reference.provider_place_reference
      IS DISTINCT FROM p_provider_place_reference
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Trusted state provider does not match location resolution provider';
  END IF;


  SELECT x.*
  INTO v_existing
  FROM private.trusted_location_state_evidence x
  WHERE x.resolution_evidence_id=v_evidence_id;

  IF FOUND THEN
    IF
      v_existing.resolved_location_reference_id
        IS DISTINCT FROM v_resolved_location_reference_id

      OR v_existing.provider_namespace
        IS DISTINCT FROM p_provider_namespace

      OR v_existing.state_provider_reference
        IS DISTINCT FROM p_state_provider_reference

      OR v_existing.state_name
        IS DISTINCT FROM p_state_name

      OR v_existing.state_key
        IS DISTINCT FROM v_state_key
    THEN
      RAISE EXCEPTION
        USING
          ERRCODE='23514',
          MESSAGE='Trusted state evidence does not match recorded resolution';
    END IF;
  ELSE
    INSERT INTO private.trusted_location_state_evidence(
      resolution_evidence_id,
      resolved_location_reference_id,
      provider_namespace,
      state_provider_reference,
      state_name,
      state_key
    )
    VALUES (
      v_evidence_id,
      v_resolved_location_reference_id,
      p_provider_namespace,
      p_state_provider_reference,
      p_state_name,
      v_state_key
    );
  END IF;


  PERFORM private.assert_trusted_location_state_evidence(
    v_evidence_id
  );

  RETURN QUERY
  SELECT
    v_evidence_id,
    v_resolved_location_reference_id,
    v_version,
    v_expires_at;
END;
$resolve_with_state$;


REVOKE ALL
ON FUNCTION public.record_attested_location_resolution_for_server(
  uuid,uuid,uuid,
  text,text,text,text,text,text,text,text,
  numeric,numeric,timestamptz,timestamptz
)
FROM PUBLIC,anon,authenticated,service_role;

GRANT EXECUTE
ON FUNCTION public.record_attested_location_resolution_for_server(
  uuid,uuid,uuid,
  text,text,text,text,text,text,text,text,
  numeric,numeric,timestamptz,timestamptz
)
TO service_role;


-- =========================================================
-- Close the old state-less service writer
-- =========================================================

REVOKE ALL
ON FUNCTION public.record_attested_location_resolution_for_server(
  uuid,uuid,uuid,
  text,text,text,text,text,text,
  numeric,numeric,timestamptz,timestamptz
)
FROM PUBLIC,anon,authenticated,service_role;


-- =========================================================
-- State-bound matching assertion
-- =========================================================
--
-- This assertion is intentionally called only after the
-- mature trusted matching-context function has performed its
-- established lock order and live eligibility validation.
--
-- State evidence is immutable and is looked up only by the
-- exact resolved endpoint references already established by
-- that trusted context.
-- =========================================================

CREATE FUNCTION private.assert_state_bound_matching_context(
  p_requester_origin_location_reference_id uuid,
  p_requester_destination_location_reference_id uuid,
  p_route_evidence_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $assert_state_bound_matching_context$
DECLARE
  v_route
    private.offering_route_evidence%ROWTYPE;

  v_requester_origin_state
    private.trusted_location_state_evidence%ROWTYPE;

  v_requester_destination_state
    private.trusted_location_state_evidence%ROWTYPE;

  v_offering_origin_state
    private.trusted_location_state_evidence%ROWTYPE;

  v_offering_destination_state
    private.trusted_location_state_evidence%ROWTYPE;
BEGIN
  IF
    p_requester_origin_location_reference_id IS NULL
    OR p_requester_destination_location_reference_id IS NULL
    OR p_route_evidence_id IS NULL
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='22004',
        MESSAGE='Trusted state-bound matching inputs are required';
  END IF;


  -- The enclosing trusted matching context already selected
  -- and SHARE-locked this exact current route evidence.
  SELECT e.*
  INTO STRICT v_route
  FROM private.offering_route_evidence e
  WHERE e.id=p_route_evidence_id;


  SELECT s.*
  INTO v_requester_origin_state
  FROM private.trusted_location_state_evidence s
  WHERE s.resolved_location_reference_id
        =p_requester_origin_location_reference_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Requester origin trusted state evidence is unavailable';
  END IF;


  SELECT s.*
  INTO v_requester_destination_state
  FROM private.trusted_location_state_evidence s
  WHERE s.resolved_location_reference_id
        =p_requester_destination_location_reference_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Requester destination trusted state evidence is unavailable';
  END IF;


  SELECT s.*
  INTO v_offering_origin_state
  FROM private.trusted_location_state_evidence s
  WHERE s.resolved_location_reference_id
        =v_route.origin_location_reference_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Offering origin trusted state evidence is unavailable';
  END IF;


  SELECT s.*
  INTO v_offering_destination_state
  FROM private.trusted_location_state_evidence s
  WHERE s.resolved_location_reference_id
        =v_route.destination_location_reference_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Offering destination trusted state evidence is unavailable';
  END IF;


  PERFORM private.assert_trusted_location_state_evidence(
    v_requester_origin_state.resolution_evidence_id
  );

  PERFORM private.assert_trusted_location_state_evidence(
    v_requester_destination_state.resolution_evidence_id
  );

  PERFORM private.assert_trusted_location_state_evidence(
    v_offering_origin_state.resolution_evidence_id
  );

  PERFORM private.assert_trusted_location_state_evidence(
    v_offering_destination_state.resolution_evidence_id
  );


  -- =======================================================
  -- Requester movement must itself be state-contained.
  -- =======================================================

  IF
    v_requester_origin_state.provider_namespace
      IS DISTINCT FROM
        v_requester_destination_state.provider_namespace

    OR v_requester_origin_state.state_provider_reference
      IS DISTINCT FROM
        v_requester_destination_state.state_provider_reference

    OR v_requester_origin_state.state_key
      IS DISTINCT FROM
        v_requester_destination_state.state_key
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Requester movement crosses a state boundary';
  END IF;


  -- =======================================================
  -- Offered movement must itself be state-contained.
  -- =======================================================

  IF
    v_offering_origin_state.provider_namespace
      IS DISTINCT FROM
        v_offering_destination_state.provider_namespace

    OR v_offering_origin_state.state_provider_reference
      IS DISTINCT FROM
        v_offering_destination_state.state_provider_reference

    OR v_offering_origin_state.state_key
      IS DISTINCT FROM
        v_offering_destination_state.state_key
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Offered movement crosses a state boundary';
  END IF;


  -- =======================================================
  -- Both sides of this connection must be in the same state.
  -- =======================================================

  IF
    v_requester_origin_state.provider_namespace
      IS DISTINCT FROM
        v_offering_origin_state.provider_namespace

    OR v_requester_origin_state.state_provider_reference
      IS DISTINCT FROM
        v_offering_origin_state.state_provider_reference

    OR v_requester_origin_state.state_key
      IS DISTINCT FROM
        v_offering_origin_state.state_key
  THEN
    RAISE EXCEPTION
      USING
        ERRCODE='23514',
        MESSAGE='Requester and offered movements are in different states';
  END IF;
END;
$assert_state_bound_matching_context$;

REVOKE ALL
ON FUNCTION private.assert_state_bound_matching_context(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC,anon,authenticated,service_role;


-- =========================================================
-- Preserve 0036 function identity and add hard state gate
-- =========================================================
--
-- PostgreSQL function dependencies are bound to function OIDs.
-- Therefore the existing public 0036 function must remain the
-- same database object. CREATE OR REPLACE changes its body
-- without moving, renaming or replacing its identity.
--
-- The mature 0036 lock order and validation semantics remain
-- unchanged:
--
--   movement need
--   -> requester endpoints
--   -> offering intent
--   -> current route evidence
--
-- Only after all existing trusted-context validation succeeds
-- do we enforce the immutable trusted state boundary.
-- =========================================================

CREATE OR REPLACE FUNCTION
public.get_trusted_matching_context_for_server(
  p_movement_need_id uuid,
  p_offering_movement_intent_id uuid,
  p_offering_member_id uuid
)
RETURNS TABLE (
  movement_need_id uuid,
  requesting_member_id uuid,

  requester_origin_location_reference_id uuid,
  requester_origin_latitude numeric,
  requester_origin_longitude numeric,

  requester_destination_location_reference_id uuid,
  requester_destination_latitude numeric,
  requester_destination_longitude numeric,

  requester_earliest_departure_at timestamptz,
  requester_latest_departure_at timestamptz,

  offering_movement_intent_id uuid,
  offering_member_id uuid,
  offering_intent_version integer,

  offering_earliest_departure_at timestamptz,
  offering_latest_departure_at timestamptz,

  route_evidence_id uuid,
  route_evidence_version integer,
  route_shape_format text,
  route_shape jsonb,
  route_distance_meters bigint,
  route_duration_seconds bigint,
  route_generated_at timestamptz,
  route_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trusted_matching_context$
DECLARE
  v_need public.movement_needs%ROWTYPE;

  v_requester_origin_id uuid;
  v_requester_destination_id uuid;

  v_requester_origin
    private.movement_location_references%ROWTYPE;

  v_requester_destination
    private.movement_location_references%ROWTYPE;

  v_intent
    private.offering_movement_intents%ROWTYPE;

  v_evidence
    private.offering_route_evidence%ROWTYPE;

  v_now timestamptz;
BEGIN
  IF current_setting('transaction_isolation')
       <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Trusted matching context requires READ COMMITTED';
  END IF;


  -- =======================================================
  -- Required identities
  -- =======================================================

  IF p_movement_need_id IS NULL
     OR p_offering_movement_intent_id IS NULL
     OR p_offering_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE =
        'Movement need, offering intent and offering member are required';
  END IF;


  -- =======================================================
  -- Requester movement need
  --
  -- Lock the need first. Future matching/materialization
  -- writers must preserve this lock order.
  -- =======================================================

  SELECT n.*
  INTO v_need
  FROM public.movement_needs n
  WHERE n.id = p_movement_need_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Movement need not found';
  END IF;

  IF v_need.status <> 'discoverable' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need is not available for matching';
  END IF;

  IF v_need.member_id = p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering member cannot match their own movement need';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.alignments a
    WHERE a.movement_need_id = v_need.id
      AND a.status IN (
        'awaiting_activation_payment',
        'activated',
        'in_progress',
        'completed'
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need already has an active or completed alignment';
  END IF;


  -- =======================================================
  -- Trusted requester endpoint bindings
  -- =======================================================

  SELECT l.location_reference_id
  INTO v_requester_origin_id
  FROM private.movement_need_locations l
  WHERE l.movement_need_id = v_need.id
    AND l.role = 'origin';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted origin is unavailable';
  END IF;


  SELECT l.location_reference_id
  INTO v_requester_destination_id
  FROM private.movement_need_locations l
  WHERE l.movement_need_id = v_need.id
    AND l.role = 'destination';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted destination is unavailable';
  END IF;


  IF v_requester_origin_id
       = v_requester_destination_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoints must be distinct';
  END IF;


  IF (
    SELECT count(*)
    FROM private.movement_need_locations l
    WHERE l.movement_need_id = v_need.id
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need must have exactly two trusted endpoints';
  END IF;


  SELECT lr.*
  INTO STRICT v_requester_origin
  FROM private.movement_location_references lr
  WHERE lr.id = v_requester_origin_id
  FOR SHARE;


  SELECT lr.*
  INTO STRICT v_requester_destination
  FROM private.movement_location_references lr
  WHERE lr.id = v_requester_destination_id
  FOR SHARE;


  v_now := clock_timestamp();

  IF v_requester_origin.owner_member_id
       <> v_need.member_id
     OR v_requester_destination.owner_member_id
       <> v_need.member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoint ownership is invalid';
  END IF;


  IF v_requester_origin.resolution_status
       <> 'resolved'
     OR v_requester_destination.resolution_status
       <> 'resolved'
     OR v_requester_origin.source_kind
       <> 'provider_resolved'
     OR v_requester_destination.source_kind
       <> 'provider_resolved' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need requires resolved provider endpoints';
  END IF;


  IF v_requester_origin.latitude IS NULL
     OR v_requester_origin.longitude IS NULL
     OR v_requester_destination.latitude IS NULL
     OR v_requester_destination.longitude IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted coordinates are incomplete';
  END IF;


  IF NOT (
       v_requester_origin.latitude BETWEEN -90 AND 90
     )
     OR NOT (
       v_requester_origin.longitude BETWEEN -180 AND 180
     )
     OR NOT (
       v_requester_destination.latitude BETWEEN -90 AND 90
     )
     OR NOT (
       v_requester_destination.longitude BETWEEN -180 AND 180
     )
     OR v_requester_origin.latitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_origin.longitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_destination.latitude::text
       IN ('NaN', 'Infinity', '-Infinity')
     OR v_requester_destination.longitude::text
       IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted coordinates are invalid';
  END IF;


  IF (
       v_requester_origin.expires_at IS NOT NULL
       AND v_requester_origin.expires_at <= v_now
     )
     OR (
       v_requester_destination.expires_at IS NOT NULL
       AND v_requester_destination.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Movement need trusted endpoint has expired';
  END IF;


  -- =======================================================
  -- Offerer's independently established movement intent
  -- =======================================================

  SELECT i.*
  INTO v_intent
  FROM private.offering_movement_intents i
  WHERE i.id = p_offering_movement_intent_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE =
        'Offering movement intent not found';
  END IF;


  IF v_intent.offering_member_id
       <> p_offering_member_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE =
        'Offering movement intent does not belong to member';
  END IF;


  v_now := clock_timestamp();

  IF v_intent.status <> 'current'
     OR (
       v_intent.expires_at IS NOT NULL
       AND v_intent.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering movement intent is not current and unexpired';
  END IF;


  PERFORM
    private.assert_offering_movement_intent(
      v_intent.id
    );


  -- =======================================================
  -- Exact current trusted route evidence
  --
  -- This is selected only after the offering-intent lock.
  -- The route producer uses the intent as its serialization
  -- boundary, so a competing route replacement cannot race
  -- this context read.
  -- =======================================================

  SELECT e.*
  INTO v_evidence
  FROM private.offering_route_evidence e
  WHERE e.offering_movement_intent_id
          = v_intent.id
    AND e.status = 'current'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Current trusted offering route evidence is unavailable';
  END IF;


  v_now := clock_timestamp();

  IF v_evidence.offering_member_id
       <> p_offering_member_id
     OR v_evidence.status <> 'current'
     OR (
       v_evidence.expires_at IS NOT NULL
       AND v_evidence.expires_at <= v_now
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence is not eligible for matching';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM private.offering_movement_intent_locations il
    WHERE il.intent_id = v_intent.id
      AND il.role = 'origin'
      AND il.location_reference_id
            = v_evidence.origin_location_reference_id
  )
  OR NOT EXISTS (
    SELECT 1
    FROM private.offering_movement_intent_locations il
    WHERE il.intent_id = v_intent.id
      AND il.role = 'destination'
      AND il.location_reference_id
            = v_evidence.destination_location_reference_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints do not match intent';
  END IF;


  IF EXISTS (
    SELECT 1
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      v_evidence.origin_location_reference_id,
      v_evidence.destination_location_reference_id
    )
      AND (
        lr.owner_member_id <> p_offering_member_id
        OR lr.resolution_status <> 'resolved'
        OR lr.source_kind <> 'provider_resolved'
        OR lr.latitude IS NULL
        OR lr.longitude IS NULL
        OR (
          lr.expires_at IS NOT NULL
          AND lr.expires_at <= v_now
        )
      )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints are not eligible for matching';
  END IF;


  IF (
    SELECT count(*)
    FROM private.movement_location_references lr
    WHERE lr.id IN (
      v_evidence.origin_location_reference_id,
      v_evidence.destination_location_reference_id
    )
  ) <> 2 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence endpoints are unavailable';
  END IF;


  IF v_evidence.route_shape_format
       <> 'geojson_linestring_v1' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence shape format is unsupported';
  END IF;


  PERFORM
    private.assert_geojson_linestring_v1(
      v_evidence.route_shape
    );


  IF v_evidence.route_distance_meters <= 0
     OR v_evidence.route_duration_seconds <= 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Offering route evidence distance or duration is invalid';
  END IF;


  -- =======================================================
  -- Hard state-bound matching invariant
  --
  -- This runs only after the mature trusted-context checks
  -- above have succeeded and while their locks remain held.
  -- =======================================================

  PERFORM private.assert_state_bound_matching_context(
    v_requester_origin.id,
    v_requester_destination.id,
    v_evidence.id
  );


  -- =======================================================
  -- Return private matching inputs only to the trusted
  -- server caller.
  -- =======================================================

  RETURN QUERY
  SELECT
    v_need.id,
    v_need.member_id,

    v_requester_origin.id,
    v_requester_origin.latitude,
    v_requester_origin.longitude,

    v_requester_destination.id,
    v_requester_destination.latitude,
    v_requester_destination.longitude,

    v_need.earliest_departure_at,
    v_need.latest_departure_at,

    v_intent.id,
    v_intent.offering_member_id,
    v_intent.version,

    v_intent.earliest_departure_at,
    v_intent.latest_departure_at,

    v_evidence.id,
    v_evidence.version,
    v_evidence.route_shape_format,
    v_evidence.route_shape,
    v_evidence.route_distance_meters,
    v_evidence.route_duration_seconds,
    v_evidence.generated_at,
    v_evidence.expires_at;
END;
$trusted_matching_context$;


REVOKE ALL
ON FUNCTION
public.get_trusted_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
FROM PUBLIC, anon, authenticated, service_role;


GRANT EXECUTE
ON FUNCTION
public.get_trusted_matching_context_for_server(
  uuid,
  uuid,
  uuid
)
TO service_role;


COMMIT;