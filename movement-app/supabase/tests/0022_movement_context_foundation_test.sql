BEGIN;
-- Administrator-only rollback test after 0001-0022. No remote execution by the
-- coding agent. Run the whole file; any unexpected setup failure aborts it.
-- For migration+test outer rollback instructions, see the companion document.
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
CREATE TEMP TABLE context_results (
  test_name text PRIMARY KEY, passed boolean NOT NULL, diagnostic text
) ON COMMIT DROP;
CREATE TEMP TABLE context_functions ON COMMIT DROP AS
SELECT p.oid,md5(pg_get_functiondef(p.oid)) definition_hash,p.proacl::text acl,p.proconfig::text config
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.prokind='f';
CREATE TEMP TABLE context_tables ON COMMIT DROP AS
SELECT c.oid,n.nspname schema_name,c.relname table_name,c.relacl::text acl,c.relrowsecurity,c.relforcerowsecurity,
  (SELECT md5(coalesce(jsonb_agg(to_jsonb(pol) ORDER BY pol.oid)::text,'[]')) FROM pg_policy pol WHERE pol.polrelid=c.oid) policy_hash
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE (n.nspname IN ('public','private') OR (n.nspname='auth' AND c.relname='users')) AND c.relkind='r';
CREATE TEMP TABLE context_data (table_oid oid PRIMARY KEY,fingerprint text) ON COMMIT DROP;
DO $$ DECLARE entry record; fingerprint text; BEGIN
  FOR entry IN SELECT * FROM pg_temp.context_tables LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM %I.%I r',entry.schema_name,entry.table_name) INTO fingerprint;
    INSERT INTO pg_temp.context_data VALUES(entry.oid,fingerprint);
  END LOOP;
END $$;

CREATE FUNCTION pg_temp.context_check(p_name text,p_pass boolean,p_diagnostic text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO pg_temp.context_results VALUES(p_name,coalesce(p_pass,false),p_diagnostic);
END $$;
REVOKE ALL ON FUNCTION pg_temp.context_check(text,boolean,text) FROM PUBLIC;

CREATE FUNCTION pg_temp.context_error(p_name text,p_sql text,p_state text DEFAULT '23514',p_message text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE observed text; observed_message text;
BEGIN
  -- Flush valid baseline BEFORE entering the caught subtransaction.
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  BEGIN
    EXECUTE p_sql;
    SET CONSTRAINTS ALL IMMEDIATE;
    observed:='00000'; observed_message:='unexpected success';
    RAISE EXCEPTION USING ERRCODE='ZX022',MESSAGE='restore attempted mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE<>'ZX022' THEN observed:=SQLSTATE; observed_message:=SQLERRM; END IF;
  END;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.context_check(p_name,observed=p_state AND (p_message IS NULL OR observed_message=p_message),
    observed||': '||observed_message);
END $$;
REVOKE ALL ON FUNCTION pg_temp.context_error(text,text,text,text) FROM PUBLIC;

-- All builders are temporary administrator fixtures, never application writers.
CREATE FUNCTION pg_temp.context_location(p_owner uuid,p_override jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE result_id uuid; BEGIN
  INSERT INTO private.movement_location_references
  SELECT r.* FROM jsonb_populate_record(NULL::private.movement_location_references,
    jsonb_build_object('id',gen_random_uuid(),'owner_member_id',p_owner,'declared_label','Private declaration',
      'source_kind','member_declared','resolution_status','unresolved','created_at',clock_timestamp())||p_override) r
  RETURNING id INTO result_id;
  RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION pg_temp.context_location(uuid,jsonb) FROM PUBLIC;

CREATE FUNCTION pg_temp.context_intent(p_owner uuid,p_origin uuid,p_destination uuid,p_override jsonb DEFAULT '{}',p_locations integer DEFAULT 2)
RETURNS uuid LANGUAGE plpgsql AS $$ DECLARE result_id uuid; BEGIN
  INSERT INTO private.offering_movement_intents
  SELECT r.* FROM jsonb_populate_record(NULL::private.offering_movement_intents,
    jsonb_build_object('id',gen_random_uuid(),'offering_member_id',p_owner,'intent_key',gen_random_uuid(),
      'version',1,'earliest_departure_at',now()+interval '1 day','created_at',clock_timestamp(),'status','current')||p_override) r
  RETURNING id INTO result_id;
  IF p_locations>=1 THEN INSERT INTO private.offering_movement_intent_locations VALUES(result_id,'origin',p_origin); END IF;
  IF p_locations>=2 THEN INSERT INTO private.offering_movement_intent_locations VALUES(result_id,'destination',p_destination); END IF;
  RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION pg_temp.context_intent(uuid,uuid,uuid,jsonb,integer) FROM PUBLIC;

CREATE FUNCTION pg_temp.context_snapshot(p_need uuid,p_intent uuid,p_vehicle uuid,p_override jsonb DEFAULT '{}',p_roster_limit integer DEFAULT 100)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE need_row public.movement_needs%ROWTYPE; intent_row private.offering_movement_intents%ROWTYPE;
  result_id uuid; origin_id uuid; destination_id uuid; capacity integer; traveller record;
BEGIN
  SELECT n.* INTO STRICT need_row FROM public.movement_needs n WHERE n.id=p_need;
  SELECT i.* INTO STRICT intent_row FROM private.offering_movement_intents i WHERE i.id=p_intent;
  SELECT v.seat_capacity INTO STRICT capacity FROM public.vehicles v WHERE v.id=p_vehicle;
  SELECT il.location_reference_id INTO origin_id FROM private.offering_movement_intent_locations il WHERE il.intent_id=p_intent AND il.role='origin';
  SELECT il.location_reference_id INTO destination_id FROM private.offering_movement_intent_locations il WHERE il.intent_id=p_intent AND il.role='destination';
  INSERT INTO private.movement_context_snapshots
  SELECT r.* FROM jsonb_populate_record(NULL::private.movement_context_snapshots,
    jsonb_build_object('id',gen_random_uuid(),'movement_need_id',p_need,'requesting_member_id',need_row.member_id,
      'offering_member_id',intent_row.offering_member_id,'offering_movement_intent_id',p_intent,
      'offering_intent_version',intent_row.version,'vehicle_id',p_vehicle,'version',1,'context_schema_version','movement_context_v1',
      'people_count',need_row.people_count,'seats_offered',need_row.people_count,'vehicle_seat_capacity',capacity,
      'requester_origin_area',need_row.origin_area,'requester_destination_area',need_row.destination_area,
      'requester_earliest_departure_at',need_row.earliest_departure_at,'requester_latest_departure_at',need_row.latest_departure_at,
      'offering_earliest_departure_at',intent_row.earliest_departure_at,'offering_latest_departure_at',intent_row.latest_departure_at,
      'offering_origin_location_id',origin_id,'offering_destination_location_id',destination_id,
      'created_at',clock_timestamp(),'status','current')||p_override) r
  RETURNING id INTO result_id;
  FOR traveller IN SELECT mp.* FROM public.movement_participants mp WHERE mp.movement_need_id=p_need AND mp.status='confirmed'
    ORDER BY mp.member_id LIMIT p_roster_limit LOOP
    INSERT INTO private.movement_context_snapshot_travellers VALUES(result_id,traveller.member_id,traveller.id,traveller.role);
  END LOOP;
  RETURN result_id;
END $$;
REVOKE ALL ON FUNCTION pg_temp.context_snapshot(uuid,uuid,uuid,jsonb,integer) FROM PUBLIC;

DO $test$
<<fixture>>
DECLARE offering uuid:=gen_random_uuid(); requester uuid:=gen_random_uuid(); guest uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  need_id uuid:=gen_random_uuid(); vehicle_id uuid:=gen_random_uuid(); other_vehicle uuid:=gen_random_uuid();
  origin_id uuid; destination_id uuid; requester_location uuid; intent_id uuid; intent_key uuid; snapshot_id uuid;
  spare_intent uuid; expiring_intent uuid; offer_id uuid:=gen_random_uuid(); wrong_offer uuid:=gen_random_uuid();
  record_id uuid; expired_location uuid; label text; assignment text; options jsonb; row_before jsonb; saved_results jsonb;
  table_name text; role_name text; signature text; old_role text; observed text; result_count bigint; mutation text;
BEGIN
 BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  SELECT x,'authenticated','authenticated',x::text||'@test-0022.invalid','{}','{}',now(),now()
  FROM unnest(ARRAY[offering,requester,guest,outsider]) x;
  INSERT INTO public.vehicles(id,make,color,seat_capacity,plate_number)
  VALUES(vehicle_id,'Fixture','Blue',4,'TEST-0022'),(other_vehicle,'Fixture','Green',4,'TEST-0022-B');
  INSERT INTO public.member_vehicle_access(member_id,vehicle_id) VALUES(offering,vehicle_id);
  origin_id:=pg_temp.context_location(offering);
  destination_id:=pg_temp.context_location(offering,'{"source_kind":"member_selected"}');
  requester_location:=pg_temp.context_location(requester);
  PERFORM pg_temp.context_check('declared unresolved input needs no coordinates',
    (SELECT latitude IS NULL AND longitude IS NULL AND resolution_status='unresolved' FROM private.movement_location_references WHERE id=origin_id));
  record_id:=pg_temp.context_location(offering,jsonb_build_object('source_kind','provider_resolved','resolution_status','resolved',
    'latitude',6.4,'longitude',3.4,'provider_namespace','fixture','provider_place_reference','opaque-fixture',
    'resolution_version','fixture_v1','resolved_at',now()));
  PERFORM pg_temp.context_check('coherent future producer shape accepted without claiming geographic truth',record_id IS NOT NULL);
  FOR label,options IN SELECT * FROM (VALUES
    ('invalid latitude',jsonb_build_object('latitude',91,'longitude',3)),
    ('invalid longitude',jsonb_build_object('latitude',6,'longitude',181)),
    ('single coordinate',jsonb_build_object('latitude',6)),
    ('unresolved cannot contain exact point',jsonb_build_object('latitude',6,'longitude',3)),
    ('resolved state requires provenance',jsonb_build_object('resolution_status','resolved')),
    ('blank provider namespace',jsonb_build_object('provider_namespace',' ','provider_place_reference','x')),
    ('blank provider reference',jsonb_build_object('provider_namespace','fixture','provider_place_reference',' ')),
    ('tab-only provider namespace',jsonb_build_object('provider_namespace',chr(9),'provider_place_reference','x')),
    ('tab-only provider reference',jsonb_build_object('provider_namespace','fixture','provider_place_reference',chr(9))),
    ('unpaired provider reference',jsonb_build_object('provider_place_reference','x')),
    ('future location creation',jsonb_build_object('created_at',clock_timestamp()+interval '1 hour')),
    ('future resolution time',jsonb_build_object('resolved_at',clock_timestamp()+interval '1 hour')),
    ('expired location insertion',jsonb_build_object('expires_at',clock_timestamp()-interval '1 day'))
  ) cases(name,overrides) LOOP
    IF label IN ('invalid latitude','invalid longitude') THEN
      options:=jsonb_build_object('source_kind','provider_resolved','resolution_status','resolved',
        'provider_namespace','fixture','provider_place_reference','opaque','resolution_version','v1','resolved_at',now())||options;
    END IF;
    PERFORM pg_temp.context_error(label,format('SELECT pg_temp.context_location(%L,%L::jsonb)',offering,options));
  END LOOP;
  FOR label,assignment IN SELECT * FROM (VALUES
    ('location identity',format('id=%L',gen_random_uuid())),('location owner',format('owner_member_id=%L',requester)),
    ('location label','declared_label=''changed'''),('location provenance','source_kind=''member_selected'''),
    ('location coordinates','latitude=6,longitude=3'),('location provider','provider_namespace=''changed'''),
    ('location resolution','resolution_status=''resolved'''),('location timestamp','created_at=created_at-interval ''1 second''')
  ) cases(name,value) LOOP
    PERFORM pg_temp.context_error(label||' immutable',format('UPDATE private.movement_location_references SET %s WHERE id=%L',assignment,origin_id),
      '23514','Location inputs are immutable');
  END LOOP;
  PERFORM pg_temp.context_error('location deletion blocked',format('DELETE FROM private.movement_location_references WHERE id=%L',origin_id),
    '23514','Movement context history cannot be deleted');

  -- No need or offer exists when this intent becomes valid.
  intent_id:=pg_temp.context_intent(offering,origin_id,destination_id);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT i.intent_key INTO intent_key FROM private.offering_movement_intents i WHERE i.id=intent_id;
  PERFORM pg_temp.context_check('intent independent of requester demand',NOT EXISTS (SELECT 1 FROM public.movement_needs WHERE id=need_id));
  PERFORM pg_temp.context_error('missing both intent locations',format('SELECT pg_temp.context_intent(%L,%L,%L,''{}'',0)',offering,origin_id,destination_id),
    '23514','Offering intent requires exactly origin and destination');
  PERFORM pg_temp.context_error('missing destination',format('SELECT pg_temp.context_intent(%L,%L,%L,''{}'',1)',offering,origin_id,destination_id),
    '23514','Offering intent requires exactly origin and destination');
  PERFORM pg_temp.context_error('missing origin',format(
    'INSERT INTO private.offering_movement_intent_locations SELECT pg_temp.context_intent(%L,%L,%L,''{}'',0),''destination'',%L',offering,origin_id,destination_id,destination_id),
    '23514','Offering intent requires exactly origin and destination');
  PERFORM pg_temp.context_error('terminal transition cannot hide incomplete intent',format(
    'DO $case$ DECLARE new_id uuid; BEGIN new_id:=pg_temp.context_intent(%L,%L,%L,''{}'',0); UPDATE private.offering_movement_intents SET status=''superseded'' WHERE id=new_id; END $case$',offering,origin_id,destination_id),
    '23514','Offering intent is not current and unexpired');
  PERFORM pg_temp.context_error('wrong intent location owner',format('SELECT pg_temp.context_intent(%L,%L,%L)',offering,requester_location,destination_id),
    '23514','Offering intent location owner or expiry does not match');
  FOR label,options IN SELECT * FROM (VALUES
    ('zero intent version',jsonb_build_object('version',0)),
    ('invalid intent window',jsonb_build_object('latest_departure_at',now()-interval '1 day')),
    ('invalid intent expiry',jsonb_build_object('expires_at',now()-interval '1 day')),
    ('future intent creation',jsonb_build_object('created_at',clock_timestamp()+interval '1 hour')),
    ('initial terminal intent',jsonb_build_object('status','superseded'))
  ) cases(name,overrides) LOOP
    PERFORM pg_temp.context_error(label,format('SELECT pg_temp.context_intent(%L,%L,%L,%L::jsonb)',offering,origin_id,destination_id,options));
  END LOOP;
  PERFORM pg_temp.context_error('duplicate intent version',format('SELECT pg_temp.context_intent(%L,%L,%L,%L::jsonb)',offering,origin_id,destination_id,jsonb_build_object('intent_key',intent_key)),'23505');
  PERFORM pg_temp.context_error('two current intent versions',format('SELECT pg_temp.context_intent(%L,%L,%L,%L::jsonb)',offering,origin_id,destination_id,jsonb_build_object('intent_key',intent_key,'version',2)),'23505');
  FOREACH label IN ARRAY ARRAY['origin','destination'] LOOP
    PERFORM pg_temp.context_error('duplicate intent '||label,format('INSERT INTO private.offering_movement_intent_locations VALUES(%L,%L,%L)',intent_id,label,origin_id),'23505');
  END LOOP;

  spare_intent:=pg_temp.context_intent(offering,origin_id,destination_id);
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  SELECT to_jsonb(i) INTO row_before FROM private.offering_movement_intents i WHERE i.id=spare_intent;
  UPDATE private.offering_movement_intents SET status='superseded' WHERE id=spare_intent;
  record_id:=pg_temp.context_intent(offering,origin_id,destination_id,
    jsonb_build_object('intent_key',row_before->>'intent_key','version',2));
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.context_check('new intent version preserves old declaration',
    (SELECT to_jsonb(i)-'status'=row_before-'status' FROM private.offering_movement_intents i WHERE i.id=spare_intent));
  PERFORM pg_temp.context_error('unsupported intent location role',format('INSERT INTO private.offering_movement_intent_locations VALUES(%L,''waypoint'',%L)',intent_id,origin_id));
  PERFORM pg_temp.context_error('intent location relationship immutable',format('UPDATE private.offering_movement_intent_locations SET location_reference_id=%L WHERE intent_id=%L',requester_location,intent_id),
    '23514','Movement context relationships are immutable');
  PERFORM pg_temp.context_error('intent location deletion blocked',format('DELETE FROM private.offering_movement_intent_locations WHERE intent_id=%L',intent_id),
    '23514','Movement context relationships are immutable');
  FOR label,assignment IN SELECT * FROM (VALUES
    ('intent identity',format('id=%L',gen_random_uuid())),('intent member',format('offering_member_id=%L',outsider)),
    ('intent key',format('intent_key=%L',gen_random_uuid())),('intent version','version=2'),
    ('intent departure','earliest_departure_at=earliest_departure_at+interval ''1 hour'''),
    ('intent latest departure','latest_departure_at=earliest_departure_at'),('intent creation','created_at=created_at-interval ''1 second'''),
    ('intent expiry','expires_at=created_at+interval ''1 day''')
  ) cases(name,value) LOOP
    PERFORM pg_temp.context_error(label||' immutable',format('UPDATE private.offering_movement_intents SET %s WHERE id=%L',assignment,intent_id),
      '23514','Movement context fields are immutable');
  END LOOP;
  PERFORM pg_temp.context_error('cannot mark unexpired intent expired',format('UPDATE private.offering_movement_intents SET status=''expired'' WHERE id=%L',intent_id),
    '23514','Intent expiry has not elapsed');
  FOREACH label IN ARRAY ARRAY['superseded','withdrawn'] LOOP
    spare_intent:=pg_temp.context_intent(offering,origin_id,destination_id);
    SET CONSTRAINTS ALL IMMEDIATE;
    SET CONSTRAINTS ALL DEFERRED;
    UPDATE private.offering_movement_intents i SET status=label WHERE i.id=spare_intent;
    PERFORM pg_temp.context_error(label||' intent cannot reopen',format('UPDATE private.offering_movement_intents SET status=''current'' WHERE id=%L',spare_intent),
      '23514','Movement context lifecycle cannot reopen or change terminal state');
    PERFORM pg_temp.context_error(label||' intent deletion blocked',format('DELETE FROM private.offering_movement_intents WHERE id=%L',spare_intent),
      '23514','Movement context history cannot be deleted');
  END LOOP;

  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,people_count)
  VALUES(need_id,requester,'Declared origin','Declared destination',now()+interval '1 day',2);
  INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES(need_id,guest,'invited_participant','confirmed');
  INSERT INTO public.movement_offers(id,movement_need_id,offering_member_id,vehicle_id,seats_offered,proposed_pickup_area,proposed_dropoff_area,estimated_arrival_minutes)
  VALUES(offer_id,need_id,offering,vehicle_id,2,'Declared pickup','Declared dropoff',15),
    (wrong_offer,need_id,offering,vehicle_id,3,NULL,NULL,NULL);

  -- Each negative starts from no current snapshot in this context.
  FOR label,options IN SELECT * FROM (VALUES
    ('wrong requester',jsonb_build_object('requesting_member_id',outsider)),
    ('stale origin',jsonb_build_object('requester_origin_area','changed')),
    ('stale destination',jsonb_build_object('requester_destination_area','changed')),
    ('stale departure',jsonb_build_object('requester_earliest_departure_at',now()+interval '2 days')),
    ('wrong count',jsonb_build_object('people_count',1))
  ) cases(name,overrides) LOOP
    PERFORM pg_temp.context_error(label,format('SELECT pg_temp.context_snapshot(%L,%L,%L,%L::jsonb)',need_id,intent_id,vehicle_id,options),
      '23514','Movement snapshot need declarations do not match');
  END LOOP;
  FOR label,options IN SELECT * FROM (VALUES
    ('wrong offerer',jsonb_build_object('offering_member_id',outsider)),
    ('wrong intent version',jsonb_build_object('offering_intent_version',2)),
    ('wrong offering departure',jsonb_build_object('offering_earliest_departure_at',now()+interval '2 days')),
    ('wrong offering origin',jsonb_build_object('offering_origin_location_id',destination_id))
  ) cases(name,overrides) LOOP
    PERFORM pg_temp.context_error(label,format('SELECT pg_temp.context_snapshot(%L,%L,%L,%L::jsonb)',need_id,intent_id,vehicle_id,options),
      '23514','Movement snapshot offering intent does not match');
  END LOOP;
  PERFORM pg_temp.context_error('requester location owner mismatch',format('SELECT pg_temp.context_snapshot(%L,%L,%L,%L::jsonb)',need_id,intent_id,vehicle_id,jsonb_build_object('requester_origin_location_id',origin_id)),
    '23514','Movement snapshot requester location owner or expiry does not match');
  PERFORM pg_temp.context_error('wrong vehicle without access',format('SELECT pg_temp.context_snapshot(%L,%L,%L)',need_id,intent_id,other_vehicle),
    '23514','Movement snapshot vehicle access or capacity does not match');
  PERFORM pg_temp.context_error('capacity mismatch',format('SELECT pg_temp.context_snapshot(%L,%L,%L,''{"vehicle_seat_capacity":3}'')',need_id,intent_id,vehicle_id),
    '23514','Movement snapshot vehicle access or capacity does not match');
  FOREACH options IN ARRAY ARRAY['{"seats_offered":1}'::jsonb,'{"seats_offered":5}'::jsonb,'{"version":0}'::jsonb] LOOP
    PERFORM pg_temp.context_error('snapshot shape '||options::text,format('SELECT pg_temp.context_snapshot(%L,%L,%L,%L::jsonb)',need_id,intent_id,vehicle_id,options));
  END LOOP;
  PERFORM pg_temp.context_error('missing roster',format('SELECT pg_temp.context_snapshot(%L,%L,%L,''{}'',0)',need_id,intent_id,vehicle_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('incomplete roster',format('SELECT pg_temp.context_snapshot(%L,%L,%L,''{}'',1)',need_id,intent_id,vehicle_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('supersession cannot hide incomplete snapshot',format(
    'DO $case$ DECLARE new_id uuid; BEGIN new_id:=pg_temp.context_snapshot(%L,%L,%L,''{}'',0); UPDATE private.movement_context_snapshots SET status=''superseded'' WHERE id=new_id; END $case$',need_id,intent_id,vehicle_id),
    '23514','Movement snapshot is not current and unexpired');
  -- Build a complete-sized but incorrectly attributed snapshot, without UPDATE
  -- so the deferred roster validator, not the immutability guard, is tested.
  PERFORM pg_temp.context_error('primary requester role must match source',format(
    'WITH fresh AS MATERIALIZED (SELECT pg_temp.context_snapshot(%L,%L,%L,''{}'',0) id) INSERT INTO private.movement_context_snapshot_travellers SELECT fresh.id,mp.member_id,mp.id,''invited_participant'' FROM fresh CROSS JOIN public.movement_participants mp WHERE mp.movement_need_id=%L AND mp.status=''confirmed''',need_id,intent_id,vehicle_id,need_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('invited role must match source',format(
    'WITH fresh AS MATERIALIZED (SELECT pg_temp.context_snapshot(%L,%L,%L,''{}'',0) id) INSERT INTO private.movement_context_snapshot_travellers SELECT fresh.id,mp.member_id,mp.id,''primary_requester'' FROM fresh CROSS JOIN public.movement_participants mp WHERE mp.movement_need_id=%L AND mp.status=''confirmed''',need_id,intent_id,vehicle_id,need_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('pending invitation rejects snapshot',format(
    'INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES(%L,%L,''invited_participant'',''invited''); SELECT pg_temp.context_snapshot(%L,%L,%L)',need_id,outsider,need_id,intent_id,vehicle_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('offering member cannot be requester traveller',format(
    'UPDATE public.movement_needs SET people_count=3 WHERE id=%L; INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES(%L,%L,''invited_participant'',''confirmed''); SELECT pg_temp.context_snapshot(%L,%L,%L)',need_id,need_id,offering,need_id,intent_id,vehicle_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('source participant identity must match',format(
    'WITH fresh AS MATERIALIZED (SELECT pg_temp.context_snapshot(%L,%L,%L,''{}'',0) id) INSERT INTO private.movement_context_snapshot_travellers SELECT fresh.id,mp.member_id,gen_random_uuid(),mp.role FROM fresh CROSS JOIN public.movement_participants mp WHERE mp.movement_need_id=%L AND mp.status=''confirmed''',need_id,intent_id,vehicle_id,need_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('lost vehicle access',format(
    'UPDATE public.member_vehicle_access SET active=false WHERE member_id=%L AND vehicle_id=%L; SELECT pg_temp.context_snapshot(%L,%L,%L)',offering,vehicle_id,need_id,intent_id,vehicle_id),
    '23514','Movement snapshot vehicle access or capacity does not match');
  PERFORM pg_temp.context_error('superseded intent rejects new snapshot',format(
    'UPDATE private.offering_movement_intents SET status=''superseded'' WHERE id=%L; SELECT pg_temp.context_snapshot(%L,%L,%L)',intent_id,need_id,intent_id,vehicle_id),
    '23514','Offering intent is not current and unexpired');
  PERFORM pg_temp.context_error('closed need rejects snapshot',format(
    'UPDATE public.movement_needs SET status=''closed'' WHERE id=%L; SELECT pg_temp.context_snapshot(%L,%L,%L)',need_id,need_id,intent_id,vehicle_id),
    '23514','Movement snapshot requires an available need');
  PERFORM pg_temp.context_error('active alignment rejects snapshot',format(
    'INSERT INTO public.alignments(movement_need_id,movement_offer_id,offering_member_id,member_needing_movement_id) VALUES(%L,%L,%L,%L); SELECT pg_temp.context_snapshot(%L,%L,%L)',need_id,offer_id,offering,requester,need_id,intent_id,vehicle_id),
    '23514','Movement snapshot requires an available need');
  PERFORM pg_temp.context_error('offer context mismatch',format('SELECT pg_temp.context_snapshot(%L,%L,%L,%L::jsonb)',need_id,intent_id,vehicle_id,jsonb_build_object('movement_offer_id',wrong_offer)),
    '23514','Movement snapshot offer does not match');

  snapshot_id:=pg_temp.context_snapshot(need_id,intent_id,vehicle_id,jsonb_build_object('movement_offer_id',offer_id,
    'proposed_pickup_area','Declared pickup','proposed_dropoff_area','Declared dropoff','declared_arrival_minutes',15,
    'requester_origin_location_id',requester_location));
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.context_check('complete snapshot with exact offer and roster validates',
    (SELECT count(*)=2 FROM private.movement_context_snapshot_travellers st WHERE st.snapshot_id=fixture.snapshot_id));
  SELECT to_jsonb(s) INTO row_before FROM private.movement_context_snapshots s WHERE s.id=snapshot_id;
  UPDATE private.movement_context_snapshots s SET status=s.status WHERE s.id=snapshot_id;
  PERFORM pg_temp.context_check('identical snapshot retry preserves every field',
    (SELECT to_jsonb(s)=row_before FROM private.movement_context_snapshots s WHERE s.id=snapshot_id));
  PERFORM pg_temp.context_error('two current snapshots',format('SELECT pg_temp.context_snapshot(%L,%L,%L,''{"version":2}'')',need_id,intent_id,vehicle_id),'23505');
  FOR label,assignment IN SELECT * FROM (VALUES
    ('snapshot identity',format('id=%L',gen_random_uuid())),('snapshot need',format('movement_need_id=%L',gen_random_uuid())),
    ('snapshot requester',format('requesting_member_id=%L',outsider)),('snapshot offerer',format('offering_member_id=%L',outsider)),
    ('snapshot intent',format('offering_movement_intent_id=%L',spare_intent)),('snapshot intent version','offering_intent_version=2'),
    ('snapshot offer',format('movement_offer_id=%L',wrong_offer)),('snapshot vehicle',format('vehicle_id=%L',other_vehicle)),
    ('snapshot version','version=2'),('snapshot schema','context_schema_version=''other'''),('snapshot count','people_count=1'),
    ('snapshot seats','seats_offered=3'),('snapshot capacity','vehicle_seat_capacity=3'),
    ('snapshot origin','requester_origin_area=''changed'''),('snapshot destination','requester_destination_area=''changed'''),
    ('snapshot requester window','requester_latest_departure_at=requester_earliest_departure_at'),
    ('snapshot offering window','offering_latest_departure_at=offering_earliest_departure_at'),
    ('snapshot requester location','requester_origin_location_id=NULL'),('snapshot offering location',format('offering_origin_location_id=%L',destination_id)),
    ('snapshot pickup','proposed_pickup_area=''changed'''),('snapshot dropoff','proposed_dropoff_area=''changed'''),('snapshot declared arrival','declared_arrival_minutes=16'),
    ('snapshot created time','created_at=created_at-interval ''1 second'''),('snapshot expiry','expires_at=created_at+interval ''1 day''')
  ) cases(name,value) LOOP
    PERFORM pg_temp.context_error(label||' immutable',format('UPDATE private.movement_context_snapshots SET %s WHERE id=%L',assignment,snapshot_id),
      '23514','Movement context fields are immutable');
  END LOOP;
  FOR label,assignment IN SELECT * FROM (VALUES
    ('traveller member',format('member_id=%L',outsider)),('traveller source',format('movement_participant_id=%L',gen_random_uuid())),
    ('traveller role','role=''primary_requester'''),('traveller parent',format('snapshot_id=%L',gen_random_uuid()))
  ) cases(name,value) LOOP
    PERFORM pg_temp.context_error(label||' immutable',format('UPDATE private.movement_context_snapshot_travellers SET %s WHERE snapshot_id=%L AND member_id=%L',assignment,snapshot_id,guest),
      '23514','Movement context relationships are immutable');
  END LOOP;
  PERFORM pg_temp.context_error('traveller deletion blocked',format('DELETE FROM private.movement_context_snapshot_travellers WHERE snapshot_id=%L',snapshot_id),
    '23514','Movement context relationships are immutable');
  PERFORM pg_temp.context_error('duplicate traveller rejected',format('INSERT INTO private.movement_context_snapshot_travellers SELECT * FROM private.movement_context_snapshot_travellers WHERE snapshot_id=%L',snapshot_id),'23505');
  PERFORM pg_temp.context_error('extra traveller rejected',format('INSERT INTO private.movement_context_snapshot_travellers VALUES(%L,%L,%L,''invited_participant'')',snapshot_id,outsider,gen_random_uuid()),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('same-count source substitution rejects revalidation',format(
    'UPDATE public.movement_participants SET status=''removed'' WHERE movement_need_id=%L AND member_id=%L; INSERT INTO public.movement_participants(movement_need_id,member_id,role,status) VALUES(%L,%L,''invited_participant'',''confirmed''); SELECT private.assert_movement_context_snapshot(%L)',need_id,guest,need_id,outsider,snapshot_id),
    '23514','Movement snapshot requires the exact confirmed roster');
  PERFORM pg_temp.context_error('stale source need rejects revalidation',format(
    'UPDATE public.movement_needs SET origin_area=''changed'' WHERE id=%L; SELECT private.assert_movement_context_snapshot(%L)',need_id,snapshot_id),
    '23514','Movement snapshot need declarations do not match');
  PERFORM pg_temp.context_error('changed capacity rejects revalidation',format(
    'UPDATE public.vehicles SET seat_capacity=3 WHERE id=%L; SELECT private.assert_movement_context_snapshot(%L)',vehicle_id,snapshot_id),
    '23514','Movement snapshot vehicle access or capacity does not match');
  PERFORM pg_temp.context_error('nonpending offer rejects revalidation',format(
    'UPDATE public.movement_offers SET status=''withdrawn'' WHERE id=%L; SELECT private.assert_movement_context_snapshot(%L)',offer_id,snapshot_id),
    '23514','Movement snapshot offer does not match');

  UPDATE public.movement_needs SET origin_area='Changed historical source' WHERE id=need_id;
  UPDATE private.movement_context_snapshots s SET status='superseded' WHERE s.id=snapshot_id;
  PERFORM pg_temp.context_check('historical supersession preserves stale snapshot',
    (SELECT to_jsonb(s)-'status'=row_before-'status' FROM private.movement_context_snapshots s WHERE s.id=snapshot_id));
  PERFORM pg_temp.context_error('superseded snapshot cannot reopen',format('UPDATE private.movement_context_snapshots SET status=''current'' WHERE id=%L',snapshot_id),
    '23514','Movement context lifecycle cannot reopen or change terminal state');
  PERFORM pg_temp.context_error('snapshot history deletion blocked',format('DELETE FROM private.movement_context_snapshots WHERE id=%L',snapshot_id),
    '23514','Movement context history cannot be deleted');
  record_id:=pg_temp.context_snapshot(need_id,intent_id,vehicle_id,'{"version":2}');
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_temp.context_check('replacement snapshot can omit offer and requester exact points',
    (SELECT movement_offer_id IS NULL AND requester_origin_location_id IS NULL FROM private.movement_context_snapshots WHERE id=record_id));
  UPDATE private.movement_context_snapshots SET status='superseded' WHERE id=record_id;

  expired_location:=pg_temp.context_location(requester,jsonb_build_object('expires_at',clock_timestamp()+interval '1 second'));
  expiring_intent:=pg_temp.context_intent(offering,origin_id,destination_id,jsonb_build_object('expires_at',clock_timestamp()+interval '1 second'));
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_sleep(1.1);
  PERFORM pg_temp.context_error('expired intent rejects snapshot',format('SELECT pg_temp.context_snapshot(%L,%L,%L,''{"version":3}'')',need_id,expiring_intent,vehicle_id),
    '23514','Offering intent is not current and unexpired');
  PERFORM pg_temp.context_error('expired requester location rejects snapshot',format('SELECT pg_temp.context_snapshot(%L,%L,%L,%L::jsonb)',need_id,intent_id,vehicle_id,
    jsonb_build_object('version',3,'requester_origin_location_id',expired_location)),
    '23514','Movement snapshot requester location owner or expiry does not match');
  UPDATE private.offering_movement_intents SET status='expired' WHERE id=expiring_intent;
  PERFORM pg_temp.context_error('expired intent cannot reopen',format('UPDATE private.offering_movement_intents SET status=''current'' WHERE id=%L',expiring_intent),
    '23514','Movement context lifecycle cannot reopen or change terminal state');
  record_id:=pg_temp.context_snapshot(need_id,intent_id,vehicle_id,jsonb_build_object('version',3,'expires_at',clock_timestamp()+interval '1 second'));
  SET CONSTRAINTS ALL IMMEDIATE;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_sleep(1.1);
  PERFORM pg_temp.context_error('expired snapshot rejects revalidation',format('SELECT private.assert_movement_context_snapshot(%L)',record_id),
    '23514','Movement snapshot is not current and unexpired');
  UPDATE private.movement_context_snapshots SET status='superseded' WHERE id=record_id;

  FOREACH table_name IN ARRAY ARRAY['movement_location_references','offering_movement_intents','offering_movement_intent_locations','movement_context_snapshots','movement_context_snapshot_travellers'] LOOP
    PERFORM pg_temp.context_check('private table RLS no policies PUBLIC denied: '||table_name,
      (SELECT c.relrowsecurity AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid=c.oid)
        AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE acl.grantee=0)
        FROM pg_class c WHERE c.oid=to_regclass('private.'||table_name)));
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      PERFORM pg_temp.context_check(role_name||' no mutations: '||table_name,
        NOT has_table_privilege(role_name,'private.'||table_name,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
      old_role:=current_setting('role');
      -- A role-switch failure must abort, not satisfy a caught access denial.
      PERFORM set_config('role',role_name,true);
      BEGIN
        EXECUTE format('SELECT count(*) FROM private.%I',table_name) INTO result_count;
        observed:='00000';
      EXCEPTION WHEN OTHERS THEN observed:=SQLSTATE;
      END;
      PERFORM set_config('role',old_role,true);
      PERFORM pg_temp.context_check(role_name||' actual SELECT: '||table_name,
        observed=CASE WHEN role_name='service_role' THEN '00000' ELSE '42501' END,observed);
      FOREACH mutation IN ARRAY ARRAY[
        format('INSERT INTO private.%I DEFAULT VALUES',table_name),
        format('DELETE FROM private.%I WHERE false',table_name),
        format('UPDATE private.%I SET %I=%I WHERE false',table_name,
          CASE WHEN table_name IN ('offering_movement_intent_locations','movement_context_snapshot_travellers') THEN 'role' ELSE 'id' END,
          CASE WHEN table_name IN ('offering_movement_intent_locations','movement_context_snapshot_travellers') THEN 'role' ELSE 'id' END)
      ] LOOP
        PERFORM set_config('role',role_name,true);
        BEGIN
          EXECUTE mutation;
          observed:='00000';
          RAISE EXCEPTION USING ERRCODE='ZX022',MESSAGE='restore unexpected privileged write';
        EXCEPTION WHEN OTHERS THEN
          IF SQLSTATE<>'ZX022' THEN observed:=SQLSTATE; END IF;
        END;
        PERFORM set_config('role',old_role,true);
        PERFORM pg_temp.context_check(role_name||' actual mutation denied: '||mutation,observed='42501',observed);
      END LOOP;
    END LOOP;
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['protect_movement_context_record()','protect_movement_context_child()',
    'assert_offering_movement_intent(uuid)','validate_offering_movement_intent()',
    'assert_movement_context_snapshot(uuid)','validate_movement_context_snapshot()'] LOOP
    PERFORM pg_temp.context_check('helper isolated and restricted: '||signature,
      NOT has_function_privilege('anon','private.'||signature,'EXECUTE')
      AND NOT has_function_privilege('authenticated','private.'||signature,'EXECUTE')
      AND NOT has_function_privilege('service_role','private.'||signature,'EXECUTE')
      AND (SELECT p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[] AND NOT EXISTS (
        SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0)
        FROM pg_proc p WHERE p.oid=to_regprocedure('private.'||signature)));
  END LOOP;
  PERFORM pg_temp.context_check('0021 route gate remains NULL-only',EXISTS (
    SELECT 1 FROM pg_constraint c WHERE c.conrelid='private.financial_proposals'::regclass
      AND pg_get_constraintdef(c.oid)='CHECK ((route_evidence_id IS NULL))'));
  PERFORM pg_temp.context_error('0021 non-NULL route reference still rejected',format(
    'INSERT INTO private.financial_proposals(movement_need_id,offering_member_id,member_needing_movement_id,vehicle_id,version,financial_model_version,pricing_policy_version,platform_fee_allocation_policy_version,currency,quoted_platform_fee_total_minor,quoted_movement_contribution_minor,origin_area,destination_area,earliest_departure_at,people_count,seats_offered,vehicle_seat_capacity,route_evidence_id) VALUES(%L,%L,%L,%L,1,''shared_platform_fee_v1'',''fixture'',''equal_split_requester_remainder_v1'',''NGN'',0,0,''Changed historical source'',''Declared destination'',now()+interval ''1 day'',2,2,4,%L)',need_id,offering,requester,vehicle_id,gen_random_uuid()),
    '23514','new row for relation "financial_proposals" violates check constraint "financial_proposals_route_evidence_id_check"');
  -- No fixture manually creates these rows. Compare before rolling fixtures back.
  FOREACH table_name IN ARRAY ARRAY['financial_proposals','financial_agreements','financial_components','alignment_activation_payments','movement_settlements'] LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM private.%I r',table_name) INTO label;
    PERFORM pg_temp.context_check('no automatic private rows: '||table_name,
      label=(SELECT d.fingerprint FROM pg_temp.context_data d WHERE d.table_oid=to_regclass('private.'||table_name)));
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['alignments','journeys'] LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM public.%I r',table_name) INTO label;
    PERFORM pg_temp.context_check('no automatic public rows: '||table_name,
      label=(SELECT d.fingerprint FROM pg_temp.context_data d WHERE d.table_oid=to_regclass('public.'||table_name)));
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT jsonb_agg(to_jsonb(r) ORDER BY r.test_name) INTO saved_results FROM pg_temp.context_results r;
  RAISE EXCEPTION USING ERRCODE='ZX022',MESSAGE='rollback every fixture';
 EXCEPTION WHEN SQLSTATE 'ZX022' THEN NULL;
 END;
 IF saved_results IS NULL THEN RAISE EXCEPTION 'Missing test results'; END IF;
 INSERT INTO pg_temp.context_results SELECT r.* FROM jsonb_populate_recordset(NULL::pg_temp.context_results,saved_results) r;
 PERFORM pg_temp.context_check('all fixture users disappeared',NOT EXISTS (SELECT 1 FROM auth.users WHERE id IN (offering,requester,guest,outsider)));
END;
$test$;

DO $$ DECLARE entry record; fingerprint text; BEGIN
  FOR entry IN SELECT t.*,d.fingerprint old_fingerprint FROM pg_temp.context_tables t JOIN pg_temp.context_data d ON d.table_oid=t.oid LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text)::text,''[]'')) FROM %I.%I r',entry.schema_name,entry.table_name) INTO fingerprint;
    PERFORM pg_temp.context_check('exact rows restored: '||entry.schema_name||'.'||entry.table_name,fingerprint=entry.old_fingerprint);
  END LOOP;
END $$;
SELECT pg_temp.context_check('all existing function definitions grants and configuration unchanged',NOT EXISTS (
  SELECT 1 FROM pg_temp.context_functions s LEFT JOIN pg_proc p ON p.oid=s.oid WHERE p.oid IS NULL
    OR s.definition_hash<>md5(pg_get_functiondef(p.oid)) OR s.acl IS DISTINCT FROM p.proacl::text OR s.config IS DISTINCT FROM p.proconfig::text));
SELECT pg_temp.context_check('all existing table ACL RLS and policies unchanged',NOT EXISTS (
  SELECT 1 FROM pg_temp.context_tables s LEFT JOIN pg_class c ON c.oid=s.oid WHERE c.oid IS NULL
    OR s.acl IS DISTINCT FROM c.relacl::text OR s.relrowsecurity<>c.relrowsecurity OR s.relforcerowsecurity<>c.relforcerowsecurity
    OR s.policy_hash<>(SELECT md5(coalesce(jsonb_agg(to_jsonb(pol) ORDER BY pol.oid)::text,'[]')) FROM pg_policy pol WHERE pol.polrelid=c.oid)));
SELECT test_name,passed,diagnostic FROM pg_temp.context_results ORDER BY test_name;
SELECT count(*) AS tests,count(*) FILTER (WHERE passed) AS passed,count(*) FILTER (WHERE NOT passed) AS failed FROM pg_temp.context_results;
ROLLBACK;
