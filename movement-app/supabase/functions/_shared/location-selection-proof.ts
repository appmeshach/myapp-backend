import {
  LOCATION_PROOF_AUDIENCE,
  LOCATION_PROOF_VERSION,
  MAX_LOCATION_LABEL_LENGTH,
  MAX_PROVIDER_NAMESPACE_LENGTH,
  MAX_PROVIDER_REFERENCE_LENGTH,
  MAX_SELECTION_PROOF_LENGTH,
} from './location-contracts.ts';

import type {
  SelectionProofClaims,
  SelectionProofSigner,
} from './location-contracts.ts';

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

const PREFIX = 'sp1';
const MAX_FUTURE_SKEW_MS = 30_000;
const MAX_PROOF_LIFETIME_MS = 5 * 60_000;

type SelectionProofTuple = readonly [
  typeof LOCATION_PROOF_AUDIENCE,
  typeof LOCATION_PROOF_VERSION,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

function textValid(
  value: unknown,
  max: number,
): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= max
    && /\S/u.test(value);
}

function validIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const time = Date.parse(value);

  return Number.isFinite(time)
    && new Date(time).toISOString() === value;
}

function validClaimsShape(
  value: unknown,
): value is SelectionProofTuple {
  if (!Array.isArray(value) || value.length !== 9) return false;

  const [
    audience,
    version,
    memberId,
    selectionRequestId,
    declaredLabel,
    providerNamespace,
    providerPlaceReference,
    issuedAt,
    expiresAt,
  ] = value;

  if (audience !== LOCATION_PROOF_AUDIENCE) return false;
  if (version !== LOCATION_PROOF_VERSION) return false;

  if (
    typeof memberId !== 'string'
    || !UUID.test(memberId)
  ) {
    return false;
  }

  if (
    typeof selectionRequestId !== 'string'
    || !UUID.test(selectionRequestId)
  ) {
    return false;
  }

  if (
    !textValid(
      declaredLabel,
      MAX_LOCATION_LABEL_LENGTH,
    )
  ) {
    return false;
  }

  if (
    !textValid(
      providerNamespace,
      MAX_PROVIDER_NAMESPACE_LENGTH,
    )
  ) {
    return false;
  }

  if (
    !textValid(
      providerPlaceReference,
      MAX_PROVIDER_REFERENCE_LENGTH,
    )
  ) {
    return false;
  }

  if (!validIso(issuedAt) || !validIso(expiresAt)) {
    return false;
  }

  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);

  if (issued >= expires) return false;

  if (
    expires - issued > MAX_PROOF_LIFETIME_MS
  ) {
    return false;
  }

  return true;
}

function tuple(
  claims: SelectionProofClaims,
): SelectionProofTuple {
  return [
    claims.audience,
    claims.version,
    claims.memberId,
    claims.selectionRequestId,
    claims.declaredLabel,
    claims.providerNamespace,
    claims.providerPlaceReference,
    claims.issuedAt,
    claims.expiresAt,
  ];
}

function ownedBytes(
  value: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function base64UrlEncode(
  bytes: Uint8Array<ArrayBufferLike>,
): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(
  value: string,
): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    const padding =
      (4 - (value.length % 4)) % 4;

    const standard =
      value
        .replace(/-/g, '+')
        .replace(/_/g, '/')
      + '='.repeat(padding);

    const binary = atob(standard);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  } catch {
    return null;
  }
}

function decodeClaims(
  payload: string,
): SelectionProofClaims | null {
  const bytes = base64UrlDecode(payload);

  if (!bytes) return null;

  try {
    const parsed: unknown =
      JSON.parse(new TextDecoder().decode(bytes));

    if (!validClaimsShape(parsed)) {
      return null;
    }

    const [
      audience,
      version,
      memberId,
      selectionRequestId,
      declaredLabel,
      providerNamespace,
      providerPlaceReference,
      issuedAt,
      expiresAt,
    ] = parsed;

    return {
      audience,
      version,
      memberId,
      selectionRequestId,
      declaredLabel,
      providerNamespace,
      providerPlaceReference,
      issuedAt,
      expiresAt,
    };
  } catch {
    return null;
  }
}

function timingValid(
  claims: SelectionProofClaims,
  nowMs: number,
): boolean {
  const issued = Date.parse(claims.issuedAt);
  const expires = Date.parse(claims.expiresAt);

  return issued <= nowMs + MAX_FUTURE_SKEW_MS
    && expires > nowMs;
}

async function importHmacKey(
  secret: Uint8Array<ArrayBufferLike>,
): Promise<CryptoKey> {
  const keyData = ownedBytes(secret);

  return crypto.subtle.importKey(
    'raw',
    keyData,
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign', 'verify'],
  );
}

export function createHmacSelectionProofSigner(
  secret: Uint8Array<ArrayBufferLike>,
  now: () => number = () => Date.now(),
): SelectionProofSigner {
  const keyBytes = ownedBytes(secret);
  const available = keyBytes.length >= 32;

  return {
    isAvailable() {
      return available;
    },

    async sign(
      claims: SelectionProofClaims,
      signal: AbortSignal,
    ): Promise<string> {
      signal.throwIfAborted();

      if (!available) {
        throw new Error(
          'Selection proof unavailable',
        );
      }

      if (!validClaimsShape(tuple(claims))) {
        throw new Error(
          'Selection proof claims invalid',
        );
      }

      if (!timingValid(claims, now())) {
        throw new Error(
          'Selection proof claims invalid',
        );
      }

      const payloadBytes =
        new TextEncoder().encode(
          JSON.stringify(tuple(claims)),
        );

      const payload =
        base64UrlEncode(payloadBytes);

      const signingInput =
        `${PREFIX}.${payload}`;

      const key =
        await importHmacKey(keyBytes);

      signal.throwIfAborted();

      const signature = new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          key,
          new TextEncoder().encode(
            signingInput,
          ),
        ),
      );

      signal.throwIfAborted();

      const token =
        `${signingInput}.${base64UrlEncode(signature)}`;

      if (
        token.length > MAX_SELECTION_PROOF_LENGTH
      ) {
        throw new Error(
          'Selection proof unavailable',
        );
      }

      return token;
    },

    async verify(
      proof: string,
      expectedMemberId: string,
      signal: AbortSignal,
    ): Promise<SelectionProofClaims | null> {
      signal.throwIfAborted();

      if (
        !available
        || typeof proof !== 'string'
        || proof.length < 1
        || proof.length > MAX_SELECTION_PROOF_LENGTH
        || !UUID.test(expectedMemberId)
      ) {
        return null;
      }

      const parts = proof.split('.');

      if (
        parts.length !== 3
        || parts[0] !== PREFIX
      ) {
        return null;
      }

      const [
        ,
        payload,
        encodedSignature,
      ] = parts;

      const signature =
        base64UrlDecode(encodedSignature);

      if (
        !signature
        || signature.length !== 32
      ) {
        return null;
      }

      const claims = decodeClaims(payload);

      if (!claims) return null;

      if (
        claims.memberId !== expectedMemberId
      ) {
        return null;
      }

      if (!timingValid(claims, now())) {
        return null;
      }

      const key =
        await importHmacKey(keyBytes);

      signal.throwIfAborted();

      const valid =
        await crypto.subtle.verify(
          'HMAC',
          key,
          ownedBytes(signature),
          new TextEncoder().encode(
            `${PREFIX}.${payload}`,
          ),
        );

      signal.throwIfAborted();

      return valid ? claims : null;
    },
  };
}

declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

export function runtimeSelectionProofSigner(): SelectionProofSigner {
  const value =
    Deno.env.get('LOCATION_SELECTION_PROOF_SECRET') ?? '';

  if (!value) {
    return {
      isAvailable: () => false,
      async sign() {
        throw new Error('Selection proof unavailable');
      },
      async verify() {
        return null;
      },
    };
  }

  return createHmacSelectionProofSigner(
    new TextEncoder().encode(value),
  );
}
