import { createVerificationHandler } from '../_shared/face-orchestration.ts';
import { runtimeBackend, serve } from '../_shared/face-runtime.ts';

// No vendor selected. Fail closed; test fakes are never imported here.
serve(createVerificationHandler(runtimeBackend(), null));
