'use strict';
// Local qualification driver. Production run.cjs has no test environment switches.
const path=require('node:path');
const {main}=require('../../../scripts/assessment-worker/run.cjs');
const {calculateIsolated}=require('../../../scripts/assessment-worker/compute.cjs');
const mode=process.argv[2];
process.on('message',v=>{if(v==='SIGTERM'||v==='SIGINT')process.emit(v);});
const compute=mode==='stall'?async(a,b,options)=>{
 const work=calculateIsolated(a,b,{...options,childPath:path.join(__dirname,'0099-compute-stall.cjs')});
 process.send?.({event:'compute_started'});return work;
}:undefined;
main({args:mode==='once'?['--once']:[],compute,log:v=>{process.stdout.write(JSON.stringify(v)+'\n');process.send?.(v);}})
 .then(()=>{if(process.connected)process.disconnect();})
 .catch(()=>{process.stderr.write('Qualification worker unavailable\n');process.exitCode=1;if(process.connected)process.disconnect();});
