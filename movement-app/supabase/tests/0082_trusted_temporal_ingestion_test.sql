DO $instrument$
DECLARE name text; definition text;
BEGIN
 FOREACH name IN ARRAY ARRAY['record_location_resolution_for_server','record_offering_route_evidence_for_server','record_trusted_route_match_evidence_for_server'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name;
  IF strpos(definition,'v_attested_at := clock_timestamp();')=0 THEN RAISE EXCEPTION 'Missing authoritative ingestion sample'; END IF;
  EXECUTE replace(definition,'v_attested_at := clock_timestamp();',format('v_attested_at := clock_timestamp(); PERFORM set_config(%L,v_attested_at::text,true);','movement.test_ingestion_'||name));
 END LOOP;
END $instrument$;
DO $tests$
DECLARE f record; target_id uuid; offer_id uuid; e private.movement_location_resolution_evidence%ROWTYPE;
 t private.movement_location_references%ROWTYPE; m private.trusted_route_match_evidence%ROWTYPE;
 r private.offering_route_evidence%ROWTYPE; definition text; reference timestamptz;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.snapshot_fixture;
 target_id:=pg_temp.snapshot_state_endpoint(f.requester,'Temporal compatible provider endpoint','temporal-'||gen_random_uuid(),6.5,3.5);
 SELECT x.* INTO STRICT e FROM private.movement_location_resolution_evidence x WHERE x.resolved_location_reference_id=target_id;
 SELECT x.* INTO STRICT t FROM private.movement_location_references x WHERE x.id=target_id;
 PERFORM pg_temp.snapshot_check('location sample used by admission equals both persisted attestations',e.recorded_at=t.created_at AND e.recorded_at=current_setting('movement.test_ingestion_record_location_resolution_for_server')::timestamptz AND t.resolved_at<=e.recorded_at);
 offer_id:=pg_temp.new_offer();
 SELECT x.* INTO STRICT m FROM private.trusted_route_match_evidence x JOIN private.movement_offer_route_match_bindings b ON b.route_match_evidence_id=x.id WHERE b.movement_offer_id=offer_id;
 SELECT x.* INTO STRICT r FROM private.offering_route_evidence x WHERE x.id=m.route_evidence_id;
 PERFORM pg_temp.snapshot_check('route admission sample equals immutable created stamp',r.created_at=current_setting('movement.test_ingestion_record_offering_route_evidence_for_server')::timestamptz AND r.generated_at<=r.created_at);
 PERFORM pg_temp.snapshot_check('match admission sample equals immutable created stamp',m.created_at=current_setting('movement.test_ingestion_record_trusted_route_match_evidence_for_server')::timestamptz AND m.calculated_at<=m.created_at);
 PERFORM pg_temp.probe('location rejects genuine future external event',format('SELECT * FROM public.record_location_resolution_for_server(%L,gen_random_uuid(),%L,%L,%L,%L,%L,%L,%L,clock_timestamp()+interval ''1 hour'',NULL)',e.source_location_reference_id,t.provider_namespace,e.provider_product,e.provider_version,t.provider_place_reference,t.resolution_version,t.latitude,t.longitude),'23514','timestamps');
 PERFORM pg_temp.probe('match rejects genuine future external event',format('SELECT * FROM public.record_trusted_route_match_evidence_for_server(%L,%L,%L,%s,0,0,1000,0,1000,6,3,7,4,clock_timestamp()+interval ''1 hour'',NULL)',m.movement_need_id,m.offering_movement_intent_id,r.id,r.version),'23514','calculation time');
 PERFORM pg_temp.probe('plausible event cannot replace exact selected provider identity',format('SELECT * FROM public.record_location_resolution_for_server(%L,gen_random_uuid(),%L,%L,%L,%L,%L,%L,%L,%L::timestamptz,NULL)',e.source_location_reference_id,t.provider_namespace,e.provider_product,e.provider_version,'wrong-'||gen_random_uuid(),t.resolution_version,t.latitude,t.longitude,t.resolved_at),'23514','preserve provider selection identity');
 PERFORM pg_temp.probe('plausible match time cannot substitute another route identity',format('SELECT * FROM public.record_trusted_route_match_evidence_for_server(%L,%L,gen_random_uuid(),%s,0,0,1000,0,1000,6,3,7,4,%L::timestamptz,NULL)',m.movement_need_id,m.offering_movement_intent_id,r.version,r.generated_at),'23514','route is no longer current');
 PERFORM pg_temp.probe('API cannot fabricate ordinal', 'SET LOCAL ROLE authenticated; INSERT INTO private.alignment_face_verifications(attempt_ordinal) VALUES(1)','42501');
 PERFORM pg_temp.probe('API cannot fabricate route attestation', 'SET LOCAL ROLE service_role; INSERT INTO private.offering_route_evidence(created_at) VALUES(clock_timestamp())','42501');
 PERFORM pg_temp.probe('resolution attestation immutable',format('UPDATE private.movement_location_resolution_evidence SET recorded_at=recorded_at+interval ''1 microsecond'' WHERE id=%L',e.id),'23514','immutable');
 PERFORM pg_temp.probe('route attestation immutable',format('UPDATE private.offering_route_evidence SET created_at=created_at+interval ''1 microsecond'' WHERE id=%L',r.id),'23514','immutable');
 PERFORM pg_temp.probe('match attestation immutable',format('UPDATE private.trusted_route_match_evidence SET created_at=created_at+interval ''1 microsecond'' WHERE id=%L',m.id),'23514','immutable');
 reference:=e.recorded_at-interval '5338 microseconds';
 definition:=pg_get_functiondef('private.assert_movement_location_resolution_evidence(uuid)'::regprocedure);
 EXECUTE replace(definition,'clock_timestamp()',quote_literal(reference)||'::timestamptz');
 PERFORM private.assert_movement_location_resolution_evidence(e.id);
 PERFORM private.assert_trusted_location_discovery_area(e.id);
 PERFORM private.assert_trusted_location_state_evidence(e.id);
 PERFORM pg_temp.snapshot_check('resolution survives exact captured 5338 microsecond lower evaluation clock',reference<e.recorded_at);
 PERFORM pg_temp.probe('expired resolution cannot authorize new live action',format('DO $x$ BEGIN EXECUTE %L; END $x$; SELECT private.assert_movement_location_resolution_evidence(%L)',replace(definition,'clock_timestamp()',quote_literal(e.recorded_at+interval '5 hours')||'::timestamptz'),e.id),'23514','expiry');
 PERFORM pg_temp.probe('exact wrong provider provenance denied',format('UPDATE private.offering_route_evidence SET provider_route_reference=gen_random_uuid()::text WHERE id=%L',r.id),'23514','immutable');
END $tests$;
TABLE pg_temp.snapshot_results;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_temp.snapshot_results WHERE NOT passed) THEN RAISE EXCEPTION 'Temporal ingestion behaviors failed'; END IF; END $$;
ROLLBACK;
