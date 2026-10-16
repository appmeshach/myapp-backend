'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {loadAcquisition,inventory}=require('./fixtures/0114d-acquisition-wrapper.cjs');
const hash=s=>crypto.createHash('sha256').update(s.replace(/\r\n/g,'\n')).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const reject=fn=>assert.throws(fn,/unavailable/);
function candidate(f){const target=f.binding(),inputs=f.input(target),code={reviewedHead:f.drift.head,reviewedBranch:f.drift.branch};return{target,inputs,code};}
function rewrite(f,x,edit){edit(x.inputs.record);const lifecycleText=JSON.stringify(x.inputs.record)+'\n';f.drift.files.set(x.inputs.lifecyclePath,lifecycleText);
 x.inputs.package.lifecycleReview.sha256=hash(lifecycleText);const packageText=JSON.stringify(x.inputs.package)+'\n';f.drift.files.set(x.inputs.packagePath,packageText);x.inputs.descriptor.sha256=hash(packageText);}
function create(f,x){return f.auth.createExecutableAcquisitionDraft(x.target,inventory(),x.code,x.inputs.descriptor);}
function retime(record,reviewedAtMs){record.operator.assertedAt=new Date(reviewedAtMs).toISOString();record.review.reviewedAt=new Date(reviewedAtMs).toISOString();record.validity.expiresAt=new Date(reviewedAtMs+1800000).toISOString();}
test.beforeEach(t=>{let calls=0;for(const[o,k]of[[require('node:https'),'request'],[require('node:http'),'request'],[global,'fetch']])t.mock.method(o,k,()=>{calls++;throw Error('REAL NETWORK FORBIDDEN');});t.after(()=>assert.equal(calls,0));});

test('canonical assertion identity and v3/v4 lifecycle binding are exact',()=>{
 const f=loadAcquisition(),x=candidate(f),draft=create(f,x),review=f.auth.reviewExecutableAcquisitionPackage(draft),eligibility=review.manifest.expectedTarget.lifecycleEligibility;
 assert.equal(Date.parse(x.inputs.record.review.reviewedAt),f.clock().now);
 assert.equal(x.inputs.package.version,'movement_railway_acquisition_input_review_v3');assert.equal(review.manifest.version,'movement_railway_identity_acquisition_auth_v4');
 assert.equal(eligibility.assertionKey,hash(canonical(x.inputs.record)));assert.equal(eligibility.subjectSha256,x.inputs.record.subjectSha256);
 assert.equal(Buffer.byteLength(canonical(x.inputs.record),'utf8')<=16384,true);assert.equal(Object.keys(f.auth.sourceHashes).length,13);
 for(const key of Reflect.ownKeys(f.auth))assert.doesNotMatch(String(key),/admission|assertion|carrier|clock|lifecycle.*(?:hook|state|map)|fence/i);
});

test('reviewedAt equal to trusted UTC passes and one millisecond in the future fails before authority',()=>{
 const equal=loadAcquisition(),a=candidate(equal);assert.doesNotThrow(()=>create(equal,a));
 const future=loadAcquisition(),b=candidate(future),now=future.clock().now;rewrite(future,b,r=>retime(r,now+1));
 reject(()=>create(future,b));assert.equal(future.timers.size,0);assert.equal(future.reads.length,0);assert.equal(future.opens.length,0);assert.equal(future.calls.length,0);
});

test('attemptReference accepts exactly 128, rejects 129, and preserves reverse-index collision denial',()=>{
 const pass=loadAcquisition(),a=candidate(pass);rewrite(pass,a,r=>{r.attemptReference='a'.repeat(128);});assert.doesNotThrow(()=>create(pass,a));
 const fail=loadAcquisition(),b=candidate(fail);rewrite(fail,b,r=>{r.attemptReference='b'.repeat(129);});reject(()=>create(fail,b));assert.equal(fail.timers.size,0);
 const f=loadAcquisition(),first=candidate(f),second=candidate(f),shared='c'.repeat(128);
 rewrite(f,first,r=>{r.attemptReference=shared;});const draft=create(f,first);
 rewrite(f,second,r=>{r.attemptReference=shared;r.review.evidenceReference='distinct reviewed evidence';});reject(()=>create(f,second));
 rewrite(f,first,()=>{});
 assert.doesNotThrow(()=>f.auth.reviewExecutableAcquisitionPackage(draft));
});

for(const mode of ['extra','missing','falseAck','sameReviewer','wrongExpiry','wrongSubject','wrongPolicy','badScope'])test('strict activation rejects '+mode+' before claim',()=>{
 const f=loadAcquisition(),x=candidate(f);rewrite(f,x,r=>{if(mode==='extra')r.extra=true;if(mode==='missing')delete r.review.acceptance;
  if(mode==='falseAck')r.operator.acknowledgements.currentlyAllocated=false;if(mode==='sameReviewer')r.review.reviewerReference=r.operator.reference;
  if(mode==='wrongExpiry')r.validity.expiresAt=new Date(Date.parse(r.validity.expiresAt)+1).toISOString();if(mode==='wrongSubject')r.subjectSha256='0'.repeat(64);
  if(mode==='wrongPolicy')r.policy.sha256='0'.repeat(64);if(mode==='badScope')r.validity.scope='many';});
 reject(()=>create(f,x));assert.equal(f.opens.length,0);assert.equal(f.reads.length,0);
});

test('duplicate JSON fields are rejected before admission',()=>{
 const f=loadAcquisition(),x=candidate(f),text=JSON.stringify(x.inputs.record).replace('"attemptReference":','"attemptReference":"duplicate","attemptReference":');
 f.drift.files.set(x.inputs.lifecyclePath,text);x.inputs.package.lifecycleReview.sha256=hash(text);const pkg=JSON.stringify(x.inputs.package)+'\n';f.drift.files.set(x.inputs.packagePath,pkg);x.inputs.descriptor.sha256=hash(pkg);
 reject(()=>create(f,x));
});

test('unseen claims once, cancellation closes idempotently, and no capability rearms',()=>{
 const f=loadAcquisition(),x=candidate(f),draft=create(f,x);reject(()=>create(f,x));
 assert.equal(f.auth.cancelExecutableAcquisitionDraft(draft).outcome,'ACQUISITION_CANCELLED');
 assert.equal(f.auth.cancelExecutableAcquisitionDraft(draft).outcome,'ACQUISITION_CANCELLED');
 reject(()=>f.auth.reviewExecutableAcquisitionPackage(draft));reject(()=>create(f,x));assert.equal(f.opens.length,0);
});

test('monotonic deadline closes while UTC-unexpired marker remains nonreusable',()=>{
 const f=loadAcquisition(),x=candidate(f),draft=create(f,x);f.advanceMono(1900000);
 reject(()=>f.auth.reviewExecutableAcquisitionPackage(draft));reject(()=>create(f,x));assert.equal(f.opens.length,0);
});

test('UTC rollback latches process fault and denies later fresh assertions',()=>{
 const f=loadAcquisition(),a=candidate(f);create(f,a);f.advanceUtc(10);const b=candidate(f);create(f,b);f.rewindUtc(20);
 const c=candidate(f);reject(()=>create(f,c));reject(()=>f.auth.reviewExecutableAcquisitionPackage(a.inputs));
});

test('capacity is exactly 64 and fails closed without eviction',()=>{
 const f=loadAcquisition();for(let i=0;i<64;i++){const x=candidate(f);create(f,x);}const last=candidate(f);reject(()=>create(f,last));assert.equal(f.opens.length,0);
});

test('one owner sweep tracks nearest closure, replaces earlier, ignores stale and early callbacks, and advances after delay',()=>{
 const f=loadAcquisition();f.advanceUtc(100000);const later=candidate(f),laterExpiry=Date.parse(later.inputs.record.validity.expiresAt),laterDraft=create(f,later);f.auth.cancelExecutableAcquisitionDraft(laterDraft);
 assert.equal(f.timers.size,1);const laterTimer=[...f.timers.values()][0];assert.equal(laterTimer.due,laterExpiry);
 const earlier=candidate(f),earlierReviewed=f.clock().now-100000;rewrite(f,earlier,r=>retime(r,earlierReviewed));const earlierExpiry=Date.parse(earlier.inputs.record.validity.expiresAt),earlierDraft=create(f,earlier);f.auth.cancelExecutableAcquisitionDraft(earlierDraft);
 assert.equal(f.timers.size,1);const earlierTimer=[...f.timers.values()][0];assert.notEqual(earlierTimer,laterTimer);assert.equal(earlierTimer.due,earlierExpiry);
 f.fireTimer(laterTimer);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0],earlierTimer);
 f.fireTimer(earlierTimer);assert.equal(f.timers.size,1);const rearmed=[...f.timers.values()][0];assert.equal(rearmed.due,earlierExpiry);
 f.elapse(earlierExpiry-f.clock().now);f.fireTimer(rearmed);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0].due,laterExpiry);
});

test('later closure never postpones owner sweep and active timers coexist without duplicate cleanup',()=>{
 const f=loadAcquisition(),first=candidate(f),firstExpiry=Date.parse(first.inputs.record.validity.expiresAt),d1=create(f,first);f.auth.cancelExecutableAcquisitionDraft(d1);
 const owner=[...f.timers.values()][0];f.advanceUtc(1000);const second=candidate(f),d2=create(f,second);assert.equal(f.timers.size,2);
 f.auth.cancelExecutableAcquisitionDraft(d2);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0],owner);assert.equal(owner.due,firstExpiry);
 f.auth.cancelExecutableAcquisitionDraft(d2);assert.equal(f.timers.size,1);assert.equal([...f.timers.values()][0],owner);
});

for(const mode of ['rollback','invalid'])test('owner sweep '+mode+' clock fault retains markers and remains latched',()=>{
 const f=loadAcquisition(),x=candidate(f),d=create(f,x);f.auth.cancelExecutableAcquisitionDraft(d);const fresh=candidate(f),timer=[...f.timers.values()][0];
 if(mode==='rollback')f.setUtc(f.clock().now-1);else f.setUtc(Number.NaN);f.fireTimer(timer);assert.equal(f.timers.size,0);
 reject(()=>create(f,fresh));reject(()=>create(f,x));
});

test('monotonic-only closure retains marker until UTC expiry and valid cleanup cannot rearm expired authority',()=>{
 const f=loadAcquisition(),x=candidate(f),expiry=Date.parse(x.inputs.record.validity.expiresAt),d=create(f,x);f.advanceMono(1800001);
 reject(()=>f.auth.reviewExecutableAcquisitionPackage(d));reject(()=>create(f,x));assert.equal(f.timers.size,1);
 const early=[...f.timers.values()][0];f.fireTimer(early);assert.equal(f.timers.size,1);
 f.advanceUtc(expiry-f.clock().now);const due=[...f.timers.values()][0];f.fireTimer(due);assert.equal(f.timers.size,0);reject(()=>create(f,x));
 const fresh=candidate(f);assert.doesNotThrow(()=>create(f,fresh));
});

test('64 closed markers retain capacity until UTC owner cleanup, then reverse indexes and capacity are released',()=>{
 const f=loadAcquisition(),references=[];for(let i=0;i<64;i++){const x=candidate(f);references.push(x.inputs.record.attemptReference);const d=create(f,x);f.auth.cancelExecutableAcquisitionDraft(d);}
 assert.equal(f.timers.size,1);reject(()=>create(f,candidate(f)));const timer=[...f.timers.values()][0];f.elapse(timer.due-f.clock().now);f.fireTimer(timer);assert.equal(f.timers.size,0);
 const fresh=candidate(f);rewrite(f,fresh,r=>{r.attemptReference=references[0];});assert.doesNotThrow(()=>create(f,fresh));
});

test('lazy owner-entry sweep frees expired markers when the owner callback is withheld and high-water survives empty cleanup',()=>{
 const f=loadAcquisition(),x=candidate(f),d=create(f,x);f.auth.cancelExecutableAcquisitionDraft(d);const prior=f.clock().now;f.timers.clear();f.advanceUtc(1800000);
 const fresh=candidate(f);assert.doesNotThrow(()=>create(f,fresh));f.setUtc(prior);reject(()=>create(f,candidate(f)));
});

test('raw and canonical activation bounds fail closed',()=>{
 const f=loadAcquisition(),x=candidate(f);rewrite(f,x,r=>{r.review.evidenceReference='x'.repeat(16000);});reject(()=>create(f,x));
 const y=candidate(f);const oversized=JSON.stringify(y.inputs.record)+' '.repeat(17000);f.drift.files.set(y.inputs.lifecyclePath,oversized);y.inputs.package.lifecycleReview.sha256=hash(oversized);
 const pkg=JSON.stringify(y.inputs.package)+'\n';f.drift.files.set(y.inputs.packagePath,pkg);y.inputs.descriptor.sha256=hash(pkg);reject(()=>create(f,y));
});

test('terminal acquisition result closes before release and stale handles deny authority',async()=>{
 const f=loadAcquisition(),a=f.authorized(),h=f.wrapper.beginAuthorizedAcquisition(a.ticket);f.wrapper.cancelAcquisition(h);
 reject(()=>f.wrapper.takePendingHumanReview(h));reject(()=>f.wrapper.beginAuthorizedAcquisition(a.ticket));assert.equal(f.contextRecord(f.opens[0]).closed,true);assert.equal(f.timers.size,1);
});
