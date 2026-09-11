BEGIN;

-- Authenticated members may directly SELECT these tables.
-- RLS still determines which rows each member can actually see.
GRANT SELECT ON TABLE
  public.members,
  public.member_media,
  public.vehicles,
  public.member_vehicle_access,
  public.movement_needs,
  public.movement_offers,
  public.alignments,
  public.journeys,
  public.journey_reviews
TO authenticated;

-- movement_needs is the only core table currently designed for
-- direct authenticated client writes.
-- Existing RLS restricts these operations to the member's own rows.
GRANT INSERT, UPDATE, DELETE
ON TABLE public.movement_needs
TO authenticated;

-- Keep system-controlled writes unavailable directly to authenticated users.
REVOKE INSERT, UPDATE, DELETE ON TABLE
  public.members,
  public.member_media,
  public.vehicles,
  public.member_vehicle_access,
  public.movement_offers,
  public.alignments,
  public.journeys,
  public.journey_reviews
FROM authenticated;

-- Anonymous users must have no direct table access to these application tables.
REVOKE ALL ON TABLE
  public.members,
  public.member_media,
  public.vehicles,
  public.member_vehicle_access,
  public.movement_needs,
  public.movement_offers,
  public.alignments,
  public.journeys,
  public.journey_reviews
FROM anon;

COMMIT;
