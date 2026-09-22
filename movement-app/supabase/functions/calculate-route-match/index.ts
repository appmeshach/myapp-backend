declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

import {
  createRouteMatchHandler,
} from '../_shared/route-match-orchestration.ts';

import {
  runtimeRouteBackend,
} from '../_shared/route-runtime.ts';

import {
  serve,
} from '../_shared/face-runtime.ts';

serve(
  createRouteMatchHandler(
    runtimeRouteBackend(),
  ),
);
