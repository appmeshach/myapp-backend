'use strict';
// Audit label only; operational identity is checked against the frozen contract
// by worker.cjs. Keep preflight independent of TypeScript loading on old Node.
const ASSESSMENT_VERSION='shared_segment_geographic_assessment_v1';
const CONTRACT=Object.freeze({nodeMajor:24,concurrency:1,pollMs:1000,leaseMs:60000,timeoutMs:15000,heapMb:192,ioMs:5000,reserveMs:10000,shutdownMs:6000});
function validateRuntime(version=process.versions.node){
 const major=Number(version.split('.')[0]);
 if(!Number.isInteger(major)||major<CONTRACT.nodeMajor)throw Error('Unsupported worker runtime');
}
function configuration(env=process.env){
 const url=env.SUPABASE_URL,secret=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!secret||secret.trim()!==secret||/\s/.test(secret))throw Error('Worker configuration unavailable');
 let root;try{root=new URL(url);}catch{throw Error('Worker configuration unavailable');}
 if(root.username||root.password||root.pathname!=='/'||root.search||root.hash||
  !(root.protocol==='https:'||root.protocol==='http:'&&['localhost','127.0.0.1','kong'].includes(root.hostname)))throw Error('Worker configuration unavailable');
 return {url:root.origin,secret};
}
// Construct from an allowlist, never spread an error, backend response or result.
function event(name,fields={}){
 if(!['worker_started','worker_ready','worker_heartbeat','shutdown_started','worker_stopped','bootstrap_failed','job_transition'].includes(name))throw Error('Invalid worker event');
 const out={event:name,timestamp:new Date().toISOString(),uptimeSeconds:process.uptime(),workerVersion:'0101',algorithmVersion:ASSESSMENT_VERSION};
 for(const k of ['pollCount','attemptCount','durationMs','computeMs','cpuMs','peakRssBytes','rssBytes'])
  if(typeof fields[k]==='number'&&Number.isFinite(fields[k])&&fields[k]>=0)out[k]=fields[k];
 if(['idle','completed','pending','failed','stale','expired','lease_invalid','interrupted','unavailable'].includes(fields.state))out.state=fields.state;
 if(['geometric_corridor_support','overlap_observed','inconclusive','processing_limit','calculation_failed','evidence_invalid'].includes(fields.resultCategory))out.resultCategory=fields.resultCategory;
 return out;
}
module.exports={CONTRACT,validateRuntime,configuration,event};
