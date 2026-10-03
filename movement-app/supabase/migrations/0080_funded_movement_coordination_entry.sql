BEGIN;

-- WE DO NOT CREATE JOURNEYS: this is the technical coordination container for
-- an independently intended, accepted, held and funded-activated movement.
CREATE TABLE private.funded_movement_coordination_entries (
 financial_agreement_id uuid PRIMARY KEY REFERENCES private.financial_agreements(id),
 alignment_id uuid NOT NULL UNIQUE REFERENCES public.alignments(id),
 journey_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)),
 CONSTRAINT funded_coordination_entry_journey_fk FOREIGN KEY(journey_id)
  REFERENCES public.journeys(id) DEFERRABLE INITIALLY IMMEDIATE
);
ALTER TABLE private.funded_movement_coordination_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_movement_coordination_entries FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_funded_coordination_entries BEFORE UPDATE OR DELETE OR TRUNCATE
 ON private.funded_movement_coordination_entries FOR EACH STATEMENT
 EXECUTE FUNCTION private.protect_wallet_ledger_row();

-- Every financial coordination operation uses agreement SHARE -> alignment
-- UPDATE -> offer SHARE -> journey lock. Discovery acquires no locks. This
-- matches 0079 and avoids lock upgrades between simultaneous principals.
-- Legacy journey-first mutation RPCs reject financial selectors before locking.
CREATE FUNCTION private.funded_coordination_alignment(p_need uuid,p_principal boolean DEFAULT true)
RETURNS public.alignments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_selector$
DECLARE a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
 p private.financial_proposals%ROWTYPE; caller uuid:=auth.uid();
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Coordination requires READ COMMITTED'; END IF;
 IF p_need IS NULL THEN RAISE EXCEPTION USING ERRCODE='22004',MESSAGE='Movement need required'; END IF;
 IF caller IS NULL OR NOT EXISTS(SELECT 1 FROM public.members WHERE id=caller) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Authenticated member required'; END IF;
 IF (SELECT count(*) FROM public.alignments WHERE movement_need_id=p_need)<>1 THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact funded movement required'; END IF;
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.movement_need_id=p_need;
 IF caller NOT IN (a.offering_member_id,a.member_needing_movement_id)
  AND (p_principal OR NOT EXISTS(SELECT 1 FROM public.movement_participants t
   WHERE t.movement_need_id=p_need AND t.member_id=caller AND t.status='confirmed' AND t.role='invited_participant')) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact movement principal required'; END IF;
 SELECT x.* INTO g FROM private.financial_agreements x
  JOIN private.funded_movement_activations r ON r.financial_agreement_id=x.id WHERE r.alignment_id=a.id;
 IF g.id IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact funded activation required'; END IF;
 SELECT x.* INTO STRICT g FROM private.financial_agreements x WHERE x.id=g.id FOR SHARE;
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=g.alignment_id FOR UPDATE;
 IF a.movement_need_id IS DISTINCT FROM p_need OR a.status<>'activated'
  OR (p_principal AND caller NOT IN (a.offering_member_id,a.member_needing_movement_id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activated exact movement required'; END IF;
 g:=private.movement_funding_agreement(g.id,g.member_needing_movement_id,g.version);
 PERFORM private.assert_funded_activation(g,a);
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 IF NOT EXISTS(SELECT 1 FROM public.movement_offers o JOIN public.vehicles v ON v.id=o.vehicle_id
  WHERE o.id=a.movement_offer_id AND o.status='accepted' AND o.vehicle_id=p.vehicle_id
   AND o.movement_need_id=a.movement_need_id AND o.offering_member_id=a.offering_member_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact accepted offer vehicle required'; END IF;
 RETURN a;
END;
$coordination_selector$;

CREATE FUNCTION private.assert_funded_coordination_entry(p_alignment uuid)
RETURNS public.journeys LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_graph$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
 a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
BEGIN
 SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=p_alignment;
 SELECT x.* INTO a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=r.financial_agreement_id;
 SELECT x.* INTO j FROM public.journeys x WHERE x.id=r.journey_id;
 IF r.alignment_id IS NULL OR j.id IS NULL OR g.id IS NULL
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=p_alignment)<>1
  OR g.alignment_id IS DISTINCT FROM a.id OR j.alignment_id IS DISTINCT FROM a.id
  OR a.status<>'activated' OR j.status<>'not_started'
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM r.created_at OR r.created_at<a.activated_at OR r.created_at>clock_timestamp()
  OR j.start_requested_at IS NOT NULL OR j.started_at IS NOT NULL OR j.completion_requested_at IS NOT NULL
  OR j.completed_at IS NOT NULL OR j.end_requested_by_member_id IS NOT NULL OR j.end_requested_at IS NOT NULL
  OR j.end_confirmed_by_member_id IS NOT NULL OR j.end_confirmed_at IS NOT NULL OR j.end_reason IS NOT NULL OR j.end_method IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact coordination entry required'; END IF;
 PERFORM private.assert_funded_activation(g,a);
 RETURN j;
END;
$coordination_graph$;

CREATE FUNCTION public.open_my_funded_movement_coordination(p_movement_need_id uuid)
RETURNS TABLE(movement_need_id uuid,journey_state text,coordination_ready boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_open$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; g uuid; stamp timestamptz; next_id uuid;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF EXISTS(SELECT 1 FROM public.journeys WHERE alignment_id=a.id)
  OR EXISTS(SELECT 1 FROM private.funded_movement_coordination_entries WHERE alignment_id=a.id) THEN
  PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR SHARE;
  j:=private.assert_funded_coordination_entry(a.id);
 ELSE
  SELECT financial_agreement_id INTO STRICT g FROM private.funded_movement_activations WHERE alignment_id=a.id;
  stamp:=clock_timestamp(); next_id:=gen_random_uuid();
  -- Receipt precedes the journey so the INSERT guard can require exact provenance.
  -- Defer only this new FK, drain it immediately, and roll its mode back on error.
  BEGIN
   SET CONSTRAINTS private.funded_coordination_entry_journey_fk DEFERRED;
   INSERT INTO private.funded_movement_coordination_entries VALUES(g,a.id,next_id,stamp);
   INSERT INTO public.journeys(id,alignment_id,vehicle_id,status,created_at,updated_at)
    SELECT next_id,a.id,o.vehicle_id,'not_started',stamp,stamp FROM public.movement_offers o WHERE o.id=a.movement_offer_id;
   j:=private.assert_funded_coordination_entry(a.id);
   SET CONSTRAINTS private.funded_coordination_entry_journey_fk IMMEDIATE;
  EXCEPTION WHEN OTHERS THEN RAISE;
  END;
 END IF;
 RETURN QUERY SELECT p_movement_need_id,j.status,true;
END;
$coordination_open$;

-- A narrow read lets either principal reach the explicit continuation button.
-- The legacy activation-payment endpoint recognizes only the offering member.
-- This projection never constructs a journey or fabricates activation evidence.
CREATE FUNCTION public.get_my_funded_movement_coordination_readiness(p_movement_need_id uuid)
RETURNS TABLE(movement_need_id uuid,funded_activated boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_readiness$
DECLARE a public.alignments%ROWTYPE;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.alignments x WHERE x.movement_need_id=p_movement_need_id AND private.is_financial_alignment(x.id)) THEN
  -- Preserve explicit navigation for an already existing, validated legacy
  -- container. This is not eligibility for the funded construction RPC.
  RETURN QUERY SELECT p_movement_need_id,false FROM private.movement_coordination_context(p_movement_need_id,false) c
   WHERE auth.uid() IN (c.offering_id,c.requester_id) AND c.journey_status='not_started';
  RETURN;
 END IF;
 BEGIN
  a:=private.funded_coordination_alignment(p_movement_need_id);
  IF EXISTS(SELECT 1 FROM public.journeys WHERE alignment_id=a.id)
   OR EXISTS(SELECT 1 FROM private.funded_movement_coordination_entries WHERE alignment_id=a.id) THEN
   PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR SHARE;
   PERFORM private.assert_funded_coordination_entry(a.id);
  END IF;
  RETURN QUERY SELECT p_movement_need_id,true;
 EXCEPTION WHEN check_violation OR insufficient_privilege OR no_data_found OR too_many_rows THEN RETURN;
 END;
END;
$coordination_readiness$;

-- Direct trusted writers also cannot start, end, cancel, complete or rebind a
-- financial container. Meeting points live in their own existing table.
CREATE FUNCTION private.protect_financial_coordination_journey()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $journey_guard$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; a public.alignments%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM public.journeys j WHERE private.is_financial_alignment(j.alignment_id)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF; RETURN NULL;
 END IF;
 IF TG_OP<>'INSERT' AND private.is_financial_alignment(OLD.alignment_id) THEN
  IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
 END IF;
 IF TG_OP<>'DELETE' AND private.is_financial_alignment(NEW.alignment_id) THEN
  SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.journey_id=NEW.id;
  SELECT x.* INTO a FROM public.alignments x WHERE x.id=NEW.alignment_id;
  IF r.journey_id IS NULL OR r.alignment_id IS DISTINCT FROM NEW.alignment_id OR a.status<>'activated'
   OR NOT EXISTS(SELECT 1 FROM private.funded_movement_activations f WHERE f.alignment_id=a.id AND f.financial_agreement_id=r.financial_agreement_id)
   OR NEW.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
   OR NEW.created_at IS DISTINCT FROM r.created_at OR NEW.updated_at IS DISTINCT FROM r.created_at
   OR NEW.status<>'not_started' OR NEW.start_requested_at IS NOT NULL OR NEW.started_at IS NOT NULL
   OR NEW.completion_requested_at IS NOT NULL OR NEW.completed_at IS NOT NULL
   OR NEW.end_requested_by_member_id IS NOT NULL OR NEW.end_requested_at IS NOT NULL
   OR NEW.end_confirmed_by_member_id IS NOT NULL OR NEW.end_confirmed_at IS NOT NULL
   OR NEW.end_reason IS NOT NULL OR NEW.end_method IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact funded coordination provenance required'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$journey_guard$;
CREATE TRIGGER protect_financial_coordination_journey BEFORE INSERT OR UPDATE OR DELETE ON public.journeys
 FOR EACH ROW EXECUTE FUNCTION private.protect_financial_coordination_journey();
CREATE TRIGGER protect_financial_coordination_journey_truncate BEFORE TRUNCATE ON public.journeys
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_financial_coordination_journey();

CREATE FUNCTION private.protect_financial_coordination_alignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_alignment_guard$
BEGIN
 IF OLD.activated_at IS NOT NULL AND EXISTS(SELECT 1 FROM private.funded_movement_activations WHERE alignment_id=OLD.id)
  AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$coordination_alignment_guard$;
CREATE TRIGGER protect_financial_coordination_alignment BEFORE UPDATE OR DELETE ON public.alignments
 FOR EACH ROW EXECUTE FUNCTION private.protect_financial_coordination_alignment();

CREATE FUNCTION private.protect_funded_coordination_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_offer_guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.alignments a JOIN private.funded_movement_activations r ON r.alignment_id=a.id
  WHERE a.movement_offer_id=OLD.id)
  AND (TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at')) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Funded accepted offer is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$coordination_offer_guard$;
CREATE TRIGGER protect_funded_coordination_offer BEFORE UPDATE OR DELETE ON public.movement_offers
 FOR EACH ROW EXECUTE FUNCTION private.protect_funded_coordination_offer();

CREATE FUNCTION private.reject_financial_legacy_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $settlement_guard$
BEGIN
 IF private.is_financial_alignment(NEW.alignment_id) OR EXISTS(SELECT 1 FROM public.journeys j
  WHERE j.id=NEW.journey_id AND private.is_financial_alignment(j.alignment_id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial legacy settlement unavailable'; END IF;
 RETURN NEW;
END;
$settlement_guard$;
CREATE TRIGGER reject_financial_legacy_settlement BEFORE INSERT OR UPDATE ON private.movement_settlements
 FOR EACH ROW EXECUTE FUNCTION private.reject_financial_legacy_settlement();

REVOKE ALL ON FUNCTION private.funded_coordination_alignment(uuid,boolean),private.assert_funded_coordination_entry(uuid),
 private.protect_financial_coordination_journey(),private.protect_financial_coordination_alignment(),private.protect_funded_coordination_offer(),private.reject_financial_legacy_settlement()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.open_my_funded_movement_coordination(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.open_my_funded_movement_coordination(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_funded_movement_coordination_readiness(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_funded_movement_coordination_readiness(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_journey_start(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  start_requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_timestamp timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  -- Caller must be the offering member
  IF v_alignment_record.offering_member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the offering member may request journey start';
  END IF;

  -- Alignment must be activated
  IF v_alignment_record.status <> 'activated' THEN
    RAISE EXCEPTION 'Alignment is not activated';
  END IF;

  -- Journey must be not_started
  IF v_journey_record.status <> 'not_started' THEN
    RAISE EXCEPTION 'Journey is not in not_started state';
  END IF;

  -- Journey must not be completed, cancelled, or failed
  IF v_journey_record.status IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Journey is in a terminal state';
  END IF;

  -- Idempotency: if start_requested_at already exists and journey is still not_started, return existing
  IF v_journey_record.start_requested_at IS NOT NULL THEN
    v_returned_timestamp := v_journey_record.start_requested_at;
  ELSE
    -- Set start_requested_at to now
    UPDATE public.journeys j
    SET start_requested_at = NOW(), updated_at = NOW()
    WHERE j.id = p_journey_id
    RETURNING j.start_requested_at
    INTO v_returned_timestamp;
  END IF;

  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'not_started'::text AS journey_status,
    v_returned_timestamp AS start_requested_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_journey_start(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  started_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_started_at timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  -- Caller must be the primary requester (member_needing_movement_id)
  IF v_alignment_record.member_needing_movement_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the primary requester may confirm journey start';
  END IF;

  -- Idempotency check: if both already in_progress, return existing started_at
  IF v_journey_record.status = 'in_progress' AND v_alignment_record.status = 'in_progress' THEN
    v_returned_started_at := v_journey_record.started_at;
    RETURN QUERY
    SELECT
      p_journey_id AS journey_id,
      'in_progress'::text AS journey_status,
      v_returned_started_at AS started_at;
    RETURN;
  END IF;

  -- Validate journey state
  IF v_journey_record.status <> 'not_started' THEN
    RAISE EXCEPTION 'Journey is not in not_started state';
  END IF;

  -- Validate start was requested
  IF v_journey_record.start_requested_at IS NULL THEN
    RAISE EXCEPTION 'Journey start has not been requested';
  END IF;

  -- Validate alignment state
  IF v_alignment_record.status <> 'activated' THEN
    RAISE EXCEPTION 'Alignment is not activated';
  END IF;

  -- Atomically update both journey and alignment
  UPDATE public.journeys j
  SET
    status = 'in_progress',
    started_at = NOW(),
    updated_at = NOW()
  WHERE j.id = p_journey_id
  RETURNING j.started_at
  INTO v_returned_started_at;

  UPDATE public.alignments a
  SET
    status = 'in_progress',
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id;

  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'in_progress'::text AS journey_status,
    v_returned_started_at AS started_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_journey_completion(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  completion_requested_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_timestamp timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  -- Caller must be the offering member
  IF v_alignment_record.offering_member_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the offering member may request journey completion';
  END IF;

  -- Journey must be in_progress
  IF v_journey_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Journey is not in_progress';
  END IF;

  -- Alignment must be in_progress
  IF v_alignment_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Alignment is not in_progress';
  END IF;

  -- started_at must not be null
  IF v_journey_record.started_at IS NULL THEN
    RAISE EXCEPTION 'Journey has not been started';
  END IF;

  -- Idempotency: if completion_requested_at already exists while still in_progress, return existing
  IF v_journey_record.completion_requested_at IS NOT NULL THEN
    v_returned_timestamp := v_journey_record.completion_requested_at;
  ELSE
    -- Set completion_requested_at to now
    UPDATE public.journeys j
    SET completion_requested_at = NOW(), updated_at = NOW()
    WHERE j.id = p_journey_id
    RETURNING j.completion_requested_at
    INTO v_returned_timestamp;
  END IF;

  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'in_progress'::text AS journey_status,
    v_returned_timestamp AS completion_requested_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_journey_completion(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_returned_completed_at timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  -- Caller must be the primary requester (member_needing_movement_id)
  IF v_alignment_record.member_needing_movement_id <> v_caller_member_id THEN
    RAISE EXCEPTION 'Only the primary requester may confirm journey completion';
  END IF;

  -- Idempotency check: if both already completed, return existing completed_at
  IF v_journey_record.status = 'completed' AND v_alignment_record.status = 'completed' THEN
    v_returned_completed_at := v_journey_record.completed_at;
    RETURN QUERY
    SELECT
      p_journey_id AS journey_id,
      'completed'::text AS journey_status,
      v_returned_completed_at AS completed_at;
    RETURN;
  END IF;

  -- Validate journey state
  IF v_journey_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Journey is not in_progress';
  END IF;

  -- Validate alignment state
  IF v_alignment_record.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Alignment is not in_progress';
  END IF;

  -- Validate journey has been started
  IF v_journey_record.started_at IS NULL THEN
    RAISE EXCEPTION 'Journey has not been started';
  END IF;

  -- Validate completion was requested
  IF v_journey_record.completion_requested_at IS NULL THEN
    RAISE EXCEPTION 'Journey completion has not been requested';
  END IF;

  -- Atomically update both journey and alignment
  UPDATE public.journeys j
  SET
    status = 'completed',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE j.id = p_journey_id
  RETURNING j.completed_at
  INTO v_returned_completed_at;

  UPDATE public.alignments a
  SET
    status = 'completed',
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id;

  RETURN QUERY
  SELECT
    p_journey_id AS journey_id,
    'completed'::text AS journey_status,
    v_returned_completed_at AS completed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_movement_end(
  p_journey_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text,
  requested_by_me boolean,
  waiting_for_other_member boolean,
  completed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_offering_member_id uuid;
  v_requester_member_id uuid;
  v_end_status text;
  v_requested_by_me boolean;
  v_waiting_for_other_member boolean;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  v_offering_member_id := v_alignment_record.offering_member_id;
  v_requester_member_id := v_alignment_record.member_needing_movement_id;

  -- Caller must be one of the two principal members
  IF v_caller_member_id <> v_offering_member_id AND v_caller_member_id <> v_requester_member_id THEN
    RAISE EXCEPTION 'Only principal movement members may end the movement';
  END IF;

  -- Terminal retries cannot create another consent or settlement.
  IF v_journey_record.status='cancelled' AND v_alignment_record.status='cancelled'
    AND EXISTS (SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=p_journey_id) THEN
    RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, false::boolean, false::boolean, NULL::timestamptz;
    RETURN;
  END IF;
  -- Allow ending only in valid states
  -- A: activated + not_started
  -- B: in_progress + in_progress
  -- C: already completed (idempotent)

  IF v_alignment_record.status = 'completed' AND v_journey_record.status = 'completed' THEN
    -- Already completed, return idempotently
    RETURN QUERY
    SELECT
      p_journey_id,
      v_journey_record.status,
      v_alignment_record.status,
      'completed'::text,
      false::boolean,
      false::boolean,
      v_journey_record.completed_at;
    RETURN;
  END IF;

  -- Reject if not in a valid ending state
  IF NOT (
    (v_alignment_record.status = 'activated' AND v_journey_record.status = 'not_started')
    OR
    (v_alignment_record.status = 'in_progress' AND v_journey_record.status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Movement is not in a state that allows mutual ending';
  END IF;

  -- Check if an end request already exists
  IF v_journey_record.end_requested_by_member_id IS NOT NULL THEN
    -- End request already pending
    IF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
      -- Same member requesting again: idempotent
      v_end_status := 'awaiting_other_member';
      v_requested_by_me := true;
      v_waiting_for_other_member := true;
    ELSE
      -- OTHER principal member is now also requesting end: mutual agreement!
      -- Both rows are locked in journey-then-alignment order. A request is not a start.
      IF v_alignment_record.status='activated' AND v_journey_record.status='not_started' THEN
        PERFORM private.close_mutual_no_travel(p_journey_id);
        RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, false::boolean, false::boolean, NULL::timestamptz;
        RETURN;
      END IF;
      -- Complete the movement
      UPDATE public.journeys j
      SET
        end_confirmed_by_member_id = v_caller_member_id,
        end_confirmed_at = NOW(),
        status = 'completed',
        completed_at = COALESCE(j.completed_at, NOW()),
        end_method = 'mutual_user_end',
        updated_at = NOW()
      WHERE j.id = p_journey_id;

      UPDATE public.alignments a
      SET
        status = 'completed',
        updated_at = NOW()
      WHERE a.id = v_alignment_record.id;

      -- Create settlement entitlement
      INSERT INTO private.movement_settlements (
        alignment_id,
        journey_id,
        beneficiary_member_id,
        status,
        created_at
      )
      VALUES (
        v_alignment_record.id,
        p_journey_id,
        v_offering_member_id,
        'pending_amount',
        NOW()
      )
      ON CONFLICT (alignment_id) DO NOTHING;

      v_end_status := 'completed';
      v_requested_by_me := false;
      v_waiting_for_other_member := false;

      -- Reload both records for accurate return
      SELECT *
      INTO v_journey_record
      FROM public.journeys j
      WHERE j.id = p_journey_id;

      SELECT *
      INTO v_alignment_record
      FROM public.alignments a
      WHERE a.id = v_alignment_record.id;
    END IF;
  ELSE
    -- No end request exists yet: create one
    -- Defensive: also clear any stale confirmation fields
    UPDATE public.journeys j
    SET
      end_requested_by_member_id = v_caller_member_id,
      end_requested_at = NOW(),
      end_confirmed_by_member_id = NULL,
      end_confirmed_at = NULL,
      end_reason = NULLIF(trim(p_reason), ''),
      updated_at = NOW()
    WHERE j.id = p_journey_id;

    v_end_status := 'awaiting_other_member';
    v_requested_by_me := true;
    v_waiting_for_other_member := true;
  END IF;

  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    v_end_status,
    v_requested_by_me,
    v_waiting_for_other_member,
    v_journey_record.completed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_movement_end(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text,
  completed_at timestamptz,
  settlement_required boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_offering_member_id uuid;
  v_requester_member_id uuid;
  v_settlement_exists boolean;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  v_offering_member_id := v_alignment_record.offering_member_id;
  v_requester_member_id := v_alignment_record.member_needing_movement_id;

  -- Caller must be one of the principal members
  IF v_caller_member_id <> v_offering_member_id AND v_caller_member_id <> v_requester_member_id THEN
    RAISE EXCEPTION 'Only principal movement members may confirm movement end';
  END IF;

  -- Terminal retries cannot create another consent or settlement.
  IF v_journey_record.status='cancelled' AND v_alignment_record.status='cancelled'
    AND EXISTS (SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=p_journey_id) THEN
    RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, NULL::timestamptz, false::boolean;
    RETURN;
  END IF;
  -- Idempotency: if both already completed, return safely
  IF v_journey_record.status = 'completed' AND v_alignment_record.status = 'completed' THEN
    -- Verify settlement exists
    SELECT EXISTS(
      SELECT 1
      FROM private.movement_settlements ms
      WHERE ms.journey_id = p_journey_id
    ) INTO v_settlement_exists;

    RETURN QUERY
    SELECT
      p_journey_id,
      v_journey_record.status,
      v_alignment_record.status,
      'completed'::text,
      v_journey_record.completed_at,
      v_settlement_exists;
    RETURN;
  END IF;

  -- Must have a pending end request
  IF v_journey_record.end_requested_by_member_id IS NULL THEN
    RAISE EXCEPTION 'No pending end request to confirm';
  END IF;

  -- Caller cannot confirm their own request
  IF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot confirm your own end request';
  END IF;

  -- Validate state: must be in a valid ending state
  IF NOT (
    (v_alignment_record.status = 'activated' AND v_journey_record.status = 'not_started')
    OR
    (v_alignment_record.status = 'in_progress' AND v_journey_record.status = 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Movement is not in a state that allows mutual ending';
  END IF;

  -- Both rows are locked in journey-then-alignment order. A request is not a start.
  IF v_alignment_record.status='activated' AND v_journey_record.status='not_started' THEN
    PERFORM private.close_mutual_no_travel(p_journey_id);
    RETURN QUERY SELECT p_journey_id, 'cancelled'::text, 'cancelled'::text, 'mutual_no_travel'::text, NULL::timestamptz, false::boolean;
    RETURN;
  END IF;
  -- Confirm the end request
  UPDATE public.journeys j
  SET
    end_confirmed_by_member_id = v_caller_member_id,
    end_confirmed_at = NOW(),
    status = 'completed',
    completed_at = COALESCE(j.completed_at, NOW()),
    end_method = 'mutual_user_end',
    updated_at = NOW()
  WHERE j.id = p_journey_id;

  UPDATE public.alignments a
  SET
    status = 'completed',
    updated_at = NOW()
  WHERE a.id = v_alignment_record.id;

  -- Create settlement entitlement
  INSERT INTO private.movement_settlements (
    alignment_id,
    journey_id,
    beneficiary_member_id,
    status,
    created_at
  )
  VALUES (
    v_alignment_record.id,
    p_journey_id,
    v_offering_member_id,
    'pending_amount',
    NOW()
  )
  ON CONFLICT (alignment_id) DO NOTHING;

  -- Check if settlement was created
  SELECT EXISTS(
    SELECT 1
    FROM private.movement_settlements ms
    WHERE ms.journey_id = p_journey_id
  ) INTO v_settlement_exists;

  -- Reload both records for return
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id;

  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_alignment_record.id;

  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    'completed'::text,
    v_journey_record.completed_at,
    v_settlement_exists;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_movement_end(
  p_journey_id uuid
)
RETURNS TABLE (
  journey_id uuid,
  journey_status text,
  alignment_status text,
  end_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_member_id uuid;
  v_journey_record public.journeys%ROWTYPE;
  v_alignment_record public.alignments%ROWTYPE;
  v_offering_member_id uuid;
  v_requester_member_id uuid;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  v_caller_member_id := auth.uid();

  IF v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Load and lock the journey
  SELECT *
  INTO v_journey_record
  FROM public.journeys j
  WHERE j.id = p_journey_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey not found';
  END IF;

  -- Load and lock the alignment
  SELECT *
  INTO v_alignment_record
  FROM public.alignments a
  WHERE a.id = v_journey_record.alignment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alignment not found';
  END IF;

  v_offering_member_id := v_alignment_record.offering_member_id;
  v_requester_member_id := v_alignment_record.member_needing_movement_id;

  -- Caller must be one of the principal members
  IF v_caller_member_id <> v_offering_member_id AND v_caller_member_id <> v_requester_member_id THEN
    RAISE EXCEPTION 'Only principal movement members may decline movement end';
  END IF;

  -- Must have a pending end request
  IF v_journey_record.end_requested_by_member_id IS NULL THEN
    RAISE EXCEPTION 'No pending end request to decline';
  END IF;

  -- Caller cannot decline their own request
  IF v_journey_record.end_requested_by_member_id = v_caller_member_id THEN
    RAISE EXCEPTION 'You cannot decline your own end request';
  END IF;

  -- Terminal consent must never be cleared.
  IF v_journey_record.status IN ('completed','cancelled','failed') THEN
    RAISE EXCEPTION 'Movement is already terminal';
  END IF;

  -- Clear the pending end request and any stale confirmation fields
  UPDATE public.journeys j
  SET
    end_requested_by_member_id = NULL,
    end_requested_at = NULL,
    end_confirmed_by_member_id = NULL,
    end_confirmed_at = NULL,
    end_reason = NULL,
    updated_at = NOW()
  WHERE j.id = p_journey_id;

  RETURN QUERY
  SELECT
    p_journey_id,
    v_journey_record.status,
    v_alignment_record.status,
    'no_pending_end_request'::text;
END;
$$;

CREATE OR REPLACE FUNCTION private.close_mutual_no_travel(p_journey_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j public.journeys%ROWTYPE; a public.alignments%ROWTYPE;
  caller uuid := auth.uid(); closed_time timestamptz;
BEGIN
  IF EXISTS(SELECT 1 FROM public.journeys lifecycle_journey WHERE lifecycle_journey.id=p_journey_id AND private.is_financial_alignment(lifecycle_journey.alignment_id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  SELECT * INTO STRICT j FROM public.journeys WHERE id=p_journey_id FOR UPDATE;
  SELECT * INTO STRICT a FROM public.alignments WHERE id=j.alignment_id FOR UPDATE;
  closed_time := clock_timestamp();
  IF caller IS NULL OR caller NOT IN (a.offering_member_id,a.member_needing_movement_id)
    OR j.end_requested_by_member_id IS NULL OR j.end_requested_at IS NULL
    OR j.end_requested_by_member_id NOT IN (a.offering_member_id,a.member_needing_movement_id)
    OR j.end_requested_by_member_id=caller THEN
    RAISE EXCEPTION 'Two principal consents required';
  END IF;
  IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL
    OR j.completed_at IS NOT NULL OR a.activated_at IS NULL THEN
    RAISE EXCEPTION 'Movement is not eligible for no-travel closure';
  END IF;
  -- State/timestamps alone are not payment evidence (trusted historical imports
  -- can contain inconsistent rows). Match the existing 0014 activation evidence.
  -- Do not lock payment after alignment: payment success uses payment->alignment.
  IF NOT EXISTS (
    SELECT 1 FROM private.alignment_activation_payments p
    WHERE p.alignment_id=a.id AND p.status='succeeded' AND p.succeeded_at IS NOT NULL
      AND p.payer_member_id=a.offering_member_id
      AND p.amount_minor=a.activation_fee_minor AND p.currency=a.activation_currency
  ) THEN
    RAISE EXCEPTION 'Successful activation payment required';
  END IF;
  -- Never silently delete an inconsistent pre-existing entitlement.
  IF EXISTS (SELECT 1 FROM private.movement_settlements s WHERE s.journey_id=j.id OR s.alignment_id=a.id) THEN
    RAISE EXCEPTION 'Existing settlement requires reviewed resolution';
  END IF;
  UPDATE public.journeys SET status='cancelled',start_requested_at=NULL,
    end_confirmed_by_member_id=caller,end_confirmed_at=closed_time,
    end_method='mutual_no_travel_after_activation',updated_at=now() WHERE id=j.id;
  UPDATE public.alignments SET status='cancelled',updated_at=now() WHERE id=a.id;
  INSERT INTO private.mutual_no_travel_closures
    (journey_id,first_principal_id,second_principal_id,first_consented_at,closed_at,invalidated_start_requested_at)
    VALUES(j.id,j.end_requested_by_member_id,caller,j.end_requested_at,closed_time,j.start_requested_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_my_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  IF EXISTS(SELECT 1 FROM public.alignments lifecycle_candidate WHERE lifecycle_candidate.movement_need_id=p_movement_need_id AND private.is_financial_alignment(lifecycle_candidate.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  SELECT * INTO c FROM private.movement_coordination_context(p_movement_need_id,true);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable'; END IF;
  IF auth.uid()<>c.offering_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.journey_meeting_points mp WHERE mp.journey_id=c.journey_id AND mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Meeting point required';
  END IF;

  PERFORM * FROM public.request_journey_start(c.journey_id);
  RETURN QUERY SELECT * FROM public.get_my_movement_coordination_status(p_movement_need_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_my_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
  IF EXISTS(SELECT 1 FROM public.alignments lifecycle_candidate WHERE lifecycle_candidate.movement_need_id=p_movement_need_id AND private.is_financial_alignment(lifecycle_candidate.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  SELECT * INTO c FROM private.movement_coordination_context(p_movement_need_id,true);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable'; END IF;
  IF auth.uid()<>c.requester_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM private.journey_meeting_points mp WHERE mp.journey_id=c.journey_id AND mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Meeting point required';
  END IF;
  IF c.requested_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable'; END IF;
  PERFORM * FROM public.confirm_journey_start(c.journey_id);
  RETURN QUERY SELECT * FROM public.get_my_movement_coordination_status(p_movement_need_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.movement_end_context(p_movement_need_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; selected_id uuid; selected_alignment uuid; a public.alignments%ROWTYPE;
BEGIN
  IF EXISTS(SELECT 1 FROM public.alignments lifecycle_candidate WHERE lifecycle_candidate.movement_need_id=p_movement_need_id AND private.is_financial_alignment(lifecycle_candidate.id)) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id=auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  SELECT array_agg(j.id) INTO ids FROM public.journeys j
    JOIN public.alignments x ON x.id=j.alignment_id WHERE x.movement_need_id=p_movement_need_id;
  IF cardinality(ids) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  selected_id:=ids[1];
  IF NOT EXISTS (SELECT 1 FROM public.journeys j JOIN public.alignments x ON x.id=j.alignment_id
    WHERE j.id=selected_id AND auth.uid() IN (x.offering_member_id,x.member_needing_movement_id)) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  SELECT j.alignment_id INTO selected_alignment FROM public.journeys j WHERE j.id=selected_id FOR UPDATE;
  SELECT x.* INTO a FROM public.alignments x WHERE x.id=selected_alignment FOR UPDATE;
  SELECT array_agg(j.id) INTO ids FROM public.journeys j
    JOIN public.alignments x ON x.id=j.alignment_id WHERE x.movement_need_id=p_movement_need_id;
  IF cardinality(ids) IS DISTINCT FROM 1 OR ids[1] IS DISTINCT FROM selected_id
    OR a.movement_need_id IS DISTINCT FROM p_movement_need_id
    OR auth.uid() NOT IN (a.offering_member_id,a.member_needing_movement_id)
    OR NOT (
      EXISTS (SELECT 1 FROM private.movement_coordination_context(p_movement_need_id,false) c
        WHERE c.journey_id=selected_id AND c.alignment_id=a.id)
      OR (a.status='cancelled' AND EXISTS (
        SELECT 1 FROM private.mutual_no_travel_closures n JOIN public.journeys j ON j.id=n.journey_id
        WHERE j.id=selected_id AND j.status='cancelled' AND j.started_at IS NULL AND j.completed_at IS NULL
          AND auth.uid() IN (n.first_principal_id,n.second_principal_id)))
    ) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Movement end unavailable';
  END IF;
  RETURN selected_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.movement_coordination_context(p_need uuid, p_lock boolean DEFAULT false)
RETURNS TABLE (journey_id uuid, alignment_id uuid, offering_id uuid, requester_id uuid,
  journey_status text, requested_at timestamptz, began_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; selected_id uuid; selected_alignment uuid; financial_alignment public.alignments%ROWTYPE; financial_journey public.journeys%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.alignments a WHERE a.movement_need_id=p_need AND private.is_financial_alignment(a.id)) THEN
    -- Do not run reveal (which locks alignment) before the canonical agreement lock.
    BEGIN
      financial_alignment:=private.funded_coordination_alignment(p_need,false);
      IF NOT EXISTS(SELECT 1 FROM public.journeys j WHERE j.alignment_id=financial_alignment.id) THEN RETURN; END IF;
      IF p_lock THEN PERFORM j.id FROM public.journeys j WHERE j.alignment_id=financial_alignment.id FOR UPDATE;
      ELSE PERFORM j.id FROM public.journeys j WHERE j.alignment_id=financial_alignment.id FOR SHARE; END IF;
      financial_journey:=private.assert_funded_coordination_entry(financial_alignment.id);
      IF NOT EXISTS(SELECT 1 FROM private.post_activation_reveal_subjects(p_need,auth.uid()) s WHERE s.alignment_id=financial_alignment.id) THEN RETURN; END IF;
      RETURN QUERY SELECT financial_journey.id,financial_alignment.id,financial_alignment.offering_member_id,
        financial_alignment.member_needing_movement_id,financial_journey.status,financial_journey.start_requested_at,financial_journey.started_at;
      RETURN;
    EXCEPTION WHEN check_violation OR insufficient_privilege OR no_data_found OR too_many_rows THEN RETURN;
    END;
  END IF;
  SELECT array_agg(j.id) INTO ids FROM public.journeys j
  JOIN public.alignments a ON a.id=j.alignment_id
  WHERE a.movement_need_id=p_need AND EXISTS (
    SELECT 1 FROM private.post_activation_reveal_subjects(p_need,auth.uid()) s WHERE s.alignment_id=a.id
  );
  IF cardinality(ids) IS DISTINCT FROM 1 THEN RETURN; END IF;
  selected_id:=ids[1];
  IF p_lock THEN
    SELECT j.alignment_id INTO selected_alignment FROM public.journeys j WHERE j.id=selected_id FOR UPDATE;
    PERFORM 1 FROM public.alignments a WHERE a.id=selected_alignment FOR UPDATE;
  END IF;
  RETURN QUERY SELECT j.id,a.id,a.offering_member_id,a.member_needing_movement_id,
    j.status,j.start_requested_at,j.started_at
  FROM public.journeys j JOIN public.alignments a ON a.id=j.alignment_id
  WHERE j.id=selected_id AND a.movement_need_id=p_need AND EXISTS (
    SELECT 1 FROM private.post_activation_reveal_subjects(p_need,auth.uid()) s WHERE s.alignment_id=a.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_movement_coordination_status(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT mp.place_text,mp.revision,c.journey_status,c.requested_at,c.began_at,
    (auth.uid() IN (c.offering_id,c.requester_id) AND c.journey_status='not_started' AND c.requested_at IS NULL),
    (NOT private.is_financial_alignment(c.alignment_id) AND auth.uid()=c.offering_id AND c.journey_status='not_started' AND c.requested_at IS NULL AND coalesce((mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]'),false)),
    (NOT private.is_financial_alignment(c.alignment_id) AND auth.uid()=c.requester_id AND c.journey_status='not_started' AND c.requested_at IS NOT NULL AND coalesce((mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]'),false))
  FROM private.movement_coordination_context(p_movement_need_id) c
  LEFT JOIN private.journey_meeting_points mp ON mp.journey_id=c.journey_id;
$$;

-- Preserve each historical function ACL; CREATE OR REPLACE does not add grants.
COMMIT;
