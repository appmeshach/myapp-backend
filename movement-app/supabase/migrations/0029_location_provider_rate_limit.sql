BEGIN;

CREATE TABLE private.location_provider_quota_buckets (
  member_id uuid NOT NULL REFERENCES public.members(id) ON DELETE RESTRICT,
  operation text NOT NULL CHECK (operation IN ('location_search','location_resolution')),
  window_kind text NOT NULL CHECK (window_kind IN ('minute','day')),
  window_start timestamptz NOT NULL CHECK (isfinite(window_start)),
  request_count integer NOT NULL CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL CHECK (isfinite(updated_at)),
  PRIMARY KEY (member_id,operation,window_kind,window_start),
  CHECK (window_start = date_trunc(window_kind,window_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
);
ALTER TABLE private.location_provider_quota_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.location_provider_quota_buckets FROM PUBLIC,anon,authenticated,service_role;

-- Owner-only deterministic clock seam for rollback boundary tests. NULL means
-- actual server time, sampled AFTER obtaining the lock (not transaction start).
CREATE FUNCTION private.consume_location_provider_quota_at(
  p_verified_member_id uuid,p_operation text,p_server_time timestamptz
) RETURNS TABLE(admitted boolean,retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $quota$
DECLARE
  v_now timestamptz; v_minute timestamptz; v_day timestamptz;
  v_minute_count integer; v_day_count integer;
  v_minute_limit integer; v_day_limit integer; v_retry integer := 0;
BEGIN
  -- Fresh statement snapshots after the lock wait are required by this design.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE='25000',MESSAGE='Quota requires READ COMMITTED';
  END IF;
  IF p_operation IS NULL OR p_operation NOT IN ('location_search','location_resolution') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid quota operation';
  END IF;
  -- One existing row serializes all quota admissions for this member, including
  -- missing buckets. No member data is changed. Different members do not block
  -- each other. Both operations briefly serialize, but have independent counts.
  PERFORM 1 FROM public.members m WHERE m.id=p_verified_member_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Quota member unavailable';
  END IF;
  v_now := coalesce(p_server_time,clock_timestamp());
  IF NOT isfinite(v_now) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid quota time';
  END IF;
  v_minute := date_trunc('minute',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_day := date_trunc('day',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF p_operation='location_search' THEN
    v_minute_limit := 30; v_day_limit := 300;
  ELSE
    v_minute_limit := 10; v_day_limit := 100;
  END IF;
  SELECT b.request_count INTO v_minute_count FROM private.location_provider_quota_buckets b
  WHERE b.member_id=p_verified_member_id AND b.operation=p_operation
    AND b.window_kind='minute' AND b.window_start=v_minute;
  SELECT b.request_count INTO v_day_count FROM private.location_provider_quota_buckets b
  WHERE b.member_id=p_verified_member_id AND b.operation=p_operation
    AND b.window_kind='day' AND b.window_start=v_day;
  IF coalesce(v_minute_count,0)>=v_minute_limit THEN
    v_retry := greatest(1,ceil(extract(epoch FROM (v_minute+interval '1 minute'-v_now)))::integer);
  END IF;
  IF coalesce(v_day_count,0)>=v_day_limit THEN
    -- UTC timestamp arithmetic avoids session timezone / DST day lengths.
    -- If both block, waiting for the later reset avoids another certain denial.
    v_retry := greatest(v_retry,ceil(extract(epoch FROM
      (((v_day AT TIME ZONE 'UTC')+interval '1 day') AT TIME ZONE 'UTC')-v_now))::integer);
  END IF;
  IF v_retry>0 THEN
    RETURN QUERY SELECT false,least(86400,greatest(1,v_retry));
    RETURN;
  END IF;
  -- One statement updates both windows; any error rolls back both. Only the
  -- exact primary-key conflict is handled; unrelated uniqueness errors escape.
  INSERT INTO private.location_provider_quota_buckets AS b
    (member_id,operation,window_kind,window_start,request_count,updated_at)
  VALUES (p_verified_member_id,p_operation,'minute',v_minute,1,v_now),
         (p_verified_member_id,p_operation,'day',v_day,1,v_now)
  ON CONFLICT (member_id,operation,window_kind,window_start)
  DO UPDATE SET request_count=b.request_count+1,updated_at=EXCLUDED.updated_at;
  RETURN QUERY SELECT true,0;
END;
$quota$;
REVOKE ALL ON FUNCTION private.consume_location_provider_quota_at(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.consume_location_provider_quota_for_server(
  p_verified_member_id uuid,p_operation text
) RETURNS TABLE(admitted boolean,retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $server$
BEGIN
  RETURN QUERY SELECT q.admitted,q.retry_after_seconds
  FROM private.consume_location_provider_quota_at(p_verified_member_id,p_operation,NULL::timestamptz) q;
END;
$server$;
REVOKE ALL ON FUNCTION public.consume_location_provider_quota_for_server(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.consume_location_provider_quota_for_server(uuid,text) TO service_role;

COMMIT;
