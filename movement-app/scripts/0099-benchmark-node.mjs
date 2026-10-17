import { cases, measure } from './0099-geographic-support-benchmark.mjs';
import { cpus, totalmem } from 'node:os';
console.log(JSON.stringify({ runtime: process.version, platform: process.platform,
  cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem() }));
const selected = process.argv[2];
if (selected && !(selected in cases)) throw new Error('Unknown benchmark case');
for (const name of selected ? [selected] : Object.keys(cases)) {
  const cpu = process.cpuUsage();
  const result = measure(name);
  const used = process.cpuUsage(cpu);
  console.log(JSON.stringify({ ...result, cpuMs: (used.user + used.system) / 1000 }));
}
