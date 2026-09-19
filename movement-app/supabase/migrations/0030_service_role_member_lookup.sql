BEGIN;

-- Server-side membership lookup requires table SELECT even when RLS is bypassed.
GRANT SELECT ON TABLE public.members TO service_role;

COMMIT;
