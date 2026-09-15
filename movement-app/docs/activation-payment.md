# Activation payment boundary

`create-activation-payment` accepts an authenticated POST containing only `movementNeedId`. Auth verifies the JWT; a server-only lookup resolves the movement and restricts initiation to its offering member, the payer established by migration 0007. Travellers and unrelated members cannot initiate. Ambiguous alignments fail closed.

The endpoint exposes only a safe state: activation_not_ready, payment_provider_unavailable, payment_pending, activated, or authentication_required. No participant readiness details, payment/alignment IDs, provider references or raw errors leave the server. Responses use private/no-store caching. Activated requires existing backend activation evidence; provider initiation cannot establish activation.

No migration 0018 is required. Installed SQL is unchanged. With an available adapter, the service-only create_alignment_activation_payment RPC must return successfully after commit before any external initiation. Its 0016 all-participant face gate remains authoritative even for pending-payment reuse. Final success still uses the existing service-only payment-success transaction, face recheck and exactly-once journey creation.

Production injects only the unavailable adapter. It stops before creating placeholder ledger entries; it never contacts a provider or marks success. There is no fake environment switch and no payment callback endpoint. The callback adapter seam defaults to rejection; a user JWT or success boolean grants no settlement authority.

Pricing is deliberately unresolved: the boundary uses only a previously recorded activation fee and currency. New accepted alignments currently have no fee. A trusted pricing policy must be specified before payment setup can work; no price is invented here.

## Client foundation

requestActivationPayment sends only movementNeedId with the current authenticated session and public project key. It projects safe backend states, distinguishes network/authentication failures, rejects unexpected response fields, and supports cancellation/timeouts. The controller blocks duplicate taps and discards cancelled, disposed and superseded results. It takes no own-face-ready or provider-success input. Future screen owners must cancel on blur/background/account change, dispose on unmount, and create a new owner for a new movement/account. No checkout screen is added while checkout is unavailable. Existing current-member face copy is unchanged and implies nothing about other participants.

## Before integrating a real provider

An adapter must durably bind a server payment ID to exactly one provider/account/checkout and use it as the external idempotency key across concurrent workers, retries and ambiguous network failures. Reusing a DB pending row alone does not deduplicate external charges. Existing pending rows must not be silently reassigned to another provider. The tests inject a fake adapter only to exercise ordering; they do not certify a real financial integration.

Choose trusted pricing, checkout handoff, authenticated callback verification, durable context binding, replay protection and settlement reconciliation before enabling an adapter. Callback processing must validate provider evidence against stored server context and invoke only the existing service-role success RPC. Ordinary JWTs are insufficient. No callback wiring or success route exists in this foundation.

If an external capture succeeds and final database activation rejects expired/changed face readiness, PostgreSQL cannot undo that charge. Product/provider decisions must specify refund/reconciliation/reverification, durable event handling, and user support. Do not retry with a new charge or fabricate activation to hide this failure. No fake reconciliation is implemented.

Eventually the endpoint requires the existing server SUPABASE_URL and SUPABASE_SECRET_KEYS.default (or legacy SUPABASE_SERVICE_ROLE_KEY). Client uses EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY only. No new provider secrets are needed until a real adapter is selected. Never put server credentials in EXPO_PUBLIC variables.

Local tests: supabase/tests/activation_payment.test.mjs and tests/activationPayment.test.cjs. No migration, remote SQL, deployment, commit or push is part of this change. SQL gate tests are static regression checks, not a substitute for the already-installed rollback tests or future provider concurrency tests.

## Audit: authority and limits

Migration 0007 explicitly establishes the offering member as the activation-fee payer. The Edge endpoint enforces caller authorization by comparing verified Auth identity with the resolved offering_member_id. The service-only SQL function does not authenticate the end-user actor: it trusts server callers and assigns payer_member_id from the locked alignment. Edge authorization is therefore mandatory, not redundant. SQL remains authoritative for face readiness, permitted alignment state, payer assignment and payment record creation. No client gains direct execution permission.

Amount and currency initially come from public.alignments.activation_fee_minor and activation_currency. The existing schema currency default is NGN, but a currency default is not a pricing policy. On pending-payment reuse, the RPC returns the original private payment amount/currency and those returned values are passed to the adapter. The SQL function accepts trusted server amounts; it is not a price calculator. Production has no available adapter, creates no placeholder payment, and cannot produce a payable checkout. Before enabling real payments, define trusted pricing and quote consistency, including changes between the initial lookup and the locked RPC.

The client busy guard is convenience only. Separate controllers/devices/workers can call concurrently. The database locks the alignment and reuses its pending row, with unique pending/succeeded indexes as backstops. Timeout/retry and adapter-unavailable retry must reuse that server context; the external adapter must durably deduplicate checkout creation. Current tests prove repeated calls reuse the identity returned by the DB stub, not actual PostgreSQL concurrency or provider idempotency. No remote SQL was run. Final-gate/capture coverage verifies the existing SQL gate and lack of a success shortcut; it does not simulate real funds or implement refunds.

Client controllers must receive the backend service, not arbitrary provider callbacks. Runtime allowlisting rejects objects, face-success results and unsupported states. A modified client can change its own display, but cannot authorize payment or activate the database. The mounted activation card uses the lifecycle owner described below.

## Mounted activation UI

The movement-verification screen now mounts ActivationPaymentCard alongside the current-member face card. It accepts only movementNeedId; it neither reads nor derives aggregate readiness from the face model. No amounts are shown. Continue/retry calls the existing payment service on explicit taps only, never on mount or a polling timer. Provider-unavailable is truthful build-unavailable copy, not payment failure.

useActivationPayment owns a controller for the focused, active authenticated account. Blur, unmount, background and account switches dispose old attempts and clear their display; late results cannot cross owners. Re-entering requires an explicit request. No lifecycle event automatically initiates payment.

Authoritative activation is observable for the offering member through the existing create-activation-payment response when the database alignment is activated. This is a mutation endpoint, not a read-only status feed; retries remain payment initiation attempts and rely on DB/adapter idempotency. It does not provide traveller activation observation or report in-progress/completed as activated. No broader status contract is claimed. No migration or new RPC was needed for this payer flow.

The optional onContinueJourney callback appears only after the service reports activated. No callback is supplied by the current route because no journey screen exists; no journey start/end functionality was added. Actual checkout, real payment and callback settlement remain blocked on provider/pricing work described above.
