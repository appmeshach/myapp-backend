BEGIN;

SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TEMP TABLE pg_temp.completed_recovery_results (
  test_number integer GENERATED ALWAYS AS IDENTITY,
  test_name text NOT NULL UNIQUE,
  passed boolean NOT NULL,
  diagnostic text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.completed_recovery_check(
  p_name text,
  p_passed boolean,
  p_diagnostic text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $check$
BEGIN
  INSERT INTO pg_temp.completed_recovery_results(
    test_name,
    passed,
    diagnostic
  )
  VALUES (
    p_name,
    coalesce(p_passed, false),
    p_diagnostic
  );
END;
$check$;

REVOKE ALL
ON FUNCTION pg_temp.completed_recovery_check(text, boolean, text)
FROM PUBLIC;


CREATE FUNCTION pg_temp.completed_recovery_as(
  p_role text,
  p_member_id uuid,
  p_sql text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $as_member$
DECLARE
  previous_role text;
  previous_sub text;
  previous_jwt_role text;
  previous_claims text;

  rows_json jsonb;
  result_json jsonb;
BEGIN
  IF p_role NOT IN (
    'authenticated',
    'anon',
    'service_role'
  ) THEN
    RAISE EXCEPTION 'Unsupported test role';
  END IF;

  previous_role :=
    current_setting('role');

  previous_sub :=
    current_setting(
      'request.jwt.claim.sub',
      true
    );

  previous_jwt_role :=
    current_setting(
      'request.jwt.claim.role',
      true
    );

  previous_claims :=
    current_setting(
      'request.jwt.claims',
      true
    );

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(p_member_id::text, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    p_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      p_member_id,
      'role',
      p_role
    )::text,
    true
  );

  PERFORM set_config(
    'role',
    p_role,
    true
  );

  BEGIN
    EXECUTE
      'SELECT coalesce(
         jsonb_agg(to_jsonb(q)),
         ''[]''::jsonb
       )
       FROM (' || p_sql || ') AS q'
    INTO rows_json;

    result_json :=
      jsonb_build_object(
        'ok',
        true,
        'rows',
        rows_json
      );

  EXCEPTION
    WHEN OTHERS THEN
      result_json :=
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
    previous_role,
    true
  );

  PERFORM set_config(
    'request.jwt.claim.sub',
    coalesce(previous_sub, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claim.role',
    coalesce(previous_jwt_role, ''),
    true
  );

  PERFORM set_config(
    'request.jwt.claims',
    coalesce(previous_claims, '{}'),
    true
  );

  RETURN result_json;
END;
$as_member$;

REVOKE ALL
ON FUNCTION pg_temp.completed_recovery_as(text, uuid, text)
FROM PUBLIC;


CREATE FUNCTION pg_temp.completed_recovery_list(
  p_member_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
AS $list$
  SELECT pg_temp.completed_recovery_as(
    'authenticated',
    p_member_id,
    format(
      'SELECT *
       FROM public.list_my_completed_movement_recoveries(%s)',
      CASE
        WHEN p_limit IS NULL THEN 'NULL'
        ELSE p_limit::text
      END
    )
  );
$list$;

REVOKE ALL
ON FUNCTION pg_temp.completed_recovery_list(uuid, integer)
FROM PUBLIC;


CREATE FUNCTION pg_temp.completed_recovery_requester_fixture(
  p_label text,
  p_people_count integer DEFAULT 1,
  p_member uuid DEFAULT NULL
)
RETURNS TABLE (
  member_id uuid,
  movement_need_id uuid
)
LANGUAGE plpgsql
AS $fixture$
DECLARE
  m uuid := coalesce(p_member, gen_random_uuid());

  source_id uuid;
  resolved_id uuid;

  endpoints uuid[] := ARRAY[]::uuid[];

  n integer;
  place text;

  r jsonb;
  need_id uuid;
BEGIN
  IF p_member IS NULL THEN
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
    VALUES (
      m,
      'authenticated',
      'authenticated',
      m::text || '@test-0058-requester.invalid',
      clock_timestamp(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      clock_timestamp(),
      clock_timestamp()
    );
  END IF;

  FOR n IN 1..2 LOOP
    place :=
      p_label || '-requester-' || n;

    SELECT x.location_reference_id
    INTO source_id
    FROM public.record_verified_selected_location_for_server(
      m,
      gen_random_uuid(),
      'Precise private address ' || place,
      'test_provider',
      place,
      'selection_proof_v1',
      clock_timestamp() - interval '1 minute',
      clock_timestamp() + interval '4 hours'
    ) x;

    SELECT x.resolved_location_reference_id
    INTO resolved_id
    FROM public.record_attested_location_resolution_for_server(
      m,
      source_id,
      gen_random_uuid(),
      'test_provider',
      'geocode',
      'test_v1',
      place,
      'resolution_v1',
      CASE n
        WHEN 1 THEN 'Ologolo, Lagos'
        ELSE 'Ikeja, Lagos'
      END,
      CASE n
        WHEN 1 THEN 6.4300
        ELSE 6.6018
      END,
      CASE n
        WHEN 1 THEN 3.5200
        ELSE 3.3515
      END,
      clock_timestamp(),
      NULL
    ) x;

    endpoints :=
      array_append(
        endpoints,
        resolved_id
      );
  END LOOP;

  r :=
    pg_temp.completed_recovery_as(
      'authenticated',
      m,
      format(
        'SELECT *
         FROM public.create_movement_need(
           %L::uuid,
           %L::uuid,
           %L::uuid,
           %L::timestamptz,
           %L::timestamptz,
           %s
         )',
        gen_random_uuid(),
        endpoints[1],
        endpoints[2],
        clock_timestamp() + interval '10 minutes',
        clock_timestamp() + interval '20 minutes',
        p_people_count
      )
    );

  need_id :=
    (
      r #>>
      '{rows,0,movement_need_id}'
    )::uuid;

  IF need_id IS NULL THEN
    RAISE EXCEPTION
      '0058 requester fixture need failed: %',
      r;
  END IF;

  RETURN QUERY
  SELECT
    m,
    need_id;
END;
$fixture$;


CREATE FUNCTION pg_temp.completed_recovery_end_call(
  p_member_id uuid,
  p_action text,
  p_need uuid
)
RETURNS jsonb
LANGUAGE sql
AS $call$
  SELECT pg_temp.completed_recovery_as(
    'authenticated',
    p_member_id,
    format(
      'SELECT *
       FROM public.%I(%L::uuid)',
      p_action,
      p_need
    )
  );
$call$;

REVOKE ALL
ON FUNCTION pg_temp.completed_recovery_end_call(uuid, text, uuid)
FROM PUBLIC;


DO $test$
DECLARE
  driver uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  requester uuid;

  vehicle uuid := gen_random_uuid();

  f record;

  need_ids uuid[] := ARRAY[]::uuid[];
  alignment_ids uuid[] := ARRAY[]::uuid[];

  offer uuid;
  aid uuid;
  jid uuid;

  i integer;
  actor uuid;

  sub uuid;
  media uuid;
  ref text;
  payment uuid;

  r jsonb;
  offerer_rows jsonb;
  requester_rows jsonb;

  state text;
  settlement_state text;

  before_count bigint;
  after_count bigint;

  original_beneficiary uuid;
  completion_time timestamptz;
BEGIN
  INSERT INTO auth.users(
    id,
    aud,
    role,
    email,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  SELECT
    id,
    'authenticated',
    'authenticated',
    id::text || '@test-0058.invalid',
    '{}',
    '{}',
    now(),
    now()
  FROM unnest(
    ARRAY[
      driver,
      outsider
    ]
  ) ids(id);

  INSERT INTO public.vehicles(
    id,
    make,
    color,
    seat_capacity,
    plate_number
  )
  VALUES (
    vehicle,
    'Test',
    'Blue',
    4,
    'TEST0058'
  );

  /*
   * Fixtures:
   *
   * 1 = genuine completed travelled movement
   * 2 = genuine completed travelled movement
   * 3 = activated but never travelled, then mutual-no-travel closure
   * 4 = awaiting activation
   * 5 = genuine in-progress movement
   */
  FOR i IN 1..5 LOOP
    SELECT *
    INTO f
    FROM pg_temp.completed_recovery_requester_fixture(
      'recovery-' || i,
      1,
      requester
    );

    requester := f.member_id;

    need_ids :=
      array_append(
        need_ids,
        f.movement_need_id
      );

    UPDATE public.movement_needs
    SET
      status = 'closed',
      origin_area = 'PRIVATE exact origin address',
      destination_area = 'PRIVATE exact destination address'
    WHERE id = f.movement_need_id;

    offer := gen_random_uuid();
    aid := gen_random_uuid();

    alignment_ids :=
      array_append(
        alignment_ids,
        aid
      );

    INSERT INTO public.movement_offers(
      id,
      movement_need_id,
      offering_member_id,
      vehicle_id,
      seats_offered,
      status
    )
    VALUES (
      offer,
      f.movement_need_id,
      driver,
      vehicle,
      1,
      'accepted'
    );

    INSERT INTO public.alignments(
      id,
      movement_need_id,
      movement_offer_id,
      member_needing_movement_id,
      offering_member_id
    )
    VALUES (
      aid,
      f.movement_need_id,
      offer,
      requester,
      driver
    );

    IF i <> 4 THEN
      FOREACH actor IN ARRAY ARRAY[driver, requester] LOOP
        r :=
          pg_temp.completed_recovery_as(
            'service_role',
            NULL,
            format(
              'SELECT public.create_profile_photo_submission_for_server(
                 %L,
                 %L,
                 ''image/png'',
                 128
               ) AS id',
              actor,
              gen_random_uuid()::text || '/original'
            )
          );

        sub :=
          (
            r #>>
            '{rows,0,id}'
          )::uuid;

        r :=
          pg_temp.completed_recovery_as(
            'service_role',
            NULL,
            format(
              'SELECT public.prepare_profile_photo_submission_for_server(
                 %L,
                 %L
               ) AS id',
              sub,
              gen_random_uuid()::text || '/processed'
            )
          );

        media :=
          (
            r #>>
            '{rows,0,id}'
          )::uuid;

        ref := gen_random_uuid()::text;

        r :=
          pg_temp.completed_recovery_as(
            'service_role',
            NULL,
            format(
              'SELECT *
               FROM public.start_movement_face_verification_for_server(
                 %L,
                 %L,
                 ''test'',
                 %L
               )',
              f.movement_need_id,
              actor,
              ref
            )
          );

        IF r->>'ok' <> 'true' THEN
          RAISE EXCEPTION
            '0058 face start failed: %',
            r;
        END IF;

        r :=
          pg_temp.completed_recovery_as(
            'service_role',
            NULL,
            format(
              'SELECT public.complete_face_verification_callback_for_server(
                 ''test'',
                 %L,
                 %L,
                 true,
                 true
               )',
              ref,
              media
            )
          );

        IF r->>'ok' <> 'true' THEN
          RAISE EXCEPTION
            '0058 face complete failed: %',
            r;
        END IF;
      END LOOP;

      r :=
        pg_temp.completed_recovery_as(
          'service_role',
          NULL,
          format(
            'SELECT *
             FROM public.create_alignment_activation_payment(
               %L,
               100,
               ''NGN'',
               ''test''
             )',
            aid
          )
        );

      payment :=
        (
          r #>>
          '{rows,0,payment_id}'
        )::uuid;

      r :=
        pg_temp.completed_recovery_as(
          'service_role',
          NULL,
          format(
            'SELECT *
             FROM public.mark_alignment_activation_payment_succeeded(
               %L,
               %L
             )',
            payment,
            gen_random_uuid()::text
          )
        );

      IF r->>'ok' <> 'true' THEN
        RAISE EXCEPTION
          '0058 activation payment failed: %',
          r;
      END IF;
    END IF;

    IF i IN (1, 2, 5) THEN
      r :=
        pg_temp.completed_recovery_as(
          'authenticated',
          driver,
          format(
            'SELECT *
             FROM public.set_my_movement_meeting_point(
               %L,
               ''Test meeting place'',
               NULL
             )',
            f.movement_need_id
          )
        );

      IF r->>'ok' <> 'true' THEN
        RAISE EXCEPTION
          '0058 meeting point failed: %',
          r;
      END IF;

      r :=
        pg_temp.completed_recovery_as(
          'authenticated',
          driver,
          format(
            'SELECT *
             FROM public.request_my_movement_start(%L)',
            f.movement_need_id
          )
        );

      IF r->>'ok' <> 'true' THEN
        RAISE EXCEPTION
          '0058 start request failed: %',
          r;
      END IF;

      r :=
        pg_temp.completed_recovery_as(
          'authenticated',
          requester,
          format(
            'SELECT *
             FROM public.confirm_my_movement_start(%L)',
            f.movement_need_id
          )
        );

      IF r->>'ok' <> 'true' THEN
        RAISE EXCEPTION
          '0058 start confirmation failed: %',
          r;
      END IF;
    END IF;

    IF i IN (1, 2) THEN
      r :=
        pg_temp.completed_recovery_end_call(
          driver,
          'request_my_movement_end',
          f.movement_need_id
        );

      IF r#>>'{rows,0,end_status}' <> 'awaiting_other_member' THEN
        RAISE EXCEPTION
          '0058 end request failed: %',
          r;
      END IF;

      r :=
        pg_temp.completed_recovery_end_call(
          requester,
          'confirm_my_movement_end',
          f.movement_need_id
        );

      IF r#>>'{rows,0,end_status}' <> 'completed' THEN
        RAISE EXCEPTION
          '0058 completion failed: %',
          r;
      END IF;
    END IF;

    IF i = 3 THEN
      r :=
        pg_temp.completed_recovery_end_call(
          driver,
          'request_my_movement_end',
          f.movement_need_id
        );

      IF r#>>'{rows,0,end_status}' <> 'awaiting_other_member' THEN
        RAISE EXCEPTION
          '0058 no-travel request failed: %',
          r;
      END IF;

      r :=
        pg_temp.completed_recovery_end_call(
          requester,
          'confirm_my_movement_end',
          f.movement_need_id
        );

      IF r#>>'{rows,0,end_status}' <> 'mutual_no_travel' THEN
        RAISE EXCEPTION
          '0058 no-travel closure failed: %',
          r;
      END IF;
    END IF;
  END LOOP;


  PERFORM pg_temp.completed_recovery_check(
    'missing authentication rejected',
    pg_temp.completed_recovery_list(NULL)->>'state' = '42501'
  );

  PERFORM pg_temp.completed_recovery_check(
    'nonexistent member rejected',
    pg_temp.completed_recovery_list(gen_random_uuid())->>'state' = '42501'
  );

  FOREACH state IN ARRAY ARRAY['anon', 'service_role'] LOOP
    r :=
      pg_temp.completed_recovery_as(
        state,
        driver,
        'SELECT *
         FROM public.list_my_completed_movement_recoveries()'
      );

    PERFORM pg_temp.completed_recovery_check(
      state || ' denied',
      r->>'state' = '42501'
    );
  END LOOP;

  PERFORM pg_temp.completed_recovery_check(
    'PUBLIC denied',
    NOT EXISTS(
      SELECT 1
      FROM pg_proc p,
      LATERAL aclexplode(
        coalesce(
          p.proacl,
          acldefault('f', p.proowner)
        )
      ) x
      WHERE p.oid =
        'public.list_my_completed_movement_recoveries(integer)'::regprocedure
        AND x.grantee = 0
        AND x.privilege_type = 'EXECUTE'
    )
  );


  offerer_rows :=
    pg_temp.completed_recovery_list(driver);

  requester_rows :=
    pg_temp.completed_recovery_list(requester);

  PERFORM pg_temp.completed_recovery_check(
    'offerer recovers exactly two genuinely completed movements',
    offerer_rows->>'ok' = 'true'
    AND jsonb_array_length(offerer_rows->'rows') = 2
  );

  PERFORM pg_temp.completed_recovery_check(
    'requester recovers exactly two genuinely completed movements',
    requester_rows->>'ok' = 'true'
    AND jsonb_array_length(requester_rows->'rows') = 2
  );

  PERFORM pg_temp.completed_recovery_check(
    'offerer settlement entitlement is marked for me',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(offerer_rows->'rows') row
      WHERE row->>'settlement_is_for_me' <> 'true'
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    'requester settlement entitlement is not marked for me',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(requester_rows->'rows') row
      WHERE row->>'settlement_is_for_me' <> 'false'
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    'exact narrow safe output shape',
    (
      SELECT array_agg(k ORDER BY k)
      FROM jsonb_object_keys(
        offerer_rows #> '{rows,0}'
      ) k
    ) = ARRAY[
      'completed_at',
      'destination_area',
      'movement_need_id',
      'origin_area',
      'settled_at',
      'settlement_is_for_me',
      'settlement_status'
    ]
  );

  PERFORM pg_temp.completed_recovery_check(
    'trusted broad labels returned',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(offerer_rows->'rows') row
      WHERE row->>'origin_area' <> 'Ologolo, Lagos'
         OR row->>'destination_area' <> 'Ikeja, Lagos'
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    'precise movement labels never leak',
    offerer_rows::text NOT LIKE '%PRIVATE exact%'
    AND requester_rows::text NOT LIKE '%PRIVATE exact%'
  );

  PERFORM pg_temp.completed_recovery_check(
    'outsider sees no completed movements',
    pg_temp.completed_recovery_list(outsider)
      = '{"ok":true,"rows":[]}'::jsonb
  );

  PERFORM pg_temp.completed_recovery_check(
    'limit one returns one row',
    jsonb_array_length(
      pg_temp.completed_recovery_list(driver, 1)->'rows'
    ) = 1
  );

  PERFORM pg_temp.completed_recovery_check(
    'maximum limit accepted',
    pg_temp.completed_recovery_list(driver, 50)
      = offerer_rows
  );

  FOREACH state IN ARRAY ARRAY['0', '-1', '51'] LOOP
    r :=
      pg_temp.completed_recovery_as(
        'authenticated',
        driver,
        'SELECT *
         FROM public.list_my_completed_movement_recoveries('
         || state ||
         ')'
      );

    PERFORM pg_temp.completed_recovery_check(
      'invalid limit ' || state,
      r->>'state' = '23514'
    );
  END LOOP;

  r :=
    pg_temp.completed_recovery_as(
      'authenticated',
      driver,
      'SELECT *
       FROM public.list_my_completed_movement_recoveries(NULL)'
    );

  PERFORM pg_temp.completed_recovery_check(
    'null limit rejected',
    r->>'state' = '23514'
  );


  PERFORM pg_temp.completed_recovery_check(
    'equal completion time uses descending movementNeedId tie breaker',
    offerer_rows#>>'{rows,0,movement_need_id}'
      =
      greatest(
        need_ids[1],
        need_ids[2]
      )::text
  );

  PERFORM pg_temp.completed_recovery_check(
    'closed movement needs remain recoverable',
    (
      SELECT bool_and(status = 'closed')
      FROM public.movement_needs
      WHERE id = ANY(
        ARRAY[
          need_ids[1],
          need_ids[2]
        ]
      )
    )
    AND jsonb_array_length(offerer_rows->'rows') = 2
  );


  PERFORM pg_temp.completed_recovery_check(
    'awaiting activation movement excluded',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(offerer_rows->'rows') row
      WHERE row->>'movement_need_id' = need_ids[4]::text
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    'in progress movement excluded',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(offerer_rows->'rows') row
      WHERE row->>'movement_need_id' = need_ids[5]::text
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    'mutual no travel movement excluded',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(offerer_rows->'rows') row
      WHERE row->>'movement_need_id' = need_ids[3]::text
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    'mutual no travel has no settlement entitlement',
    NOT EXISTS(
      SELECT 1
      FROM private.movement_settlements s
      JOIN public.alignments a
        ON a.id = s.alignment_id
      WHERE a.movement_need_id = need_ids[3]
    )
  );


  SELECT j.id, j.completed_at
  INTO STRICT jid, completion_time
  FROM public.journeys j
  JOIN public.alignments a
    ON a.id = j.alignment_id
  WHERE a.id = alignment_ids[1];

  SELECT beneficiary_member_id
  INTO STRICT original_beneficiary
  FROM private.movement_settlements
  WHERE alignment_id = alignment_ids[1];


  FOREACH settlement_state IN ARRAY ARRAY[
    'pending_settlement',
    'failed'
  ] LOOP
    BEGIN
      UPDATE private.movement_settlements
      SET
        status = settlement_state,
        settled_at = NULL
      WHERE alignment_id = alignment_ids[1];

      r :=
        pg_temp.completed_recovery_list(driver);

      RAISE SQLSTATE 'ZT058';

    EXCEPTION
      WHEN SQLSTATE 'ZT058' THEN
        NULL;
    END;

    PERFORM pg_temp.completed_recovery_check(
      settlement_state || ' remains visible',
      EXISTS(
        SELECT 1
        FROM jsonb_array_elements(r->'rows') row
        WHERE row->>'movement_need_id' = need_ids[1]::text
          AND row->>'settlement_status' = settlement_state
      )
    );
  END LOOP;


  BEGIN
    UPDATE private.movement_settlements
    SET
      status = 'settled',
      settled_at = completion_time + interval '1 second'
    WHERE alignment_id = alignment_ids[1];

    r :=
      pg_temp.completed_recovery_list(driver);

    RAISE SQLSTATE 'ZT058';

  EXCEPTION
    WHEN SQLSTATE 'ZT058' THEN
      NULL;
  END;

  PERFORM pg_temp.completed_recovery_check(
    'settled entitlement remains visible with settled timestamp',
    EXISTS(
      SELECT 1
      FROM jsonb_array_elements(r->'rows') row
      WHERE row->>'movement_need_id' = need_ids[1]::text
        AND row->>'settlement_status' = 'settled'
        AND row->>'settled_at' IS NOT NULL
    )
  );


  BEGIN
    DELETE FROM private.movement_settlements
    WHERE alignment_id = alignment_ids[1];

    r :=
      pg_temp.completed_recovery_list(driver);

    RAISE SQLSTATE 'ZT058';

  EXCEPTION
    WHEN SQLSTATE 'ZT058' THEN
      NULL;
  END;

  PERFORM pg_temp.completed_recovery_check(
    'missing settlement entitlement fails closed',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(r->'rows') row
      WHERE row->>'movement_need_id' = need_ids[1]::text
    )
  );


  BEGIN
    UPDATE private.movement_settlements
    SET beneficiary_member_id = requester
    WHERE alignment_id = alignment_ids[1];

    r :=
      pg_temp.completed_recovery_list(driver);

    RAISE SQLSTATE 'ZT058';

  EXCEPTION
    WHEN SQLSTATE 'ZT058' THEN
      NULL;
  END;

  PERFORM pg_temp.completed_recovery_check(
    'wrong settlement beneficiary fails closed',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(r->'rows') row
      WHERE row->>'movement_need_id' = need_ids[1]::text
    )
  );


  BEGIN
    UPDATE private.movement_settlements
    SET
      status = 'settled',
      settled_at = NULL
    WHERE alignment_id = alignment_ids[1];

    r :=
      pg_temp.completed_recovery_list(driver);

    RAISE SQLSTATE 'ZT058';

  EXCEPTION
    WHEN SQLSTATE 'ZT058' THEN
      NULL;
  END;

  PERFORM pg_temp.completed_recovery_check(
    'contradictory settled evidence fails closed',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(r->'rows') row
      WHERE row->>'movement_need_id' = need_ids[1]::text
    )
  );


  BEGIN
    UPDATE private.movement_settlements
    SET
      status = 'pending_amount',
      settled_at = completion_time + interval '1 second'
    WHERE alignment_id = alignment_ids[1];

    r :=
      pg_temp.completed_recovery_list(driver);

    RAISE SQLSTATE 'ZT058';

  EXCEPTION
    WHEN SQLSTATE 'ZT058' THEN
      NULL;
  END;

  PERFORM pg_temp.completed_recovery_check(
    'non-settled row with settled timestamp fails closed',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(r->'rows') row
      WHERE row->>'movement_need_id' = need_ids[1]::text
    )
  );


  SELECT count(*)
  INTO before_count
  FROM private.movement_settlements;

  PERFORM pg_temp.completed_recovery_list(driver);
  PERFORM pg_temp.completed_recovery_list(requester);

  SELECT count(*)
  INTO after_count
  FROM private.movement_settlements;

  PERFORM pg_temp.completed_recovery_check(
    'recovery reads do not create or delete settlement rows',
    before_count = after_count
  );

  PERFORM pg_temp.completed_recovery_check(
    'canonical pending amount rows remain unchanged after reads',
    (
      SELECT count(*) = 2
        AND bool_and(
          s.status = 'pending_amount'
          AND s.settled_at IS NULL
          AND s.beneficiary_member_id = driver
        )
      FROM private.movement_settlements s
      JOIN public.alignments a
        ON a.id = s.alignment_id
      WHERE a.movement_need_id = ANY(
        ARRAY[
          need_ids[1],
          need_ids[2]
        ]
      )
    )
  );

  PERFORM pg_temp.completed_recovery_check(
    '0056 still excludes completed movements',
    NOT EXISTS(
      SELECT 1
      FROM jsonb_array_elements(
        pg_temp.completed_recovery_as(
          'authenticated',
          driver,
          'SELECT *
           FROM public.list_my_active_movement_continuations()'
        )->'rows'
      ) row
      WHERE row->>'movement_need_id' IN (
        need_ids[1]::text,
        need_ids[2]::text
      )
    )
  );
END;
$test$;


CREATE FUNCTION pg_temp.completed_recovery_snapshot()
RETURNS jsonb
LANGUAGE sql
AS $snapshot$
SELECT jsonb_build_object(
  'tables',
  (
    SELECT jsonb_object_agg(
      n.nspname || '.' || c.relname,
      query_to_xml(
        format(
          'SELECT count(*) AS rows,
                  md5(
                    coalesce(
                      string_agg(
                        to_jsonb(t)::text,
                        ''''
                        ORDER BY to_jsonb(t)::text
                      ),
                      ''''
                    )
                  ) AS hash
           FROM %I.%I t',
          n.nspname,
          c.relname
        ),
        false,
        true,
        ''
      )::text
    )
    FROM pg_class c
    JOIN pg_namespace n
      ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname IN (
        'public',
        'private',
        'auth',
        'supabase_migrations'
      )
  ),
  'functions',
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'oid',
        p.oid,
        'def',
        md5(pg_get_functiondef(p.oid)),
        'acl',
        p.proacl,
        'owner',
        p.proowner
      )
      ORDER BY p.oid
    )
    FROM pg_proc p
    JOIN pg_namespace n
      ON n.oid = p.pronamespace
    WHERE n.nspname IN (
      'public',
      'private'
    )
      AND p.prokind = 'f'
  )
) AS state;
$snapshot$;

REVOKE ALL
ON FUNCTION pg_temp.completed_recovery_snapshot()
FROM PUBLIC;


DO $readonly$
DECLARE
  before_state jsonb;
  after_state jsonb;
  caller uuid;
BEGIN
  SELECT a.offering_member_id
  INTO STRICT caller
  FROM public.alignments a
  JOIN public.journeys j
    ON j.alignment_id = a.id
  WHERE a.status = 'completed'
    AND j.status = 'completed'
    AND a.offering_member_id IN (
      SELECT id
      FROM auth.users
      WHERE email LIKE '%@test-0058.invalid'
    )
  LIMIT 1;

  before_state :=
    pg_temp.completed_recovery_snapshot();

  PERFORM
    pg_temp.completed_recovery_list(
      caller
    );

  after_state :=
    pg_temp.completed_recovery_snapshot();

  PERFORM pg_temp.completed_recovery_check(
    'RPC leaves complete database and function state unchanged',
    before_state = after_state
  );
END;
$readonly$;


SELECT
  test_number,
  test_name,
  passed
FROM pg_temp.completed_recovery_results
ORDER BY test_number;


DO $results$
BEGIN
  IF EXISTS(
    SELECT 1
    FROM pg_temp.completed_recovery_results
    WHERE NOT passed
  )
  OR (
    SELECT count(*)
    FROM pg_temp.completed_recovery_results
) <> 36 THEN
    RAISE EXCEPTION
      '0058 behavioral checks failed or missing';
  END IF;
END;
$results$;


SELECT count(*) AS passed_checks
FROM pg_temp.completed_recovery_results
WHERE passed;

ROLLBACK;
