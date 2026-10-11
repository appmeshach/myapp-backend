// Run in an offline Docker container. Each measurement uses a fresh user worker.
import { cases } from '../0099-geographic-support-benchmark.mjs';
const cpuMs = Number(Deno.env.get('BENCHMARK_CPU_MS') ?? '2000');
if (![2000, 10000].includes(cpuMs)) throw new Error('Invalid local benchmark CPU limit');
const server = Deno.serve(async (request) => {
  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: '/workspace/scripts/0099-benchmark-edge-worker',
      memoryLimitMb: 256, workerTimeoutMs: 30000,
      cpuTimeSoftLimitMs: cpuMs, cpuTimeHardLimitMs: cpuMs,
      noModuleCache: true, forceCreate: true, envVars: [],
    });
    return await worker.fetch(request);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
});
console.log(JSON.stringify({ runtime: Deno.version, cpuSoftMs: cpuMs, cpuHardMs: cpuMs,
  memoryLimitMb: 256, workerTimeoutMs: 30000 }));
for (const name of Object.keys(cases)) {
  const start = performance.now();
  try {
    const response = await fetch(`http://127.0.0.1:9000/?case=${name}`);
    console.log(JSON.stringify({ name, status: response.status,
      requestWallMs: performance.now() - start, result: await response.json() }));
  } catch (error) {
    console.log(JSON.stringify({ name, requestWallMs: performance.now() - start,
      error: String(error) }));
  }
}
console.log('0099_BENCHMARK_DONE');
await server.shutdown();
