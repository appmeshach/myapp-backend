-- Genuine trusted legacy construction for older suites' unavailable scenario.
-- Replaces their bare status UPDATE with accepted graph + face/payment
-- prerequisites + authoritative departure. All original eligibility/read-only
-- assertions still run, and each suite rolls this construction back.
CREATE FUNCTION pg_temp.freeze_roster_parent(p_parent uuid)
RETURNS void LANGUAGE plpgsql AS $fixture$
DECLARE av private.offering_movement_availability%ROWTYPE; i private.offering_movement_intents%ROWTYPE;
 requester uuid:=gen_random_uuid(); selected uuid; resolved uuid; origins uuid[]:=ARRAY[]::uuid[];
 need uuid; match uuid; offer uuid; alignment uuid; journey uuid; member uuid;
 submission uuid; media uuid; face uuid; payment uuid; point integer; namespace text;
BEGIN
 SELECT x.* INTO STRICT av FROM private.offering_movement_availability x WHERE x.id=p_parent;
 SELECT x.* INTO STRICT i FROM private.offering_movement_intents x WHERE x.id=av.offering_movement_intent_id;
 SELECT l.provider_namespace INTO STRICT namespace FROM private.offering_movement_intent_locations il
  JOIN private.movement_location_references l ON l.id=il.location_reference_id
  WHERE il.intent_id=i.id AND il.role='origin';
 INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
 VALUES(requester,'authenticated','authenticated',requester::text||'@roster-0091.invalid','{}','{}');
 FOR point IN 1..2 LOOP
  SELECT x.location_reference_id INTO selected FROM public.record_verified_selected_location_for_server(
   requester,gen_random_uuid(),'Lagos movement',namespace,requester::text||':'||point,'selection_proof_v1',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '4 hours') x;
  SELECT x.resolved_location_reference_id INTO resolved FROM public.record_attested_location_resolution_for_server(
   requester,selected,gen_random_uuid(),namespace,'geocode','0091-test',requester::text||':'||point,'resolution_v1',
   'Lagos movement','region-lagos','Lagos',CASE point WHEN 1 THEN 6.4300 ELSE 6.4310 END,
   CASE point WHEN 1 THEN 3.5200 ELSE 3.4430 END,clock_timestamp(),NULL) x;
  origins:=array_append(origins,resolved);
 END LOOP;
 PERFORM set_config('request.jwt.claim.sub',requester::text,true);
 SELECT x.movement_need_id INTO need FROM public.create_movement_need(gen_random_uuid(),origins[1],origins[2],
  statement_timestamp()+interval '1 hour',statement_timestamp()+interval '2 hours',1) x;
 SELECT x.route_match_evidence_id INTO match FROM public.record_trusted_route_match_evidence_for_server(
  need,i.id,av.route_evidence_id,av.route_evidence_version,250000,400000,18000,1000,12000,
  6.4300,3.5200,6.4310,3.4430,clock_timestamp(),NULL) x;
 PERFORM set_config('request.jwt.claim.sub',av.offering_member_id::text,true);
 SELECT x.movement_offer_id INTO offer FROM public.create_movement_offer(need,match,av.id,1) x;
 PERFORM set_config('request.jwt.claim.sub',requester::text,true);
 SELECT x.alignment_id INTO alignment FROM public.accept_movement_offer(offer) x;
 FOR member IN SELECT x.member_id FROM private.required_face_members(alignment) x LOOP
  submission:=public.create_profile_photo_submission_for_server(member,gen_random_uuid()::text||'/original.png','image/png',128);
  media:=public.prepare_profile_photo_submission_for_server(submission,gen_random_uuid()::text||'/processed.png');
  face:=public.start_alignment_face_verification_for_server(alignment,member,'legacy-0091',gen_random_uuid()::text);
  PERFORM public.complete_alignment_face_verification_for_server(face,media,true,true);
 END LOOP;
 SELECT x.payment_id INTO payment FROM public.create_alignment_activation_payment(alignment,100,'NGN','legacy-0091') x;
 PERFORM public.mark_alignment_activation_payment_succeeded(payment,'legacy-0091:'||gen_random_uuid());
 SELECT id INTO STRICT journey FROM public.journeys WHERE alignment_id=alignment;
 PERFORM set_config('request.jwt.claim.sub',av.offering_member_id::text,true);
 PERFORM public.set_my_movement_meeting_point(need,'Regression meeting point',NULL);
 PERFORM public.request_journey_start(journey);
 PERFORM private.assert_offering_movement_roster_freeze(av.id);
END;
$fixture$;
