declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

import {
  createMapboxGeocodingProvider,
} from '../_shared/mapbox-geocoding-provider.ts';

import {
  createLocationSearchHandler,
} from '../_shared/location-orchestration.ts';

import {
  runtimeLocationBackend,
} from '../_shared/location-runtime.ts';

import {
  runtimeSelectionProofSigner,
} from '../_shared/location-selection-proof.ts';

import {
  serve,
} from '../_shared/face-runtime.ts';

const locationProvider =
  createMapboxGeocodingProvider(
    Deno.env.get(
      'MAPBOX_ACCESS_TOKEN',
    ),
  );

serve(
  createLocationSearchHandler(
    runtimeLocationBackend(),
    locationProvider,
    runtimeSelectionProofSigner(),
  ),
);
