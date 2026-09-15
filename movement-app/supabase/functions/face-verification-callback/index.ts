import { createCallbackHandler } from '../_shared/face-orchestration.ts';
import { runtimeBackend, serve } from '../_shared/face-runtime.ts';

// Gateway user JWT is not provider authentication. Until an audited signature
// adapter is wired here, every callback fails closed without database mutations.
serve(createCallbackHandler(runtimeBackend(), null));
