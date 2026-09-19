BEGIN;

-- Administrator-only rollback harness.
-- No network calls.
-- This is NOT a simultaneous-session concurrency test;
-- that remains a separate requirement.

CREATE TEMP TABLE route_quota_results (
  test_name text PRIMARY KEY,
  passed boolean NOT NULL
) ON COMMIT DROP;


CREATE FUNCTION pg_temp.check_route_quota(
  p_name text,
  p_ok boolean
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO pg_temp.route_quota_results
  VALUES (
    p_name,
    coalesce(
      p_ok,
      false
    )
  );
END;
$$;

REVOKE ALL
ON FUNCTION
  pg_temp.check_route_quota(
    text,
    boolean
  )
FROM PUBLIC;


CREATE FUNCTION pg_temp.try_route_quota(
  p_role text,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  old_role text :=
    current_setting('role');

  result jsonb;
BEGIN
  IF p_role NOT IN (
    'anon',
    'authenticated',
    'service_role',
    'none'
  ) THEN
    RAISE EXCEPTION
      'Invalid test role';
  END IF;

  -- Role setup errors must escape rather than
  -- masquerading as expected permission denials.
  PERFORM set_config(
    'role',
    p_role,
    true
  );

  BEGIN
    IF p_sql ~ '^SELECT' THEN
      EXECUTE
        'SELECT to_jsonb(q) FROM ('
        || p_sql
        || ') q'
      INTO result;

      result :=
        jsonb_build_object(
          'ok',
          true,
          'row',
          result
        );
    ELSE
      EXECUTE p_sql;

      result :=
        jsonb_build_object(
          'ok',
          true
        );
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      result :=
        jsonb_build_object(
          'ok',
          false,
          'state',
          SQLSTATE,
          'message',
          SQLERRM
        );
  END;

  PERFORM set_config(
    'role',
    old_role,
    true
  );

  RETURN result;
END;
$$;

REVOKE ALL
ON FUNCTION
  pg_temp.try_route_quota(
    text,
    text
  )
FROM PUBLIC;


CREATE FUNCTION
  pg_temp.reject_route_quota_day()
RETURNS trigger
LANGUAGE plpgsql
AS $fault$
BEGIN
  IF NEW.window_kind = 'day' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE =
        'unrelated route quota test unique violation',
      CONSTRAINT =
        'unrelated_route_test_unique';
  END IF;

  RETURN NEW;
END;
$fault$;

REVOKE ALL
ON FUNCTION
  pg_temp.reject_route_quota_day()
FROM PUBLIC;


DO $tests$
DECLARE
  m uuid :=
    gen_random_uuid();

  other_m uuid :=
    gen_random_uuid();

  r record;
  result jsonb;
  saved jsonb;
  baseline jsonb;
  after_state jsonb;

  i integer;
  j integer;
  ok boolean;

  role_name text;
  action text;

  t timestamptz :=
    '2030-03-10 23:59:59.250+00';

  sig text :=
    'public.consume_route_provider_quota_for_server(uuid)';

  helper text :=
    'private.consume_route_provider_quota_at(uuid,timestamptz)';
BEGIN
  SELECT
    coalesce(
      jsonb_agg(
        to_jsonb(b)
        ORDER BY
          member_id,
          window_kind,
          window_start
      ),
      '[]'
    )
  INTO baseline
  FROM
    private.route_provider_quota_buckets b;

  BEGIN
    INSERT INTO auth.users(
      id,
      aud,
      role,
      email,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    SELECT
      id,
      'authenticated',
      'authenticated',
      id::text
        || '@test-0032.invalid',
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    FROM unnest(
      ARRAY[
        m,
        other_m
      ]
    ) ids(id);


    PERFORM pg_temp.check_route_quota(
      'service execute allowed',
      has_function_privilege(
        'service_role',
        sig,
        'EXECUTE'
      )
    );


    PERFORM pg_temp.check_route_quota(
      'PUBLIC execute absent',
      NOT EXISTS(
        SELECT 1
        FROM pg_proc p
        CROSS JOIN LATERAL
          aclexplode(
            coalesce(
              p.proacl,
              acldefault(
                'f',
                p.proowner
              )
            )
          ) a
        WHERE p.oid IN (
          sig::regprocedure,
          helper::regprocedure
        )
          AND a.grantee = 0
          AND a.privilege_type =
            'EXECUTE'
      )
    );


    PERFORM pg_temp.check_route_quota(
      'RLS enabled',
      (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid =
          'private.route_provider_quota_buckets'::regclass
      )
    );


    PERFORM pg_temp.check_route_quota(
      'no policies',
      NOT EXISTS(
        SELECT 1
        FROM pg_policy
        WHERE polrelid =
          'private.route_provider_quota_buckets'::regclass
      )
    );


    PERFORM pg_temp.check_route_quota(
      'minimal counter columns',
      (
        SELECT
          array_agg(
            attname::text
            ORDER BY attnum
          )
          = ARRAY[
              'member_id',
              'window_kind',
              'window_start',
              'request_count',
              'updated_at'
            ]
        FROM pg_attribute
        WHERE attrelid =
          'private.route_provider_quota_buckets'::regclass
          AND attnum > 0
          AND NOT attisdropped
      )
    );


    FOREACH role_name IN ARRAY
      ARRAY[
        'anon',
        'authenticated',
        'service_role'
      ]
    LOOP
      PERFORM pg_temp.check_route_quota(
        role_name
          || ' helper revoked',
        NOT has_function_privilege(
          role_name,
          helper,
          'EXECUTE'
        )
      );

      IF role_name <> 'service_role' THEN
        PERFORM pg_temp.check_route_quota(
          role_name
            || ' execute revoked',
          NOT has_function_privilege(
            role_name,
            sig,
            'EXECUTE'
          )
        );

        result :=
          pg_temp.try_route_quota(
            role_name,
            format(
              'SELECT * FROM public.consume_route_provider_quota_for_server(%L)',
              m
            )
          );

        PERFORM pg_temp.check_route_quota(
          role_name
            || ' actual execute denied',
          result->>'state' =
            '42501'
        );
      END IF;


      FOREACH action IN ARRAY
        ARRAY[
          'SELECT',
          'INSERT',
          'UPDATE',
          'DELETE'
        ]
      LOOP
        PERFORM pg_temp.check_route_quota(
          role_name
            || ' '
            || action
            || ' ACL revoked',
          NOT has_table_privilege(
            role_name,
            'private.route_provider_quota_buckets',
            action
          )
        );

        result :=
          pg_temp.try_route_quota(
            role_name,
            CASE action
              WHEN 'SELECT' THEN
                'SELECT * FROM private.route_provider_quota_buckets'

              WHEN 'INSERT' THEN
                format(
                  'INSERT INTO private.route_provider_quota_buckets VALUES(%L,%L,now(),1,now())',
                  m,
                  'minute'
                )

              WHEN 'UPDATE' THEN
                'UPDATE private.route_provider_quota_buckets SET request_count=request_count'

              ELSE
                'DELETE FROM private.route_provider_quota_buckets'
            END
          );

        PERFORM pg_temp.check_route_quota(
          role_name
            || ' '
            || action
            || ' actually denied',
          result->>'state' =
            '42501'
        );
      END LOOP;
    END LOOP;


    result :=
      pg_temp.try_route_quota(
        'service_role',
        format(
          'SELECT * FROM public.consume_route_provider_quota_for_server(%L)',
          m
        )
      );

    PERFORM pg_temp.check_route_quota(
      'service route admission',
      result->>'ok' = 'true'
      AND result->'row'
        = jsonb_build_object(
            'admitted',
            true,
            'retry_after_seconds',
            0
          )
    );


    PERFORM pg_temp.check_route_quota(
      'actual server timestamp',
      EXISTS(
        SELECT 1
        FROM
          private.route_provider_quota_buckets
        WHERE member_id = m
          AND updated_at
            BETWEEN
              clock_timestamp()
                - interval '1 minute'
              AND clock_timestamp()
      )
    );


    result :=
      pg_temp.try_route_quota(
        'service_role',
        'SELECT * FROM public.consume_route_provider_quota_for_server(NULL)'
      );

    PERFORM pg_temp.check_route_quota(
      'null member rejected',
      result->>'state' =
        '23514'
    );


    result :=
      pg_temp.try_route_quota(
        'service_role',
        format(
          'SELECT * FROM public.consume_route_provider_quota_for_server(%L)',
          gen_random_uuid()
        )
      );

    PERFORM pg_temp.check_route_quota(
      'missing member rejected',
      result->>'state' =
        '23514'
    );


    DELETE FROM
      private.route_provider_quota_buckets
    WHERE member_id = m;


    PERFORM set_config(
      'TimeZone',
      'America/Los_Angeles',
      true
    );


    ok := true;

    FOR i IN 1..10 LOOP
      SELECT *
      INTO r
      FROM
        private.consume_route_provider_quota_at(
          m,
          t
        );

      ok :=
        ok
        AND r.admitted
        AND r.retry_after_seconds = 0;
    END LOOP;

    PERFORM pg_temp.check_route_quota(
      'exact minute admitted',
      ok
    );


    SELECT *
    INTO r
    FROM
      private.consume_route_provider_quota_at(
        m,
        t
      );

    PERFORM pg_temp.check_route_quota(
      'minute next denied',
      NOT r.admitted
      AND r.retry_after_seconds = 1
    );


    PERFORM pg_temp.check_route_quota(
      'minute denial preserves daily',
      (
        SELECT
          request_count = 10
        FROM
          private.route_provider_quota_buckets
        WHERE member_id = m
          AND window_kind = 'day'
      )
    );


    SELECT *
    INTO r
    FROM
      private.consume_route_provider_quota_at(
        other_m,
        t
      );

    PERFORM pg_temp.check_route_quota(
      'other member independent',
      r.admitted
    );


    SELECT *
    INTO r
    FROM
      private.consume_route_provider_quota_at(
        m,
        t + interval '0.750 second'
      );

    PERFORM pg_temp.check_route_quota(
      'midnight resets both',
      r.admitted
      AND r.retry_after_seconds = 0
    );


    PERFORM pg_temp.check_route_quota(
      'UTC midnight bucket',
      EXISTS(
        SELECT 1
        FROM
          private.route_provider_quota_buckets
        WHERE member_id = m
          AND window_kind = 'day'
          AND window_start =
            '2030-03-11 00:00:00+00'
          AND request_count = 1
      )
    );


    DELETE FROM
      private.route_provider_quota_buckets
    WHERE member_id = m;


    ok := true;

    FOR j IN 0..9 LOOP
      FOR i IN 1..10 LOOP
        SELECT *
        INTO r
        FROM
          private.consume_route_provider_quota_at(
            m,
            '2030-03-10 12:00:00+00'::timestamptz
              + j * interval '1 minute'
          );

        ok :=
          ok
          AND r.admitted;
      END LOOP;
    END LOOP;


    PERFORM pg_temp.check_route_quota(
      'exact day across minutes admitted',
      ok
    );


    PERFORM pg_temp.check_route_quota(
      'exact daily count',
      (
        SELECT
          request_count = 100
        FROM
          private.route_provider_quota_buckets
        WHERE member_id = m
          AND window_kind = 'day'
      )
    );


    SELECT *
    INTO r
    FROM
      private.consume_route_provider_quota_at(
        m,
        '2030-03-10 12:10:00+00'
      );

    PERFORM pg_temp.check_route_quota(
      'day next denied UTC retry',
      NOT r.admitted
      AND r.retry_after_seconds =
        42600
    );


    PERFORM pg_temp.check_route_quota(
      'day denial creates no minute',
      NOT EXISTS(
        SELECT 1
        FROM
          private.route_provider_quota_buckets
        WHERE member_id = m
          AND window_kind = 'minute'
          AND window_start =
            '2030-03-10 12:10:00+00'
      )
    );


    SELECT *
    INTO r
    FROM
      private.consume_route_provider_quota_at(
        m,
        '2030-03-10 12:09:59.999+00'
      );

    PERFORM pg_temp.check_route_quota(
      'both blocked waits for day',
      NOT r.admitted
      AND r.retry_after_seconds =
        42601
    );


    SELECT *
    INTO r
    FROM
      private.consume_route_provider_quota_at(
        m,
        '2030-03-11 00:00:00+00'
      );

    PERFORM pg_temp.check_route_quota(
      'next day admits',
      r.admitted
    );


    DELETE FROM
      private.route_provider_quota_buckets
    WHERE member_id = other_m;


    CREATE TRIGGER
      route_quota_test_unique
    BEFORE INSERT OR UPDATE
    ON private.route_provider_quota_buckets
    FOR EACH ROW
    EXECUTE FUNCTION
      pg_temp.reject_route_quota_day();


    result :=
      pg_temp.try_route_quota(
        'service_role',
        format(
          'SELECT * FROM public.consume_route_provider_quota_for_server(%L)',
          other_m
        )
      );


    PERFORM pg_temp.check_route_quota(
      'unrelated unique violation escapes',
      result->>'state' = '23505'
      AND result->>'message'
        = 'unrelated route quota test unique violation'
    );


    PERFORM pg_temp.check_route_quota(
      'late failure rolls back both increments',
      NOT EXISTS(
        SELECT 1
        FROM
          private.route_provider_quota_buckets
        WHERE member_id = other_m
      )
    );


    DROP TRIGGER
      route_quota_test_unique
    ON private.route_provider_quota_buckets;


    SELECT
      jsonb_agg(
        to_jsonb(q)
      )
    INTO saved
    FROM
      pg_temp.route_quota_results q;


    RAISE EXCEPTION USING
      ERRCODE = 'Z0032',
      MESSAGE =
        'rollback route quota fixtures';

  EXCEPTION
    WHEN SQLSTATE 'Z0032' THEN
      NULL;
  END;


  INSERT INTO
    pg_temp.route_quota_results
  SELECT *
  FROM jsonb_to_recordset(
    saved
  ) AS q(
    test_name text,
    passed boolean
  );


  SELECT
    coalesce(
      jsonb_agg(
        to_jsonb(b)
        ORDER BY
          member_id,
          window_kind,
          window_start
      ),
      '[]'
    )
  INTO after_state
  FROM
    private.route_provider_quota_buckets b;


  PERFORM pg_temp.check_route_quota(
    'rollback restores all quota state',
    baseline = after_state
  );


  PERFORM pg_temp.check_route_quota(
    'rollback removes users and members',
    NOT EXISTS(
      SELECT 1
      FROM auth.users
      WHERE id IN (
        m,
        other_m
      )
    )
    AND NOT EXISTS(
      SELECT 1
      FROM public.members
      WHERE id IN (
        m,
        other_m
      )
    )
  );
END;
$tests$;


SELECT
  test_name,
  passed
FROM pg_temp.route_quota_results
ORDER BY test_name;


SELECT
  count(*) AS total,
  count(*) FILTER (
    WHERE passed
  ) AS passed,
  count(*) FILTER (
    WHERE NOT passed
  ) AS failed
FROM pg_temp.route_quota_results;


DO $assert$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_temp.route_quota_results
  ) <> 56
  OR EXISTS(
    SELECT 1
    FROM pg_temp.route_quota_results
    WHERE NOT passed
  ) THEN
    RAISE EXCEPTION
      '0032 route quota behavioral checks failed';
  END IF;
END;
$assert$;

ROLLBACK;