'use strict';
const {fork}=require('node:child_process'),path=require('node:path');
const {parseResult}=require('./result.cjs');
class ComputeFailure extends Error{constructor(code){super('Assessment compute unavailable');this.code=code;}}
/**
 * @param {unknown} offerer_shape
 * @param {unknown} requester_shape
 * @returns {Promise<{result:import('../../supabase/functions/_shared/shared-segment-assessment-contracts.ts').AssessmentResult,metrics:{wallMs:number,computeMs:number,cpuMs:number,peakRssBytes:number}}>}
 */
function calculateIsolated(offerer_shape,requester_shape,{signal=new AbortController().signal,timeoutMs=15000,childPath=path.join(__dirname,'compute-child.cjs'),heapMb=192}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000||!Number.isInteger(heapMb)||heapMb<16||heapMb>192)throw Error('Invalid compute budget');
 signal.throwIfAborted();
 const input={offerer_shape,requester_shape};if(Buffer.byteLength(JSON.stringify(input))>1024*1024)throw new ComputeFailure('invalid_evidence');
 return new Promise((resolve,reject)=>{
  /** @type {import('node:child_process').ForkOptions & {windowsHide:boolean}} */
  const options={env:{},execArgv:['--no-warnings',`--max-old-space-size=${heapMb}`],silent:true,serialization:'json',windowsHide:true};
  const start=performance.now(),child=fork(childPath,[],options);
  let result,diagnostic='',count=0,finished=false;
  const finish=(error)=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',aborted);if(child.connected)child.disconnect();if(error){child.kill('SIGKILL');reject(error);}else resolve({result,metrics:{wallMs:performance.now()-start,...JSON.parse(diagnostic)}});};
  const aborted=()=>finish(new ComputeFailure('compute_terminated'));
  const timer=setTimeout(()=>finish(new ComputeFailure('compute_timeout')),timeoutMs);
  signal.addEventListener('abort',aborted,{once:true});
  child.stdout.on('data',()=>finish(new ComputeFailure('compute_terminated')));
  child.stderr.on('data',bytes=>{diagnostic+=bytes.toString();if(diagnostic.length>4096)finish(new ComputeFailure('compute_terminated'));});
  child.on('error',()=>finish(new ComputeFailure('compute_terminated')));
  child.on('message',value=>{try{if(++count!==1||Buffer.byteLength(JSON.stringify(value))>4*1024*1024)throw Error();result=parseResult(value);}catch{finish(new ComputeFailure('compute_terminated'));}});
  // Wait for stdio to drain before validating the diagnostic channel.
  child.on('close',(code)=>{
   if(finished)return;
   try{const m=JSON.parse(diagnostic);if(code!==0||!result||Object.keys(m).sort().join('|')!=='computeMs|cpuMs|peakRssBytes'
     ||Object.values(m).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error();finish();}
   catch{finish(new ComputeFailure('compute_terminated'));}
  });
  child.send(input,error=>{if(error)finish(new ComputeFailure('compute_terminated'));});
  if(signal.aborted)aborted();
 });
}
module.exports={calculateIsolated,ComputeFailure};
