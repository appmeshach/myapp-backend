import {
  unavailableDurableLocationResolver,
} from '../_shared/location-contracts.ts';

import {
  createLocationResolutionHandler,
} from '../_shared/location-orchestration.ts';

import {
  runtimeLocationBackend,
} from '../_shared/location-runtime.ts';

import {
  serve,
} from '../_shared/face-runtime.ts';

// No durable geocoding provider is wired yet.
// Production therefore fails closed before any resolution write.
serve(
  createLocationResolutionHandler(
    runtimeLocationBackend(),
    unavailableDurableLocationResolver,
  ),
);
