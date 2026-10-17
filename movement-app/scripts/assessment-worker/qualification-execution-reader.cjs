'use strict';
// NOT a GraphQL projection or authenticated live provider. Exact query input/return/
// pagination schema is absent locally. Only a reviewed injected code boundary exists.
const p=require('./qualification-child-protocol.cjs');
const STATUSES=Object.freeze(['CRASHED','CREATED','EXITED','INITIALIZING','REMOVED','REMOVING','RESTARTING','RUNNING','SKIPPED','STOPPED']);
const fail=()=>{throw Error('Qualification execution observation unavailable');};
function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v)||/sb_secret_|eyJ|PRIVATE KEY|token/i.test(v))fail();}
function time(v,now){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||Date.parse(v)>now||now-Date.parse(v)>3600000)fail();return Date.parse(v);}
/** @param {any} expected @param {any} dependencies */
function createInjectedExecutionReader(expected,{read,now=()=>Date.now()}){
 try{
  p.exact(expected,['provider','projectId','environmentId','serviceId','serviceInstanceId','deploymentId','region']);
  if(expected.provider!=='Railway'||typeof read!=='function'||typeof now!=='function')fail();for(const [k,v] of Object.entries(expected))if(k!=='provider')id(v);
 }catch{fail();}const bound=structuredClone(expected);
 return Object.freeze({async read(signal){let timer;const controller=new AbortController(),abort=()=>controller.abort();try{
  if(signal&&signal.aborted)fail();if(signal)signal.addEventListener('abort',abort,{once:true});
  const raw=await Promise.race([Promise.resolve().then(()=>read(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Qualification execution observation unavailable'));},5000);})]);
  if(controller.signal.aborted)fail();p.size(raw);p.exact(raw,['provider','projectId','instance','executions']);
  const at=now();if(!Number.isFinite(at)||raw.provider!==bound.provider||raw.projectId!==bound.projectId)fail();
  const i=raw.instance;p.exact(i,['id','serviceId','environmentId','deploymentId','region','restartPolicyType','restartPolicyMaxRetries']);
  if(i.id!==bound.serviceInstanceId||i.serviceId!==bound.serviceId||i.environmentId!==bound.environmentId||i.deploymentId!==bound.deploymentId||i.region!==bound.region||!['ALWAYS','NEVER','ON_FAILURE'].includes(i.restartPolicyType)||!Number.isInteger(i.restartPolicyMaxRetries)||i.restartPolicyMaxRetries<0)fail();
  // This is an injected adapter contract, not an invented Railway wire envelope.
  // The upstream reviewed reader must supply one unambiguous complete observation.
  if(!Array.isArray(raw.executions)||raw.executions.length!==1)fail();const e=raw.executions[0];
  p.exact(e,['id','deploymentId','createdAt','updatedAt','completedAt','status']);id(e.id);
  const created=time(e.createdAt,at),updated=time(e.updatedAt,at);
  if(e.deploymentId!==bound.deploymentId||!STATUSES.includes(e.status)||created>updated||e.completedAt!==null&&(time(e.completedAt,at)<created||Date.parse(e.completedAt)>updated)||e.status==='RUNNING'&&e.completedAt!==null)fail();
  return {instance:structuredClone(i),execution:{...structuredClone(e),observedAt:new Date(at).toISOString()}};
 }catch{fail();}finally{controller.abort();if(signal)signal.removeEventListener('abort',abort);clearTimeout(timer);}}});
}
module.exports={STATUSES,createInjectedExecutionReader};
