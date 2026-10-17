// Local-only preflight. No database, credentials, provider, or network calls.
import { assessSharedSegment } from '../supabase/functions/_shared/shared-segment-assessment-geometry.ts';

const shape = (n, length, latitude = 6.5) => ({
  type: 'LineString',
  coordinates: Array.from({ length: n }, (_, i) => [3.4 + length / 111000 * i / (n - 1), latitude]),
});
const repeated = (n, angle, length) => ({
  type: 'LineString',
  coordinates: Array.from({ length: n }, (_, i) => {
    const t = (i % 2 ? 1 : -1) * length / 2 / 111000;
    return [3.4 + t * Math.cos(angle), 6.5 + t * Math.sin(angle)];
  }),
});
export const cases = {
  small: [shape(2, 300), shape(2, 300)],
  ordinary: [shape(200, 15000), shape(200, 15000)],
  nearMaximum: [shape(2000, 89000), shape(2000, 89000)],
  coordinateLimit: [shape(2001, 300), shape(2, 300)],
  resamplingLimit: [shape(2000, 150000), shape(2000, 150000)],
  denseCrossing: [repeated(2000, 0, 4), repeated(2000, Math.PI / 3, 4)],
};
export function measure(name) {
  const start = performance.now();
  const result = assessSharedSegment(cases[name][0], cases[name][1]);
  return { name, wallMs: performance.now() - start, workUnits: result.workUnits,
    assessmentState: result.assessmentState, geographicResult: result.geographicResult,
    reasons: result.reasons, offererPointCount: result.offererPointCount,
    requesterPointCount: result.requesterPointCount };
}
