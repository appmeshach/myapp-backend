'use strict';
// Strict schema doubles as the serialization boundary; extra properties fail closed.
const number={type:'number',minimum:0},nullable=s=>({anyOf:[s,{type:'null'}]}),bool=nullable({type:'boolean'});
const enumOf=(...values)=>({enum:values});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array=items=>({type:'array',items});
const label={type:'string',pattern:'^(?!.*(?:[sS][bB]_[sS][eE][cC][rR][eE][tT]_|[eE][yY][jJ]|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}))[A-Za-z0-9 ._()-]{1,64}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const statistics=object({count:number,min:nullable(number),p50:nullable(number),p95:nullable(number),max:nullable(number)});
const metrics=object({wallMs:number,computeMs:number,cpuMs:number,peakRssBytes:number});
const sample=object({observation:enumOf('first-process-run','subsequent-process-run'),timeoutMs:number,heapMb:number,
 failure:nullable(enumOf('compute_timeout','compute_terminated','invalid_evidence','unexpected_failure')),
 state:nullable(enumOf('complete','assessment_unavailable','not_run')),geographicResult:nullable(enumOf('geometric_corridor_support','overlap_observed','inconclusive')),
 reason:nullable(enumOf('processing_limit','calculation_failed','no_positive_support_on_reference_route','reverse_direction_only','ambiguous_traversal','below_positive_support_standard','unsupported_provider_contract')),workUnits:nullable(number),resampledPoints:nullable(array(number)),resultHash:nullable(hash),metrics:nullable(metrics)});
const schema=object({schemaVersion:enumOf('movement_worker_host_qualification_v1'),timestamp:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'},
 gitCommit:nullable({type:'string',pattern:'^[a-f0-9]{40}$'}),gitDirty:{type:'boolean'},workerSourceSha256:hash,mode:enumOf('offline','integration'),
 host:object({provider:label,machine:label,region:label,monthlyFixedCost:nullable(number),currency:label}),
 environment:object({nodeVersion:{type:'string',pattern:'^v[0-9.]+$'},platform:label,arch:label,cpuModel:label,logicalCpus:number,totalMemoryBytes:number,availableMemoryBytes:number,memoryLimitBytes:nullable(number),signalDelivery:enumOf('posix_signal','windows_handler_dispatch')}),
 algorithm:object({version:enumOf('shared_segment_geographic_assessment_v1'),parameterFingerprint:hash,geometrySha256:hash,contractsSha256:hash}),
 worker:object({nodeMajor:number,concurrency:number,pollMs:number,leaseMs:number,timeoutMs:number,heapMb:number,ioMs:number,reserveMs:number,shutdownMs:number}),
 cases:array(object({name:enumOf('small','ordinary','nearMaximum','coordinateLimit','resamplingLimit','denseCrossing','stalledChild','malformedChild','abnormalChild','constrainedHeap'),
 originalPoints:array(number),expectedHash:nullable(hash),samples:array(sample),wallMs:statistics,computeMs:statistics,cpuMs:statistics,
 failures:number,timeouts:number,abnormalTerminations:number,peakRssBytes:number,passed:{type:'boolean'}})),
 queue:array(object({jobs:number,firstClaimMs:number,drainMs:number,maxQueueAgeMs:number,computeMs:statistics,retries:number,failures:number,duplicatePublications:number,dbCalls:number,peakParentRssBytes:number})),
 dedup:nullable(object({registrationAttempts:number,canonicalJobs:number,reuseOperations:number,newComputes:number,publications:number})),
 restart:array(object({scenario:enumOf('before_claim','after_claim','child_kill','lost_publication_ack','stale_token','sigterm_idle','sigterm_compute','sigint_idle','calculation_failed'),passed:{type:'boolean'},durationMs:number})),
 idle:nullable(object({kind:enumOf('offline_simulated_poll','local_sql_worker_poll'),durationMs:number,sampleCount:number,pollCount:number,dbCalls:number,
 rssBytes:statistics,heapUsedBytes:statistics,cpuDeltaMs:statistics,cpuMs:number,maxEventLoopDelayMs:number})),
 security:object({logAllowlist:{type:'boolean'},childIsolation:{type:'boolean'},processLeakCheck:bool,installedSqlVerified:bool}),
 usage:object({wallMs:number,totalChildCpuMs:number,parentCpuMs:number,peakParentRssBytes:number,peakChildRssBytes:number,dbCalls:number,jobsCompleted:number,bytesTransferred:nullable(number)}),
 lease:object({maximumNormalWallMs:number,reserveMs:number,leaseMs:number,provisionalCeilingMs:number,remainingMs:number}),
 gates:object({correctness:bool,reliability:bool,lease:bool,memory:bool,process:bool,integration:bool,security:bool}),
 result:enumOf('qualified','unqualified','incomplete'),classification:enumOf('LOCAL_SAMPLE_QUALIFIED','HOST_UNQUALIFIED','QUALIFICATION_INCOMPLETE'),
 reasons:array(enumOf('correctness_gate_failed','reliability_gate_failed','lease_gate_failed','memory_gate_failed','process_gate_failed','integration_gate_failed','security_gate_failed',
 'memory_budget_not_supplied','integration_not_measured','process_not_measured','security_not_measured','insufficient_repetitions','qualification_execution_failed'))});
schema.$schema='https://json-schema.org/draft/2020-12/schema';
function validate(value,s=schema){
 if(s.anyOf){if(s.anyOf.some(v=>{try{validate(value,v);return true;}catch{return false;}}))return;throw Error('Invalid qualification report');}
 if(s.enum){if(!s.enum.includes(value))throw Error('Invalid qualification report');return;}
 if(s.type==='null'){if(value!==null)throw Error('Invalid qualification report');return;}
 if(s.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==s.required.slice().sort().join('|'))throw Error('Invalid qualification report');
  for(const [k,v] of Object.entries(s.properties))validate(value[k],v);return;
 }
 if(s.type==='array'){if(!Array.isArray(value))throw Error('Invalid qualification report');value.forEach(v=>validate(v,s.items));return;}
 if(typeof value!==s.type||s.type==='number'&&(!Number.isFinite(value)||value<s.minimum)||s.pattern&&!new RegExp(s.pattern).test(value))throw Error('Invalid qualification report');
 if(typeof value==='string'&&/sb_secret_|eyJ|Bearer |https?:\/\/|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(value))throw Error('Private value in qualification report');
}
function stats(values){
 if(!values.length)return {count:0,min:null,p50:null,p95:null,max:null};
 if(values.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0))throw Error('Invalid metric');
 const sorted=[...values].sort((a,b)=>a-b),n=sorted.length;
 return {count:n,min:sorted[0],p50:n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2,
  p95:n>=20?sorted[Math.ceil(n*0.95)-1]:null,max:sorted[n-1]};
}
function verdict(report,runs){
 const gates=report.gates,reasons=[];
 for(const [name,value] of Object.entries(gates))if(value===false)reasons.push(name+'_gate_failed');
 if(gates.memory===null)reasons.push('memory_budget_not_supplied');
 if(gates.integration===null)reasons.push('integration_not_measured');
 if(gates.process===null)reasons.push('process_not_measured');
 if(gates.security===null)reasons.push('security_not_measured');
 if(runs<5)reasons.push('insufficient_repetitions');
 const result=Object.values(gates).includes(false)?'unqualified':reasons.length?'incomplete':'qualified';
 return {result,classification:result==='unqualified'?'HOST_UNQUALIFIED':result==='qualified'?'LOCAL_SAMPLE_QUALIFIED':'QUALIFICATION_INCOMPLETE',reasons};
}
function markdown(r){
 validate(r);
 const ms=v=>v===null?'not measured':v.toFixed(2),mib=v=>(v/1048576).toFixed(2);
 return `# 0101 worker host qualification\n\nResult: **${r.result.toUpperCase()}** (${r.classification}). Production host remains UNSELECTED / UNQUALIFIED; geographic support activation BLOCKED.\n\n`+
 `Host: ${r.host.provider}; machine: ${r.host.machine}; region: ${r.host.region}. Mode: ${r.mode}. Commit: ${r.gitCommit||'unknown'}; dirty working tree: ${r.gitDirty}; worker source SHA-256: \`${r.workerSourceSha256}\`.\n\n`+
 `Environment: ${r.environment.nodeVersion}, ${r.environment.platform}/${r.environment.arch}; ${r.environment.cpuModel}; ${r.environment.logicalCpus} logical CPUs. OS total/available memory: ${mib(r.environment.totalMemoryBytes)}/${mib(r.environment.availableMemoryBytes)} MiB. Operator memory budget: ${r.environment.memoryLimitBytes===null?'not supplied':mib(r.environment.memoryLimitBytes)+' MiB'}.\n\n`+
 `Algorithm: ${r.algorithm.version}; parameter fingerprint: \`${r.algorithm.parameterFingerprint}\`. Geometry SHA-256: \`${r.algorithm.geometrySha256}\`; contracts SHA-256: \`${r.algorithm.contractsSha256}\`.\n\n`+
 `| Case | Samples | Wall p50/max ms | Compute p50/max ms | Peak child RSS MiB | Unexpected outcomes |\n| --- | ---: | ---: | ---: | ---: | ---: |\n`+
 r.cases.map(c=>`| ${c.name} | ${c.samples.length} | ${ms(c.wallMs.p50)}/${ms(c.wallMs.max)} | ${ms(c.computeMs.p50)}/${ms(c.computeMs.max)} | ${c.samples.some(s=>s.metrics)?mib(c.peakRssBytes):'not measured'} | ${c.passed?0:c.failures||1} |`).join('\n')+
 `\n\nEach computation forks a fresh child. first-process-run means the first case invocation in this qualification supervisor; subsequent-process-run means later invocations. Neither measures provider startup. p95 is reported only with at least 20 samples; five runs give a descriptive median, not statistical certainty.\n\n`+
 `Lease: worst normal supervisor compute wall ${ms(r.lease.maximumNormalWallMs)} ms + ${r.lease.reserveMs} ms publication/supervisor reserve; provisional ceiling ${r.lease.provisionalCeilingMs} ms (50% of ${r.lease.leaseMs} ms). Remaining lease ${ms(r.lease.remainingMs)} ms. No lease change.\n\n`+
 `Memory: parent peak ${mib(r.usage.peakParentRssBytes)} MiB; child peak ${mib(r.usage.peakChildRssBytes)} MiB. Gate uses their conservative sum at <=80% of the operator budget. V8 old-space ${r.worker.heapMb} MiB is not an RSS cap; this test does not enforce a host cgroup.\n\n`+
 `| Queue jobs | First claim ms | Drain ms | Maximum age ms | Retries/failures/duplicates |\n| ---: | ---: | ---: | ---: | --- |\n`+
 r.queue.map(q=>`| ${q.jobs} | ${ms(q.firstClaimMs)} | ${ms(q.drainMs)} | ${ms(q.maxQueueAgeMs)} | ${q.retries}/${q.failures}/${q.duplicatePublications} |`).join('\n')+
 `\n\nQueue uses one compute slot. Local SQL bridge timing includes local connection and IPC overhead; it is not target-cloud HTTP latency. DB calls: ${r.usage.dbCalls}; completed jobs: ${r.usage.jobsCompleted}; transferred bytes: not measured.\n\n`+
 `Recovery: ${r.restart.length?r.restart.map(v=>v.scenario+': '+(v.passed?'PASS':'FAIL')).join('; '):'not measured'}. Signal delivery: ${r.environment.signalDelivery}. Windows handler dispatch does not prove host POSIX signal delivery.\n\n`+
 `Deduplication: ${r.dedup?`${r.dedup.registrationAttempts} registrations -> ${r.dedup.canonicalJobs} canonical job; ${r.dedup.reuseOperations} selected-boundary reuse operations -> ${r.dedup.newComputes} new computations; ${r.dedup.publications} publication.`:'not measured' }\n\n`+
 `Idle: ${r.idle?`${r.idle.kind}, ${ms(r.idle.durationMs)} ms, ${r.idle.sampleCount} samples, ${r.idle.pollCount} polls, CPU ${ms(r.idle.cpuMs)} ms (interval p50/max ${ms(r.idle.cpuDeltaMs.p50)}/${ms(r.idle.cpuDeltaMs.max)} ms), RSS p50/max ${ms(r.idle.rssBytes.p50)}/${ms(r.idle.rssBytes.max)} bytes, maximum sampling lateness ${ms(r.idle.maxEventLoopDelayMs)} ms.`:'not measured' }\n\n`+
 `Security: allowlisted logs ${r.security.logAllowlist}; credential-free child ${r.security.childIsolation}; process leak check ${r.security.processLeakCheck}; installed SQL/security ${r.security.installedSqlVerified}. No raw error, private ID or coordinate is serialized.\n\n`+
 `Usage/cost inputs: wall ${ms(r.usage.wallMs)} ms; child CPU ${ms(r.usage.totalChildCpuMs)} ms; parent CPU ${ms(r.usage.parentCpuMs)} ms; idle polling interval ${r.worker.pollMs} ms. Monthly fixed cost: ${r.host.monthlyFixedCost===null?'unknown':r.host.monthlyFixedCost+' '+r.host.currency} (operator entered). No provider prices inferred.\n\n`+
 `Gates: ${Object.entries(r.gates).map(([k,v])=>k+': '+(v===null?'NOT MEASURED':v?'PASS':'FAIL')).join('; ')}.\n\nBlockers: ${r.reasons.length?r.reasons.join(', '):'none within this local sample; actual production host still unselected/unqualified'}.\n`;
}
module.exports={schema,validate,stats,verdict,markdown};
