BEGIN;

-- WE DO NOT CREATE JOURNEYS. Pure arithmetic; no movement or money is written.
CREATE FUNCTION private.calculate_financial_proposal_economics(
  p_seat_price_minor bigint,
  p_people_count integer,
  p_financial_model_version text,
  p_platform_fee_allocation_policy_version text
)
RETURNS TABLE (
  gross_requester_total_minor bigint,
  quoted_platform_fee_total_minor bigint,
  offering_platform_share_minor bigint,
  requester_platform_share_minor bigint,
  quoted_movement_contribution_minor bigint,
  offering_final_net_minor bigint
)
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g numeric; f numeric; o numeric; r numeric; c numeric; net numeric;
  amount numeric;
BEGIN
  IF p_seat_price_minor IS NULL OR p_people_count IS NULL
    OR p_financial_model_version IS NULL OR p_platform_fee_allocation_policy_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22004', MESSAGE='Complete economic inputs and policy identities required';
  END IF;
  IF p_seat_price_minor<=0 OR p_people_count<=0
    OR p_financial_model_version<>'shared_platform_fee_v1'
    OR p_platform_fee_allocation_policy_version<>'equal_split_requester_remainder_v1' THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Positive occupied-seat inputs and supported economic policies required';
  END IF;

  -- Cast BEFORE multiplication. Displayed price is the complete per-seat amount.
  g:=p_seat_price_minor::numeric * p_people_count::numeric;
  -- Exact nonnegative HALF-UP: floor((3*G+5)/10). div avoids division rounding.
  f:=div(g*3+5,10);
  -- Preserve 0020's floor/remainder split; no independent percentage rounding.
  o:=div(f,2);
  r:=f-o;
  c:=g-r;
  net:=c-o;

  -- Check every output before any narrowing cast; zero components are valid.
  FOREACH amount IN ARRAY ARRAY[g,f,o,r,c,net] LOOP
    IF amount<0 OR amount>9223372036854775807::numeric THEN
      RAISE EXCEPTION USING ERRCODE='22003', MESSAGE='Financial economic output exceeds bigint range';
    END IF;
  END LOOP;
  RETURN QUERY SELECT g::bigint,f::bigint,o::bigint,r::bigint,c::bigint,net::bigint;
END;
$$;
REVOKE ALL ON FUNCTION private.calculate_financial_proposal_economics(bigint,integer,text,text)
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
