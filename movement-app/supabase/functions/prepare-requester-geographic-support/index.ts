import { createMapboxDirectionsProvider } from '../_shared/mapbox-directions-provider.ts';
import { REQUESTER_ROUTE_MAX_POINTS } from '../_shared/requester-route-contracts.ts';
import { runtimeRequesterRouteBackend } from '../_shared/requester-route-runtime.ts';
import { createRequesterRouteGenerationHandler } from '../_shared/requester-route-orchestration.ts';
import { runtimeRequesterGeographicBackend } from '../_shared/requester-geographic-support-runtime.ts';
import { createRequesterGeographicSupportHandler } from '../_shared/requester-geographic-support-orchestration.ts';
import { serve } from '../_shared/face-runtime.ts';
declare const Deno: { env: { get(name: string): string | undefined } };
const provider = createMapboxDirectionsProvider(Deno.env.get('MAPBOX_ACCESS_TOKEN'), {
  timeoutMs: 5000, includeSnappedWaypoints: true, maxGeometryPoints: REQUESTER_ROUTE_MAX_POINTS,
});
serve(createRequesterGeographicSupportHandler(runtimeRequesterGeographicBackend(),
  createRequesterRouteGenerationHandler(runtimeRequesterRouteBackend(), provider)));
