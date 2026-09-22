import { readBounded } from './face-orchestration.ts';

import {
  LOCATION_PROOF_AUDIENCE,
  LOCATION_PROOF_VERSION,
  MAX_LOCATION_LABEL_LENGTH,
  MAX_LOCATION_QUERY_CODE_POINTS,
  MAX_LOCATION_SUGGESTIONS,
  MAX_PROVIDER_NAMESPACE_LENGTH,
  MAX_PROVIDER_REFERENCE_LENGTH,
  MAX_SELECTION_PROOF_LENGTH,
  MIN_LOCATION_QUERY_CODE_POINTS,
  NIGERIA_COUNTRY_CODE,
  unavailableDurableLocationResolver,
  unavailableLocationSearchProvider,
  unavailableSelectionProofSigner,
} from './location-contracts.ts';

import type {
  DurableLocationResolution,
  DurableLocationResolver,
  LocationBackend,
  LocationResolutionContext,
  LocationSearchProvider,
  ProviderSearchSuggestion,
  SelectionProofSigner,
} from './location-contracts.ts';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const SEARCH_BODY_LIMIT = 2048;
const SELECTION_BODY_LIMIT = 8192;
const LOCATION_BODY_LIMIT = 2048;
const SEARCH_DEADLINE_MS = 10_000;
const DEFAULT_DEADLINE_MS = 20_000;
const PROOF_TTL_MS = 2 * 60_000;

const headers = {
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'Vary': 'Authorization, Origin',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class Denied extends Error {
  readonly status: number;
  readonly state: string;

  constructor(status: number, state: string) {
    super(state);
    this.status = status;
    this.state = state;
  }
}

function response(
  status: number,
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(body),
    { status, headers },
  );
}

function failure(error: unknown): Response {
  if (error instanceof Denied) {
    return response(
      error.status,
      { state: error.state },
    );
  }

  return response(
    503,
    { state: 'location_unavailable' },
  );
}

async function providerAdmission(
  backend: LocationBackend,
  memberId: string,
  operation: 'location_search' | 'location_resolution',
  signal: AbortSignal,
): Promise<Response | null> {
  signal.throwIfAborted();
  const quota = await backend.consumeProviderQuota(memberId, operation, signal);
  signal.throwIfAborted();
  if (!quota || typeof quota.admitted !== 'boolean'
    || !Number.isInteger(quota.retryAfterSeconds)
    || (quota.admitted ? quota.retryAfterSeconds !== 0
      : quota.retryAfterSeconds < 1 || quota.retryAfterSeconds > 86400)) {
    throw new Error('Unavailable');
  }
  if (quota.admitted) return null;
  return new Response(JSON.stringify({
    state: 'location_rate_limited', retryAfterSeconds: quota.retryAfterSeconds,
  }), { status: 429, headers: { ...headers, 'Retry-After': String(quota.retryAfterSeconds) } });
}

function requireFreshContext(context: LocationResolutionContext): void {
  const currentTime = Date.now();
  for (const expiry of [context.sourceExpiresAt, context.expiresAt]) {
    if (expiry !== null && (!validIso(expiry) || Date.parse(expiry) <= currentTime)) {
      throw new Denied(503, 'location_resolution_unavailable');
    }
  }
}

function record(
  value: unknown,
): value is Record<string, unknown> {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();

  return actual.length === expected.length
    && actual.every(
      (item, index) => item === expected[index],
    );
}

function trimmed(
  value: unknown,
  max: number,
): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= max
    && /\S/u.test(value);
}

function codePoints(value: string): number {
  return [...value].length;
}

function validIso(
  value: unknown,
): value is string {
  if (typeof value !== 'string') return false;

  const time = Date.parse(value);

  return Number.isFinite(time)
    && new Date(time).toISOString() === value;
}

function jsonBody(
  request: Request,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    request.headers
      .get('Content-Type')
      ?.split(';')[0]
      ?.toLowerCase()
      !== 'application/json'
  ) {
    throw new Denied(
      415,
      'unsupported_content_type',
    );
  }

  const length = Number(
    request.headers.get('Content-Length'),
  );

  if (
    Number.isFinite(length)
    && length > maxBytes
  ) {
    throw new Denied(
      413,
      'request_too_large',
    );
  }

  return readBounded(
    request.body,
    maxBytes,
    signal,
  )
    .then(
      bytes => JSON.parse(
        new TextDecoder().decode(bytes),
      ),
    )
    .catch(error => {
      if (
        error instanceof Denied
        || error?.name === 'AbortError'
        || error?.name === 'TimeoutError'
      ) {
        throw error;
      }

      throw new Denied(
        400,
        'invalid_request',
      );
    });
}

function early(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return new Response(
      null,
      { status: 204, headers },
    );
  }

  if (
    request.method !== 'POST'
    || new URL(request.url).search
  ) {
    throw new Denied(
      400,
      'invalid_request',
    );
  }

  return null;
}

async function member(
  request: Request,
  backend: LocationBackend,
  signal: AbortSignal,
): Promise<string> {
  const jwt =
    request.headers
      .get('Authorization')
      ?.match(/^Bearer (\S+)$/i)?.[1];

  if (!jwt) {
    throw new Denied(
      401,
      'authentication_required',
    );
  }

  const memberId =
    await backend.authenticate(jwt, signal);

  if (
    !memberId
    || !UUID.test(memberId)
  ) {
    throw new Denied(
      401,
      'authentication_required',
    );
  }

  if (
    !await backend.memberExists(
      memberId,
      signal,
    )
  ) {
    throw new Denied(
      403,
      'membership_required',
    );
  }

  return memberId;
}

function normalizeSuggestion(
  value: ProviderSearchSuggestion,
): ProviderSearchSuggestion | null {
  if (
    !value
    || !trimmed(
      value.declaredLabel,
      MAX_LOCATION_LABEL_LENGTH,
    )
    || !trimmed(
      value.providerNamespace,
      MAX_PROVIDER_NAMESPACE_LENGTH,
    )
    || !trimmed(
      value.providerPlaceReference,
      MAX_PROVIDER_REFERENCE_LENGTH,
    )
    || typeof value.persistentSelectionAllowed
      !== 'boolean'
  ) {
    return null;
  }

  return {
    declaredLabel: value.declaredLabel,
    providerNamespace: value.providerNamespace,
    providerPlaceReference:
      value.providerPlaceReference,
    persistentSelectionAllowed:
      value.persistentSelectionAllowed,
  };
}

function normalizeAttribution(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    throw new Denied(
      502,
      'provider_response_invalid',
    );
  }

  if (value.length > 10) {
    throw new Denied(
      502,
      'provider_response_invalid',
    );
  }

  const output: string[] = [];

  for (const item of value) {
    if (
      typeof item !== 'string'
      || item !== item.trim()
      || item.length > 300
      || !/\S/u.test(item)
    ) {
      throw new Denied(
        502,
        'provider_response_invalid',
      );
    }

    output.push(item);
  }

  return output;
}

async function stableResolutionOperationId(
  sourceLocationReferenceId: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    `movement-location-resolution-v1:${sourceLocationReferenceId}`,
  );

  const digest = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      bytes,
    ),
  );

  const uuid = digest.slice(0, 16);

  uuid[6] = (uuid[6] & 0x0f) | 0x50;
  uuid[8] = (uuid[8] & 0x3f) | 0x80;

  const hex = [...uuid]
    .map(value =>
      value.toString(16).padStart(2, '0')
    )
    .join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function existingResolution(
  context: LocationResolutionContext,
): {
  state: 'resolved';
  resolvedLocationReferenceId: string;
  expiresAt: string | null;
} | null {
  if (
    context.evidenceId === null
    && context.resolvedLocationReferenceId === null
    && context.version === null
  ) {
    return null;
  }

  if (
    !context.evidenceId
    || !UUID.test(context.evidenceId)
    || !context.resolvedLocationReferenceId
    || !UUID.test(
      context.resolvedLocationReferenceId,
    )
    || !Number.isInteger(context.version)
    || Number(context.version) < 1
    || (
      context.expiresAt !== null
      && !validIso(context.expiresAt)
    )
  ) {
    throw new Denied(
      502,
      'location_unavailable',
    );
  }

  return {
    state: 'resolved',
    resolvedLocationReferenceId:
      context.resolvedLocationReferenceId,
    expiresAt: context.expiresAt,
  };
}

function validResolution(
  result: DurableLocationResolution,
  expectedNamespace: string,
  expectedReference: string,
): boolean {
  if (
    !result
    || result.durableStorageAllowed !== true
    || result.providerNamespace
      !== expectedNamespace
    || result.providerPlaceReference
      !== expectedReference
    || !trimmed(
      result.providerProduct,
      100,
    )
    || !trimmed(
      result.providerVersion,
      100,
    )
    || !trimmed(
      result.resolutionVersion,
      100,
    )
    || !trimmed(
      result.discoveryAreaLabel,
      MAX_LOCATION_LABEL_LENGTH,
    )
    || !Number.isFinite(result.latitude)
    || !Number.isFinite(result.longitude)
    || result.latitude < -90
    || result.latitude > 90
    || result.longitude < -180
    || result.longitude > 180
    || !validIso(result.resolvedAt)
    || (
      result.expiresAt !== null
      && (
        !validIso(result.expiresAt)
        || Date.parse(result.expiresAt)
          <= Date.parse(result.resolvedAt)
      )
    )
  ) {
    return false;
  }

  return true;
}

export function createLocationSearchHandler(
  backend: LocationBackend,
  provider: LocationSearchProvider =
    unavailableLocationSearchProvider,
  signer: SelectionProofSigner =
    unavailableSelectionProofSigner,
  now: () => number = () => Date.now(),
) {
  return async (
    request: Request,
  ): Promise<Response> => {
    try {
      const first = early(request);
      if (first) return first;

      const signal =
        AbortSignal.any([request.signal, AbortSignal.timeout(SEARCH_DEADLINE_MS)]);
      signal.throwIfAborted();

      const memberId =
        await member(
          request,
          backend,
          signal,
        );

      const body =
        await jsonBody(
          request,
          SEARCH_BODY_LIMIT,
          signal,
        );

      if (
        !record(body)
        || !exactKeys(body, ['query'])
        || typeof body.query !== 'string'
        || body.query !== body.query.trim()
        || codePoints(body.query)
          < MIN_LOCATION_QUERY_CODE_POINTS
        || codePoints(body.query)
          > MAX_LOCATION_QUERY_CODE_POINTS
        || !/\S/u.test(body.query)
      ) {
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      if (
        !provider.isAvailable()
        || !signer.isAvailable()
      ) {
        throw new Denied(
          503,
          'location_search_unavailable',
        );
      }

      const denied = await providerAdmission(backend, memberId, 'location_search', signal);
      if (denied) return denied;

      const providerResult =
        await provider.search(
          {
            query: body.query,
            countryCode:
              NIGERIA_COUNTRY_CODE,
            limit:
              MAX_LOCATION_SUGGESTIONS,
          },
          signal,
        );

      if (
        !providerResult
        || !Array.isArray(
          providerResult.suggestions,
        )
      ) {
        throw new Denied(
          502,
          'provider_response_invalid',
        );
      }

      signal.throwIfAborted();

      const attribution =
        normalizeAttribution(
          providerResult.attribution,
        );

      const selected =
        providerResult.suggestions
          .slice(
            0,
            MAX_LOCATION_SUGGESTIONS,
          )
          .map(normalizeSuggestion)
          .filter(
            (
              value,
            ): value is ProviderSearchSuggestion =>
              value !== null
              && value.persistentSelectionAllowed,
          );

      const suggestions = [];

      for (const suggestion of selected) {
        const selectionRequestId =
          crypto.randomUUID();

        const issuedAt =
          new Date(now()).toISOString();

        const expiresAt =
          new Date(
            now() + PROOF_TTL_MS,
          ).toISOString();

        const selectionProof =
          await signer.sign(
            {
              audience:
                LOCATION_PROOF_AUDIENCE,
              version:
                LOCATION_PROOF_VERSION,
              memberId,
              selectionRequestId,
              declaredLabel:
                suggestion.declaredLabel,
              providerNamespace:
                suggestion.providerNamespace,
              providerPlaceReference:
                suggestion.providerPlaceReference,
              issuedAt,
              expiresAt,
            },
            signal,
          );

        if (
          typeof selectionProof
            !== 'string'
          || selectionProof.length < 1
          || selectionProof.length
            > MAX_SELECTION_PROOF_LENGTH
        ) {
          throw new Denied(
            503,
            'location_search_unavailable',
          );
        }

        suggestions.push({
          selectionRequestId,
          declaredLabel:
            suggestion.declaredLabel,
          providerNamespace:
            suggestion.providerNamespace,
          providerPlaceReference:
            suggestion.providerPlaceReference,
          selectionProof,
        });
      }

      return response(
        200,
        {
          suggestions,
          attribution,
        },
      );
    } catch (error) {
      return failure(error);
    }
  };
}

export function createLocationSelectionHandler(
  backend: LocationBackend,
  signer: SelectionProofSigner =
    unavailableSelectionProofSigner,
) {
  return async (
    request: Request,
  ): Promise<Response> => {
    try {
      const first = early(request);
      if (first) return first;

      const signal =
        AbortSignal.timeout(
          DEFAULT_DEADLINE_MS,
        );

      const memberId =
        await member(
          request,
          backend,
          signal,
        );

      const body =
        await jsonBody(
          request,
          SELECTION_BODY_LIMIT,
          signal,
        );

      if (
        !record(body)
        || !exactKeys(
          body,
          ['selectionProof'],
        )
        || typeof body.selectionProof
          !== 'string'
        || body.selectionProof.length < 1
        || body.selectionProof.length
          > MAX_SELECTION_PROOF_LENGTH
      ) {
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      if (!signer.isAvailable()) {
        throw new Denied(
          503,
          'selection_unavailable',
        );
      }

      const claims =
        await signer.verify(
          body.selectionProof,
          memberId,
          signal,
        );

      if (!claims) {
        throw new Denied(
          409,
          'selection_proof_invalid',
        );
      }

      let result;

      try {
        result =
          await backend
            .recordVerifiedSelection(
              {
                verifiedMemberId:
                  memberId,
                selectionRequestId:
                  claims.selectionRequestId,
                declaredLabel:
                  claims.declaredLabel,
                providerNamespace:
                  claims.providerNamespace,
                providerPlaceReference:
                  claims.providerPlaceReference,
                proofVersion:
                  claims.version,
                proofIssuedAt:
                  claims.issuedAt,
                proofExpiresAt:
                  claims.expiresAt,
              },
              signal,
            );
      } catch {
        throw new Denied(
          503,
          'selection_unavailable',
        );
      }

      if (
        !result
        || !UUID.test(
          result.locationReferenceId,
        )
        || result.declaredLabel
          !== claims.declaredLabel
      ) {
        throw new Denied(
          409,
          'selection_unavailable',
        );
      }

      return response(
        200,
        {
          locationReferenceId:
            result.locationReferenceId,
          declaredLabel:
            result.declaredLabel,
        },
      );
    } catch (error) {
      return failure(error);
    }
  };
}

export function createLocationRecoveryHandler(
  backend: LocationBackend,
) {
  return async (
    request: Request,
  ): Promise<Response> => {
    try {
      const first = early(request);
      if (first) return first;

      const signal =
        AbortSignal.timeout(
          DEFAULT_DEADLINE_MS,
        );

      const memberId =
        await member(
          request,
          backend,
          signal,
        );

      const body =
        await jsonBody(
          request,
          LOCATION_BODY_LIMIT,
          signal,
        );

      if (
        !record(body)
        || !exactKeys(
          body,
          ['selectionRequestId'],
        )
        || typeof body.selectionRequestId
          !== 'string'
        || !UUID.test(
          body.selectionRequestId,
        )
      ) {
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      const result =
        await backend
          .recoverVerifiedSelection(
            memberId,
            body.selectionRequestId,
            signal,
          )
          .catch(() => null);

      if (
        !result
        || !UUID.test(
          result.locationReferenceId,
        )
        || !trimmed(
          result.declaredLabel,
          MAX_LOCATION_LABEL_LENGTH,
        )
      ) {
        throw new Denied(
          404,
          'selection_unavailable',
        );
      }

      return response(
        200,
        {
          locationReferenceId:
            result.locationReferenceId,
          declaredLabel:
            result.declaredLabel,
        },
      );
    } catch (error) {
      return failure(error);
    }
  };
}

export function createLocationResolutionHandler(
  backend: LocationBackend,
  resolver: DurableLocationResolver =
    unavailableDurableLocationResolver,
) {
  return async (
    request: Request,
  ): Promise<Response> => {
    try {
      const first = early(request);
      if (first) return first;

      const startedAt = performance.now();
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DEFAULT_DEADLINE_MS)]);
      signal.throwIfAborted();

      const memberId =
        await member(
          request,
          backend,
          signal,
        );

      const body =
        await jsonBody(
          request,
          LOCATION_BODY_LIMIT,
          signal,
        );

      if (
        !record(body)
        || !exactKeys(
          body,
          ['sourceLocationReferenceId'],
        )
        || typeof body
          .sourceLocationReferenceId
          !== 'string'
        || !UUID.test(
          body.sourceLocationReferenceId,
        )
      ) {
        throw new Denied(
          400,
          'invalid_request',
        );
      }

      const operationId =
        await stableResolutionOperationId(
          body.sourceLocationReferenceId,
        );

      const context =
        await backend
          .getResolutionContext(
            memberId,
            body.sourceLocationReferenceId,
            operationId,
            signal,
          )
          .catch(() => null);

      if (!context) {
        throw new Denied(
          404,
          'location_unavailable',
        );
      }

      signal.throwIfAborted();
      requireFreshContext(context);

      const existing =
        existingResolution(context);

      if (existing) {
        return response(
          200,
          existing,
        );
      }

      if (
        !trimmed(
          context.providerNamespace,
          MAX_PROVIDER_NAMESPACE_LENGTH,
        )
        || !trimmed(
          context.providerPlaceReference,
          MAX_PROVIDER_REFERENCE_LENGTH,
        )
        || resolver.providerNamespace
          !== context.providerNamespace
        || !resolver.isAvailable()
      ) {
        throw new Denied(
          503,
          'location_resolution_unavailable',
        );
      }

      const denied = await providerAdmission(backend, memberId, 'location_resolution', signal);
      if (denied) return denied;

      const result =
        await resolver.resolve(
          {
            providerNamespace:
              context.providerNamespace,
            providerPlaceReference:
              context.providerPlaceReference,
          },
          signal,
        );

      if (
        !validResolution(
          result,
          context.providerNamespace,
          context.providerPlaceReference,
        )
      ) {
        throw new Denied(
          502,
          'provider_response_invalid',
        );
      }

      signal.throwIfAborted();
      // Reserve three seconds of the ONE overall deadline for a single lookup.
      // A write timeout must not exhaust the parent signal used by recovery.
      const writeBudget = Math.floor(DEFAULT_DEADLINE_MS - (performance.now() - startedAt) - 3000);
      if (writeBudget <= 0) throw new Error('Unavailable');
      const writeSignal = AbortSignal.any([signal, AbortSignal.timeout(writeBudget)]);
      let recorded;

      try {
        recorded =
          await backend
            .recordAttestedResolution(
              {
                verifiedMemberId:
                  memberId,
                sourceLocationReferenceId:
                  body
                    .sourceLocationReferenceId,
                producerRequestId:
                  operationId,
                providerNamespace:
                  result.providerNamespace,
                providerProduct:
                  result.providerProduct,
                providerVersion:
                  result.providerVersion,
                providerPlaceReference:
                  result
                    .providerPlaceReference,
                resolutionVersion:
                  result.resolutionVersion,
                discoveryAreaLabel:
                  result.discoveryAreaLabel,
                latitude:
                  result.latitude,
                longitude:
                  result.longitude,
                resolvedAt:
                  result.resolvedAt,
                expiresAt:
                  result.expiresAt,
              },
              writeSignal,
            );
      if (
        !recorded
        || !UUID.test(
          recorded
            .resolvedLocationReferenceId,
        )
        || !UUID.test(
          recorded.evidenceId,
        )
        || !Number.isInteger(
          recorded.version,
        )
        || recorded.version < 1
        || (
          recorded.expiresAt !== null
          && !validIso(
            recorded.expiresAt,
          )
        )
      ) {
        throw new Denied(
          409,
          'location_unavailable',
        );
      }

        signal.throwIfAborted();
      } catch {
        signal.throwIfAborted();
        const recoverySignal = AbortSignal.any([signal, AbortSignal.timeout(3000)]);
        const recovered =
          await backend
            .getResolutionContext(
              memberId,
              body
                .sourceLocationReferenceId,
              operationId,
              recoverySignal,
            )
            .catch(() => null);

        if (!recovered) {
          throw new Denied(
            409,
            'location_unavailable',
          );
        }

        recoverySignal.throwIfAborted();
        requireFreshContext(recovered);
        const committed =
          existingResolution(recovered);

        if (!committed) {
          throw new Denied(
            409,
            'location_unavailable',
          );
        }

        return response(
          200,
          committed,
        );
      }

      return response(
        200,
        {
          state: 'resolved',
          resolvedLocationReferenceId:
            recorded
              .resolvedLocationReferenceId,
          expiresAt:
            recorded.expiresAt,
        },
      );
    } catch (error) {
      return failure(error);
    }
  };
}
