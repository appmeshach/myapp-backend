'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const need='00000000-0000-4000-8000-000000000001',availability='00000000-0000-4000-8000-000000000002';
const input={movementNeedId:need,availabilityId:availability};
function fixture(value={geographicSupport:'pending'},options={}){
 const calls=[],exports={};const code=ts.transpileModule(fs.readFileSync('src/services/requesterGeographicSupportService.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Error,AbortController,Uint8Array,TextDecoder,setTimeout,clearTimeout,
 process:{env:{EXPO_PUBLIC_SUPABASE_URL:'https://project.invalid',EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-key'}},
 fetch:async(...args)=>{calls.push(args);return options.fetch?options.fetch(...args):Response.json(value,{status:options.status||200});},
 require:()=>({supabase:{auth:{getSession:options.session||(async()=>({data:{session:{access_token:'jwt'}},error:null}))}}})});
 return {api:exports,calls};
}
for(const geographicSupport of ['geometric_corridor_support','overlap_observed','inconclusive','pending','unavailable'])test(`0100 service strictly accepts ${geographicSupport}`,async()=>{
 const f=fixture({geographicSupport});assert.deepEqual(JSON.parse(JSON.stringify(await f.api.prepareRequesterGeographicSupport(input))),{geographicSupport});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'https://project.invalid/functions/v1/prepare-requester-geographic-support');
 assert.deepEqual(JSON.parse(f.calls[0][1].body),input);assert.equal(f.calls[0][1].headers.Authorization,'Bearer jwt');assert.equal(f.calls[0][1].redirect,'error');
});
test('0100 service accepts only bounded pending retry hints',()=>{
 const f=fixture();for(const retryAfterSeconds of [1,30])assert.equal(f.api.parseRequesterGeographicSupport({geographicSupport:'pending',retryAfterSeconds}).retryAfterSeconds,retryAfterSeconds);
});
for(const value of [null,[],{}, {geographicSupport:'ready'}, {geographicSupport:'pending',jobId:need}, {geographicSupport:'pending',geometry:{}},
 {geographicSupport:'unavailable',retryAfterSeconds:1}, {geographicSupport:'pending',retryAfterSeconds:0}, {geographicSupport:'pending',retryAfterSeconds:31},
 {geographicSupport:'pending',retryAfterSeconds:1.5},{geographicSupport:'pending',retryAfterSeconds:'1'}])test(`0100 service rejects malformed response ${JSON.stringify(value)}`,async()=>{
 const f=fixture(value);await assert.rejects(f.api.prepareRequesterGeographicSupport(input),/geographic_support_unavailable/);
});
for(const value of [{...input,jobId:need},{movementNeedId:'bad',availability},{movementNeedId:need},null,[]])test(`0100 service rejects malformed request ${JSON.stringify(value)}`,async()=>{
 const f=fixture();await assert.rejects(f.api.prepareRequesterGeographicSupport(value),/invalid_geographic_support_request/);assert.equal(f.calls.length,0);
});
test('0100 service pre-abort and authentication failure perform no transport',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.api.prepareRequesterGeographicSupport(input,controller.signal),/geographic_support_aborted/);assert.equal(f.calls.length,0);
 const g=fixture(undefined,{session:async()=>({data:{session:null},error:null})});await assert.rejects(g.api.prepareRequesterGeographicSupport(input),/authentication_required/);assert.equal(g.calls.length,0);
});
test('0100 service mid-flight abort neutralizes a late response',async()=>{
 const controller=new AbortController();const f=fixture(undefined,{fetch:async()=>{controller.abort();return Response.json({geographicSupport:'inconclusive'});}});
 await assert.rejects(f.api.prepareRequesterGeographicSupport(input,controller.signal),/geographic_support_aborted/);
});
test('0100 service snapshots exact selectors before an asynchronous session wait',async()=>{
 let release;const waiting=new Promise(resolve=>release=resolve),f=fixture(undefined,{session:()=>waiting}),mutable={...input};const result=f.api.prepareRequesterGeographicSupport(mutable);
 mutable.jobId='private';mutable.availabilityId=need;release({data:{session:{access_token:'jwt'}},error:null});await result;assert.deepEqual(JSON.parse(f.calls[0][1].body),input);
});
test('0100 service bounds response size and never exposes backend error text',async()=>{
 const f=fixture(undefined,{fetch:async()=>new Response('x'.repeat(1025))});await assert.rejects(f.api.prepareRequesterGeographicSupport(input),/geographic_support_unavailable/);
 const g=fixture({private:'SQL geometry provider'},{status:503});await assert.rejects(g.api.prepareRequesterGeographicSupport(input),/geographic_support_unavailable/);
});
