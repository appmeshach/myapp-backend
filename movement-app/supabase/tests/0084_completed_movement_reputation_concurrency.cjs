'use strict';
const assert=require('node:assert/strict');
const {run}=require('./0084_completed_movement_reputation_harness.cjs');
async function main(){await run(async c=>{
 let scenarios=0;
 const facts=(f,n,rating)=>{
  assert.equal(c.target(`SELECT count(*) FROM private.completed_movement_ratings WHERE reviewed_member_id='${f.offerer}';`),String(n));
  assert.equal(c.target(`SELECT rating FROM public.members WHERE id='${f.offerer}';`),rating);
  c.target(`SELECT private.assert_funded_coordination_entry('${f.alignment}');`);
 };
 const safe=(...sessions)=>{assert.doesNotMatch(sessions.map(s=>s.err).join('\n'),/ERROR|40P01|deadlock|timeout/i);sessions.forEach(s=>s.close());};
 for(const rollback of [false,true]){
  const f=c.fresh(),a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
  await a.send(c.rate(f,5));const wait=b.send(c.rate(f,5));await c.blocked(a,b);await a.send(rollback?'ROLLBACK;':'COMMIT;');await wait;await b.send('COMMIT;');
  facts(f,1,'5.00');safe(a,b);scenarios++;console.log('PASS duplicate rating rollback='+rollback+'; one receipt, actual blocking');
 }
 const f=c.fresh(),g=c.fresh({offerer:f.offerer}),h=c.fresh({offerer:f.offerer});
 c.target('BEGIN; '+c.rate(f,1)+' COMMIT;');
 const a=new c.Session(),b=new c.Session();await a.begin();await b.begin();
 await a.send(c.rate(g,2));const wait=b.send(c.rate(h,2));await c.blocked(a,b);await a.send('COMMIT;');await wait;await b.send('COMMIT;');
 facts(f,3,'1.67');assert.equal(c.target(`SELECT completed_movements FROM public.members WHERE id='${f.offerer}';`),'3');safe(a,b);scenarios++;console.log('PASS distinct reviewers/shared member; no lost update, exact rounding, actual blocking');
 const k=c.fresh();const x=new c.Session(),y=new c.Session();await x.begin();await y.begin();
 await x.send(c.rate(k,4));const reciprocal=y.send(c.rate(k,3,k.offerer));await c.blocked(x,y);await x.send('COMMIT;');await reciprocal;await y.send('COMMIT;');safe(x,y);scenarios++;console.log('PASS reciprocal ratings deterministic locks, actual blocking');
 const before=c.target(`SELECT ${f.schema}.materialization_sources();`);
 c.target('BEGIN; '+c.rate(f,1)+' COMMIT;');assert.equal(c.target(`SELECT ${f.schema}.materialization_sources();`),before,'Replay no data writes');
 const n=c.fresh();c.target('BEGIN; '+c.rate(n,3)+' ROLLBACK;');facts(n,0,'');scenarios++;console.log('PASS rollback receipt/aggregate consistent and replay zero writes');
 for(let i=0;i<5;i++){
  const left=c.fresh({offerer:f.offerer}),right=c.fresh({offerer:f.offerer}),s=new c.Session(),t=new c.Session();await s.begin();await t.begin();
  await s.send(c.rate(left,1));const pending=t.send(c.rate(right,5));await c.blocked(s,t);await s.send('COMMIT;');await pending;await t.send('COMMIT;');safe(s,t);
  const count=3+2*(i+1),sum=5+6*(i+1);facts(f,count,(Math.round(sum/count*100)/100).toFixed(2));scenarios++;console.log('PASS shared member stress '+(i+1)+'; actual blocking, aggregate reconciled');
 }
 const completing=c.fresh({complete:false});
 c.target('BEGIN; '+c.as(completing,completing.offerer,`SELECT * FROM public.request_my_funded_movement_completion('${completing.need}');`)+' COMMIT;');
 const owner=new c.Session(),rating=new c.Session();await owner.begin();await rating.begin();
 await owner.send(c.as(completing,completing.requester,`SELECT * FROM public.confirm_my_funded_movement_completion('${completing.need}');`));
 const afterCompletion=rating.send(c.rate(completing,4));await c.blocked(owner,rating);
 assert.equal(c.target(`SELECT completed_movements FROM public.members WHERE id='${completing.offerer}';`),'0');
 await owner.send('COMMIT;');await afterCompletion;await rating.send('COMMIT;');facts(completing,1,'4.00');safe(owner,rating);scenarios++;
 console.log('PASS rating waits exact completion commit; no pre-completion count/rating');
 assert.equal(c.target('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'),'0');
 console.log(`PASS ${scenarios} reputation scenarios; ${c.proofs()} actual blocking proofs; no deadlock`);
 });}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={main};
