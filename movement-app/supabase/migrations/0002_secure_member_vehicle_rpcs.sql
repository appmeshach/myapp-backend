BEGIN;

-- =========================================================
-- Secure member and vehicle RPCs
-- =========================================================
-- These functions are SECURITY DEFINER because direct table writes are
-- intentionally restricted by RLS. They provide a narrow, auditable path
-- for authenticated members to update their own profile and register a vehicle
-- they currently have access to use.

-- =========================================================
-- public.update_my_profile
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_first_name text,
  p_date_of_birth date
)
RETURNS TABLE (
  id uuid,
  first_name text,
  date_of_birth date,
  identity_verified boolean,
  profile_media_verified boolean,
  common_movement_area text,
  completed_movements integer,
  rating numeric,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_trimmed_first_name text;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_trimmed_first_name := trim(p_first_name);

  IF v_trimmed_first_name IS NULL OR v_trimmed_first_name = '' THEN
    RAISE EXCEPTION 'First name is required';
  END IF;

  IF length(v_trimmed_first_name) > 100 THEN
    RAISE EXCEPTION 'First name must be 100 characters or fewer';
  END IF;

  IF p_date_of_birth IS NOT NULL AND p_date_of_birth > CURRENT_DATE THEN
    RAISE EXCEPTION 'Date of birth cannot be in the future';
  END IF;

  UPDATE public.members
  SET
    first_name = v_trimmed_first_name,
    date_of_birth = p_date_of_birth
  WHERE public.members.id = v_member_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member record not found for the authenticated user';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.first_name,
    m.date_of_birth,
    m.identity_verified,
    m.profile_media_verified,
    m.common_movement_area,
    m.completed_movements,
    m.rating,
    m.created_at,
    m.updated_at
  FROM public.members AS m
  WHERE m.id = v_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, date) TO authenticated;

-- =========================================================
-- public.register_vehicle_with_access
-- =========================================================
CREATE OR REPLACE FUNCTION public.register_vehicle_with_access(
  p_make text,
  p_model text,
  p_year integer,
  p_color text,
  p_seat_capacity integer
)
RETURNS TABLE (
  vehicle_id uuid,
  access_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_member_id uuid;
  v_make text;
  v_model text;
  v_color text;
  v_vehicle_id uuid;
  v_access_id uuid;
BEGIN
  v_member_id := auth.uid();

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  v_make := trim(p_make);
  v_model := trim(p_model);
  v_color := trim(p_color);

  IF v_make IS NULL OR v_make = '' THEN
    RAISE EXCEPTION 'Make is required';
  END IF;

  IF v_model IS NULL OR v_model = '' THEN
    RAISE EXCEPTION 'Model is required';
  END IF;

  IF v_color IS NULL OR v_color = '' THEN
    RAISE EXCEPTION 'Color is required';
  END IF;

  IF length(v_make) > 100 THEN
    RAISE EXCEPTION 'Make must be 100 characters or fewer';
  END IF;

  IF length(v_model) > 100 THEN
    RAISE EXCEPTION 'Model must be 100 characters or fewer';
  END IF;

  IF length(v_color) > 100 THEN
    RAISE EXCEPTION 'Color must be 100 characters or fewer';
  END IF;

  IF p_year IS NOT NULL AND (p_year < 1900 OR p_year > 2100) THEN
    RAISE EXCEPTION 'Year must be between 1900 and 2100';
  END IF;

  IF p_seat_capacity IS NULL THEN
    RAISE EXCEPTION 'Seat capacity is required';
  END IF;

  IF p_seat_capacity < 1 OR p_seat_capacity > 12 THEN
    RAISE EXCEPTION 'Seat capacity must be between 1 and 12';
  END IF;

  INSERT INTO public.vehicles (
    make,
    model,
    year,
    color,
    seat_capacity
  )
  VALUES (
    v_make,
    v_model,
    p_year,
    v_color,
    p_seat_capacity
  )
  RETURNING public.vehicles.id INTO v_vehicle_id;

  INSERT INTO public.member_vehicle_access (
    member_id,
    vehicle_id,
    active
  )
  VALUES (
    v_member_id,
    v_vehicle_id,
    TRUE
  )
  RETURNING public.member_vehicle_access.id INTO v_access_id;

  RETURN QUERY
  SELECT v_vehicle_id, v_access_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_vehicle_with_access(text, text, integer, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_vehicle_with_access(text, text, integer, text, integer) TO authenticated;

COMMIT;
