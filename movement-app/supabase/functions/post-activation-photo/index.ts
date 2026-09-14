import { createPhotoHandler } from './handler.ts';

// Minimal ambient contract for the Supabase Deno runtime APIs used here.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): unknown;
};

function getServerSecret(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS');

  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys) as Record<string, unknown>;
      const defaultSecret = parsed.default;

      if (typeof defaultSecret === 'string' && defaultSecret.length > 0) {
        return defaultSecret;
      }
    } catch {
      // Fall through to the legacy key.
    }
  }

  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

Deno.serve(
  createPhotoHandler({
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey: getServerSecret(),
  }),
);