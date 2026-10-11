BEGIN;
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
CREATE TEMP TABLE context_results(name text PRIMARY KEY,passed boolean NOT NULL);
CREATE FUNCTION pg_temp.check94(name text,passed boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN INSERT INTO context_results VALUES(name,coalesce(passed,false)); IF passed IS DISTINCT FROM true THEN RAISE EXCEPTION '0094 failed: %',name; END IF; END;
$$;
CREATE FUNCTION pg_temp.reject94(name text,command text,expected text DEFAULT '23514') RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false;
BEGIN BEGIN EXECUTE command; EXCEPTION WHEN OTHERS THEN IF SQLSTATE<>expected THEN RAISE; END IF; rejected:=true; END; PERFORM pg_temp.check94(name,rejected); END;
$$;
CREATE FUNCTION pg_temp.fixture94(p_status text DEFAULT 'discoverable',p_expiry timestamptz DEFAULT NULL,p_destination_expiry timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE member uuid:=gen_random_uuid(); need uuid:=gen_random_uuid(); origin uuid:=gen_random_uuid(); destination uuid:=gen_random_uuid();
BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) VALUES(member,'authenticated','authenticated',member::text||'@test-0094.invalid','{}','{}',clock_timestamp(),clock_timestamp());
  INSERT INTO public.movement_needs(id,member_id,origin_area,destination_area,earliest_departure_at,status) VALUES(need,member,'Origin','Destination',clock_timestamp()+interval '1 hour',p_status);
  INSERT INTO private.movement_location_references(id,owner_member_id,declared_label,source_kind,resolution_status,latitude,longitude,provider_namespace,provider_place_reference,resolution_version,created_at,resolved_at,expires_at)
    VALUES(origin,member,'Origin','provider_resolved','resolved',6.4,3.4,'test-location','origin','v1',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',p_expiry),
    (destination,member,'Destination','provider_resolved','resolved',6.5,3.5,'test-location','destination','v1',statement_timestamp()-interval '1 minute',statement_timestamp()-interval '1 minute',coalesce(p_destination_expiry,p_expiry));
  INSERT INTO private.movement_need_locations VALUES(need,'origin',origin),(need,'destination',destination);
  RETURN jsonb_build_object('member',member,'need',need,'origin',origin,'destination',destination);
END;
$$;
CREATE FUNCTION pg_temp.claim94(f jsonb) RETURNS jsonb LANGUAGE sql AS $$
SELECT to_jsonb(r) FROM public.claim_requester_route_generation_for_server((f->>'need')::uuid,(f->>'member')::uuid,'mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1') r;
$$;
CREATE FUNCTION pg_temp.context94(f jsonb,c jsonb) RETURNS jsonb LANGUAGE sql AS $$
SELECT to_jsonb(r) FROM public.get_claimed_requester_route_generation_context_for_server((f->>'need')::uuid,(f->>'member')::uuid,(c->>'generation_claim_token')::uuid) r;
$$;
DO $$
DECLARE f jsonb; c jsonb; r jsonb; again jsonb; other jsonb; evidence jsonb; query text; expiry timestamptz;
BEGIN
  PERFORM pg_temp.check94('service role alone granted',has_function_privilege('service_role','public.get_claimed_requester_route_generation_context_for_server(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.get_claimed_requester_route_generation_context_for_server(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.get_claimed_requester_route_generation_context_for_server(uuid,uuid,uuid)','EXECUTE'));
  f:=pg_temp.fixture94();
  PERFORM pg_temp.reject94('missing claim rejects',format('SELECT pg_temp.context94(%L,%L)',f,jsonb_build_object('generation_claim_token',gen_random_uuid())));
  c:=pg_temp.claim94(f);r:=pg_temp.context94(f,c);
  PERFORM pg_temp.check94('exact nineteen fields',(SELECT count(*)=19 FROM jsonb_object_keys(r)));
  PERFORM pg_temp.check94('exact requester and need',r->>'movement_need_id'=f->>'need' AND r->>'requesting_member_id'=f->>'member');
  PERFORM pg_temp.check94('exact endpoint identities',r->>'origin_location_reference_id'=f->>'origin' AND r->>'destination_location_reference_id'=f->>'destination');
  PERFORM pg_temp.check94('trusted coordinates',r->>'origin_latitude'='6.4' AND r->>'origin_longitude'='3.4' AND r->>'destination_latitude'='6.5' AND r->>'destination_longitude'='3.5');
  PERFORM pg_temp.check94('physical provider contract',r->>'provider_namespace'='mapbox-directions-v5' AND r->>'provider_product'='mapbox-directions' AND r->>'provider_version'='v5-driving-geojson-full-v1');
  PERFORM pg_temp.check94('schema and format',r->>'evidence_schema_version'='requester_route_evidence_v1' AND r->>'route_shape_format'='geojson_linestring_v1');
  PERFORM pg_temp.check94('server observes live lease',(r->>'claimed_at')::timestamptz<=(r->>'server_observed_at')::timestamptz AND (r->>'lease_expires_at')::timestamptz>(r->>'server_observed_at')::timestamptz);
  PERFORM pg_temp.check94('earliest generation bound',(r->>'earliest_generated_at')::timestamptz>=(r->>'claimed_at')::timestamptz);
  PERFORM pg_temp.check94('null endpoint expiry still departure bound',r->>'evidence_expires_at'=r->>'movement_need_deadline');
  again:=pg_temp.context94(f,c);
  PERFORM pg_temp.check94('context does not renew lease',again->>'lease_expires_at'=r->>'lease_expires_at' AND again->>'claimed_at'=r->>'claimed_at');
  PERFORM pg_temp.check94('context creates no evidence',NOT EXISTS(SELECT 1 FROM private.requester_route_evidence WHERE movement_need_id=(f->>'need')::uuid));
  PERFORM pg_temp.reject94('wrong token',format('SELECT pg_temp.context94(%L,%L)',f,jsonb_set(c,'{generation_claim_token}',to_jsonb(gen_random_uuid()))));
  PERFORM pg_temp.reject94('null token',format('SELECT pg_temp.context94(%L,%L)',f,'{}'::jsonb));
  other:=pg_temp.fixture94();
  PERFORM pg_temp.reject94('wrong owner',format('SELECT pg_temp.context94(%L,%L)',jsonb_set(f,'{member}',other->'member'),c),'42501');
  PERFORM pg_temp.reject94('unknown need',format('SELECT pg_temp.context94(%L,%L)',jsonb_set(f,'{need}',to_jsonb(gen_random_uuid())),c),'42501');
  query:=format('SELECT to_jsonb(r) FROM public.get_claimed_requester_route_generation_context_for_server(%L,%L,%L) r',f->>'need',f->>'member',c->>'generation_claim_token');
  EXECUTE 'SET LOCAL ROLE anon'; PERFORM pg_temp.reject94('anon actual execution denied',query,'42501'); EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated'; PERFORM pg_temp.reject94('authenticated actual execution denied',query,'42501'); EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE service_role'; EXECUTE query INTO r; EXECUTE 'RESET ROLE';
  PERFORM pg_temp.check94('service actual execution succeeds',r IS NOT NULL);
  -- Owner checks above do not depend on role impersonation/JWT.
  f:=pg_temp.fixture94('paused');c:=pg_temp.claim94(f);r:=pg_temp.context94(f,c);
  PERFORM pg_temp.check94('paused structural context remains valid',r->>'movement_need_id'=f->>'need');
  UPDATE public.movement_needs SET latest_departure_at=earliest_departure_at+interval '1 hour' WHERE id=(f->>'need')::uuid;
  r:=pg_temp.context94(f,c);
  PERFORM pg_temp.check94('latest departure overrides earliest',(r->>'movement_need_deadline')::timestamptz=(SELECT latest_departure_at FROM public.movement_needs WHERE id=(f->>'need')::uuid));
  f:=pg_temp.fixture94('discoverable',clock_timestamp()+interval '20 minutes',clock_timestamp()+interval '10 minutes');c:=pg_temp.claim94(f);r:=pg_temp.context94(f,c);
  PERFORM pg_temp.check94('endpoint expiry wins earlier horizon',(r->>'evidence_expires_at')::timestamptz<(r->>'movement_need_deadline')::timestamptz);
  PERFORM pg_temp.check94('earliest of distinct endpoints wins',(r->>'evidence_expires_at')::timestamptz=(SELECT expires_at FROM private.movement_location_references WHERE id=(f->>'destination')::uuid));
  SELECT to_jsonb(x) INTO evidence FROM public.record_claimed_requester_route_evidence_for_server((f->>'need')::uuid,(f->>'member')::uuid,(c->>'generation_claim_token')::uuid,(f->>'origin')::uuid,(f->>'destination')::uuid,'requester_route_evidence_v1','geojson_linestring_v1','mapbox-directions-v5','mapbox-directions','v5-driving-geojson-full-v1','route-v1','{"type":"LineString","coordinates":[[3.4,6.4],[3.5,6.5]]}',1000,300,(r->>'server_observed_at')::timestamptz,(r->>'evidence_expires_at')::timestamptz) x;
  PERFORM pg_temp.check94('bounded evidence published',(SELECT expires_at=(r->>'evidence_expires_at')::timestamptz FROM private.requester_route_evidence WHERE id=(evidence->>'route_evidence_id')::uuid));
  PERFORM pg_temp.reject94('completed context cannot grant fresh work',format('SELECT pg_temp.context94(%L,%L)',f,c));
END;
$$;
SELECT name,passed FROM context_results ORDER BY name;
SELECT '0094 SQL',count(*),count(*) FILTER(WHERE passed) FROM context_results;
ROLLBACK;
