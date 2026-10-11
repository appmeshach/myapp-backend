'use strict';
// Offline, disposable Edge preflight. Does not read application credentials.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '..');
const diagnostic = process.argv.includes('--diagnostic');
if (process.argv.slice(2).some(v => v !== '--diagnostic')) throw new Error('Unknown benchmark option');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'movement-0099-benchmark-'));
try {
  const files = [
    'scripts/0099-geographic-support-benchmark.mjs',
    'scripts/0099-benchmark-edge-main/index.mjs',
    'scripts/0099-benchmark-edge-worker/index.mjs',
    'supabase/functions/_shared/shared-segment-assessment-geometry.ts',
    'supabase/functions/_shared/shared-segment-assessment-contracts.ts',
  ];
  for (const file of files) {
    // Edge service directories require index.ts; plain JS is valid TypeScript.
    const destination = path.join(temporary, file.replace(/\/index\.mjs$/, '/index.ts'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, file), destination);
  }
  const result = cp.spawnSync('docker', ['run', '--rm', '--network', 'none',
    '--env', `BENCHMARK_CPU_MS=${diagnostic ? 10000 : 2000}`,
    '--mount', `type=bind,source=${temporary},target=/workspace,readonly`,
    '--workdir', '/workspace', 'public.ecr.aws/supabase/edge-runtime:v1.77.1',
    'start', '--main-service', '/workspace/scripts/0099-benchmark-edge-main',
    '--policy', 'oneshot'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.error) throw result.error;
  // Closing the main Deno listener makes this Edge image exit with status 1.
  // Accept only our explicit completion marker; retain every measurement/error.
  if (!result.stdout.includes('0099_BENCHMARK_DONE')) process.exitCode = 1;
  else if (/CPU time limit reached|"status":500/.test(result.stdout + result.stderr)) process.exitCode = 2;
} finally {
  const resolved = path.resolve(temporary), parent = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== parent || !/^movement-0099-benchmark-[a-zA-Z0-9]+$/.test(path.basename(resolved)))
    throw new Error('Refusing cleanup outside the benchmark temporary directory');
  fs.rmSync(resolved, { recursive: true, force: true });
}
