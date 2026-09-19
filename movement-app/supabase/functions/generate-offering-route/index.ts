declare const Deno: {
  env: {
    get(name: string): string | undefined;
  };
};

import {
    createMapboxDirectionsProvider,
} from '../_shared/mapbox-directions-provider.ts';

import {
    createRouteGenerationHandler,
} from '../_shared/route-orchestration.ts';

import {
    runtimeRouteBackend,
} from '../_shared/route-runtime.ts';

import {
    serve,
} from '../_shared/face-runtime.ts';

const routeProvider =
  createMapboxDirectionsProvider(
    Deno.env.get(
      'MAPBOX_ACCESS_TOKEN',
    ),
  );

serve(
  createRouteGenerationHandler(
    runtimeRouteBackend(),
    routeProvider,
  ),
);