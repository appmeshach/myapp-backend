import {
  createLocationSelectionHandler,
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

serve(
  createLocationSelectionHandler(
    runtimeLocationBackend(),
    runtimeSelectionProofSigner(),
  ),
);
