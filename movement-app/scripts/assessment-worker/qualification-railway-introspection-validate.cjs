'use strict';
// Local JSON transcript intake only. No flags, credentials or GraphQL source intake.
const fs = require('node:fs');
const plan = require('./qualification-railway-introspection-plan.cjs');
try {
 if (process.argv.length !== 2) throw Error();
 // Bound input before parsing; stdin is the only file descriptor read.
 const chunks = [], buffer = Buffer.alloc(65536);
 let total = 0, count;
 while ((count = fs.readSync(0, buffer, 0, buffer.length, null)) > 0) {
  total += count;
  if (total > 4 * 1024 * 1024) throw Error();
  chunks.push(Buffer.from(buffer.subarray(0, count)));
 }
 const responses = JSON.parse(Buffer.concat(chunks).toString('utf8'));
 if (!Array.isArray(responses) || responses.length > 65) throw Error();
 const session = plan.start();
 for (const response of responses) plan.accept(session, response);
 process.stdout.write(JSON.stringify(plan.evidence(session)) + '\n');
} catch {
 process.stderr.write('Invalid local introspection evidence\n');
 process.exitCode = 1;
}
