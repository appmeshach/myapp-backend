BEGIN;

CREATE TABLE private.route_provider_quota_buckets (
  member_id uuid NOT NULL
    REFERENCES public.members(id)
    ON DELETE RESTRICT,

  window_kind text NOT NULL
    CHECK (
      window_kind IN (
        'minute',
        'day'
      )
    ),

  window_start timestamptz NOT NULL
    CHECK (isfinite(window_start)),

  request_count integer NOT NULL
    CHECK (request_count >= 0),

  updated_at timestamptz NOT NULL
    CHECK (isfinite(updated_at)),

  PRIMARY KEY (
    member_id,
    window_kind,
    window_start
  ),

  CHECK (
    window_start
      = date_trunc(
          window_kind,
          window_start AT TIME ZONE 'UTC'
        ) AT TIME ZONE 'UTC'
  )
);

ALTER TABLE
  private.route_provider_quota_buckets
ENABLE ROW LEVEL SECURITY;

REVOKE ALL
ON private.route_provider_quota_buckets
FROM PUBLIC, anon, authenticated, service_role;


-- Owner-only deterministic clock seam for rollback boundary tests.
-- NULL means actual server time sampled after the member lock.
CREATE FUNCTION private.consume_route_provider_quota_at(
  p_verified_member_id uuid,
  p_server_time timestamptz
)
RETURNS TABLE (
  admitted boolean,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $quota$
DECLARE
  v_now timestamptz;
  v_minute timestamptz;
  v_day timestamptz;

  v_minute_count integer;
  v_day_count integer;

  v_minute_limit integer := 10;
  v_day_limit integer := 100;

  v_retry integer := 0;
BEGIN
  IF current_setting(
    'transaction_isolation'
  ) <> 'read committed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '25000',
      MESSAGE =
        'Route quota requires READ COMMITTED';
  END IF;

  IF p_verified_member_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Route quota member is required';
  END IF;

  -- One existing member row serializes first-bucket creation
  -- for this member without mutating member data.
  PERFORM 1
  FROM public.members m
  WHERE m.id = p_verified_member_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Route quota member unavailable';
  END IF;

  v_now :=
    coalesce(
      p_server_time,
      clock_timestamp()
    );

  IF NOT isfinite(v_now) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE =
        'Invalid route quota time';
  END IF;

  v_minute :=
    date_trunc(
      'minute',
      v_now AT TIME ZONE 'UTC'
    ) AT TIME ZONE 'UTC';

  v_day :=
    date_trunc(
      'day',
      v_now AT TIME ZONE 'UTC'
    ) AT TIME ZONE 'UTC';

  SELECT b.request_count
  INTO v_minute_count
  FROM private.route_provider_quota_buckets b
  WHERE b.member_id = p_verified_member_id
    AND b.window_kind = 'minute'
    AND b.window_start = v_minute;

  SELECT b.request_count
  INTO v_day_count
  FROM private.route_provider_quota_buckets b
  WHERE b.member_id = p_verified_member_id
    AND b.window_kind = 'day'
    AND b.window_start = v_day;

  IF coalesce(
    v_minute_count,
    0
  ) >= v_minute_limit THEN
    v_retry :=
      greatest(
        1,
        ceil(
          extract(
            epoch FROM (
              v_minute
              + interval '1 minute'
              - v_now
            )
          )
        )::integer
      );
  END IF;

  IF coalesce(
    v_day_count,
    0
  ) >= v_day_limit THEN
    v_retry :=
      greatest(
        v_retry,
        ceil(
          extract(
            epoch FROM (
              (
                (
                  v_day
                  AT TIME ZONE 'UTC'
                )
                + interval '1 day'
              )
              AT TIME ZONE 'UTC'
            ) - v_now
          )
        )::integer
      );
  END IF;

  IF v_retry > 0 THEN
    RETURN QUERY
    SELECT
      false,
      least(
        86400,
        greatest(
          1,
          v_retry
        )
      );

    RETURN;
  END IF;

  -- Both quota windows are changed by one statement.
  -- Any later error rolls both changes back.
  INSERT INTO
    private.route_provider_quota_buckets AS b
    (
      member_id,
      window_kind,
      window_start,
      request_count,
      updated_at
    )
  VALUES
    (
      p_verified_member_id,
      'minute',
      v_minute,
      1,
      v_now
    ),
    (
      p_verified_member_id,
      'day',
      v_day,
      1,
      v_now
    )
  ON CONFLICT (
    member_id,
    window_kind,
    window_start
  )
  DO UPDATE SET
    request_count =
      b.request_count + 1,
    updated_at =
      EXCLUDED.updated_at;

  RETURN QUERY
  SELECT true, 0;
END;
$quota$;

REVOKE ALL ON FUNCTION
  private.consume_route_provider_quota_at(
    uuid,
    timestamptz
  )
FROM PUBLIC, anon, authenticated, service_role;


CREATE FUNCTION
  public.consume_route_provider_quota_for_server(
    p_verified_member_id uuid
  )
RETURNS TABLE (
  admitted boolean,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $server$
BEGIN
  RETURN QUERY
  SELECT
    q.admitted,
    q.retry_after_seconds
  FROM
    private.consume_route_provider_quota_at(
      p_verified_member_id,
      NULL::timestamptz
    ) q;
END;
$server$;

REVOKE ALL ON FUNCTION
  public.consume_route_provider_quota_for_server(
    uuid
  )
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.consume_route_provider_quota_for_server(
    uuid
  )
TO service_role;

COMMIT;