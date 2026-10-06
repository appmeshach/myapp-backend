'use strict';
// Execute the unchanged 0085 suites with only their harness dependency replaced
// by the 0086 disposable source composition. No assertions or fixtures removed.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
async function main(){
 for(const name of ['0085_funded_no_travel_behavior.cjs','0085_funded_no_travel_regression.cjs','0085_funded_no_travel_concurrency.cjs']){
  const filename=path.join(__dirname,name),module={exports:{}};
  const localRequire=n=>n==='./0085_funded_no_travel_harness.cjs'?require('./0086_funded_dispute_harness.cjs'):require(n.startsWith('.')?path.resolve(__dirname,n):n);
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:localRequire,module,exports:module.exports,__dirname,console,process,Buffer,setTimeout,clearTimeout},{filename});
  await module.exports.main();console.log('PASS unchanged '+name+' against installed 0086');
 }
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
