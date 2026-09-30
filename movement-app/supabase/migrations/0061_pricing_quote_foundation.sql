BEGIN;

-- WE DO NOT CREATE JOURNEYS. Opaque quote history, not a pricing engine.
CREATE TABLE private.pricing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL CHECK (version>=1),
  pricing_geography_evidence_id uuid NOT NULL REFERENCES private.pricing_geography_evidence(id),
  pricing_geography_evidence_version integer NOT NULL CHECK (pricing_geography_evidence_version>=1),
  -- No need FK: declaration deletion cannot remove historical quote facts.
  movement_need_id uuid NOT NULL,
  requesting_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_member_id uuid NOT NULL REFERENCES public.members(id),
  offering_movement_intent_id uuid NOT NULL,
  offering_intent_version integer NOT NULL CHECK (offering_intent_version>=1),
  state_location_reference_id uuid NOT NULL,
  pricing_policy_version text NOT NULL CHECK (
    length(pricing_policy_version) BETWEEN 1 AND 100
    AND pricing_policy_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]*$'),
  currency text NOT NULL CHECK (currency='NGN'),
  seat_price_minor bigint NOT NULL CHECK (seat_price_minor>=0),
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at)),
  CHECK (requesting_member_id<>offering_member_id),
  CHECK (expires_at>created_at),
  UNIQUE (movement_need_id,offering_movement_intent_id,version)
);
CREATE UNIQUE INDEX pricing_quotes_one_current
  ON private.pricing_quotes(movement_need_id,offering_movement_intent_id) WHERE status='current';
ALTER TABLE private.pricing_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.pricing_quotes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON private.pricing_quotes TO service_role;

-- Canonical copied bindings are validated, never silently repaired/rebound.
-- The exact evidence FK and this assertion also protect the copied intent/state
-- identities without acquiring their FK locks before canonical validation.
CREATE FUNCTION private.assert_pricing_quote_context(p private.pricing_quotes)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
    OR p.created_at<e.created_at OR p.created_at>clock_timestamp()
    OR p.expires_at IS NULL OR NOT isfinite(p.expires_at)
    OR p.expires_at<=p.created_at OR p.expires_at<=clock_timestamp() OR p.expires_at>e.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote lifecycle or evidence-bounded timestamps invalid';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_pricing_quote_context(private.pricing_quotes)
  FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.assert_pricing_quote(p_quote_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE q private.pricing_quotes%ROWTYPE;
BEGIN
  SELECT x.* INTO STRICT q FROM private.pricing_quotes x WHERE x.id=p_quote_id;
  PERFORM private.assert_pricing_quote_context(q);
  SELECT x.* INTO STRICT q FROM private.pricing_quotes x WHERE x.id=p_quote_id FOR SHARE;
  -- Re-read lifecycle and recheck time/source after any quote-row lock wait.
  PERFORM private.assert_pricing_quote_context(q);
END;
$$;
REVOKE ALL ON FUNCTION private.assert_pricing_quote(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.protect_pricing_quote()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE next_version bigint;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing quote history cannot be removed';
  END IF;
  IF TG_OP='INSERT' THEN
    -- BEFORE validation precedes FK locks. Inherited need UPDATE lock serializes
    -- the same canonical need/intent history as 0059, including manual inserts.
    PERFORM private.assert_pricing_quote_context(NEW);
    SELECT coalesce(max(x.version)::bigint,0)+1 INTO next_version FROM private.pricing_quotes x
      WHERE x.movement_need_id=NEW.movement_need_id
        AND x.offering_movement_intent_id=NEW.offering_movement_intent_id;
    IF NEW.version IS DISTINCT FROM next_version THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quote version must be the next canonical history version';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Pricing quote facts are immutable';
  END IF;
  IF OLD.status IS DISTINCT FROM 'current' OR NEW.status IS DISTINCT FROM 'superseded' THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Only current to superseded quote transition is permitted';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.protect_pricing_quote() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_pricing_quote BEFORE INSERT OR UPDATE ON private.pricing_quotes
  FOR EACH ROW EXECUTE FUNCTION private.protect_pricing_quote();
-- Statement-level guard also rejects DELETE WHERE false and empty-table removal.
CREATE TRIGGER prevent_pricing_quote_removal BEFORE DELETE OR TRUNCATE ON private.pricing_quotes
  FOR EACH STATEMENT EXECUTE FUNCTION private.protect_pricing_quote();

COMMIT;
