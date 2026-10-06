BEGIN;

-- WE DO NOT CREATE JOURNEYS. Only exact settled 0083 movements count.
-- The dormant 0001 review scaffold has no authorized producer. Existing values
-- require explicit reconciliation rather than silently creating a second history.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.journey_reviews)
  OR EXISTS(SELECT 1 FROM public.members WHERE rating IS NOT NULL OR completed_movements<>0) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Existing reputation requires reviewed reconciliation';
 END IF;
END $$;

CREATE TABLE private.completed_movement_principals (
 alignment_id uuid NOT NULL REFERENCES private.funded_movement_completions(alignment_id),
 member_id uuid NOT NULL REFERENCES public.members(id),
 person_role text NOT NULL CHECK(person_role IN ('offering_member','primary_requester')),
 completed_at timestamptz NOT NULL CHECK(isfinite(completed_at)),
 PRIMARY KEY(alignment_id,member_id), UNIQUE(alignment_id,person_role)
);
CREATE INDEX completed_movement_principals_member ON private.completed_movement_principals(member_id);
CREATE TABLE private.completed_movement_ratings (
 alignment_id uuid NOT NULL,
 reviewer_member_id uuid NOT NULL,
 reviewed_member_id uuid NOT NULL,
 stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),
 submitted_at timestamptz NOT NULL CHECK(isfinite(submitted_at)),
 PRIMARY KEY(alignment_id,reviewer_member_id,reviewed_member_id),
 FOREIGN KEY(alignment_id,reviewer_member_id) REFERENCES private.completed_movement_principals(alignment_id,member_id),
 FOREIGN KEY(alignment_id,reviewed_member_id) REFERENCES private.completed_movement_principals(alignment_id,member_id),
 CHECK(reviewer_member_id<>reviewed_member_id)
);
CREATE INDEX completed_movement_ratings_reviewed ON private.completed_movement_ratings(reviewed_member_id);
ALTER TABLE private.completed_movement_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.completed_movement_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.completed_movement_principals,private.completed_movement_ratings FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_completed_movement_principals BEFORE UPDATE OR DELETE OR TRUNCATE ON private.completed_movement_principals
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();
CREATE TRIGGER protect_completed_movement_ratings BEFORE UPDATE OR DELETE OR TRUNCATE ON private.completed_movement_ratings
 FOR EACH STATEMENT EXECUTE FUNCTION private.protect_wallet_ledger_row();

CREATE FUNCTION private.validate_completed_movement_principal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; stamp timestamptz;
BEGIN
 PERFORM private.assert_funded_coordination_entry(NEW.alignment_id);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=NEW.alignment_id;
 SELECT r.completed_at INTO STRICT stamp FROM private.funded_movement_completions r WHERE r.alignment_id=a.id;
 IF NEW.completed_at IS DISTINCT FROM stamp OR NEW.member_id IS DISTINCT FROM
  (CASE NEW.person_role WHEN 'offering_member' THEN a.offering_member_id WHEN 'primary_requester' THEN a.member_needing_movement_id END) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completed principal required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER validate_completed_movement_principal BEFORE INSERT ON private.completed_movement_principals
 FOR EACH ROW EXECUTE FUNCTION private.validate_completed_movement_principal();

-- Same member gates/order as 0083 settlement. Recompute after the gate wait,
-- using fresh READ COMMITTED statements. Numeric AVG/ROUND gives exact decimal
-- rounding to two places (positive half ties away from zero), NULL without votes.
CREATE FUNCTION private.refresh_completed_movement_reputation(p_members uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM m.id FROM public.members m WHERE m.id=ANY(p_members) ORDER BY m.id FOR UPDATE;
 UPDATE public.members m SET
  completed_movements=(SELECT count(*) FROM private.completed_movement_principals p WHERE p.member_id=m.id),
  rating=(SELECT round(avg(r.stars::numeric),2) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=m.id)
 WHERE m.id=ANY(p_members) AND (m.completed_movements,m.rating) IS DISTINCT FROM
  ((SELECT count(*)::integer FROM private.completed_movement_principals p WHERE p.member_id=m.id),
   (SELECT round(avg(r.stars::numeric),2) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=m.id));
END;
$$;

CREATE FUNCTION private.protect_member_reputation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.rating IS NOT NULL OR NEW.completed_movements<>0 THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Authoritative reputation required'; END IF;
 ELSIF (NEW.rating,NEW.completed_movements) IS DISTINCT FROM (OLD.rating,OLD.completed_movements) THEN
  IF NEW.completed_movements IS DISTINCT FROM (SELECT count(*) FROM private.completed_movement_principals p WHERE p.member_id=NEW.id)
   OR NEW.rating IS DISTINCT FROM (SELECT round(avg(r.stars::numeric),2) FROM private.completed_movement_ratings r WHERE r.reviewed_member_id=NEW.id) THEN
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Authoritative reputation required'; END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER protect_member_reputation BEFORE INSERT OR UPDATE ON public.members
 FOR EACH ROW EXECUTE FUNCTION private.protect_member_reputation();

CREATE FUNCTION private.record_completed_movement_principals(p_alignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; stamp timestamptz;
BEGIN
 -- Explicit historical validation; never infer completion from a live roster.
 PERFORM private.assert_funded_coordination_entry(p_alignment);
 SELECT x.* INTO STRICT a FROM public.alignments x WHERE x.id=p_alignment;
 SELECT r.completed_at INTO STRICT stamp FROM private.funded_movement_completions r WHERE r.alignment_id=a.id;
 IF a.status<>'completed' OR a.offering_member_id=a.member_needing_movement_id THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completed principals required'; END IF;
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 INSERT INTO private.completed_movement_principals VALUES
  (a.id,a.offering_member_id,'offering_member',stamp),
  (a.id,a.member_needing_movement_id,'primary_requester',stamp)
 ON CONFLICT DO NOTHING;
 IF (SELECT count(*) FROM private.completed_movement_principals p WHERE p.alignment_id=a.id)<>2
  OR NOT EXISTS(SELECT 1 FROM private.completed_movement_principals p WHERE p.alignment_id=a.id AND p.member_id=a.offering_member_id AND p.person_role='offering_member' AND p.completed_at=stamp)
  OR NOT EXISTS(SELECT 1 FROM private.completed_movement_principals p WHERE p.alignment_id=a.id AND p.member_id=a.member_needing_movement_id AND p.person_role='primary_requester' AND p.completed_at=stamp) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completed principals required'; END IF;
 PERFORM private.refresh_completed_movement_reputation(ARRAY[a.offering_member_id,a.member_needing_movement_id]);
END;
$$;
CREATE FUNCTION private.capture_completed_movement_reputation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.record_completed_movement_principals(NEW.alignment_id);
 RETURN NULL;
END;
$$;
-- Statement-end/deferred validation sees the entire 0083 writable CTE graph,
-- never the legitimate intermediate parent receipt before postings/lifecycle.
CREATE CONSTRAINT TRIGGER completed_movement_reputation
 AFTER INSERT ON private.funded_movement_completions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION private.capture_completed_movement_reputation();

CREATE FUNCTION private.completed_movement_rating_alignment(p_need uuid)
RETURNS public.alignments LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE;
BEGIN
 a:=private.funded_coordination_alignment(p_need,true);
 PERFORM j.id FROM public.journeys j WHERE j.alignment_id=a.id FOR UPDATE;
 PERFORM private.assert_funded_coordination_entry(a.id);
 IF a.status<>'completed' OR NOT EXISTS(SELECT 1 FROM private.funded_movement_completions r WHERE r.alignment_id=a.id) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact funded completion required'; END IF;
 PERFORM m.id FROM public.members m WHERE m.id IN(a.offering_member_id,a.member_needing_movement_id) ORDER BY m.id FOR UPDATE;
 IF (SELECT count(*) FROM private.completed_movement_principals p WHERE p.alignment_id=a.id)<>2
  OR NOT EXISTS(SELECT 1 FROM private.completed_movement_principals p JOIN private.funded_movement_completions r USING(alignment_id)
   WHERE p.alignment_id=a.id AND p.member_id=a.offering_member_id AND p.person_role='offering_member' AND p.completed_at=r.completed_at)
  OR NOT EXISTS(SELECT 1 FROM private.completed_movement_principals p JOIN private.funded_movement_completions r USING(alignment_id)
   WHERE p.alignment_id=a.id AND p.member_id=a.member_needing_movement_id AND p.person_role='primary_requester' AND p.completed_at=r.completed_at) THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact completed principals required'; END IF;
 RETURN a;
END;
$$;

-- Principal selectors are viewer-relative, matching 0014: travellers see the
-- offering member at 1; offerer sees the primary requester first at 1. Identity
-- comes from immutable completion principal receipts, not live ordinal sorting.
CREATE FUNCTION public.get_my_completed_movement_rating_targets(p_movement_need_id uuid)
RETURNS TABLE(person_number integer,person_role text,first_name text,rating numeric,
 completed_movements integer,already_rated boolean,my_stars integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE;
BEGIN
 a:=private.completed_movement_rating_alignment(p_movement_need_id);
 RETURN QUERY SELECT 1,p.person_role,m.first_name,m.rating,m.completed_movements,r.stars IS NOT NULL,r.stars
 FROM private.completed_movement_principals p JOIN public.members m ON m.id=p.member_id
 LEFT JOIN private.completed_movement_ratings r ON r.alignment_id=p.alignment_id
  AND r.reviewed_member_id=p.member_id AND r.reviewer_member_id=auth.uid()
 WHERE p.alignment_id=a.id AND p.member_id<>auth.uid();
END;
$$;
CREATE FUNCTION private.validate_completed_movement_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; need uuid; completed timestamptz;
BEGIN
 SELECT x.movement_need_id INTO STRICT need FROM public.alignments x WHERE x.id=NEW.alignment_id;
 a:=private.completed_movement_rating_alignment(need);
 SELECT r.completed_at INTO STRICT completed FROM private.funded_movement_completions r WHERE r.alignment_id=a.id;
 IF NEW.reviewer_member_id IS DISTINCT FROM auth.uid()
  OR NEW.reviewed_member_id IS DISTINCT FROM (CASE WHEN auth.uid()=a.offering_member_id THEN a.member_needing_movement_id ELSE a.offering_member_id END)
  OR NEW.submitted_at<completed OR NEW.submitted_at>clock_timestamp() THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Exact historical rating required'; END IF;
 RETURN NEW;
END;
$$;
CREATE FUNCTION private.refresh_completed_movement_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM private.refresh_completed_movement_reputation(ARRAY[NEW.reviewed_member_id]);
 RETURN NULL;
END;
$$;
CREATE TRIGGER validate_completed_movement_rating BEFORE INSERT ON private.completed_movement_ratings
 FOR EACH ROW EXECUTE FUNCTION private.validate_completed_movement_rating();
CREATE TRIGGER refresh_completed_movement_rating AFTER INSERT ON private.completed_movement_ratings
 FOR EACH ROW EXECUTE FUNCTION private.refresh_completed_movement_rating();
CREATE FUNCTION public.rate_my_completed_movement_person(p_movement_need_id uuid,p_person_number integer,p_stars integer)
RETURNS TABLE(person_number integer,person_role text,first_name text,rating numeric,
 completed_movements integer,already_rated boolean,my_stars integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.alignments%ROWTYPE; target uuid; prior integer;
BEGIN
 IF p_person_number IS NULL OR p_person_number<>1 OR p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Valid rating selection required'; END IF;
 a:=private.completed_movement_rating_alignment(p_movement_need_id);
 -- The selector has acquired agreement -> alignment -> journey -> sorted member
 -- gates, before any rating insertion. No aggregate read before the gate wait.
 SELECT p.member_id INTO STRICT target FROM private.completed_movement_principals p WHERE p.alignment_id=a.id AND p.member_id<>auth.uid();
 SELECT r.stars INTO prior FROM private.completed_movement_ratings r WHERE r.alignment_id=a.id
  AND r.reviewer_member_id=auth.uid() AND r.reviewed_member_id=target;
 IF prior IS NOT NULL AND prior<>p_stars THEN
  RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Submitted rating is immutable'; END IF;
 IF prior IS NULL THEN
  INSERT INTO private.completed_movement_ratings VALUES(a.id,auth.uid(),target,p_stars,clock_timestamp());
 END IF;
 RETURN QUERY SELECT * FROM public.get_my_completed_movement_rating_targets(p_movement_need_id);
END;
$$;

-- Existing exact funded receipts can be reconciled from their validated graph;
-- legacy completed journeys and confirmed invitees are intentionally excluded.
DO $$ DECLARE receipt record; BEGIN
 FOR receipt IN SELECT alignment_id FROM private.funded_movement_completions ORDER BY alignment_id LOOP
  PERFORM private.record_completed_movement_principals(receipt.alignment_id);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.refresh_completed_movement_reputation(uuid[]),private.protect_member_reputation(),
 private.record_completed_movement_principals(uuid),private.capture_completed_movement_reputation(),
 private.completed_movement_rating_alignment(uuid),private.validate_completed_movement_rating(),
 private.refresh_completed_movement_rating(),private.validate_completed_movement_principal() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.get_my_completed_movement_rating_targets(uuid),
 public.rate_my_completed_movement_person(uuid,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.get_my_completed_movement_rating_targets(uuid),
 public.rate_my_completed_movement_person(uuid,integer,integer) TO authenticated;
COMMIT;
