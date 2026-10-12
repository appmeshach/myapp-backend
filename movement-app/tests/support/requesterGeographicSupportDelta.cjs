'use strict';
// Exact sanctioned 0100 requester-screen delta. Historical blob pins stay unchanged.
const assert=require('node:assert/strict');
const delta=[
  [
    "import { prepareRequesterGeographicSupport, type GeographicSupport } from '../services/requesterGeographicSupportService';\n",
    ""
  ],
  [
    "  const routeCheckInFlight = useRef<string | null>(null);\n  const geographicFlight = useRef<{ key: string; controller: AbortController } | null>(null);\n  const [geographicResult, setGeographicResult] = useState<{ key: string; state: GeographicSupport } | null>(null);\n  const [geographicLoading, setGeographicLoading] = useState(false);\n",
    ""
  ],
  [
    "    return () => { mounted.current = false; routeCheckVersion.current += 1; geographicFlight.current?.controller.abort(); geographicFlight.current = null; };\n",
    "    return () => { mounted.current = false; routeCheckVersion.current += 1; };\n"
  ],
  [
    "    clearGeographicSupport();\n    routeCheckInFlight.current = null;\n",
    ""
  ],
  [
    "  function clearGeographicSupport() {\n    geographicFlight.current?.controller.abort();\n    geographicFlight.current = null;\n    setGeographicResult(null);\n    setGeographicLoading(false);\n  }\n\n  async function checkGeographicSupport(movementNeedId: string, availabilityId: string) {\n    const key = `${movementNeedId}:${availabilityId}`;\n    if (geographicFlight.current?.key === key) return;\n    geographicFlight.current?.controller.abort();\n    const flight = { key, controller: new AbortController() };\n    geographicFlight.current = flight;\n    setGeographicResult({ key, state: 'pending' });\n    setGeographicLoading(true);\n    try {\n      const value = await prepareRequesterGeographicSupport({ movementNeedId, availabilityId }, flight.controller.signal);\n      if (!mounted.current || geographicFlight.current !== flight || flight.controller.signal.aborted) return;\n      setGeographicResult({ key, state: value.geographicSupport });\n    } catch {\n      if (!mounted.current || geographicFlight.current !== flight || flight.controller.signal.aborted) return;\n      setGeographicResult({ key, state: 'unavailable' });\n    } finally {\n      if (mounted.current && geographicFlight.current === flight) {\n        geographicFlight.current = null;\n        setGeographicLoading(false);\n      }\n    }\n  }\n\n",
    ""
  ],
  [
    "    if (busy || interestInFlight.current || routeCheckInFlight.current === availabilityId) return;\n",
    "    if (busy || interestInFlight.current) return;\n"
  ],
  [
    "    clearGeographicSupport();\n",
    ""
  ],
  [
    "    routeCheckInFlight.current = availabilityId;\n",
    ""
  ],
  [
    "      void checkGeographicSupport(explicitMovementNeedId, availabilityId);\n",
    ""
  ],
  [
    "      if (mounted.current && version === routeCheckVersion.current) { routeCheckInFlight.current = null; setBusy(false); }\n",
    "      if (mounted.current && version === routeCheckVersion.current) setBusy(false);\n"
  ],
  [
    "                  {geographicResult?.key === `${explicitMovementNeedId}:${movement.availabilityId}` && (\n                    <Text style={styles.help}>\n                      {{ geometric_corridor_support: 'Reference routes show continuous geometric support.',\n                        overlap_observed: 'Some geometric overlap was observed.',\n                        inconclusive: 'This reference-route comparison is inconclusive. Other routes remain unassessed.',\n                        pending: 'Checking the selected reference routes…',\n                        unavailable: 'Reference-route comparison is unavailable.' }[geographicResult.state]}\n                    </Text>\n                  )}\n",
    ""
  ],
  [
    "            {hasCurrentReadyRouteMatch && geographicResult?.key === interestKey\n              && ['pending', 'unavailable'].includes(geographicResult.state) && (\n              <Pressable accessibilityRole=\"button\" disabled={geographicLoading}\n                onPress={() => { if (explicitMovementNeedId && selectedAvailabilityId) void checkGeographicSupport(explicitMovementNeedId, selectedAvailabilityId); }}\n                style={styles.button}>\n                <Text style={styles.buttonText}>Refresh reference-route comparison</Text>\n              </Pressable>\n            )}\n",
    ""
  ]
];
function stripRequesterGeographicSupport0100(source){
 source=source.replace(/\r\n/g,'\n');
 for(const [current,previous] of delta){assert.equal(source.split(current).length,2,'Exactly one sanctioned 0100 chunk');source=source.replace(current,previous);}
 return source;
}
module.exports={stripRequesterGeographicSupport0100};
