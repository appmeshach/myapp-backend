BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- Core movement app schema
-- =========================================================

-- =========================================================
-- Members
-- =========================================================
-- Trust-sensitive member fields are system-managed and must not be populated
-- from untrusted metadata. Discovery will later use controlled masked-data RPCs.
CREATE TABLE public.members (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  date_of_birth DATE,
  identity_verified BOOLEAN NOT NULL DEFAULT FALSE,
  profile_media_verified BOOLEAN NOT NULL DEFAULT FALSE,
  common_movement_area TEXT NULL,
  completed_movements INTEGER NOT NULL DEFAULT 0,
  rating NUMERIC(3, 2) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (completed_movements >= 0),
  CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5))
);

ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_select_own" ON public.members
FOR SELECT
TO authenticated
USING ((select auth.uid()) = id);

-- No direct client insert/update policy. The member row is created by a secure
-- trigger after a new auth.users record is inserted.

-- =========================================================
-- Member media
-- =========================================================
CREATE TABLE public.member_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'video')),
  storage_path TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.member_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_media_select_own" ON public.member_media
FOR SELECT
TO authenticated
USING (member_id = (select auth.uid()));

-- Direct client insert/update/delete are intentionally disabled here.
-- Later controlled media functions and storage policies will manage writes.

-- =========================================================
-- Vehicles
-- =========================================================
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER NULL,
  color TEXT NOT NULL,
  seat_capacity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (seat_capacity BETWEEN 1 AND 12),
  CHECK (year IS NULL OR (year BETWEEN 1900 AND 2100))
);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Member vehicle access
-- =========================================================
-- member_vehicle_access means declared/current vehicle access in the app,
-- not legal ownership of the vehicle. This table does not prove title, registration,
-- or any other legal right to own or drive the vehicle.
CREATE TABLE public.member_vehicle_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (member_id, vehicle_id)
);

ALTER TABLE public.member_vehicle_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_vehicle_access_select_own" ON public.member_vehicle_access
FOR SELECT
TO authenticated
USING (member_id = (select auth.uid()));

-- Direct client insert/update/delete are intentionally disabled.
-- Later a controlled vehicle registration/access RPC will create and manage these rows.

CREATE POLICY "vehicles_select_active_access" ON public.vehicles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.member_vehicle_access mva
    WHERE mva.vehicle_id = vehicles.id
      AND mva.member_id = (select auth.uid())
      AND mva.active = TRUE
  )
);

-- Direct client insert/update/delete are intentionally disabled.
-- Later secure RPCs will register and manage vehicle access by member.

-- =========================================================
-- Movement needs
-- =========================================================
CREATE TABLE public.movement_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  origin_area TEXT NOT NULL,
  destination_area TEXT NOT NULL,
  earliest_departure_at TIMESTAMPTZ NOT NULL,
  latest_departure_at TIMESTAMPTZ NULL,
  people_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'discoverable'
    CHECK (status IN ('discoverable', 'paused', 'expired', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (people_count >= 1),
  CHECK (
    latest_departure_at IS NULL
    OR latest_departure_at >= earliest_departure_at
  )
);

ALTER TABLE public.movement_needs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "movement_needs_select_own" ON public.movement_needs
FOR SELECT
TO authenticated
USING (member_id = (select auth.uid()));

CREATE POLICY "movement_needs_insert_own" ON public.movement_needs
FOR INSERT
TO authenticated
WITH CHECK (member_id = (select auth.uid()));

CREATE POLICY "movement_needs_update_own" ON public.movement_needs
FOR UPDATE
TO authenticated
USING (member_id = (select auth.uid()))
WITH CHECK (member_id = (select auth.uid()));

CREATE POLICY "movement_needs_delete_own" ON public.movement_needs
FOR DELETE
TO authenticated
USING (member_id = (select auth.uid()));

-- =========================================================
-- Movement offers
-- =========================================================
CREATE TABLE public.movement_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_need_id UUID NOT NULL REFERENCES public.movement_needs(id) ON DELETE CASCADE,
  offering_member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  seats_offered INTEGER NOT NULL,
  proposed_pickup_area TEXT NULL,
  proposed_dropoff_area TEXT NULL,
  estimated_arrival_minutes INTEGER NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (seats_offered >= 1),
  CHECK (estimated_arrival_minutes IS NULL OR estimated_arrival_minutes >= 0)
);

ALTER TABLE public.movement_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "movement_offers_select_own" ON public.movement_offers
FOR SELECT
TO authenticated
USING (offering_member_id = (select auth.uid()));

CREATE POLICY "movement_offers_select_related_need" ON public.movement_offers
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.movement_needs mn
    WHERE mn.id = movement_need_id
      AND mn.member_id = (select auth.uid())
  )
);

-- Direct client insert/update/delete are intentionally disabled.
-- Offer creation and changes will be handled by secure RPCs later.

-- =========================================================
-- Alignments
-- =========================================================
CREATE TABLE public.alignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_need_id UUID NOT NULL REFERENCES public.movement_needs(id),
  movement_offer_id UUID NOT NULL REFERENCES public.movement_offers(id),
  member_needing_movement_id UUID NOT NULL REFERENCES public.members(id),
  offering_member_id UUID NOT NULL REFERENCES public.members(id),
  activation_fee_minor BIGINT NULL,
  activation_currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'awaiting_activation_payment'
    CHECK (status IN (
      'awaiting_activation_payment',
      'activated',
      'in_progress',
      'completed',
      'cancelled',
      'failed'
    )),
  activated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (activation_fee_minor IS NULL OR activation_fee_minor >= 0),
  CHECK (activation_currency ~ '^[A-Z]{3}$'),
  CHECK (member_needing_movement_id <> offering_member_id),
  UNIQUE (movement_offer_id)
);

ALTER TABLE public.alignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "alignments_select_participants" ON public.alignments
FOR SELECT
TO authenticated
USING (
  member_needing_movement_id = (select auth.uid())
  OR offering_member_id = (select auth.uid())
);

-- No general client INSERT or UPDATE policies for alignments.
-- Creation and activation will later be controlled by secure database logic.

-- =========================================================
-- Journeys
-- =========================================================
CREATE TABLE public.journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alignment_id UUID NOT NULL UNIQUE REFERENCES public.alignments(id),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'cancelled', 'failed')),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    completed_at IS NULL
    OR started_at IS NULL
    OR completed_at >= started_at
  )
);

ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journeys_select_participants" ON public.journeys
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.alignments a
    WHERE a.id = alignment_id
      AND (
        a.member_needing_movement_id = (select auth.uid())
        OR a.offering_member_id = (select auth.uid())
      )
  )
);

-- No client INSERT or UPDATE policies by design for the initial migration.

-- =========================================================
-- Journey reviews
-- =========================================================
CREATE TABLE public.journey_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  reviewer_member_id UUID NOT NULL REFERENCES public.members(id),
  reviewed_member_id UUID NOT NULL REFERENCES public.members(id),
  overall_rating INTEGER NOT NULL CHECK (overall_rating BETWEEN 1 AND 5),
  would_move_together_again BOOLEAN NULL,
  punctuality_rating INTEGER NULL CHECK (punctuality_rating IS NULL OR punctuality_rating BETWEEN 1 AND 5),
  respect_rating INTEGER NULL CHECK (respect_rating IS NULL OR respect_rating BETWEEN 1 AND 5),
  communication_rating INTEGER NULL CHECK (communication_rating IS NULL OR communication_rating BETWEEN 1 AND 5),
  profile_resemblance_confirmed BOOLEAN NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reviewer_member_id <> reviewed_member_id),
  UNIQUE (journey_id, reviewer_member_id, reviewed_member_id)
);

ALTER TABLE public.journey_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journey_reviews_select_relevant" ON public.journey_reviews
FOR SELECT
TO authenticated
USING (
  reviewer_member_id = (select auth.uid())
  OR reviewed_member_id = (select auth.uid())
);

-- Direct client insert/update/delete are intentionally disabled.
-- Later review submission RPCs will validate journey completion and participation.

-- =========================================================
-- Indexes
-- =========================================================
DROP INDEX IF EXISTS idx_vehicles_owner_member_id;

CREATE INDEX idx_member_media_member_id ON public.member_media(member_id);
CREATE INDEX idx_member_vehicle_access_member_id ON public.member_vehicle_access(member_id);
CREATE INDEX idx_member_vehicle_access_vehicle_id ON public.member_vehicle_access(vehicle_id);
CREATE INDEX idx_member_vehicle_access_active ON public.member_vehicle_access(active);
CREATE INDEX idx_movement_needs_member_id ON public.movement_needs(member_id);
CREATE INDEX idx_movement_needs_status ON public.movement_needs(status);
CREATE INDEX idx_movement_needs_earliest_departure_at ON public.movement_needs(earliest_departure_at);
CREATE INDEX idx_movement_offers_movement_need_id ON public.movement_offers(movement_need_id);
CREATE INDEX idx_movement_offers_offering_member_id ON public.movement_offers(offering_member_id);
CREATE INDEX idx_movement_offers_status ON public.movement_offers(status);
CREATE INDEX idx_alignments_member_needing_movement_id ON public.alignments(member_needing_movement_id);
CREATE INDEX idx_alignments_offering_member_id ON public.alignments(offering_member_id);
CREATE INDEX idx_alignments_status ON public.alignments(status);
CREATE INDEX idx_journeys_alignment_id ON public.journeys(alignment_id);
CREATE INDEX idx_journey_reviews_journey_id ON public.journey_reviews(journey_id);
CREATE INDEX idx_journey_reviews_reviewed_member_id ON public.journey_reviews(reviewed_member_id);

-- =========================================================
-- Trigger helper for updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_members
BEFORE UPDATE ON public.members
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_vehicles
BEFORE UPDATE ON public.vehicles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_movement_needs
BEFORE UPDATE ON public.movement_needs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_movement_offers
BEFORE UPDATE ON public.movement_offers
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_alignments
BEFORE UPDATE ON public.alignments
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_journeys
BEFORE UPDATE ON public.journeys
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- Auth user bootstrap
-- =========================================================
-- This creates the public.members row after auth.users is inserted, while keeping
-- trust-sensitive member fields system-managed and out of untrusted metadata.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.members (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user();

COMMIT;
