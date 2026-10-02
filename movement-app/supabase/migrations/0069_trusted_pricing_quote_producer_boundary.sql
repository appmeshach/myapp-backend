BEGIN;

-- Record an exact trusted-server result, not an economically approved formula.
-- WE DO NOT CREATE JOURNEYS. No operational or financial cutover occurs here.
CREATE FUNCTION public.record_pricing_quote_for_server(
  p_pricing_geography_evidence_id uuid,
  p_expected_pricing_geography_evidence_version integer,
  p_pricing_policy_version text,
  p_seat_price_minor numeric
)
RETURNS TABLE (
  quote_id uuid,
  quote_version integer,
  quote_created_at timestamptz,
  quote_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  e private.pricing_geography_evidence%ROWTYPE;
  q private.pricing_quotes%ROWTYPE;
  previous private.pricing_quotes%ROWTYPE;
  replay_count bigint;
  next_version bigint;
BEGIN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Pricing quote producer requires READ COMMITTED';
  END IF;
  IF p_pricing_geography_evidence_id IS NULL
    OR p_expected_pricing_geography_evidence_version IS NULL
    OR p_pricing_policy_version IS NULL OR p_seat_price_minor IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete trusted pricing quote result required';
  END IF;
  -- Numeric input is exact: reject fractions before bigint conversion. Callers
  -- must preserve decimal precision in transport; never pass a JS float price.
  IF p_expected_pricing_geography_evidence_version < 1
    OR p_pricing_policy_version <> 'trusted_server_result_infrastructure_v1'
    OR p_seat_price_minor::text IN ('NaN','Infinity','-Infinity')
    OR p_seat_price_minor <= 0 OR p_seat_price_minor > 9223372036854775807::numeric
    OR p_seat_price_minor <> trunc(p_seat_price_minor) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Unsupported policy or invalid trusted quote input';
  END IF;

  -- Preliminary read discovers immutable bindings only; take no quote lock.
  SELECT x.* INTO e FROM private.pricing_geography_evidence x
  WHERE x.id=p_pricing_geography_evidence_id;
  IF NOT FOUND OR e.version IS DISTINCT FROM p_expected_pricing_geography_evidence_version THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Exact pricing geography evidence unavailable';
  END IF;
  q.pricing_geography_evidence_id:=e.id;
  q.pricing_geography_evidence_version:=e.version;
  q.movement_need_id:=e.movement_need_id;
  q.requesting_member_id:=e.requesting_member_id;
  q.offering_member_id:=e.offering_member_id;
  q.offering_movement_intent_id:=e.offering_movement_intent_id;
  q.offering_intent_version:=e.offering_intent_version;
  q.state_location_reference_id:=e.state_location_reference_id;
  q.pricing_policy_version:=p_pricing_policy_version;
  q.currency:='NGN';
  q.seat_price_minor:=p_seat_price_minor::bigint;
  q.status:='current';
  q.created_at:=clock_timestamp();
  q.expires_at:=e.expires_at;

  -- 0061 delegates to 0059: need UPDATE -> requester endpoints -> intent ->
  -- route -> match -> geography SHARE. The need also serializes empty history.
  PERFORM private.assert_pricing_quote_context(q);
  PERFORM x.id FROM private.pricing_quotes x
  WHERE x.movement_need_id=q.movement_need_id
    AND x.offering_movement_intent_id=q.offering_movement_intent_id
  ORDER BY x.version FOR UPDATE;
  -- Fresh lifecycle and clock checks after any history lock wait.
  PERFORM private.assert_pricing_quote_context(q);

  SELECT count(*) INTO replay_count FROM private.pricing_quotes x
  WHERE x.pricing_geography_evidence_id=e.id
    AND x.pricing_geography_evidence_version=e.version
    AND x.pricing_policy_version=p_pricing_policy_version;
  IF replay_count > 1 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Ambiguous pricing quote replay history';
  END IF;
  IF replay_count = 1 THEN
    SELECT x.* INTO STRICT previous FROM private.pricing_quotes x
    WHERE x.pricing_geography_evidence_id=e.id
      AND x.pricing_geography_evidence_version=e.version
      AND x.pricing_policy_version=p_pricing_policy_version;
    IF (to_jsonb(previous)-ARRAY['id','version','created_at','expires_at','status'])
      IS DISTINCT FROM (to_jsonb(q)-ARRAY['id','version','created_at','expires_at','status']) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Pricing quote replay payload mismatch';
    END IF;
    PERFORM private.assert_pricing_quote(previous.id);
    RETURN QUERY SELECT previous.id,previous.version,previous.created_at,previous.expires_at;
    RETURN;
  END IF;

  SELECT coalesce(max(x.version)::bigint,0)+1 INTO next_version
  FROM private.pricing_quotes x WHERE x.movement_need_id=q.movement_need_id
    AND x.offering_movement_intent_id=q.offering_movement_intent_id;
  IF next_version > 2147483647 THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Pricing quote version exhausted';
  END IF;
  q.id:=gen_random_uuid();
  q.version:=next_version::integer;
  q.created_at:=clock_timestamp();
  PERFORM private.assert_pricing_quote_context(q);
  UPDATE private.pricing_quotes x SET status='superseded'
  WHERE x.movement_need_id=q.movement_need_id
    AND x.offering_movement_intent_id=q.offering_movement_intent_id AND x.status='current';
  INSERT INTO private.pricing_quotes SELECT q.*;
  PERFORM private.assert_pricing_quote(q.id);
  RETURN QUERY SELECT q.id,q.version,q.created_at,q.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pricing_quote_for_server(uuid,integer,text,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_pricing_quote_for_server(uuid,integer,text,numeric)
  TO service_role;

COMMIT;
