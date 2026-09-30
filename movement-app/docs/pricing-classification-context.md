# 0062 Trusted Pricing-Classification Context

## Purpose

0062 establishes the trusted server-side input boundary for future
transport-geography classification.

It does not perform classification and does not calculate money.

The boundary starts from one exact live
`private.trusted_route_match_evidence` row and exposes only the geometry
and immutable source identities necessary for a future deterministic
classifier.

## Architecture

Trusted route evidence
? trusted route-match evidence
? 0062 exact classification context
? future versioned transport-geography classifier
? 0060 trusted pricing-geography recorder
? 0059 immutable pricing-geography evidence
? future pricing policy
? 0061 immutable pricing quote history

## Exact-source semantics

The caller must provide:

- exact route-match evidence id;
- expected route-match evidence version;
- exact route evidence id;
- expected route evidence version.

0062 does not perform "latest evidence" substitution.

The existing
`private.assert_trusted_route_match_evidence(uuid)`
remains the canonical matching-context validator.

0062 reuses that assertion instead of creating a second weaker
eligibility validator.

## Returned geometry

The service-role-only context may return:

- exact route-match evidence identity/version;
- movement need id;
- offering movement-intent identity/version;
- exact route evidence identity/version;
- trusted GeoJSON route shape;
- calculated route-shape length;
- requester origin/destination positions along the route;
- closest route points;
- route order;
- route-match evidence expiry.

The provider route distance is deliberately not returned as a pricing
corridor distance.

## Explicitly excluded

0062 does not:

- identify major roads;
- identify towns or neighborhoods;
- classify core-stage entries;
- classify major transport transitions;
- calculate pricing corridor distance;
- create pricing geography evidence;
- call the 0060 writer;
- calculate seat price;
- implement minimum price;
- implement MFEU;
- implement geographic monetary coefficients;
- implement diminishing event weights;
- implement rounding;
- implement the 70/30 financial allocation;
- create pricing quotes;
- create financial proposals;
- create financial agreements;
- change payment or activation behavior.

## Security

The RPC is SECURITY DEFINER with an empty search path.

Execution is revoked from:

- PUBLIC
- anon
- authenticated
- service_role

and then granted only to `service_role`.

There is no application-client RPC or application-client projection.

## Future classifier requirement

A future classifier must use a versioned authoritative
transport-geography dataset capable of identifying qualifying
major-road corridors and structural transport transitions.

Raw route distance, locality names, or requester labels are not
sufficient substitutes for that dataset.
