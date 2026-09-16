BEGIN;

-- Movement planning is intentionally near-term. A requester need or offering
-- member intent may only declare a departure window that is current/future and
-- wholly within the next 24 hours at the database statement that creates or
-- materially changes that declaration. This is a planning horizon, not a
-- journey-duration limit.
CREATE FUNCTION private.enforce_movement_planning_horizon()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_deadline timestamptz := statement_timestamp() + interval '24 hours';
BEGIN
  IF NEW.earliest_departure_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Earliest departure is required';
  END IF;

  IF NOT isfinite(NEW.earliest_departure_at)
     OR (NEW.latest_departure_at IS NOT NULL AND NOT isfinite(NEW.latest_departure_at)) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Departure times must be finite';
  END IF;

  IF NEW.earliest_departure_at < v_now THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Earliest departure cannot be in the past';
  END IF;

  IF NEW.earliest_departure_at > v_deadline THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Earliest departure must be within the next 24 hours';
  END IF;

  IF NEW.latest_departure_at IS NOT NULL THEN
    IF NEW.latest_departure_at < NEW.earliest_departure_at THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Latest departure cannot be before earliest departure';
    END IF;

    IF NEW.latest_departure_at > v_deadline THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Latest departure must be within the next 24 hours';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_movement_planning_horizon()
FROM PUBLIC, anon, authenticated, service_role;

-- Requesters still create movement_needs directly under the existing RLS/INSERT
-- contract. Enforce the planning horizon at the database boundary so a modified
-- client cannot bypass it. Status-only lifecycle updates do not fire this trigger.
CREATE TRIGGER enforce_movement_need_planning_horizon
BEFORE INSERT OR UPDATE OF earliest_departure_at, latest_departure_at
ON public.movement_needs
FOR EACH ROW
EXECUTE FUNCTION private.enforce_movement_planning_horizon();

-- 0022 offering intents are private and currently have no production writer.
-- Their departure fields are immutable after insert, so insert-time enforcement
-- is sufficient and preserves the existing lifecycle-only update path.
CREATE TRIGGER enforce_offering_intent_planning_horizon
BEFORE INSERT
ON private.offering_movement_intents
FOR EACH ROW
EXECUTE FUNCTION private.enforce_movement_planning_horizon();

COMMIT;
