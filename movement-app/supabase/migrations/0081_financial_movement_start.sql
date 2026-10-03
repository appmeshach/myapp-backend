BEGIN;

-- WE DO NOT CREATE JOURNEYS. Two human actions start the already intended,
-- held, activated and explicitly coordinated movement. Money remains held.
CREATE TABLE private.funded_movement_start_requests (
 alignment_id uuid PRIMARY KEY REFERENCES private.funded_movement_coordination_entries(alignment_id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 requested_at timestamptz NOT NULL CHECK(isfinite(requested_at)),
 meeting_point_revision bigint NOT NULL CHECK(meeting_point_revision>=1)
);
CREATE TABLE private.funded_movement_starts (
 alignment_id uuid PRIMARY KEY REFERENCES private.funded_movement_start_requests(alignment_id),
 journey_id uuid NOT NULL UNIQUE REFERENCES public.journeys(id),
 started_at timestamptz NOT NULL CHECK(isfinite(started_at))
);
ALTER TABLE private.funded_movement_start_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.funded_movement_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.funded_movement_start_requests,private.funded_movement_starts FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_funded_start_requests BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_start_requests
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_funded_starts BEFORE UPDATE OR DELETE OR TRUNCATE ON private.funded_movement_starts
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE OR REPLACE FUNCTION private.funded_coordination_alignment(p_need uuid,p_principal boolean DEFAULT true)
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
 IF a.movement_need_id IS DISTINCT FROM p_need OR a.status NOT IN ('activated','in_progress')
  OR (p_principal AND caller NOT IN (a.offering_member_id,a.member_needing_movement_id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Activated exact movement required'; END IF;
 g:=private.movement_funding_agreement(g.id,g.member_needing_movement_id,g.version);
 PERFORM private.assert_funded_activation(g,a);
 SELECT x.* INTO STRICT p FROM private.financial_proposals x WHERE x.financial_agreement_id=g.id;
 IF NOT EXISTS(SELECT 1 FROM public.movement_offers o JOIN public.vehicles v ON v.id=o.vehicle_id
  WHERE o.id=a.movement_offer_id AND o.status='accepted' AND o.vehicle_id=p.vehicle_id
   AND o.movement_need_id=a.movement_need_id AND o.offering_member_id=a.offering_member_id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact accepted offer vehicle required'; END IF;
 -- An in-progress selector is historical only with the exact committed start graph.
 IF a.status='in_progress' THEN PERFORM private.assert_funded_coordination_entry(a.id); END IF;
 RETURN a;
END;
$coordination_selector$;

CREATE OR REPLACE FUNCTION private.assert_funded_coordination_entry(p_alignment uuid)
RETURNS public.journeys LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $coordination_graph$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; j public.journeys%ROWTYPE;
 a public.alignments%ROWTYPE; g private.financial_agreements%ROWTYPE;
 request private.funded_movement_start_requests%ROWTYPE; started private.funded_movement_starts%ROWTYPE; mp private.journey_meeting_points%ROWTYPE;
BEGIN
 SELECT x.* INTO r FROM private.funded_movement_coordination_entries x WHERE x.alignment_id=p_alignment;
 SELECT x.* INTO a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT x.* INTO g FROM private.financial_agreements x WHERE x.id=r.financial_agreement_id;
 SELECT x.* INTO j FROM public.journeys x WHERE x.id=r.journey_id;
 IF r.alignment_id IS NULL OR j.id IS NULL OR g.id IS NULL
  OR (SELECT count(*) FROM public.journeys WHERE alignment_id=p_alignment)<>1
  OR g.alignment_id IS DISTINCT FROM a.id OR j.alignment_id IS DISTINCT FROM a.id
  OR j.vehicle_id IS DISTINCT FROM (SELECT vehicle_id FROM public.movement_offers WHERE id=a.movement_offer_id)
  OR j.created_at IS DISTINCT FROM r.created_at OR r.created_at<a.activated_at OR r.created_at>clock_timestamp()
  OR j.completion_requested_at IS NOT NULL
  OR EXISTS(SELECT 1 FROM private.mutual_no_travel_closures c WHERE c.journey_id=j.id)
  OR EXISTS(SELECT 1 FROM private.movement_settlements c WHERE c.journey_id=j.id OR c.alignment_id=a.id)
  OR j.completed_at IS NOT NULL OR j.end_requested_by_member_id IS NOT NULL OR j.end_requested_at IS NOT NULL
  OR j.end_confirmed_by_member_id IS NOT NULL OR j.end_confirmed_at IS NOT NULL OR j.end_reason IS NOT NULL OR j.end_method IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact coordination entry required'; END IF;
 SELECT x.* INTO request FROM private.funded_movement_start_requests x WHERE x.alignment_id=a.id;
 SELECT x.* INTO started FROM private.funded_movement_starts x WHERE x.alignment_id=a.id;
 SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id;
 IF request.alignment_id IS NULL THEN
  IF started.alignment_id IS NOT NULL OR a.status<>'activated' OR j.status<>'not_started'
   OR j.start_requested_at IS NOT NULL OR j.started_at IS NOT NULL THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start request required'; END IF;
 ELSE
  IF request.journey_id IS DISTINCT FROM j.id OR request.requested_at IS DISTINCT FROM j.start_requested_at
   OR request.requested_at<r.created_at OR request.requested_at>clock_timestamp()
   OR mp.journey_id IS NULL OR mp.revision IS DISTINCT FROM request.meeting_point_revision
   OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact frozen meeting point and start request required'; END IF;
  IF started.alignment_id IS NULL THEN
   IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact financial start confirmation required'; END IF;
  ELSIF started.journey_id IS DISTINCT FROM j.id OR started.started_at IS DISTINCT FROM j.started_at
   OR started.started_at<request.requested_at OR started.started_at>clock_timestamp()
   OR a.status<>'in_progress' OR j.status<>'in_progress' THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Complete exact financial start required';
  END IF;
 END IF;
 PERFORM private.assert_funded_activation(g,a);
 RETURN j;
END;
$coordination_graph$;

CREATE OR REPLACE FUNCTION private.protect_financial_coordination_journey()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $journey_guard$
DECLARE r private.funded_movement_coordination_entries%ROWTYPE; a public.alignments%ROWTYPE;
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM public.journeys j WHERE private.is_financial_alignment(j.alignment_id)) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF; RETURN NULL;
 END IF;
 IF TG_OP<>'INSERT' AND private.is_financial_alignment(OLD.alignment_id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  IF to_jsonb(NEW) IS NOT DISTINCT FROM to_jsonb(OLD) THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','start_requested_at','started_at','updated_at'])
   IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','start_requested_at','started_at','updated_at']) THEN
   IF OLD.status='not_started' AND OLD.start_requested_at IS NULL AND OLD.started_at IS NULL
    AND NEW.status='not_started' AND NEW.started_at IS NULL
    AND EXISTS(SELECT 1 FROM private.funded_movement_start_requests x WHERE x.alignment_id=OLD.alignment_id
     AND x.journey_id=OLD.id AND x.requested_at=NEW.start_requested_at)
    AND NOT EXISTS(SELECT 1 FROM private.funded_movement_starts x WHERE x.alignment_id=OLD.alignment_id) THEN RETURN NEW; END IF;
   IF OLD.status='not_started' AND OLD.start_requested_at IS NOT NULL AND OLD.started_at IS NULL
    AND NEW.status='in_progress' AND NEW.start_requested_at=OLD.start_requested_at
    AND EXISTS(SELECT 1 FROM private.funded_movement_starts x WHERE x.alignment_id=OLD.alignment_id
     AND x.journey_id=OLD.id AND x.started_at=NEW.started_at) THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable';
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

CREATE OR REPLACE FUNCTION private.protect_financial_coordination_alignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_alignment_guard$
BEGIN
 IF OLD.activated_at IS NOT NULL AND EXISTS(SELECT 1 FROM private.funded_movement_activations WHERE alignment_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable'; END IF;
  IF (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RETURN NEW; END IF;
  IF OLD.status='activated' AND NEW.status='in_progress'
   AND (to_jsonb(NEW)-ARRAY['status','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','updated_at'])
   AND EXISTS(SELECT 1 FROM private.funded_movement_starts x WHERE x.alignment_id=OLD.id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial coordination lifecycle unavailable';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$start_alignment_guard$;

-- No graph lock is acquired by row guards: a direct journey/meeting-point writer
-- must not invert agreement -> alignment -> offer -> journey -> meeting-point.
CREATE FUNCTION private.protect_funded_start_meeting_point()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_meeting_guard$
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM private.funded_movement_start_requests) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial start meeting point is frozen'; END IF; RETURN NULL;
 END IF;
 IF EXISTS(SELECT 1 FROM private.funded_movement_start_requests x WHERE x.journey_id=CASE WHEN TG_OP='INSERT' THEN NEW.journey_id ELSE OLD.journey_id END)
  OR (TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM private.funded_movement_start_requests x WHERE x.journey_id=NEW.journey_id)) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Financial start meeting point is frozen'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$start_meeting_guard$;
CREATE TRIGGER protect_funded_start_meeting_point BEFORE INSERT OR UPDATE OR DELETE ON private.journey_meeting_points
 FOR EACH ROW EXECUTE FUNCTION private.protect_funded_start_meeting_point();
CREATE TRIGGER protect_funded_start_meeting_point_truncate BEFORE TRUNCATE ON private.journey_meeting_points
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_funded_start_meeting_point();

CREATE FUNCTION private.require_funded_start_actor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_actor$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; request private.funded_movement_start_requests%ROWTYPE;
BEGIN
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.alignment_id;
 j:=private.assert_funded_coordination_entry(a.id);
 IF NEW.journey_id IS DISTINCT FROM j.id OR a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pre-start graph required'; END IF;
 IF TG_TABLE_NAME='funded_movement_start_requests' THEN
  IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
  IF j.start_requested_at IS NOT NULL OR NEW.requested_at<j.created_at OR NEW.requested_at>clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM private.journey_meeting_points mp WHERE mp.journey_id=j.id AND mp.revision=NEW.meeting_point_revision
    AND mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]') THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact valid meeting point required'; END IF;
 ELSE
  IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
  SELECT x.* INTO request FROM private.funded_movement_start_requests x WHERE x.alignment_id=a.id;
  IF request.alignment_id IS NULL OR request.journey_id<>j.id OR NEW.started_at<request.requested_at OR NEW.started_at>clock_timestamp() THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer request required'; END IF;
 END IF;
 RETURN NEW;
END;
$start_actor$;
CREATE TRIGGER require_funded_start_request_actor BEFORE INSERT ON private.funded_movement_start_requests
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_start_actor();
CREATE TRIGGER require_funded_start_actor BEFORE INSERT ON private.funded_movement_starts
 FOR EACH ROW EXECUTE FUNCTION private.require_funded_start_actor();

-- Atomic final-graph checks also cover direct trusted writers. A receipt alone,
-- one advanced operational row, or a timestamp mismatch cannot commit.
CREATE FUNCTION private.validate_funded_start_graph()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_complete$
DECLARE selected_alignment uuid;
BEGIN
 IF TG_TABLE_NAME='alignments' THEN selected_alignment:=NEW.id; ELSE selected_alignment:=NEW.alignment_id; END IF;
 IF EXISTS(SELECT 1 FROM private.funded_movement_coordination_entries WHERE alignment_id=selected_alignment) THEN
  PERFORM private.assert_funded_coordination_entry(selected_alignment);
 END IF;
 RETURN NULL;
END;
$start_complete$;
CREATE CONSTRAINT TRIGGER funded_start_request_complete AFTER INSERT ON private.funded_movement_start_requests
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_start_graph();
CREATE CONSTRAINT TRIGGER funded_start_complete AFTER INSERT ON private.funded_movement_starts
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_start_graph();
CREATE CONSTRAINT TRIGGER funded_start_journey_complete AFTER UPDATE ON public.journeys
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_start_graph();
CREATE CONSTRAINT TRIGGER funded_start_alignment_complete AFTER UPDATE ON public.alignments
 DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION private.validate_funded_start_graph();

CREATE OR REPLACE FUNCTION public.get_my_movement_coordination_status(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT mp.place_text,mp.revision,c.journey_status,c.requested_at,c.began_at,
    (auth.uid() IN (c.offering_id,c.requester_id) AND c.journey_status='not_started' AND c.requested_at IS NULL),
    (auth.uid()=c.offering_id AND c.journey_status='not_started' AND c.requested_at IS NULL AND coalesce((mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]'),false)),
    (auth.uid()=c.requester_id AND c.journey_status='not_started' AND c.requested_at IS NOT NULL AND coalesce((mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]'),false))
  FROM private.movement_coordination_context(p_movement_need_id) c
  LEFT JOIN private.journey_meeting_points mp ON mp.journey_id=c.journey_id;
$$;

-- Additive projection: preserve all existing eight-field RPC signatures.
CREATE FUNCTION public.get_my_movement_start_status(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
 start_requested_at timestamptz, started_at timestamptz,
 can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean, start_authority text)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $start_projection$
 SELECT mp.place_text,mp.revision,c.journey_status,c.requested_at,c.began_at,
  (auth.uid() IN (c.offering_id,c.requester_id) AND c.journey_status='not_started' AND c.requested_at IS NULL),
  (auth.uid()=c.offering_id AND c.journey_status='not_started' AND c.requested_at IS NULL AND mp.journey_id IS NOT NULL),
  (auth.uid()=c.requester_id AND c.journey_status='not_started' AND c.requested_at IS NOT NULL AND mp.journey_id IS NOT NULL),
  CASE WHEN private.is_financial_alignment(c.alignment_id) THEN 'funded'::text ELSE 'legacy'::text END
 FROM private.movement_coordination_context(p_movement_need_id) c
 LEFT JOIN private.journey_meeting_points mp ON mp.journey_id=c.journey_id;
$start_projection$;

CREATE FUNCTION public.request_my_funded_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
 start_requested_at timestamptz, started_at timestamptz,
 can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean, start_authority text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_request$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; mp private.journey_meeting_points%ROWTYPE; stamp timestamptz;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF auth.uid() IS DISTINCT FROM a.offering_member_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact offerer required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 -- Historical exact replay performs no operational or evidence writes.
 IF EXISTS(SELECT 1 FROM private.funded_movement_start_requests WHERE alignment_id=a.id) THEN
  RETURN QUERY SELECT * FROM public.get_my_movement_start_status(p_movement_need_id); RETURN;
 END IF;
 IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact pre-start coordination required'; END IF;
 SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id FOR SHARE;
 IF mp.journey_id IS NULL OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Valid meeting point required'; END IF;
 -- All graph/journey/meeting-point waits and revalidation precede this instant.
 stamp:=clock_timestamp();
 BEGIN
  SET CONSTRAINTS private.funded_start_request_complete,private.funded_start_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete DEFERRED;
  INSERT INTO private.funded_movement_start_requests VALUES(a.id,j.id,stamp,mp.revision);
  UPDATE public.journeys x SET start_requested_at=stamp,updated_at=stamp WHERE x.id=j.id;
  PERFORM private.assert_funded_coordination_entry(a.id);
  SET CONSTRAINTS private.funded_start_request_complete,private.funded_start_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete IMMEDIATE;
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 RETURN QUERY SELECT * FROM public.get_my_movement_start_status(p_movement_need_id);
END;
$start_request$;

CREATE FUNCTION public.confirm_my_funded_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
 start_requested_at timestamptz, started_at timestamptz,
 can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean, start_authority text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $start_confirm$
DECLARE a public.alignments%ROWTYPE; j public.journeys%ROWTYPE; mp private.journey_meeting_points%ROWTYPE; stamp timestamptz;
BEGIN
 a:=private.funded_coordination_alignment(p_movement_need_id);
 IF auth.uid() IS DISTINCT FROM a.member_needing_movement_id THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Exact requester required'; END IF;
 PERFORM x.id FROM public.journeys x WHERE x.alignment_id=a.id FOR UPDATE;
 j:=private.assert_funded_coordination_entry(a.id);
 -- Historical exact replay performs no operational or evidence writes.
 IF EXISTS(SELECT 1 FROM private.funded_movement_starts WHERE alignment_id=a.id) THEN
  RETURN QUERY SELECT * FROM public.get_my_movement_start_status(p_movement_need_id); RETURN;
 END IF;
 IF a.status<>'activated' OR j.status<>'not_started' OR j.started_at IS NOT NULL OR j.start_requested_at IS NULL THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact offerer request required'; END IF;
 SELECT x.* INTO mp FROM private.journey_meeting_points x WHERE x.journey_id=j.id FOR SHARE;
 IF mp.journey_id IS NULL OR mp.place_text<>btrim(mp.place_text) OR length(mp.place_text) NOT BETWEEN 1 AND 200 OR mp.place_text !~ '[^[:space:]]' THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Valid meeting point required'; END IF;
 -- All graph/journey/meeting-point waits and revalidation precede this instant.
 stamp:=clock_timestamp();
 BEGIN
  SET CONSTRAINTS private.funded_start_request_complete,private.funded_start_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete DEFERRED;
  INSERT INTO private.funded_movement_starts VALUES(a.id,j.id,stamp);
  UPDATE public.journeys x SET status='in_progress',started_at=stamp,updated_at=stamp WHERE x.id=j.id;
  UPDATE public.alignments x SET status='in_progress',updated_at=stamp WHERE x.id=a.id;
  PERFORM private.assert_funded_coordination_entry(a.id);
  SET CONSTRAINTS private.funded_start_request_complete,private.funded_start_complete,public.funded_start_journey_complete,public.funded_start_alignment_complete IMMEDIATE;
 EXCEPTION WHEN OTHERS THEN RAISE;
 END;
 RETURN QUERY SELECT * FROM public.get_my_movement_start_status(p_movement_need_id);
END;
$start_confirm$;

REVOKE ALL ON FUNCTION private.protect_funded_start_meeting_point(),private.require_funded_start_actor(),private.validate_funded_start_graph()
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_movement_start_status(uuid),public.request_my_funded_movement_start(uuid),public.confirm_my_funded_movement_start(uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_movement_start_status(uuid),public.request_my_funded_movement_start(uuid),public.confirm_my_funded_movement_start(uuid) TO authenticated;

-- Existing offer immutability, funded activation, legacy start/end/completion
-- rejection and financial legacy-settlement guards remain installed unchanged.
-- No history repair or migration-history mutation. No payment or wallet writer.
COMMIT;
