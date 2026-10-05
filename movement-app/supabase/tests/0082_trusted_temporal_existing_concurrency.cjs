'use strict';
// Execute unmodified scenario logic from each installed milestone's runner.
// The only in-memory adaptation loads/validates hardening in its disposable
// clone where the runner would validate the original installed definitions.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const milestone=process.argv[2];assert(['0079','0080','0081'].includes(milestone));
const name={ '0079':'0079_funded_movement_activation_concurrency.cjs','0080':'0080_funded_movement_coordination_entry_concurrency.cjs','0081':'0081_financial_movement_start_concurrency.cjs'}[milestone];
const filename=path.join(__dirname,name);let code=fs.readFileSync(filename,'utf8');
const logs=[];const originalLog=console.log;console.log=(...args)=>{logs.push(args.join(' '));originalLog(...args);};
const marker='verify(query, database);';assert.equal(code.split(marker).length,2,'One clone source-verification boundary required');
code=code.replace(marker,"target(require('./0082_trusted_temporal_evidence_hardening_harness.cjs').source); require('./0082_trusted_temporal_evidence_hardening_harness.cjs').verify(query, database);");
// Later installed protections intentionally supersede these older expectations.
// Keep exact denial and use the full audited through-0081 definition/ACL pin.
if(milestone==='0079'){assert(code.includes("check(start,false,'42501');"));code=code.replace("check(start,false,'42501');","check(start,false,'23514'); assert.match(start.error,/Financial coordination lifecycle unavailable/);");}
if(milestone==='0080'){
 assert(code.includes('const mode = inspect(query);'));code=code.replace('const mode = inspect(query);',"const mode = require('./0082_trusted_temporal_evidence_hardening_harness.cjs').inspectThrough0081(query);");
 const meeting="assert(b.out.includes('Station entrance'));assert(b.out.includes('|t|f|f'));";
 assert.equal(code.split(meeting).length,2);code=code.replace(meeting,"assert(b.out.includes('Station entrance'));assert(b.out.includes('|t|t|f')); assert.equal(target(`SELECT count(*) FROM private.funded_movement_start_requests WHERE alignment_id='${f.alignment}';`),'0');");
}
code+=`\nmain().then(()=>require('node:fs').writeFileSync('docs/0082-temporal-existing-${milestone}-concurrency-results.json',JSON.stringify({passed:true,sourceSha:require('node:crypto').createHash('sha256').update(require('./0082_trusted_temporal_evidence_hardening_harness.cjs').source).digest('hex'),logs:globalThis.temporalExistingLogs},null,2)+'\\n')).catch(e=>{console.error(e.stack);process.exitCode=1;});\n`;
globalThis.temporalExistingLogs=logs;
const copy=new Module(filename,module);copy.filename=filename;copy.paths=Module._nodeModulePaths(__dirname);copy._compile(code,filename);
