import {
  unavailableLocationSearchProvider,
} from '../_shared/location-contracts.ts';

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

// No location provider is wired yet.
// Production therefore fails closed before issuing selectable suggestions.
serve(
  createLocationSearchHandler(
    runtimeLocationBackend(),
    unavailableLocationSearchProvider,
    runtimeSelectionProofSigner(),
  ),
);
