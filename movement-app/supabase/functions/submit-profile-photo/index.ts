import { createSubmissionHandler } from '../_shared/face-orchestration.ts';
import { runtimeBackend, serve } from '../_shared/face-runtime.ts';

// Explicitly no image processor: private original upload stays pending.
// No environment flag can enable a passthrough or fake sanitizer.
serve(createSubmissionHandler(runtimeBackend(), null));
