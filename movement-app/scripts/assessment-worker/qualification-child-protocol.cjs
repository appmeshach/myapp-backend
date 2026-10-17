'use strict';
// Private inherited IPC wire format, never an artifact/authorization decoder.
const VERSION='0104-inherited-child-v1',LIMIT=256*1024;
const KEYS=['qualificationRunSha256','supervisorRunSha256','jobSha256','executionSha256','workerSourceSha256','migrationDigest'];
const fail=()=>{throw Error('Qualification child unavailable');};
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==keys.slice().sort().join('|'))fail();}
function size(v){try{const json=JSON.stringify(v);if(typeof json!=='string'||Buffer.byteLength(json)>LIMIT)fail();}catch{fail();}}
function binding(v,expected){exact(v,KEYS);for(const k of KEYS){if(typeof v[k]!=='string'||!/^[a-f0-9]{64}$/.test(v[k])||expected&&v[k]!==expected[k])fail();}}
function message(v,expected){
 size(v);if(!v||typeof v.type!=='string')fail();
 const fields={hello:['version'],initialize:['plan'],ready:[],register:[],registered:['value'],prepare:[],prepared:['value'],release:[],fault_receipt:['value'],receipt_ack:[],backend_request:['requestId','method','args'],backend_result:['requestId','value'],failure:[]};
 if(!Object.hasOwn(fields,v.type))fail();exact(v,['type',...(v.type==='hello'?[]:['binding']),...fields[v.type]]);
 if(v.type==='hello'){if(v.version!==VERSION)fail();}else binding(v.binding,expected);
 if(['backend_request','backend_result'].includes(v.type)&&(!Number.isInteger(v.requestId)||v.requestId<1||v.requestId>3))fail();
 if(v.type==='backend_request'&&(!['register','claim','load'].includes(v.method)||!Array.isArray(v.args)))fail();return v;
}
function same(v,expected){exact(v,Object.keys(expected));for(const k of Object.keys(expected))if(v[k]!==expected[k])fail();}
module.exports={VERSION,LIMIT,KEYS,fail,exact,size,binding,message,same};
