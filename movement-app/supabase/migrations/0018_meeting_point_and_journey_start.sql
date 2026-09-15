BEGIN;

-- Prevent a concurrent legacy start request between preflight and installation
-- of the required-meeting-point trigger. Held only until this migration commits.
LOCK TABLE public.journeys IN SHARE ROW EXCLUSIVE MODE;

-- A legacy pending handshake has no recorded meeting point to freeze. Do not
-- invent one or reset a live request. Resolve these through reviewed operational
-- handling before installation; this preflight never repairs existing data.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.journeys WHERE status='not_started' AND start_requested_at IS NOT NULL) THEN
    RAISE EXCEPTION '0018 preflight: resolve legacy pending journey-start requests before installation';
  END IF;
END $$;

-- Human-readable coordination only. No coordinates or inferred private places.
CREATE TABLE private.journey_meeting_points (
  journey_id uuid PRIMARY KEY REFERENCES public.journeys(id) ON DELETE CASCADE,
  place_text text NOT NULL CHECK (place_text = btrim(place_text) AND length(place_text) BETWEEN 1 AND 200 AND place_text ~ '[^[:space:]]'),
  revision bigint NOT NULL CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.journey_meeting_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.journey_meeting_points FROM PUBLIC, anon, authenticated;
GRANT ALL ON private.journey_meeting_points TO service_role;

-- Reuse 0014's actual-participant, succeeded-payment and lifecycle checks.
-- Internal IDs never leave this private helper. Mutation locking follows 0008:
-- journey first, then alignment. Recheck eligibility after locks are acquired.
CREATE FUNCTION private.movement_coordination_context(p_need uuid, p_lock boolean DEFAULT false)
RETURNS TABLE (journey_id uuid, alignment_id uuid, offering_id uuid, requester_id uuid,
  journey_status text, requested_at timestamptz, began_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ids uuid[]; selected_id uuid; selected_alignment uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
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
REVOKE ALL ON FUNCTION private.movement_coordination_context(uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_my_movement_coordination_status(p_movement_need_id uuid)
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
REVOKE ALL ON FUNCTION public.get_my_movement_coordination_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_movement_coordination_status(uuid) TO authenticated;

CREATE FUNCTION public.set_my_movement_meeting_point(p_movement_need_id uuid,p_place_text text,p_expected_revision bigint)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record; current_revision bigint;
BEGIN
  SELECT * INTO c FROM private.movement_coordination_context(p_movement_need_id,true);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable'; END IF;
  IF auth.uid() NOT IN (c.offering_id,c.requester_id) OR c.journey_status<>'not_started' OR c.requested_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Coordination unavailable';
  END IF;
  IF p_place_text IS NULL OR length(btrim(p_place_text)) NOT BETWEEN 1 AND 200 OR p_place_text !~ '[^[:space:]]' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid meeting point';
  END IF;
  SELECT mp.revision INTO current_revision FROM private.journey_meeting_points mp WHERE mp.journey_id=c.journey_id;
  -- NULL expected revision means "no row yet"; never silently overwrite.
  IF p_expected_revision IS DISTINCT FROM current_revision THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='Meeting point changed; refresh and retry';
  END IF;
  IF current_revision IS NULL THEN
    INSERT INTO private.journey_meeting_points(journey_id,place_text,revision) VALUES(c.journey_id,btrim(p_place_text),1);
  ELSE
    UPDATE private.journey_meeting_points mp SET place_text=btrim(p_place_text),revision=mp.revision+1,updated_at=now() WHERE mp.journey_id=c.journey_id;
  END IF;
  RETURN QUERY SELECT * FROM public.get_my_movement_coordination_status(p_movement_need_id);
END;
$$;
REVOKE ALL ON FUNCTION public.set_my_movement_meeting_point(uuid,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_my_movement_meeting_point(uuid,text,bigint) TO authenticated;

-- Protect the still-authenticated legacy journey-ID RPC too. The row lock taken
-- by 0008 serializes this transition against edits. No old function is replaced.
CREATE FUNCTION private.require_meeting_point_on_start_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.start_requested_at IS NULL AND NEW.start_requested_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM private.journey_meeting_points mp WHERE mp.journey_id=NEW.id AND mp.place_text=btrim(mp.place_text) AND length(mp.place_text) BETWEEN 1 AND 200 AND mp.place_text ~ '[^[:space:]]'
  ) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Meeting point required'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_meeting_point_on_start_request() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER require_meeting_point_on_start_request BEFORE UPDATE OF start_requested_at ON public.journeys
FOR EACH ROW EXECUTE FUNCTION private.require_meeting_point_on_start_request();

CREATE FUNCTION public.request_my_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
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
REVOKE ALL ON FUNCTION public.request_my_movement_start(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_my_movement_start(uuid) TO authenticated;

CREATE FUNCTION public.confirm_my_movement_start(p_movement_need_id uuid)
RETURNS TABLE (meeting_point_text text, meeting_point_revision bigint, journey_state text,
  start_requested_at timestamptz, started_at timestamptz,
  can_edit_meeting_point boolean, can_request_start boolean, can_confirm_start boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c record;
BEGIN
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
REVOKE ALL ON FUNCTION public.confirm_my_movement_start(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_my_movement_start(uuid) TO authenticated;

COMMIT;
