'use strict';
// Compose historical assertions against final 0099, without editing old harnesses.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const file=path.join(__dirname,'0098_current_route_match_reuse_boundary_validation.cjs');
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
m.require=name=>name==='./0098_current_route_match_reuse_boundary_harness.cjs'
 ? {...require(name),run:require('./0099_shared_segment_assessment_job_foundation_harness.cjs').run}
 : require(name.startsWith('.')?path.resolve(__dirname,name):name);
let source=fs.readFileSync(file,'utf8').replaceAll('movement-0098-validation','movement-0099-validation');
source=source.replace("'0098_current_route_match_reuse_boundary.sql'].map", "'0098_current_route_match_reuse_boundary.sql','0099_shared_segment_assessment_job_foundation.sql'].map");
m._compile(source,file);
async function finalConcurrency(name){
 const target=path.join(__dirname,name),child=new Module(target,module);child.filename=target;child.paths=Module._nodeModulePaths(__dirname);
 child.require=n=>/^\.\/009[678]_.*_harness\.cjs$/.test(n)?{...require(n),run:require('./0099_shared_segment_assessment_job_foundation_harness.cjs').run}:require(n.startsWith('.')?path.resolve(__dirname,n):n);
 child._compile(fs.readFileSync(target,'utf8'),target);await child.exports.main();
}
async function main(){
 if(process.argv[2]==='remaining-sql'){
  const groups=['assessment','sql','requester-concurrency','assessment-route-concurrency','route-behavior','roster-behavior','roster-concurrency','roster-temporal'];
  fs.mkdirSync(m.exports.output,{recursive:true});
  for(const group of groups){
   const log=path.join(m.exports.output,group+'.txt'),fd=fs.openSync(log,'w'),original=console.log;
   process.argv[2]=group;console.log=(...args)=>fs.writeSync(fd,args.join(' ')+'\n');
   try{await main();}finally{console.log=original;fs.closeSync(fd);}
   console.log('PASS '+group+'; '+log);console.log(fs.readFileSync(log,'utf8').split('\n').slice(-9).join('\n'));
  }
 }else if(process.argv[2]==='assessment-behavior'){
  for(const name of ['0096_trusted_shared_segment_geographic_assessment_harness.cjs','0097_shared_segment_assessment_reuse_boundary_harness.cjs']){
   const target=path.join(__dirname,name),child=new Module(target,module);child.filename=target;child.paths=Module._nodeModulePaths(__dirname);
   child.require=n=>require(n.startsWith('.')?path.resolve(__dirname,n):n);
   const original=fs.readFileSync(target,'utf8');const code=original.replace(/async function run\(callback\)\s*\{[^\n]*\}/,
    "async function run(callback){await require('./0099_shared_segment_assessment_job_foundation_harness.cjs').run(callback);}");
   if(code===original)throw Error('Unrecognized assessment harness');child._compile(code,target);await child.exports.main();
  }
 }else if(process.argv[2]==='assessment-route-concurrency'){
  for(const name of ['0096_trusted_shared_segment_geographic_assessment_concurrency.cjs','0097_shared_segment_assessment_reuse_boundary_concurrency.cjs','0098_current_route_match_reuse_boundary_concurrency.cjs'])await finalConcurrency(name);
 }else if(process.argv[2]==='route-behavior'){
  const target=path.join(__dirname,'0098_current_route_match_reuse_boundary_harness.cjs'),child=new Module(target,module);child.filename=target;child.paths=Module._nodeModulePaths(__dirname);
  child.require=n=>n==='./0097_shared_segment_assessment_reuse_boundary_harness.cjs'?{...require(n),run:require('./0099_shared_segment_assessment_job_foundation_harness.cjs').run}:require(n.startsWith('.')?path.resolve(__dirname,n):n);
  // Avoid recursive installation: main's closure uses a final-0099 run directly.
  const code=fs.readFileSync(target,'utf8').replace('async function run(callback){await base.run(async c=>{c.target(migration);verify(c);await callback(c);});}',"async function run(callback){await require('./0099_shared_segment_assessment_job_foundation_harness.cjs').run(callback);}");
  child._compile(code,target);await child.exports.main();
 }else await m.exports.main();
}
module.exports={...m.exports,main};
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
