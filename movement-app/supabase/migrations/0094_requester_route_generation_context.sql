BEGIN;

-- Private automotive-road-network reference geometry supports compatibility;
-- it does not prove intended driving or make non-overlap an incompatibility.
-- Read-only server context. Discoverability scheduling stays outside evidence.
CREATE FUNCTION public.get_claimed_requester_route_generation_context_for_server(
  p_movement_need_id uuid, p_requesting_member_id uuid, p_generation_claim_token uuid
)
RETURNS TABLE (
  movement_need_id uuid, requesting_member_id uuid,
  origin_location_reference_id uuid, origin_latitude numeric, origin_longitude numeric,
  destination_location_reference_id uuid, destination_latitude numeric, destination_longitude numeric,
  evidence_schema_version text, route_shape_format text,
  provider_namespace text, provider_product text, provider_version text,
  claimed_at timestamptz, lease_expires_at timestamptz, server_observed_at timestamptz,
  earliest_generated_at timestamptz, movement_need_deadline timestamptz, evidence_expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  ctx record; c private.requester_route_generation_claims%ROWTYPE;
  n public.movement_needs%ROWTYPE;
  o private.movement_location_references%ROWTYPE; d private.movement_location_references%ROWTYPE;
  stamp timestamptz; deadline timestamptz; horizon timestamptz;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000', MESSAGE='Requester generation context requires READ COMMITTED';
  END IF;
  -- This locks need, bindings and resolved references in the established order.
  SELECT * INTO STRICT ctx FROM private.lock_requester_route_generation_context(p_movement_need_id,p_requesting_member_id);
  SELECT x.* INTO c FROM private.requester_route_generation_claims x
    WHERE x.movement_need_id=p_movement_need_id FOR UPDATE;
  IF NOT FOUND OR p_generation_claim_token IS NULL OR c.claim_token IS DISTINCT FROM p_generation_claim_token
    OR c.requesting_member_id IS DISTINCT FROM p_requesting_member_id
    OR c.completed_at IS NOT NULL
    OR ROW(c.origin_location_reference_id,c.destination_location_reference_id) IS DISTINCT FROM ROW(ctx.origin_id,ctx.destination_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Requester generation context claim unavailable';
  END IF;
  PERFORM private.validate_requester_generation_contract(c.provider_namespace,c.provider_product,c.provider_version,c.evidence_schema_version,c.route_shape_format);
  SELECT x.* INTO STRICT n FROM public.movement_needs x WHERE x.id=p_movement_need_id;
  SELECT x.* INTO STRICT o FROM private.movement_location_references x WHERE x.id=ctx.origin_id;
  SELECT x.* INTO STRICT d FROM private.movement_location_references x WHERE x.id=ctx.destination_id;
  -- Exact 0051/0052 effective departure deadline, not a route TTL or status gate.
  deadline:=COALESCE(n.latest_departure_at,n.earliest_departure_at);
  horizon:=LEAST(o.expires_at,d.expires_at,deadline);
  stamp:=clock_timestamp();
  IF c.lease_expires_at<=stamp OR deadline IS NULL OR NOT isfinite(deadline) OR deadline<=stamp
    OR horizon IS NULL OR NOT isfinite(horizon) OR horizon<=stamp THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Requester generation context deadline elapsed';
  END IF;
  RETURN QUERY SELECT n.id,n.member_id,o.id,o.latitude,o.longitude,d.id,d.latitude,d.longitude,
    c.evidence_schema_version,c.route_shape_format,c.provider_namespace,c.provider_product,c.provider_version,
    c.claimed_at,c.lease_expires_at,stamp,GREATEST(n.created_at,o.resolved_at,d.resolved_at,c.claimed_at),deadline,horizon;
END;
$$;
REVOKE ALL ON FUNCTION public.get_claimed_requester_route_generation_context_for_server(uuid,uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_claimed_requester_route_generation_context_for_server(uuid,uuid,uuid) TO service_role;

COMMIT;
