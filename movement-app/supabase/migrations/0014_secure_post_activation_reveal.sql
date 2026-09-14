BEGIN;

-- Post-activation reveal. Existing discovery, invitation, capacity, payment,
-- start and mutual-end functions are intentionally unchanged.
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS plate_number text,
  ALTER COLUMN model DROP NOT NULL;

ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_reveal_make_nonblank CHECK (btrim(make) <> ''),
  ADD CONSTRAINT vehicles_reveal_color_nonblank CHECK (btrim(color) <> ''),
  ADD CONSTRAINT vehicles_plate_number_valid CHECK (
    plate_number IS NULL OR
    (plate_number = btrim(plate_number) AND length(plate_number) BETWEEN 1 AND 32)
  );

COMMENT ON COLUMN public.vehicles.plate_number IS
  'Declared plate collected privately at registration; not proof of verification, legal ownership or a right to drive. Reveal to other members only after successful activation.';

-- A column REVOKE alone cannot override the table-wide SELECT from 0004.
-- Preserve existing own-vehicle reads under RLS, excluding the new plate.
REVOKE SELECT ON TABLE public.vehicles FROM PUBLIC, anon, authenticated;
REVOKE ALL (plate_number) ON public.vehicles FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, make, model, year, color, seat_capacity, created_at, updated_at)
  ON public.vehicles TO authenticated;

-- Media reads now go through controlled RPCs; no raw storage paths for clients.
REVOKE SELECT ON TABLE public.member_media FROM PUBLIC, anon, authenticated;

-- Internal registration helper, allowing an absent model. Only the plate-aware
-- SECURITY DEFINER wrapper below may use this on behalf of ordinary clients.
CREATE OR REPLACE FUNCTION public.register_vehicle_with_access(
  p_make text, p_model text, p_year integer, p_color text, p_seat_capacity integer
)
RETURNS TABLE (vehicle_id uuid, access_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid := auth.uid();
  v_make text := btrim(p_make);
  v_model text := nullif(btrim(p_model), '');
  v_color text := btrim(p_color);
  v_vehicle_id uuid;
  v_access_id uuid;
BEGIN
  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_make IS NULL OR v_make = '' OR length(v_make) > 100 THEN
    RAISE EXCEPTION 'Make is required and must be 100 characters or fewer';
  END IF;
  IF length(v_model) > 100 THEN
    RAISE EXCEPTION 'Model must be 100 characters or fewer';
  END IF;
  IF v_color IS NULL OR v_color = '' OR length(v_color) > 100 THEN
    RAISE EXCEPTION 'Color is required and must be 100 characters or fewer';
  END IF;
  IF p_year IS NOT NULL AND (p_year < 1900 OR p_year > 2100) THEN
    RAISE EXCEPTION 'Year must be between 1900 and 2100';
  END IF;
  IF p_seat_capacity IS NULL OR p_seat_capacity NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'Seat capacity must be between 1 and 12';
  END IF;

  INSERT INTO public.vehicles (make, model, year, color, seat_capacity)
  VALUES (v_make, v_model, p_year, v_color, p_seat_capacity)
  RETURNING id INTO v_vehicle_id;
  INSERT INTO public.member_vehicle_access (member_id, vehicle_id, active)
  VALUES (v_member_id, v_vehicle_id, true)
  RETURNING id INTO v_access_id;
  RETURN QUERY SELECT v_vehicle_id, v_access_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_vehicle_with_access(text, text, integer, text, integer)
  FROM PUBLIC, anon, authenticated;

-- Separate name avoids PostgREST overload ambiguity. All app registrations must
-- collect a plate atomically with registration; the old RPC is internal only.
-- Clients can supply a plate only for the vehicle being created in this call;
-- declared access never authorizes overwriting another vehicle's plate.
-- Existing plate-less rows are retained but cannot enter a new alignment or
-- activate. Trusted platform infrastructure must backfill/correct their plates;
-- no client UPDATE grant or arbitrary-ID setter is provided.
-- Collection is not verification: verification workflow/evidence comes later.
CREATE FUNCTION public.register_vehicle_with_plate(
  p_make text, p_model text, p_year integer, p_color text,
  p_seat_capacity integer, p_plate_number text
)
RETURNS TABLE (vehicle_id uuid, access_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plate text := btrim(p_plate_number);
  v_vehicle_id uuid;
  v_access_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF v_plate IS NULL OR length(v_plate) NOT BETWEEN 1 AND 32
    OR v_plate ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Plate number must contain 1 to 32 characters without control characters';
  END IF;

  SELECT registered.vehicle_id, registered.access_id
  INTO v_vehicle_id, v_access_id
  FROM public.register_vehicle_with_access(
    p_make, p_model, p_year, p_color, p_seat_capacity
  ) registered;

  UPDATE public.vehicles v SET plate_number = v_plate WHERE v.id = v_vehicle_id;
  RETURN QUERY SELECT v_vehicle_id, v_access_id;
END;
$$;
REVOKE ALL ON FUNCTION public.register_vehicle_with_plate(text, text, integer, text, integer, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_vehicle_with_plate(text, text, integer, text, integer, text)
  TO authenticated;

-- Enforce at acceptance (alignment INSERT), not just offer creation: old pending
-- offers are covered too. Recheck activation to cover alignments that predate
-- 0014 and trusted plate corrections between acceptance and payment success.
-- This augments, rather than replaces, every group/capacity check in 0013.
-- The selected vehicle is locked until transaction end so its plate cannot be
-- cleared concurrently with acceptance/activation. A failure rolls back the
-- entire acceptance or payment-success transaction, including its other writes.
CREATE FUNCTION private.require_alignment_vehicle_plate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plate text;
BEGIN
  -- Do not obstruct mutual completion/cancellation of historical movements.
  IF TG_OP = 'UPDATE' AND NEW.status NOT IN (
    'awaiting_activation_payment', 'activated', 'in_progress'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT v.plate_number INTO v_plate
  FROM public.movement_offers mo
  JOIN public.vehicles v ON v.id = mo.vehicle_id
  WHERE mo.id = NEW.movement_offer_id
    AND mo.movement_need_id = NEW.movement_need_id
    AND mo.offering_member_id = NEW.offering_member_id
  FOR SHARE OF v;

  IF NOT FOUND OR v_plate IS NULL OR btrim(v_plate) = '' THEN
    RAISE EXCEPTION 'A vehicle plate must be recorded before alignment or activation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_alignment_vehicle_plate()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER require_alignment_vehicle_plate
  BEFORE INSERT OR UPDATE OF movement_offer_id, movement_need_id, offering_member_id, status
  ON public.alignments
  FOR EACH ROW EXECUTE FUNCTION private.require_alignment_vehicle_plate();

-- Internal authorization and subject selection shared by both reveals and photo
-- redemption. Never grant clients access: it accepts a trusted viewer UUID.
-- Need IDs are already available to invitees through the invitation RPC.
-- STABLE keeps authorization and subject reads on the calling query's snapshot.
CREATE FUNCTION private.post_activation_reveal_subjects(
  p_movement_need_id uuid, p_viewer_member_id uuid
)
RETURNS TABLE (alignment_id uuid, vehicle_id uuid, subject_member_id uuid,
  subject_role text, subject_number integer)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH eligible AS (
    SELECT a.id, a.offering_member_id, a.member_needing_movement_id,
      a.movement_need_id, j.vehicle_id
    FROM public.alignments a
    JOIN public.movement_needs mn ON mn.id = a.movement_need_id
      AND mn.member_id = a.member_needing_movement_id AND mn.status = 'closed'
    JOIN public.movement_offers mo ON mo.id = a.movement_offer_id
      AND mo.movement_need_id = a.movement_need_id
      AND mo.offering_member_id = a.offering_member_id AND mo.status = 'accepted'
    JOIN public.journeys j ON j.alignment_id = a.id AND j.vehicle_id = mo.vehicle_id
    WHERE a.movement_need_id = p_movement_need_id
      AND p_viewer_member_id IS NOT NULL
      AND a.activated_at IS NOT NULL
      AND ((a.status = 'activated' AND j.status = 'not_started')
        OR (a.status = 'in_progress' AND j.status = 'in_progress')
        OR (a.status = 'completed' AND j.status = 'completed'))
      AND EXISTS (
        SELECT 1 FROM private.alignment_activation_payments ap
        WHERE ap.alignment_id = a.id AND ap.status = 'succeeded'
          AND ap.succeeded_at IS NOT NULL
          AND ap.payer_member_id = a.offering_member_id
          AND ap.amount_minor = a.activation_fee_minor
          AND ap.currency = a.activation_currency
      )
      AND (p_viewer_member_id = a.offering_member_id OR EXISTS (
        SELECT 1 FROM public.movement_participants mp
        WHERE mp.movement_need_id = a.movement_need_id
          AND mp.member_id = p_viewer_member_id AND mp.status = 'confirmed'
          AND ((mp.role = 'primary_requester' AND mp.member_id = a.member_needing_movement_id)
            OR (mp.role = 'invited_participant' AND mp.member_id <> a.member_needing_movement_id))
      ))
  ), subjects AS (
    -- Travellers see only the offering member through this reveal.
    SELECT e.id, e.vehicle_id, e.offering_member_id AS member_id,
      'offering_member'::text AS role, 1::bigint AS ordinal
    FROM eligible e WHERE p_viewer_member_id <> e.offering_member_id
    UNION ALL
    -- Offering member sees only the confirmed travellers of this movement.
    SELECT e.id, e.vehicle_id, mp.member_id, mp.role,
      row_number() OVER (ORDER BY
        CASE WHEN mp.role = 'primary_requester' THEN 0 ELSE 1 END, mp.created_at, mp.id)
    FROM eligible e
    JOIN public.movement_participants mp ON mp.movement_need_id = e.movement_need_id
    WHERE p_viewer_member_id = e.offering_member_id
      AND mp.status = 'confirmed' AND mp.member_id <> e.offering_member_id
      AND ((mp.role = 'primary_requester' AND mp.member_id = e.member_needing_movement_id)
        OR (mp.role = 'invited_participant' AND mp.member_id <> e.member_needing_movement_id))
  )
  SELECT s.id, s.vehicle_id, s.member_id, s.role, s.ordinal::integer FROM subjects s;
$$;
REVOKE ALL ON FUNCTION private.post_activation_reveal_subjects(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

-- Opaque, short-lived photo references, not media/member IDs or signed storage
-- URLs (which would disclose object paths). One slot per viewer/alignment/subject
-- prevents repeated reveal calls from creating unbounded token rows.
CREATE TABLE private.post_activation_photo_tokens (
  viewer_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  alignment_id uuid NOT NULL REFERENCES public.alignments(id) ON DELETE CASCADE,
  subject_member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES public.member_media(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (viewer_member_id, alignment_id, subject_member_id)
);
ALTER TABLE private.post_activation_photo_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.post_activation_photo_tokens FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_post_activation_people(p_movement_need_id uuid)
RETURNS TABLE (
  person_number integer, person_role text, first_name text, age integer,
  verified boolean, rating numeric, completed_movements integer,
  profile_photo_token text, profile_photo_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_viewer uuid := auth.uid();
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Authorization, photo selection, token issuance and profile projection share
  -- one SQL statement snapshot. Unauthorized/missing/inactive needs return no rows.
  RETURN QUERY
  WITH subjects AS MATERIALIZED (
    SELECT s.*, m.first_name, m.date_of_birth,
      (m.identity_verified AND m.profile_media_verified) AS verified,
      m.rating, m.completed_movements, photo.id AS media_id
    FROM private.post_activation_reveal_subjects(p_movement_need_id, v_viewer) s
    JOIN public.members m ON m.id = s.subject_member_id
    LEFT JOIN LATERAL (
      SELECT mm.id FROM public.member_media mm
      WHERE mm.member_id = s.subject_member_id AND mm.media_type = 'photo'
        AND mm.is_current AND mm.verified
      ORDER BY mm.created_at DESC, mm.id DESC LIMIT 1
    ) photo ON true
  ), issued AS (
    INSERT INTO private.post_activation_photo_tokens AS pt
      (viewer_member_id, alignment_id, subject_member_id, media_id, token, expires_at)
    SELECT v_viewer, s.alignment_id, s.subject_member_id, s.media_id,
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      statement_timestamp() + interval '5 minutes'
    FROM subjects s WHERE s.media_id IS NOT NULL
    ON CONFLICT (viewer_member_id, alignment_id, subject_member_id) DO UPDATE
      SET media_id = EXCLUDED.media_id, token = EXCLUDED.token,
          expires_at = EXCLUDED.expires_at
    RETURNING pt.alignment_id, pt.subject_member_id, pt.token, pt.expires_at
  )
  SELECT s.subject_number, s.subject_role, s.first_name,
    CASE WHEN s.date_of_birth <= CURRENT_DATE
      THEN extract(year FROM age(CURRENT_DATE, s.date_of_birth))::integer END,
    s.verified, s.rating, s.completed_movements, i.token, i.expires_at
  FROM subjects s LEFT JOIN issued i
    ON i.alignment_id = s.alignment_id AND i.subject_member_id = s.subject_member_id
  ORDER BY s.subject_number;
END;
$$;
REVOKE ALL ON FUNCTION public.get_post_activation_people(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_post_activation_people(uuid) TO authenticated;

CREATE FUNCTION public.get_post_activation_vehicle(p_movement_need_id uuid)
RETURNS TABLE (vehicle_display_name text, plate_number text)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  RETURN QUERY
  SELECT concat_ws(' ', btrim(v.color), btrim(v.make), nullif(btrim(v.model), '')),
    v.plate_number
  FROM public.vehicles v
  -- Fail closed for historical plate-less vehicles or later trusted corrections.
  WHERE nullif(btrim(v.plate_number), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM private.post_activation_reveal_subjects(p_movement_need_id, auth.uid()) s
    WHERE s.vehicle_id = v.id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_post_activation_vehicle(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_post_activation_vehicle(uuid) TO authenticated;

-- SERVER ONLY: an authenticated image proxy must verify the user's JWT and pass
-- its subject as p_viewer_member_id (never trust a client-supplied viewer ID).
-- Stream image bytes with Cache-Control: private, no-store; do not return this
-- path, redirect to Storage, or return a signed Storage URL to the client.
-- No storage bucket/proxy exists in 0001-0013: this is its database contract.
CREATE FUNCTION public.resolve_post_activation_photo_for_server(
  p_photo_token text, p_viewer_member_id uuid
)
RETURNS TABLE (storage_path text)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT mm.storage_path
  FROM private.post_activation_photo_tokens pt
  JOIN public.alignments a ON a.id = pt.alignment_id
  JOIN public.member_media mm ON mm.id = pt.media_id
    AND mm.member_id = pt.subject_member_id
    AND mm.media_type = 'photo' AND mm.is_current AND mm.verified
  WHERE pt.token = p_photo_token AND pt.viewer_member_id = p_viewer_member_id
    AND pt.expires_at > statement_timestamp()
    AND EXISTS (
      SELECT 1 FROM private.post_activation_reveal_subjects(a.movement_need_id, p_viewer_member_id) s
      WHERE s.alignment_id = pt.alignment_id AND s.subject_member_id = pt.subject_member_id
    )
    AND mm.id = (
      SELECT latest.id FROM public.member_media latest
      WHERE latest.member_id = pt.subject_member_id AND latest.media_type = 'photo'
        AND latest.is_current AND latest.verified
      ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
    );
$$;
REVOKE ALL ON FUNCTION public.resolve_post_activation_photo_for_server(text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_post_activation_photo_for_server(text, uuid)
  TO service_role;

COMMIT;
