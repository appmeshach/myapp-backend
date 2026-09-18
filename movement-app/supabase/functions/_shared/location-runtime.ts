import { readBounded } from './face-orchestration.ts';

import type {
  AttestedResolutionRecord,
  LocationBackend,
  LocationResolutionContext,
  VerifiedSelectionRecord,
} from './location-contracts.ts';

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const RPC_RECORD_SELECTION =
  'record_verified_selected_location_for_server';

const RPC_RECOVER_SELECTION =
  'get_verified_selected_location_for_server';

const RPC_RESOLUTION_CONTEXT =
  'get_selected_location_resolution_context_for_server';

const RPC_RECORD_RESOLUTION =
  'record_attested_location_resolution_for_server';

const ALLOWED_RPCS = new Set([
  'consume_location_provider_quota_for_server',
  RPC_RECORD_SELECTION,
  RPC_RECOVER_SELECTION,
  RPC_RESOLUTION_CONTEXT,
  RPC_RECORD_RESOLUTION,
]);

function serverSecret(): string {
  let secret =
    Deno.env.get(
      'SUPABASE_SERVICE_ROLE_KEY',
    ) ?? '';

  try {
    const keys = JSON.parse(
      Deno.env.get(
        'SUPABASE_SECRET_KEYS',
      ) ?? '{}',
    ) as Record<string, unknown>;

    if (
      typeof keys.default === 'string'
      && keys.default.length > 0
    ) {
      secret = keys.default;
    }
  } catch {
    // Preserve the repository's existing legacy fallback.
  }

  return secret;
}

function rootUrl(value: string): string {
  const url = new URL(value);

  const allowedHttp =
    url.protocol === 'http:'
    && [
      'localhost',
      '127.0.0.1',
      'kong',
    ].includes(url.hostname);

  if (
    url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !(
      url.protocol === 'https:'
      || allowedHttp
    )
  ) {
    throw new Error('Unavailable');
  }

  return url.origin;
}

function serviceHeaders(
  secret: string,
): Record<string, string> {
  if (!secret) {
    throw new Error('Unavailable');
  }

  return {
    apikey: secret,
    ...(
      secret.startsWith('sb_secret_')
        ? {}
        : {
            Authorization:
              `Bearer ${secret}`,
          }
    ),
  };
}

function exactlyOneRow(
  value: unknown,
): Record<string, unknown> | null {
  if (
    !Array.isArray(value)
    || value.length !== 1
    || !value[0]
    || typeof value[0] !== 'object'
    || Array.isArray(value[0])
  ) {
    return null;
  }

  return value[0] as Record<
    string,
    unknown
  >;
}

function nullableIso(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;

  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    return undefined;
  }

  const time = Date.parse(value);

  if (!Number.isFinite(time)) {
    return undefined;
  }

  return new Date(time).toISOString();
}

export function runtimeLocationBackend():
  LocationBackend {
  return createLocationBackend(
    Deno.env.get('SUPABASE_URL') ?? '',
    serverSecret(),
  );
}

export function createLocationBackend(
  supabaseUrl: string,
  secret: string,
  fetcher: typeof fetch = fetch,
): LocationBackend {
  function root(): string {
    if (!secret) {
      throw new Error('Unavailable');
    }

    return rootUrl(supabaseUrl);
  }

  async function request(
    path: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<Response> {
    const response =
      await fetcher(
        `${root()}${path}`,
        {
          ...init,
          signal,
          redirect: 'error',
          cache: 'no-store',
        },
      );

    if (
      !response.ok
      || response.redirected
    ) {
      throw new Error('Unavailable');
    }

    return response;
  }

  async function json(
    response: Response,
    signal: AbortSignal,
  ): Promise<unknown> {
    const bytes =
      await readBounded(
        response.body,
        64 * 1024,
        signal,
      );

    return JSON.parse(
      new TextDecoder().decode(bytes),
    );
  }

  async function rpc(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!ALLOWED_RPCS.has(name)) {
      throw new Error('Unavailable');
    }

    const response =
      await request(
        `/rest/v1/rpc/${name}`,
        {
          method: 'POST',
          headers: {
            ...serviceHeaders(secret),
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify(args),
        },
        signal,
      );

    return json(response, signal);
  }

  return {
    async consumeProviderQuota(memberId, operation, signal) {
      if (!UUID.test(memberId)
        || !['location_search', 'location_resolution'].includes(operation)) {
        throw new Error('Unavailable');
      }
      signal.throwIfAborted();
      const row = exactlyOneRow(await rpc(
        'consume_location_provider_quota_for_server',
        { p_verified_member_id: memberId, p_operation: operation },
        signal,
      ));
      if (!row || Object.keys(row).length !== 2
        || typeof row.admitted !== 'boolean'
        || !Number.isInteger(row.retry_after_seconds)
        || (row.admitted
          ? row.retry_after_seconds !== 0
          : Number(row.retry_after_seconds) < 1
            || Number(row.retry_after_seconds) > 86400)) {
        throw new Error('Unavailable');
      }
      return {
        admitted: row.admitted,
        retryAfterSeconds: Number(row.retry_after_seconds),
      };
    },

    async authenticate(
      jwt,
      signal,
    ) {
      try {
        const response =
          await request(
            '/auth/v1/user',
            {
              headers: {
                apikey: secret,
                Authorization:
                  `Bearer ${jwt}`,
              },
            },
            signal,
          );

        const body =
          await json(
            response,
            signal,
          );

        if (
          !body
          || typeof body !== 'object'
          || Array.isArray(body)
        ) {
          return null;
        }

        const value =
          body as Record<
            string,
            unknown
          >;

        return value.role
            === 'authenticated'
          && typeof value.id
            === 'string'
          && UUID.test(value.id)
          ? value.id
          : null;
      } catch {
        return null;
      }
    },

    async memberExists(
      memberId,
      signal,
    ) {
      if (!UUID.test(memberId)) {
        throw new Error(
          'Unavailable',
        );
      }

      const query =
        new URLSearchParams({
          select: 'id',
          id: `eq.${memberId}`,
          limit: '2',
        });

      const response =
        await request(
          `/rest/v1/members?${query}`,
          {
            headers:
              serviceHeaders(secret),
          },
          signal,
        );

      const body =
        await json(
          response,
          signal,
        );

      return Array.isArray(body)
        && body.length === 1
        && body[0]
        && typeof body[0]
          === 'object'
        && !Array.isArray(body[0])
        && (
          body[0] as Record<
            string,
            unknown
          >
        ).id === memberId;
    },

    async recordVerifiedSelection(
      input,
      signal,
    ): Promise<
      VerifiedSelectionRecord | null
    > {
      const body =
        await rpc(
          RPC_RECORD_SELECTION,
          {
            p_verified_member_id:
              input.verifiedMemberId,

            p_selection_request_id:
              input.selectionRequestId,

            p_declared_label:
              input.declaredLabel,

            p_provider_namespace:
              input.providerNamespace,

            p_provider_place_reference:
              input.providerPlaceReference,

            p_proof_version:
              input.proofVersion,

            p_proof_issued_at:
              input.proofIssuedAt,

            p_proof_expires_at:
              input.proofExpiresAt,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (
        !row
        || typeof row
          .location_reference_id
          !== 'string'
        || !UUID.test(
          row.location_reference_id,
        )
        || typeof row
          .declared_label
          !== 'string'
      ) {
        return null;
      }

      return {
        locationReferenceId:
          row.location_reference_id,
        declaredLabel:
          row.declared_label,
      };
    },

    async recoverVerifiedSelection(
      verifiedMemberId,
      selectionRequestId,
      signal,
    ): Promise<
      VerifiedSelectionRecord | null
    > {
      const body =
        await rpc(
          RPC_RECOVER_SELECTION,
          {
            p_verified_member_id:
              verifiedMemberId,

            p_selection_request_id:
              selectionRequestId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (
        !row
        || typeof row
          .location_reference_id
          !== 'string'
        || !UUID.test(
          row.location_reference_id,
        )
        || typeof row
          .declared_label
          !== 'string'
      ) {
        return null;
      }

      return {
        locationReferenceId:
          row.location_reference_id,
        declaredLabel:
          row.declared_label,
      };
    },

    async getResolutionContext(
      verifiedMemberId,
      sourceLocationReferenceId,
      producerRequestId,
      signal,
    ): Promise<
      LocationResolutionContext | null
    > {
      const body =
        await rpc(
          RPC_RESOLUTION_CONTEXT,
          {
            p_verified_member_id:
              verifiedMemberId,

            p_source_location_reference_id:
              sourceLocationReferenceId,

            p_producer_request_id:
              producerRequestId,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) return null;

      if (
        typeof row
          .provider_namespace
          !== 'string'
        || typeof row
          .provider_place_reference
          !== 'string'
        || typeof row
          .source_created_at
          !== 'string'
      ) {
        return null;
      }

      const sourceCreatedAt =
        nullableIso(
          row.source_created_at,
        );

      const sourceExpiresAt =
        nullableIso(
          row.source_expires_at,
        );

      const expiresAt =
        nullableIso(
          row.expires_at,
        );

      if (
        !sourceCreatedAt
        || sourceExpiresAt
          === undefined
        || expiresAt
          === undefined
      ) {
        return null;
      }

      const evidenceId =
        row.evidence_id === null
          ? null
          : (
              typeof row
                .evidence_id
                === 'string'
              && UUID.test(
                row.evidence_id,
              )
            )
            ? row.evidence_id
            : undefined;

      const resolvedId =
        row
          .resolved_location_reference_id
          === null
          ? null
          : (
              typeof row
                .resolved_location_reference_id
                === 'string'
              && UUID.test(
                row
                  .resolved_location_reference_id,
              )
            )
            ? row
                .resolved_location_reference_id
            : undefined;

      const version =
        row.version === null
          ? null
          : (
              Number.isInteger(
                row.version,
              )
              && Number(row.version)
                >= 1
            )
            ? Number(row.version)
            : undefined;

      if (
        evidenceId === undefined
        || resolvedId === undefined
        || version === undefined
      ) {
        return null;
      }

      return {
        providerNamespace:
          row.provider_namespace,

        providerPlaceReference:
          row.provider_place_reference,

        sourceCreatedAt,

        sourceExpiresAt,

        evidenceId,

        resolvedLocationReferenceId:
          resolvedId,

        version,

        expiresAt,
      };
    },

    async recordAttestedResolution(
      input,
      signal,
    ): Promise<
      AttestedResolutionRecord | null
    > {
      const body =
        await rpc(
          RPC_RECORD_RESOLUTION,
          {
            p_verified_member_id:
              input.verifiedMemberId,

            p_source_location_reference_id:
              input
                .sourceLocationReferenceId,

            p_producer_request_id:
              input.producerRequestId,

            p_provider_namespace:
              input.providerNamespace,

            p_provider_product:
              input.providerProduct,

            p_provider_version:
              input.providerVersion,

            p_provider_place_reference:
              input
                .providerPlaceReference,

            p_resolution_version:
              input.resolutionVersion,

            p_latitude:
              input.latitude,

            p_longitude:
              input.longitude,

            p_resolved_at:
              input.resolvedAt,

            p_expires_at:
              input.expiresAt,
          },
          signal,
        );

      const row =
        exactlyOneRow(body);

      if (!row) return null;

      const expiresAt =
        nullableIso(
          row.expires_at,
        );

      if (
        typeof row.evidence_id
          !== 'string'
        || !UUID.test(
          row.evidence_id,
        )
        || typeof row
          .resolved_location_reference_id
          !== 'string'
        || !UUID.test(
          row
            .resolved_location_reference_id,
        )
        || !Number.isInteger(
          row.version,
        )
        || Number(row.version) < 1
        || expiresAt === undefined
      ) {
        return null;
      }

      return {
        evidenceId:
          row.evidence_id,

        resolvedLocationReferenceId:
          row
            .resolved_location_reference_id,

        version:
          Number(row.version),

        expiresAt,
      };
    },
  };
}
