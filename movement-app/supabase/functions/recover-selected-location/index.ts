import {
  createLocationRecoveryHandler,
} from '../_shared/location-orchestration.ts';

import {
  runtimeLocationBackend,
} from '../_shared/location-runtime.ts';

import {
  serve,
} from '../_shared/face-runtime.ts';

serve(
  createLocationRecoveryHandler(
    runtimeLocationBackend(),
  ),
);
