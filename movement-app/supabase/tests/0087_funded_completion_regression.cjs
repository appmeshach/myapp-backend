'use strict';
// Evaluate unchanged 0086 programs, including their unchanged 0085/0083/0084
// composition, with only the disposable source harness replaced by 0087.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
async function main(){for(const name of ['0086_funded_dispute_behavior.cjs','0086_funded_dispute_concurrency.cjs','0086_funded_dispute_temporal.cjs','0086_funded_dispute_regression.cjs']){
 const filename=path.join(__dirname,name),loaded=new Module(filename,module);
 const localRequire=n=>n==='./0086_funded_dispute_harness.cjs'?require('./0087_funded_completion_harness.cjs'):require(n.startsWith('.')?path.resolve(__dirname,n):n);
 // Compile in the ordinary Node realm so strict prototype comparisons in the
 // original assertions compare ordinary objects from the replacement harness.
 loaded.filename=filename;loaded.paths=Module._nodeModulePaths(__dirname);loaded.require=localRequire;loaded._compile(fs.readFileSync(filename,'utf8'),filename);await loaded.exports.main();console.log('PASS unchanged '+name+' against disposable 0087');
 }}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});module.exports={main};
