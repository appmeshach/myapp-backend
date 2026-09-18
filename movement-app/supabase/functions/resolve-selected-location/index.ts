declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

import {
  createMapboxGeocodingProvider,
} from '../_shared/mapbox-geocoding-provider.ts';

import {
  createLocationResolutionHandler,
} from '../_shared/location-orchestration.ts';

import {
  runtimeLocationBackend,
} from '../_shared/location-runtime.ts';

import {
  serve,
} from '../_shared/face-runtime.ts';

const locationResolver =
  createMapboxGeocodingProvider(
    Deno.env.get(
      'MAPBOX_ACCESS_TOKEN',
    ),
  );

serve(
  createLocationResolutionHandler(
    runtimeLocationBackend(),
    locationResolver,
  ),
);
