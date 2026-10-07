BEGIN;

-- WE DO NOT CREATE JOURNEYS. Eligible incoming offers rise; people choose.
CREATE OR REPLACE FUNCTION public.discover_masked_offers_for_my_need(
  p_movement_need_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  movement_offer_id uuid,
  seats_offered integer,
  estimated_arrival_minutes integer,
  offer_status text,
  offer_created_at timestamptz,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text,
  vehicle_seat_capacity integer,
  age integer,
  common_movement_area text,
  identity_verified boolean,
  profile_media_verified boolean,
  completed_movements integer,
  rating numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $requester_priority$
DECLARE
 v_member_id uuid:=auth.uid();
 v_candidate record;
 v_visible boolean;
 v_now timestamptz;
 v_score numeric;
 v_rows jsonb:='[]'::jsonb;
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Requester offer discovery requires READ COMMITTED'; END IF;
 IF v_member_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.members m WHERE m.id=v_member_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authenticated member required'; END IF;
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Discovery limit must be between 1 and 50'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.movement_needs n WHERE n.id=p_movement_need_id AND n.member_id=v_member_id) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Movement need unavailable'; END IF;
 v_now:=clock_timestamp();

 -- All history/rating aggregates share this cursor SELECT snapshot. Traversal
 -- is deterministic, but no preliminary candidate is trusted as eligible.
 <<candidates>>
 FOR v_candidate IN
  SELECT mo.id,
   (SELECT count(*) FROM private.completed_movement_principals p WHERE p.member_id=mo.offering_member_id) AS completed,
   (SELECT coalesce(sum(r.stars::numeric),0) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=mo.offering_member_id) AS rating_sum,
   (SELECT count(*) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=mo.offering_member_id) AS rating_count
  FROM public.movement_offers mo
  WHERE mo.movement_need_id=p_movement_need_id AND mo.status='pending'
  ORDER BY mo.created_at ASC,mo.id ASC
 LOOP
  v_visible:=false;
  BEGIN
   BEGIN
    PERFORM private.assert_movement_offer_availability_binding(v_candidate.id);
   EXCEPTION
    WHEN check_violation THEN
     -- Only audited live eligibility failures are ordinary candidate staleness.
     -- Missing immutable receipts and all other integrity errors must escape.
     IF SQLERRM IN(
      'Insufficient eligible availability for the complete requester group',
      'Trusted route-match evidence is not current and unexpired',
      'Movement need is not available for matching',
      'Movement need already has an active or completed alignment',
      'Offering movement intent is not current and unexpired',
      'Offering intent is not current and unexpired',
      'Current trusted offering route evidence is unavailable',
      'Offering route evidence is not current and unexpired',
      'Availability requires active vehicle access and sufficient capacity',
      'Availability is not open and eligible'
     ) THEN CONTINUE candidates; END IF;
     RAISE;
    WHEN raise_exception THEN
     IF SQLERRM IN('Movement need not found','Movement offer not found',
      'Offering movement availability not found','Offering movement intent not found',
      'Movement offer is not pending','Movement need is not discoverable') THEN CONTINUE candidates; END IF;
     RAISE;
    WHEN insufficient_privilege THEN
     IF SQLERRM IN('Verified member does not own this movement need',
      'Offering movement intent does not belong to member') THEN CONTINUE candidates; END IF;
     RAISE;
   END;
  SELECT
    mo.id AS movement_offer_id,
    mo.seats_offered,
    mo.estimated_arrival_minutes,
    mo.status AS offer_status,
    mo.created_at AS offer_created_at,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    v.year AS vehicle_year,
    v.color AS vehicle_color,
    v.seat_capacity AS vehicle_seat_capacity,
    CASE
      WHEN m.date_of_birth IS NOT NULL THEN
        EXTRACT(YEAR FROM age(CURRENT_DATE, m.date_of_birth))::integer
      ELSE NULL
    END AS age,
    m.common_movement_area,
    m.identity_verified,
    m.profile_media_verified,
    m.completed_movements,
    m.rating
  INTO movement_offer_id,seats_offered,estimated_arrival_minutes,offer_status,offer_created_at,
    vehicle_make,vehicle_model,vehicle_year,vehicle_color,vehicle_seat_capacity,age,
    common_movement_area,identity_verified,profile_media_verified,completed_movements,rating
  FROM public.movement_offers AS mo
  INNER JOIN public.vehicles AS v
    ON v.id = mo.vehicle_id
  INNER JOIN public.members AS m
    ON m.id = mo.offering_member_id
  WHERE mo.movement_need_id = p_movement_need_id
    AND mo.status = 'pending'
    AND mo.id=v_candidate.id
    AND EXISTS(SELECT 1 FROM public.movement_needs n WHERE n.id=mo.movement_need_id AND n.member_id=v_member_id);

   v_visible:=FOUND;
   IF v_visible THEN
    v_score:=private.movement_priority_v1(v_candidate.completed,v_candidate.rating_sum,
     v_candidate.rating_count,greatest(0::numeric,extract(epoch FROM (v_now-offer_created_at))/60),
     'requester_initiated_v1');
   END IF;
   -- As in 0089, rollback releases this candidate's validation locks. Local
   -- projected values/score survive. ZX090 is a private control signal only.
   RAISE SQLSTATE 'ZX090' USING MESSAGE='Release requester discovery candidate locks';
  EXCEPTION WHEN SQLSTATE 'ZX090' THEN NULL;
  END;
  IF v_visible THEN
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('movement_offer_id',movement_offer_id,'seats_offered',seats_offered,'estimated_arrival_minutes',estimated_arrival_minutes,'offer_status',offer_status,'offer_created_at',offer_created_at,'vehicle_make',vehicle_make,'vehicle_model',vehicle_model,'vehicle_year',vehicle_year,'vehicle_color',vehicle_color,'vehicle_seat_capacity',vehicle_seat_capacity,'age',age,'common_movement_area',common_movement_area,'identity_verified',identity_verified,'profile_media_verified',profile_media_verified,'completed_movements',completed_movements,'rating',rating,'priority',v_score));
  END IF;
 END LOOP candidates;
 RETURN QUERY SELECT x.movement_offer_id,x.seats_offered,x.estimated_arrival_minutes,x.offer_status,x.offer_created_at,x.vehicle_make,x.vehicle_model,x.vehicle_year,x.vehicle_color,x.vehicle_seat_capacity,x.age,x.common_movement_area,x.identity_verified,x.profile_media_verified,x.completed_movements,x.rating
 FROM jsonb_to_recordset(v_rows) AS x(movement_offer_id uuid,seats_offered integer,estimated_arrival_minutes integer,offer_status text,offer_created_at timestamptz,vehicle_make text,vehicle_model text,vehicle_year integer,vehicle_color text,vehicle_seat_capacity integer,age integer,common_movement_area text,identity_verified boolean,profile_media_verified boolean,completed_movements integer,rating numeric,priority numeric)
 ORDER BY x.priority DESC,x.offer_created_at ASC,x.movement_offer_id ASC LIMIT p_limit;
END;
$requester_priority$;
REVOKE ALL ON FUNCTION public.discover_masked_offers_for_my_need(uuid,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.discover_masked_offers_for_my_need(uuid,integer) TO authenticated;
COMMIT;
