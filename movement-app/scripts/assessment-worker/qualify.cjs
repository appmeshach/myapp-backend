'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {calculateIsolated}=require('./compute.cjs');
const {CONTRACT,validateRuntime}=require('./runtime.cjs');
const {stats,verdict,validate,markdown,schema}=require('./qualification-report.cjs');
const {ASSESSMENT_VERSION,parameterFingerprint}=require('../../supabase/functions/_shared/shared-segment-assessment-contracts.ts');
const ROOT=path.resolve(__dirname,'../..');
const EXPECTED=Object.freeze({small:'c417020529025bcf828b41513b4df8825385baccca43a23b3bd65a73e4ec155b',ordinary:'91be9f6dc7230b9f0458a799cda4add5014e488cc3b108e19da647e56cc74499',
 nearMaximum:'329456608ccdbe37a5c2055b1bd359448c07bf692f40a3c7f09f0406fd936bbe',coordinateLimit:'d34aa1b518f8bb5024f3ef9abb57e2d9224f0c6f510a486dbd9ac237cd30e238',
 resamplingLimit:'d34aa1b518f8bb5024f3ef9abb57e2d9224f0c6f510a486dbd9ac237cd30e238',denseCrossing:'1883baa953644be27d3440a8ad70fa7d0c3c14720a17b476cdc3ea5a3216bd8c'});
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const sourceHash=name=>digest(fs.readFileSync(path.join(ROOT,'supabase/functions/_shared',name+'.ts'),'utf8').replace(/\r\n/g,'\n'));
function parseArgs(args){
 const out={mode:null,runs:5,idleMs:0,memoryLimitBytes:null,output:null,host:{provider:'unspecified',machine:'unspecified',region:'unspecified',monthlyFixedCost:null,currency:'unspecified'}};
 const seen=new Set();
 for(let i=0;i<args.length;i++){
  const k=args[i];if(seen.has(k))throw Error('Duplicate qualification argument');seen.add(k);
  if(k==='--offline'||k==='--integration'){if(out.mode)throw Error('Choose one qualification mode');out.mode=k.slice(2);continue;}
  if(!['--runs','--idle-minutes','--idle-seconds','--memory-limit-mb','--output','--provider','--machine','--region','--monthly-fixed-cost','--currency'].includes(k))throw Error('Unknown qualification argument');
  const v=args[++i];if(!v||v.startsWith('--'))throw Error('Missing qualification argument');
  if(['--provider','--machine','--region','--currency'].includes(k)){
   if(!/^[A-Za-z0-9 ._()-]{1,64}$/.test(v)||/sb_secret|eyJ|service.role|coordinates|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(v))throw Error('Invalid host label');out.host[k.slice(2)]=v;
  }else if(k==='--output'){out.output=path.resolve(v);}
  else{
   if(!/^\d+(\.\d+)?$/.test(v))throw Error('Invalid qualification number');const n=Number(v);
   if(k==='--runs'){if(!Number.isInteger(n)||n<1||n>20)throw Error('Runs must be 1 through 20');out.runs=n;}
   if(k==='--idle-minutes'||k==='--idle-seconds'){if(n<=0||n>(k==='--idle-minutes'?60:10)||seen.has(k==='--idle-minutes'?'--idle-seconds':'--idle-minutes'))throw Error('Invalid idle budget');out.idleMs=n*(k==='--idle-minutes'?60000:1000);}
   if(k==='--memory-limit-mb'){if(!Number.isInteger(n)||n<64||n>1048576)throw Error('Invalid memory budget');out.memoryLimitBytes=n*1048576;}
   if(k==='--monthly-fixed-cost'){if(!Number.isFinite(n)||n>1000000)throw Error('Invalid cost input');out.host.monthlyFixedCost=n;}
  }
 }
 if(!out.mode)throw Error('Explicit qualification mode required');
 if(out.host.monthlyFixedCost!==null&&out.host.currency==='unspecified')throw Error('Cost requires currency');
 return out;
}
function blankSample(index,timeoutMs,heapMb=/** @type {number} */(CONTRACT.heapMb)){return {observation:index===0?'first-process-run':'subsequent-process-run',timeoutMs,heapMb,failure:null,state:null,geographicResult:null,reason:null,workUnits:null,resampledPoints:null,resultHash:null,metrics:null};}
async function offline(runs,compute=calculateIsolated){
 const {cases}=await import('../0099-geographic-support-benchmark.mjs'),out=[];let invocation=0;
 const failures=[['stalledChild','stall','compute_timeout'],['malformedChild','malformed','compute_terminated'],['abnormalChild','abnormal','compute_terminated'],['constrainedHeap','oom','compute_terminated']];
 for(const [name,shapes] of Object.entries(cases)){
  const samples=[];for(let i=0;i<runs;i++){
   const s=blankSample(invocation++,CONTRACT.timeoutMs);
   try{const v=await compute(shapes[0],shapes[1]);const r=v.result;
    s.metrics=v.metrics;s.state=r.assessmentState;s.geographicResult=r.geographicResult;s.reason=r.reasons[0]||null;s.workUnits=r.workUnits;
    s.resampledPoints=[r.offererPointCount,r.requesterPointCount];s.resultHash=digest(JSON.stringify(r));
   }catch(e){s.failure=['compute_timeout','compute_terminated','invalid_evidence'].includes(e?.code)?e.code:'unexpected_failure';}
   samples.push(s);
  }
  out.push(summarize(name,shapes.map(s=>s.coordinates.length),EXPECTED[name],samples,samples.every(s=>s.failure===null&&s.resultHash===EXPECTED[name])));
 }
 for(const [name,file,expected] of failures){
  // Heap pressure can spend time in GC; qualify it within the existing actual
  // worker deadline rather than the shorter malformed/crash smoke budget.
  const s=blankSample(invocation++,file==='stall'?1000:file==='oom'?CONTRACT.timeoutMs:5000,16);try{await compute(cases.small[0],cases.small[1],{childPath:path.join(ROOT,'supabase/tests/fixtures',`0099-compute-${file}.cjs`),timeoutMs:s.timeoutMs,heapMb:s.heapMb});}
  catch(e){s.failure=['compute_timeout','compute_terminated','invalid_evidence'].includes(e?.code)?e.code:'unexpected_failure';}
  out.push(summarize(name,[2,2],null,[s],s.failure===expected));
 }
 return out;
}
function summarize(name,originalPoints,expectedHash,samples,passed){
 const measured=samples.filter(s=>s.metrics);
 return {name,originalPoints,expectedHash,samples,wallMs:stats(measured.map(s=>s.metrics.wallMs)),computeMs:stats(measured.map(s=>s.metrics.computeMs)),cpuMs:stats(measured.map(s=>s.metrics.cpuMs)),
 failures:samples.filter(s=>s.failure).length,timeouts:samples.filter(s=>s.failure==='compute_timeout').length,
 abnormalTerminations:samples.filter(s=>s.failure==='compute_terminated').length,peakRssBytes:Math.max(0,...measured.map(s=>s.metrics.peakRssBytes)),passed};
}
async function observeIdle(durationMs,backend=null,{intervalMs=1000}={}){
 if(!Number.isFinite(durationMs)||durationMs<1||durationMs>3600000||!Number.isFinite(intervalMs)||intervalMs<1)throw Error('Invalid idle duration');
 const start=performance.now(),cpu=process.cpuUsage(),rss=[],heap=[],cpuDeltas=[];let previousCpu=cpu,polls=0,lateness=0;
 do{
  const before=performance.now();if(backend){const v=await backend.claim(AbortSignal.timeout(CONTRACT.ioMs));if(v.state!=='idle')throw Error('Idle qualification requires empty queue');}polls++;
  const m=process.memoryUsage();rss.push(m.rss);heap.push(m.heapUsed);
  const sleepMs=Math.min(intervalMs,Math.max(0,durationMs-(performance.now()-start))),due=performance.now()+sleepMs;
  await delay(sleepMs);lateness=Math.max(lateness,performance.now()-due);
  const currentCpu=process.cpuUsage();cpuDeltas.push((currentCpu.user-previousCpu.user+currentCpu.system-previousCpu.system)/1000);previousCpu=currentCpu;
  if(performance.now()-before>durationMs+CONTRACT.ioMs)throw Error('Idle observation unavailable');
 }while(performance.now()-start<durationMs);
 const used=process.cpuUsage(cpu);
 return {kind:backend?'local_sql_worker_poll':'offline_simulated_poll',durationMs:performance.now()-start,sampleCount:rss.length,pollCount:polls,dbCalls:backend?polls:0,
 rssBytes:stats(rss),heapUsedBytes:stats(heap),cpuDeltaMs:stats(cpuDeltas),cpuMs:(used.user+used.system)/1000,maxEventLoopDelayMs:Math.max(0,lateness)};
}
function securitySources(){
 const child=fs.readFileSync(path.join(__dirname,'compute-child.cjs'),'utf8'),parent=fs.readFileSync(path.join(__dirname,'compute.cjs'),'utf8');
 return {logAllowlist:!fs.readFileSync(path.join(__dirname,'worker.cjs'),'utf8').includes('log({jobId'),childIsolation:/env:\{\}/.test(parent)&&!/SUPABASE|MAPBOX|fetch\(|job_id|lease_token/.test(child),processLeakCheck:null,installedSqlVerified:null};
}
async function qualify(options){
 validateRuntime();const started=performance.now(),cpu=process.cpuUsage();
 const git=cp.spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',windowsHide:true});
 const commit=git.status===0&&/^[a-f0-9]{40}$/.test(git.stdout.trim())?git.stdout.trim():null;
 const state=cp.spawnSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8',windowsHide:true});
 const workerSourceSha256=digest(fs.readdirSync(__dirname).filter(f=>/\.cjs$/.test(f)||f==='package.json').sort().map(f=>f+'\n'+fs.readFileSync(path.join(__dirname,f),'utf8').replace(/\r\n/g,'\n')).join('\n'));
 const model=(os.cpus()[0]?.model||'unknown').replace(/[^A-Za-z0-9 ._()-]/g,' ').slice(0,64);
 const r={schemaVersion:'movement_worker_host_qualification_v1',timestamp:new Date().toISOString(),gitCommit:commit,gitDirty:state.status!==0||Boolean(state.stdout.trim()),workerSourceSha256,mode:options.mode,host:options.host,
 environment:{nodeVersion:process.version,platform:process.platform,arch:process.arch,cpuModel:model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),availableMemoryBytes:os.freemem(),memoryLimitBytes:options.memoryLimitBytes,signalDelivery:process.platform==='win32'?'windows_handler_dispatch':'posix_signal'},
 algorithm:{version:ASSESSMENT_VERSION,parameterFingerprint:await parameterFingerprint(),geometrySha256:sourceHash('shared-segment-assessment-geometry'),contractsSha256:sourceHash('shared-segment-assessment-contracts')},
 worker:{...CONTRACT},cases:await offline(options.runs),queue:[],dedup:null,restart:[],idle:null,security:securitySources(),usage:null,lease:null,gates:null,result:'incomplete',classification:'QUALIFICATION_INCOMPLETE',reasons:[]};
 /** @type {any} */let integration=null;let integrationFailed=false;
 if(options.mode==='integration'){
  try{integration=await require('./qualification-integration.cjs').integration(options.idleMs);}
  catch{integrationFailed=true;}
 }
 if(integration){r.queue=integration.queue;r.dedup=integration.dedup;r.restart=integration.restart;r.idle=integration.idle;r.security.processLeakCheck=integration.processLeakCheck;r.security.installedSqlVerified=true;}
 else if(options.idleMs)r.idle=await observeIdle(options.idleMs);
 const normal=r.cases.filter(c=>c.expectedHash),maxWall=Math.max(0,...normal.map(c=>c.wallMs.max||0));
 const parentPeak=Math.max(process.resourceUsage().maxRSS*1024,...r.queue.map(q=>q.peakParentRssBytes));
 const childPeak=Math.max(0,...normal.map(c=>c.peakRssBytes),integration?.peakChildRssBytes||0),used=process.cpuUsage(cpu);
 r.usage={wallMs:performance.now()-started,totalChildCpuMs:r.cases.reduce((a,c)=>a+c.samples.reduce((n,s)=>n+(s.metrics?.cpuMs||0),0),0)+(integration?.childCpuMs||0),parentCpuMs:(used.user+used.system)/1000,
 peakParentRssBytes:parentPeak,peakChildRssBytes:childPeak,dbCalls:integration?.dbCalls||0,jobsCompleted:integration?.jobsCompleted||0,bytesTransferred:null};
 r.lease={maximumNormalWallMs:maxWall,reserveMs:CONTRACT.reserveMs,leaseMs:CONTRACT.leaseMs,provisionalCeilingMs:CONTRACT.leaseMs/2,remainingMs:Math.max(0,CONTRACT.leaseMs-maxWall-CONTRACT.reserveMs)};
 r.gates={correctness:normal.every(c=>c.passed)&&r.algorithm.parameterFingerprint==='1625aa38ea035ad2c26a8c13a3a4df37714fc32624089fa3894f57c2ddda29d5'&&
 r.algorithm.geometrySha256==='d48f53b5f7e2e226ed9a1c23d9dd1884e6a6350539e8e58b794061103db54043'&&r.algorithm.contractsSha256==='9ad2c9a1675a4caeb4a6d658bcb8b24fcaecc6ae1b101effea906b8e216eda95',
 reliability:r.cases.every(c=>c.passed),lease:maxWall+CONTRACT.reserveMs<=CONTRACT.leaseMs/2,
 memory:options.memoryLimitBytes===null?null:parentPeak+childPeak<=options.memoryLimitBytes*0.8,
 process:integration?(process.platform==='win32'?null:integration.restart.every(v=>v.passed)):integrationFailed?false:null,integration:integration?integration.queue.every(q=>q.failures===0&&q.retries===0&&q.duplicatePublications===0)&&integration.dedup.canonicalJobs===1&&integration.dedup.newComputes===0&&integration.dedup.publications===1:integrationFailed?false:null,
 security:integration?r.security.logAllowlist&&r.security.childIsolation&&r.security.processLeakCheck:null};
 Object.assign(r,verdict(r,options.runs));if(integrationFailed)r.reasons.push('qualification_execution_failed');validate(r);return r;
}
async function main(args=process.argv.slice(2)){
 const options=parseArgs(args),report=await qualify(options);
 if(options.output){fs.mkdirSync(options.output,{recursive:true});fs.writeFileSync(path.join(options.output,'qualification.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(options.output,'qualification.md'),markdown(report));fs.writeFileSync(path.join(options.output,'qualification.schema.json'),JSON.stringify(schema,null,2)+'\n');}
 process.stdout.write(markdown(report));if(report.result==='unqualified')process.exitCode=1;
 return report;
}
module.exports={parseArgs,offline,observeIdle,qualify,main,EXPECTED,summarize};
if(require.main===module)main().catch(()=>{process.stderr.write('Qualification unavailable; no geographic evidence produced\n');process.exitCode=1;});
