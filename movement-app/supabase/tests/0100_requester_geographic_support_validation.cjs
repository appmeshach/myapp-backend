'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),Module=require('node:module'),assert=require('node:assert/strict');
const file=path.join(__dirname,'0099_shared_segment_assessment_job_foundation_validation.cjs'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
m.require=name=>require(name.startsWith('.')?path.resolve(__dirname,name):name);
m._compile(fs.readFileSync(file,'utf8').replaceAll("'movement-0099-validation'","'movement-0100-validation'"),file);
const output=path.join(os.tmpdir(),'movement-0100-validation');
async function main(){const group=process.argv[2]||'node';fs.mkdirSync(output,{recursive:true});
 if(['regressions','requester-regressions'].includes(group)){
  const groups=group==='requester-regressions'?['sql','requester-concurrency']:['foundation','assessment','assessment-behavior','assessment-route-concurrency','route-behavior','priority','roster-behavior','roster-concurrency','roster-temporal'];
  for(const name of groups){
   const log=path.join(output,name+'.txt'),fd=fs.openSync(log,'w');
   const result=cp.spawnSync(process.execPath,['--no-warnings',__filename,name],{stdio:['ignore',fd,fd],timeout:900000,windowsHide:true});fs.closeSync(fd);
   console.log(`Regression ${name}: exit ${result.status}; ${log}`);console.log(fs.readFileSync(log,'utf8').split('\n').slice(-8).join('\n'));assert.equal(result.status,0,result.error?String(result.error):'See '+log);
  }
 }else if(['node','root-node','supabase-node'].includes(group)){
  for(const [name,dir] of group==='root-node'?[['root','tests']]:group==='supabase-node'?[['supabase','supabase/tests']]:[['supabase','supabase/tests'],['root','tests']]){
   const files=fs.readdirSync(dir).filter(f=>/\.test\.(cjs|mjs|js)$/.test(f)).sort().map(f=>path.join(dir,f));
   const log=path.join(output,name+'-node.txt'),fd=fs.openSync(log,'w');
   const result=cp.spawnSync(process.execPath,['--no-warnings','--test',...files],{stdio:['ignore',fd,fd],timeout:600000,windowsHide:true});fs.closeSync(fd);
   console.log(`${name}: ${files.length} files; exit ${result.status}; ${log}`);console.log(fs.readFileSync(log,'utf8').split('\n').slice(-12).join('\n'));assert.equal(result.status,0,result.error?String(result.error):'See '+log);
  }
 }else await m.exports.main();
}
module.exports={main,output};if(require.main===module)main().catch(error=>{console.error(error.stack);process.exitCode=1;});
