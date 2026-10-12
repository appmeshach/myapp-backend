'use strict';
// Reuse the existing safe local platform bootstrap/reset, adding 0099 verification.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const file=path.join(__dirname,'0098_current_route_match_reuse_boundary_reset.cjs'),m=new Module(file,module);
m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
m.require=name=>require(name.startsWith('.')?path.resolve(__dirname,name):name);
let source=fs.readFileSync(file,'utf8').replaceAll('movement-0098-reset-','movement-0099-reset-').replaceAll('98/0001/0098','99/0001/0099')
 .replaceAll('0001 through 0098','0001 through 0099');
assert(source.includes('verify0096(c);verify0097(c);verify0098(c);'));
source=source.replace('verify0096(c);verify0097(c);verify0098(c);',"verify0096(c);verify0097(c);verify0098(c);require('./0099_shared_segment_assessment_job_foundation_harness.cjs').verify(c);");
m._compile(source,file);module.exports=m.exports;
if(require.main===module)m.exports.main().catch(e=>{console.error(e.stack);process.exitCode=1;});
