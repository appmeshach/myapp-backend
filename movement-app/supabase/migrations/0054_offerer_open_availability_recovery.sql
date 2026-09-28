BEGIN;

-- WE DO NOT CREATE JOURNEYS. Recover only independently declared availability.
CREATE FUNCTION public.list_my_open_offering_movement_availabilities(
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  availability_id uuid,
  offering_movement_intent_id uuid,
  vehicle_id uuid,
  total_places integer,
  remaining_places integer,
  expires_at timestamptz,
  origin_area text,
  destination_area text,
  earliest_departure_at timestamptz,
  latest_departure_at timestamptz,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_color text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $recovery$
DECLARE
  v_member_id uuid := auth.uid();
  v_candidate record;
  v_visible boolean;
  v_returned integer := 0;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = '25000', MESSAGE = 'Availability recovery requires READ COMMITTED';
  END IF;
  IF v_member_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.members m WHERE m.id = v_member_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated member required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Recovery limit must be between 1 and 50';
  END IF;

  <<candidates>>
  FOR v_candidate IN
    SELECT a.id
    FROM private.offering_movement_availability a
    JOIN private.offering_movement_intents i ON i.id = a.offering_movement_intent_id
    WHERE a.offering_member_id = v_member_id
    ORDER BY i.earliest_departure_at ASC, a.created_at ASC, a.id ASC
  LOOP
    v_visible := false;
    BEGIN
      -- Only eligibility failures from the existing assertion are skippable.
      -- Projection errors, deadlocks, cancellations and other SQL errors escape.
      BEGIN
        PERFORM private.assert_offering_movement_availability(v_candidate.id);
      EXCEPTION WHEN check_violation OR no_data_found THEN
        CONTINUE candidates;
      END;

      SELECT a.id, a.offering_movement_intent_id, a.vehicle_id,
        a.total_places, a.remaining_places, a.expires_at,
        od.discovery_area_label, dd.discovery_area_label,
        i.earliest_departure_at, i.latest_departure_at,
        v.make, v.model, v.year, v.color
      INTO availability_id, offering_movement_intent_id, vehicle_id,
        total_places, remaining_places, expires_at, origin_area, destination_area,
        earliest_departure_at, latest_departure_at,
        vehicle_make, vehicle_model, vehicle_year, vehicle_color
      FROM private.offering_movement_availability a
      JOIN private.offering_movement_intents i ON i.id = a.offering_movement_intent_id
      JOIN private.offering_route_evidence e ON e.id = a.route_evidence_id
      JOIN private.trusted_location_discovery_areas od
        ON od.resolved_location_reference_id = e.origin_location_reference_id
      JOIN private.trusted_location_discovery_areas dd
        ON dd.resolved_location_reference_id = e.destination_location_reference_id
      JOIN public.vehicles v ON v.id = a.vehicle_id
      WHERE a.id = v_candidate.id AND a.offering_member_id = v_member_id;
      v_visible := FOUND;

      -- As in 0048, release validation locks before acquiring the next intent.
      -- Subtransaction rollback releases locks; local output variables survive.
      RAISE SQLSTATE 'ZX054' USING MESSAGE = 'Release recovery candidate locks';
    EXCEPTION WHEN SQLSTATE 'ZX054' THEN
      NULL;
    END;
    IF v_visible THEN
      RETURN NEXT;
      v_returned := v_returned + 1;
      EXIT candidates WHEN v_returned >= p_limit;
    END IF;
  END LOOP candidates;
END;
$recovery$;

REVOKE ALL ON FUNCTION public.list_my_open_offering_movement_availabilities(integer)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_open_offering_movement_availabilities(integer)
TO authenticated;

COMMIT;
