# Transport Geography Dataset Registry (0063)

## Purpose

WE DO NOT CREATE JOURNEYS.

Movement matches people to movement that already exists or that a member independently intends to make.

0063 adds a private registry for the exact transport-geography dataset snapshots that a future trusted geographic classifier may use.

Its job is to answer one narrow question:

Which exact transport-geography dataset version and extract has Movement approved for classification?

0063 does not classify roads, calculate prices, create journeys, create matches, change financial obligations, or call an external map provider.

## Why this exists

A future geographic classifier must not depend on a vague statement such as "we used Overture."

Transport datasets change over time. Roads, geometry, topology, classifications and source data can be corrected or updated.

Movement therefore needs to preserve the exact dataset snapshot that was approved when a classification was produced.

0063 records:

- Movement transport-geography version
- dataset family
- upstream dataset release
- source schema version
- theme
- feature type
- extract format
- source license
- source attribution
- source locator
- coordinate reference system
- geographic coverage
- SHA-256 content fingerprint
- extract byte size
- feature count
- lifecycle status
- registration timestamp

This makes future classification evidence reproducible and auditable.

## How 0063 fits into the pricing-geography system

The intended sequence is:

authoritative transport dataset
→ approved immutable regional extract
→ SHA-256 fingerprint
→ 0063 dataset registry
→ future geographic classifier
→ 0062 trusted pricing-classification context
→ corridor distance and structural geographic events
→ 0060 trusted pricing-geography recorder
→ 0059 immutable pricing-geography evidence
→ future pricing policy
→ 0061 immutable pricing quote

0063 deliberately stops at the dataset-registry stage.

It does not implement the classifier.

## Relationship to 0059 and 0060

0059 already stores three provenance values:

- classifier_name
- classifier_version
- transport_geography_version

In simple terms:

classifier_name tells us which classification system produced the result.

classifier_version tells us which version of that classification logic was used.

transport_geography_version tells us which exact map or road-network dataset version the classifier used.

0060 already records those values as part of the identity of trusted pricing-geography evidence.

0063 does not replace those existing fields.

Instead, 0063 provides the official registry that will eventually tell the system whether a transport_geography_version is a real approved dataset.

For example, the classifier might be:

movement_transport_classifier_v1

while the dataset might be:

an approved extract from a specific Overture Transportation release.

These are intentionally separate.

The classifier could change while the dataset stays the same.

The dataset could also change while the classifier stays the same.

Movement needs to know both.

## No 0059 or 0060 cutover yet

0063 intentionally does not change the existing 0059 or 0060 production behavior.

It does not change:

- private.pricing_geography_evidence
- public.record_pricing_geography_evidence_for_server
- 0062 classification context
- pricing quotes
- financial proposals
- financial agreements
- activation payments
- settlement

Development and historical provenance tokens therefore continue to work.

A later migration may require the production classifier to prove that its transport_geography_version exists in the 0063 registry and is currently approved.

That should happen only after:

1. a real production transport dataset extract exists,
2. its exact bytes are fixed,
3. its SHA-256 has been calculated,
4. its metadata has been registered,
5. the trusted classifier runtime exists,
6. classification behavior has been separately tested.

## Dataset lifecycle

Every dataset registry record must begin as:

approved

An approved dataset may later move only to:

superseded

or:

retired

A superseded or retired dataset cannot become approved again.

The factual metadata of a dataset cannot be edited after registration.

That includes:

- dataset release
- schema version
- source information
- coverage
- content hash
- byte size
- feature count

Dataset history cannot be deleted or truncated.

This means Movement can still explain which dataset produced old classification evidence years later.

## Meaning of each lifecycle state

approved means:

This exact dataset snapshot may be used for new classification work.

superseded means:

Keep this dataset for historical evidence, but a newer approved dataset has replaced it for new classification work.

retired means:

Keep this dataset for historical evidence, but it is intentionally no longer allowed for new classification work.

Historical preservation and permission to create new classifications are therefore separate concepts.

## Geographic coverage

0063 requires:

coverage_crs = EPSG:4326

This means the stored coverage uses ordinary WGS84 longitude and latitude coordinates.

The bbox contains exactly:

- xmin
- ymin
- xmax
- ymax

Validation requires:

- exactly those four fields
- valid numeric coordinates
- longitude between -180 and 180
- latitude between -90 and 90
- xmin less than xmax
- ymin less than ymax

This prevents a dataset using a different coordinate system from silently being treated as normal longitude and latitude data.

## Exact extract identity

0063 stores a lowercase SHA-256 fingerprint of the approved extract.

Two files from the same upstream release are not automatically the same file.

If the bytes differ, the SHA-256 fingerprint differs.

The registry also stores:

- byte length
- feature count

These provide additional integrity checks, while SHA-256 remains the exact content fingerprint.

## Security model

private.transport_geography_datasets is:

- private
- protected by RLS
- configured with no application RLS policies
- readable by service_role only
- not directly writable by application roles

There is no public 0063 RPC.

0063 creates three private helpers:

- private.assert_transport_geography_bbox(jsonb)
- private.assert_transport_geography_dataset(text)
- private.protect_transport_geography_dataset()

Direct helper execution is revoked from:

- PUBLIC
- anon
- authenticated
- service_role

A future reviewed server-side classification boundary may use these private protections internally.

0063 itself exposes no client writer.

## What 0063 does not decide

0063 does not decide:

- what counts as a major road
- whether motorway, trunk, primary, secondary or tertiary qualifies
- how connector topology works
- how side-road deviations are removed
- how shared corridor distance is calculated
- what counts as a core-stage entry
- what counts as a major transport transition
- Lagos-specific classifier rules
- the provisional +450 or +850 concepts
- diminishing stage weights
- MFEU
- the distance-price curve
- rounding
- 70/30 allocation
- activation pricing
- payment-provider behavior
- settlement

Those belong to later classifier and pricing-policy work.

## Findings from the local Overture research

The local Lagos transport-data research showed that Movement cannot define a major road using one simple Overture road-class rule.

Important roads were found across multiple classes including:

- motorway
- trunk
- primary
- secondary
- tertiary

The research also showed:

- important corridors may use more than one road class
- connector and link segments matter for network continuity
- many useful road segments have no route membership value
- road names can help humans inspect results but should not become production pricing rules

The future classifier therefore needs to consider geometry, topology, route position and network structure rather than hard-coded Lagos road names.

The temporary research file:

0063-lagos-overture-roads.parquet

is deliberately excluded from Git and is not part of the production application.

## Startup cost and budget impact

Movement is an early startup, so infrastructure decisions must also consider operating cost.

Mapping capabilities should be separated into different categories:

- road-network dataset
- routing
- geocoding and place search
- map display
- live traffic

These are different capabilities and do not necessarily need to come from one provider.

0063 is designed so Movement does not automatically need to pay for a commercial map-data subscription merely to preserve and classify a versioned road-network dataset if suitable open data can do that job correctly.

That does not mean all mapping services will be free.

A commercial provider may still be useful or required for things such as:

- route generation
- place and address search
- map display
- operational reliability
- other user-facing mapping features

Each external dependency will be evaluated separately in the Movement cost ledger.

Every external dependency should be classified as:

1. required for safe or correct launch,
2. strongly recommended for reliability or user experience,
3. optional and delayable for an early startup.

For paid services we will track:

- what the service does
- why Movement needs it
- what happens if it is skipped
- cheaper or free alternatives
- billing method
- what causes the bill to increase
- when Movement actually needs to start paying

Movement should not pay for a bundled commercial capability merely because another feature from the same provider is useful.

## Validation completed before installation

0063 has been tested without persistent installation.

Focused static tests:

10 / 10 passed

Rollback-only PostgreSQL behavioral tests:

58 / 58 passed

The rollback test also proved that:

- previous database data was restored
- previous definitions were restored
- ACLs were restored
- RLS configuration was restored
- migration history was restored
- all temporary 0063 objects disappeared after rollback

Full Node regression suite:

1245 / 1245 passed

TypeScript:

passed with no errors

git diff --check:

passed

At this documentation stage, 0063 has not yet been persistently installed locally or deployed remotely.

## Deferred work after 0063

0063 is only the dataset-registry foundation.

Later work must separately address:

1. production-grade regional extract generation
2. exact production extract SHA-256 calculation
3. production dataset registration process
4. trusted classifier runtime
5. matching 0062 route geometry to dataset segments
6. connector and topology traversal
7. continuous qualifying corridor rules
8. side-road and deviation exclusion
9. structural geographic-event detection
10. classifier versioning
11. registry enforcement at the production classifier boundary
12. conversion of classification evidence into pricing
13. routing, geocoding and map-display provider cost review

None of those should be silently added to 0063.