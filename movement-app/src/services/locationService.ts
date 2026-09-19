import { supabase } from '../lib/supabase';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type MovementLocationSuggestion = {
  selectionRequestId: string;
  declaredLabel: string;
  providerNamespace: string;
  providerPlaceReference: string;
  selectionProof: string;
};

export type MovementLocationSearchResult = {
  suggestions: MovementLocationSuggestion[];
  attribution: string[];
};

export type SelectedMovementLocation = {
  locationReferenceId: string;
  declaredLabel: string;
};

export type ResolvedMovementLocation = {
  state: 'resolved';
  resolvedLocationReferenceId: string;
  expiresAt: string | null;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();

  return (
    actual.length === wanted.length
    && actual.every(
      (key, index) => key === wanted[index],
    )
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

async function postLocationEdge(
  endpoint: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{
  status: number;
  body: unknown;
}> {
  const abort = new AbortController();

  const cancel = () => abort.abort();

  signal?.addEventListener(
    'abort',
    cancel,
    { once: true },
  );

  if (signal?.aborted) {
    cancel();
  }

  const timer = setTimeout(
    cancel,
    30_000,
  );

  try {
    abort.signal.throwIfAborted();

    const {
      data,
      error,
    } = await supabase.auth.getSession();

    abort.signal.throwIfAborted();

    if (
      error
      || !data.session?.access_token
    ) {
      throw new Error(
        'authentication_required',
      );
    }

    const url =
      process.env.EXPO_PUBLIC_SUPABASE_URL;

    const key =
      process.env
        .EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      throw new Error(
        'location_unavailable',
      );
    }

    const response =
      await fetch(
        `${url.replace(/\/$/, '')}/functions/v1/${endpoint}`,
        {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${data.session.access_token}`,
            apikey: key,
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify(body),
          signal: abort.signal,
          redirect: 'error',
          cache: 'no-store',
        },
      );

    abort.signal.throwIfAborted();

    if (response.status === 401) {
      throw new Error(
        'authentication_required',
      );
    }

    if (response.redirected) {
      throw new Error(
        'location_unavailable',
      );
    }

    let responseBody: unknown;

    try {
      responseBody =
        await response.json();
    } catch {
      throw new Error(
        'location_unavailable',
      );
    }

    abort.signal.throwIfAborted();

    return {
      status: response.status,
      body: responseBody,
    };
  } catch (error) {
    if (
      error instanceof Error
      && [
        'authentication_required',
        'location_unavailable',
      ].includes(error.message)
    ) {
      throw error;
    }

    if (
      abort.signal.aborted
      || error instanceof TypeError
    ) {
      throw new Error(
        'network_unavailable',
      );
    }

    throw new Error(
      'location_unavailable',
    );
  } finally {
    clearTimeout(timer);

    signal?.removeEventListener(
      'abort',
      cancel,
    );
  }
}

export async function searchMovementLocations(
  query: string,
  signal?: AbortSignal,
): Promise<MovementLocationSearchResult> {
  if (typeof query !== 'string') {
    throw new Error(
      'invalid_location_query',
    );
  }

  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    throw new Error(
      'invalid_location_query',
    );
  }

  const result =
    await postLocationEdge(
      'search-movement-locations',
      {
        query: normalizedQuery,
      },
      signal,
    );

  if (
    result.status !== 200
    || !isRecord(result.body)
    || !hasExactKeys(
      result.body,
      [
        'suggestions',
        'attribution',
      ],
    )
    || !Array.isArray(
      result.body.suggestions,
    )
        || !Array.isArray(
      result.body.attribution,
    )
    || !result.body.attribution.every(
      value =>
        typeof value === 'string'
        && !!value.trim(),
    )
  ) {
    throw new Error(
      'location_search_unavailable',
    );
  }

  const suggestions:
    MovementLocationSuggestion[] = [];

  for (
    const value
    of result.body.suggestions
  ) {
    if (
      !isRecord(value)
      || !hasExactKeys(
        value,
        [
          'selectionRequestId',
          'declaredLabel',
          'providerNamespace',
          'providerPlaceReference',
          'selectionProof',
        ],
      )
      || !isUuid(
        value.selectionRequestId,
      )
      || typeof value.declaredLabel
        !== 'string'
      || !value.declaredLabel.trim()
      || typeof value.providerNamespace
        !== 'string'
      || !value.providerNamespace.trim()
      || typeof value
        .providerPlaceReference
        !== 'string'
      || !value
        .providerPlaceReference
        .trim()
      || typeof value.selectionProof
        !== 'string'
      || !value.selectionProof
    ) {
      throw new Error(
        'location_search_unavailable',
      );
    }

    suggestions.push({
      selectionRequestId:
        value.selectionRequestId,
      declaredLabel:
        value.declaredLabel,
      providerNamespace:
        value.providerNamespace,
      providerPlaceReference:
        value.providerPlaceReference,
      selectionProof:
        value.selectionProof,
    });
  }

  return {
    suggestions,
    attribution:
      result.body.attribution,
  };
}

export async function selectMovementLocation(
  selectionProof: string,
  signal?: AbortSignal,
): Promise<SelectedMovementLocation> {
  if (
    typeof selectionProof !== 'string'
    || !selectionProof
  ) {
    throw new Error(
      'invalid_location_selection',
    );
  }

  const result =
    await postLocationEdge(
      'select-movement-location',
      {
        selectionProof,
      },
      signal,
    );

  if (
    result.status !== 200
    || !isRecord(result.body)
    || !hasExactKeys(
      result.body,
      [
        'locationReferenceId',
        'declaredLabel',
      ],
    )
    || !isUuid(
      result.body.locationReferenceId,
    )
    || typeof result.body.declaredLabel
      !== 'string'
    || !result.body.declaredLabel.trim()
  ) {
    throw new Error(
      'location_selection_unavailable',
    );
  }

  return {
    locationReferenceId:
      result.body.locationReferenceId,
    declaredLabel:
      result.body.declaredLabel,
  };
}

export async function recoverSelectedLocation(
  selectionRequestId: string,
  signal?: AbortSignal,
): Promise<SelectedMovementLocation> {
  if (!isUuid(selectionRequestId)) {
    throw new Error(
      'invalid_location_selection',
    );
  }

  const result =
    await postLocationEdge(
      'recover-selected-location',
      {
        selectionRequestId,
      },
      signal,
    );

  if (
    result.status !== 200
    || !isRecord(result.body)
    || !hasExactKeys(
      result.body,
      [
        'locationReferenceId',
        'declaredLabel',
      ],
    )
    || !isUuid(
      result.body.locationReferenceId,
    )
    || typeof result.body.declaredLabel
      !== 'string'
    || !result.body.declaredLabel.trim()
  ) {
    throw new Error(
      'location_selection_unavailable',
    );
  }

  return {
    locationReferenceId:
      result.body.locationReferenceId,
    declaredLabel:
      result.body.declaredLabel,
  };
}

export async function resolveSelectedLocation(
  sourceLocationReferenceId: string,
  signal?: AbortSignal,
): Promise<ResolvedMovementLocation> {
  if (
    !isUuid(
      sourceLocationReferenceId,
    )
  ) {
    throw new Error(
      'invalid_location_reference',
    );
  }

  const result =
    await postLocationEdge(
      'resolve-selected-location',
      {
        sourceLocationReferenceId,
      },
      signal,
    );

  if (
    result.status !== 200
    || !isRecord(result.body)
    || !hasExactKeys(
      result.body,
      [
        'state',
        'resolvedLocationReferenceId',
        'expiresAt',
      ],
    )
    || result.body.state
      !== 'resolved'
    || !isUuid(
      result.body
        .resolvedLocationReferenceId,
    )
    || !(
      result.body.expiresAt === null
      || (
        typeof result.body.expiresAt
          === 'string'
        && Number.isFinite(
          Date.parse(
            result.body.expiresAt,
          ),
        )
      )
    )
  ) {
    throw new Error(
      'location_resolution_unavailable',
    );
  }

  return {
    state: 'resolved',
    resolvedLocationReferenceId:
      result.body
        .resolvedLocationReferenceId,
    expiresAt:
      result.body.expiresAt,
  };
}