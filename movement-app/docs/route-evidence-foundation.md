# 0023 Offering Route Evidence Foundation

## Purpose

WE DO NOT CREATE JOURNEYS. Migration 0023 adds a private, non-operational storage contract for a normalized route result describing an offering member's independently planned movement. It does not dispatch the offering member, create a requester pickup obligation, calculate requester-to-route proximity, negotiate a meeting arrangement, issue a price, or change any live movement flow.

0022 records the offerer's independent movement intent and immutable requester/vehicle/roster context. 0023 adds only the route result for the offerer's own intent. A later matching-evidence layer can compare a requester's private location/context with this route.

## Product model preserved

A requester may state `Ologolo -> Ikeja`. An offering member may already be travelling another compatible route. A future system may determine that the requester can reach the offering member's path and allow the offerer to ask, in effect, "Can you come to my route?" The requester then chooses YES or NO. That future YES is the consent to adapt to the proposed route-relative arrangement; 0023 does not implement that proposal or consent.

No requester location is classified in advance as flexible/specific. The original request remains intact. Precise meeting-pin coordination remains a later post-activation concern.

## New private object

`private.offering_route_evidence` stores one immutable version of normalized provider-produced route information for one exact `private.offering_movement_intents` version. It snapshots the offering member and exact origin/destination location-reference IDs so a route cannot be silently rebound to another intent or endpoint.

A current route-evidence version contains provider-neutral provenance strings, a normalized private GeoJSON LineString v1 shape, provider-reported positive total distance and duration, generation/creation/expiry timestamps and lifecycle state. Only one current version may exist for an offering intent.

The route shape is private. It is not a public map payload and is not requester matching evidence. GeoJSON coordinate order is `[longitude, latitude]`. The database validates structure and coordinate ranges but does not claim that a shape is geographically true merely because it passes structural validation.

## Resolved endpoint requirement

Route evidence requires the offering intent's exact origin/destination location references to be current eligible `provider_resolved` inputs with coordinates. This does not prove physical presence. It only prevents an unresolved free-text declaration from masquerading as an input to a provider-derived route result.

No routing vendor is selected. `provider_namespace`, `provider_product`, `provider_version` and `provider_route_reference` remain generic provenance fields. There is no provider API key, SDK, Edge Function, callback, geocoder or routing call in this migration.

## Trust boundary

The database can enforce immutability, binding, versioning, shape syntax, endpoint consistency and provenance-field presence. It cannot independently prove that a privileged administrator fabricated nothing. Therefore 0023 intentionally introduces no live writer.

PUBLIC, anon and authenticated have no table privileges. `service_role` has SELECT only. RLS is enabled with no policies. The four private helper functions are SECURITY DEFINER with an empty search path and EXECUTE revoked from PUBLIC, anon, authenticated and service_role. A later trusted server/provider integration must receive narrowly reviewed write authority rather than a generic client setter.

## Lifecycle

Every new evidence row starts `current`. A current row may become `superseded`, or `expired` after its non-NULL expiry time has elapsed. Terminal states cannot reopen or change to another terminal state. All non-status fields are immutable and rows cannot be deleted. At most one current route evidence version exists for each offering movement intent.

A stored `current` flag alone is not perpetual proof of eligibility. `private.assert_offering_route_evidence(uuid)` rechecks the offering intent and endpoint records. Historical evidence remains preserved when source state later changes.

## What route metrics mean

`route_distance_meters` and `route_duration_seconds` are the route provider's result for the offerer's own route. They are not requester distance, pickup deviation, drop-off deviation, overlap, shared-segment distance, pricing distance, fuel, tolls or ETA to a requester.

Requester-to-route proximity and actual road deviation are separate future measurements. For example, a requester can be physically close to a road while requiring a much longer vehicle diversion because of road topology. 0023 deliberately does not model or calculate either measurement.

## Future sequence

The intended sequence is:

1. 0022 offering movement intent + private resolved inputs.
2. A future trusted route producer creates 0023 offering-route evidence.
3. A later match-evidence layer binds an exact 0022 requester context to an exact 0023 route and derives safe route-relative facts such as `~X metres from your path` and actual vehicle deviation.
4. A later structured proposal lets the offerer ask whether the requester can come to the route; the requester explicitly accepts or declines.
5. A later immutable consent model freezes the accepted route-relative arrangement.
6. Only after those foundations are trustworthy should pricing and the financial-proposal route-evidence seam open.

## Closed financial seam

Migration 0021 is unchanged. `private.financial_proposals.route_evidence_id` remains constrained to NULL. 0023 route evidence is not automatically financial evidence, is not written into proposals, and does not issue proposals or agreements.

A later migration may open a financial evidence seam only after a trusted producer, route-relative matching evidence and consent semantics exist. Historical NULL proposals must remain distinguishable from future evidence-backed proposals.

## Explicit exclusions

0023 does not add PostGIS, geometry/geography columns, spatial indexes, maps, geocoding, provider API calls, requester-to-route distance, vehicle deviation, route overlap, detour, candidate join/leave points, bargaining, YES/NO negotiation, free-form preactivation chat, pricing, fuel, tolls, wallet, payment, refund, payout, settlement, activation changes, precise requester-pin exposure or multi-leg chaining.

It does not redefine or attach triggers to existing operational tables/functions. It adds triggers only to the new private table.
