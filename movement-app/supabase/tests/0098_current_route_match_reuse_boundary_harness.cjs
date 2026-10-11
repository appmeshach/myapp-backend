'use strict';
// Inert imports; all database writes use disposable, fingerprinted local clones.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=require('./0097_shared_segment_assessment_reuse_boundary_harness.cjs');
const previous=require('./0095_requester_deadline_matching_context_repair_harness.cjs');
const {quote}=require('./0093_requester_route_generation_claim_boundary_harness.cjs');
const {routeMatchContextIdentity}=require('../functions/_shared/route-contracts.ts');
const {calculateTrustedRouteMatchGeometry}=require('../functions/_shared/route-match-geometry.ts');
const read=n=>fs.readFileSync(path.join(__dirname,n),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0098_current_route_match_reuse_boundary.sql');
async function run(callback){await base.run(async c=>{c.target(migration);verify(c);await callback(c);});}
function verify(c){
 for(const m of migration.matchAll(/CREATE FUNCTION (public\.\w+)\([^]*?AS \$\$([^]*?)\$\$;/g)){
  const v=JSON.parse(c.target(`SELECT json_build_object('body',p.prosrc,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname||'.'||p.proname='${m[1]}';`));
  assert.equal(v.body.replace(/\r\n/g,'\n'),m[2]);assert.equal(v.owner,'postgres');assert(v.definer);assert.deepEqual(v.config,['search_path=""']);assert.deepEqual(v.acl,['postgres=X/postgres','service_role=X/postgres']);
 }
 for(const [file,name] of [['0082_trusted_temporal_evidence_hardening.sql','record_trusted_route_match_evidence_for_server'],['0046_requester_availability_matching_context.sql','get_requester_availability_matching_context_for_server']]){
  const sql=read('../migrations/'+file),m=sql.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION\\s+public\\.'+name+'\\s*\\([^]*?AS (\\$\\w*\\$)([^]*?)\\1;'));
  assert(m,'effective source '+name);
  assert.equal(c.target(`SELECT prosrc FROM pg_proc WHERE proname='${name}' AND pronamespace='public'::regnamespace;`).replace(/\r\n/g,'\n').trim(),m[2].trim());
 }
 console.log('PASS installed 0098 exact bodies, owners, service-only ACLs and empty search_path');
 console.log('PASS installed effective 0082 writer and 0046 authorization bodies unchanged');
}
const fixture=previous.matchingFixture;
const lookup=(f,expected)=>`SELECT public.get_current_requester_availability_route_match_for_server('${f.requester}','${f.need}','${f.availability}'${expected?','+quote(JSON.stringify(expected))+'::jsonb':''});`;
function context(c,f){
 const v=JSON.parse(c.target(`SELECT row_to_json(c) FROM public.get_requester_availability_matching_context_for_server('${f.requester}','${f.need}','${f.availability}') c;`));
 const result={};for(const [k,val] of Object.entries(v))result[k.replace(/_([a-z])/g,(_,x)=>x.toUpperCase())]=val;
 result.requesterOrigin={latitude:Number(v.requester_origin_latitude),longitude:Number(v.requester_origin_longitude)};
 result.requesterDestination={latitude:Number(v.requester_destination_latitude),longitude:Number(v.requester_destination_longitude)};
 return result;
}
function payload(c,f){const s=context(c,f),g=calculateTrustedRouteMatchGeometry(s);return {identity:routeMatchContextIdentity(s,f.availability),payload:{
 movementNeedId:f.need,offeringMovementIntentId:f.intent,expectedRouteEvidenceId:s.routeEvidenceId,expectedRouteEvidenceVersion:s.routeEvidenceVersion,
 requesterOriginDistanceToRouteMeters:g.requesterOrigin.distanceToRouteMeters,requesterDestinationDistanceToRouteMeters:g.requesterDestination.distanceToRouteMeters,
 calculatedRouteShapeLengthMeters:g.calculatedRouteShapeLengthMeters,requesterOriginPositionAlongRouteMeters:g.requesterOrigin.positionAlongRouteMeters,
 requesterDestinationPositionAlongRouteMeters:g.requesterDestination.positionAlongRouteMeters,
 requesterOriginClosestRoute:g.requesterOrigin.closestRoutePoint,requesterDestinationClosestRoute:g.requesterDestination.closestRoutePoint,
 calculatedAt:new Date().toISOString(),expiresAt:null}};}
const publish=(f,s)=>`SELECT public.publish_requester_availability_route_match_for_server('${f.requester}','${f.need}','${f.availability}',${quote(JSON.stringify(s.identity))}::jsonb,${quote(JSON.stringify(s.payload))}::jsonb);`;
function normalize(v){if(v.state==='reuse_existing'){v.payload.calculatedAt=new Date(v.payload.calculatedAt).toISOString();if(v.evidence.routeMatchEvidenceExpiresAt)v.evidence.routeMatchEvidenceExpiresAt=new Date(v.evidence.routeMatchEvidenceExpiresAt).toISOString();}return v;}
function backend(c,f){return {
 authenticate:async()=>f.requester,memberExists:async()=>true,
 getRequesterAvailabilityMatchingContext:async()=>context(c,f),
 getCurrentRequesterAvailabilityRouteMatch:async(_m,_n,_a,_signal,expected)=>normalize(JSON.parse(c.target(lookup(f,expected)))),
 publishRequesterAvailabilityRouteMatch:async(_m,_n,_a,identity,payload)=>normalize(JSON.parse(c.target(publish(f,{identity,payload})))),
};}
async function main(){let count=0;await run(async c=>{
 const check=(label,fn)=>{fn();count++;console.log('PASS '+label);};
 const sql=c.target(read('0098_current_route_match_reuse_boundary_test.sql'));assert.doesNotMatch(sql,/\|f(?:\||$)/m);console.log(sql);
 const f=fixture(c),s=payload(c,f);
 check('authorized pair miss',()=>assert.equal(JSON.parse(c.target(lookup(f))).state,'not_found'));
 const tables=JSON.parse(c.target("SELECT json_agg(n.nspname||'.'||t.relname ORDER BY n.nspname,t.relname) FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname IN ('public','private') AND t.relkind='r' AND t.relname<>'trusted_route_match_evidence';"));
 const snap=()=>c.target("SELECT md5(string_agg(x::text,'|' ORDER BY x::text)) FROM ("+tables.map(table=>`SELECT jsonb_build_object('table','${table}','row',to_jsonb(t)) x FROM ${table} t`).join(' UNION ALL ')+") q;");
 const before=snap();
 const first=normalize(JSON.parse(c.target(publish(f,s))));
 check('publication leaves every other application table unchanged',()=>assert.equal(snap(),before));
 check('current identity and exact canonical payload',()=>{assert.equal(first.state,'reuse_existing');assert.deepEqual(first.identity,s.identity);assert.deepEqual(first.payload,s.payload);});
 check('SQL recovery validates exact frozen payload',()=>assert.equal(JSON.parse(c.target(lookup(f,s.payload))).state,'reuse_existing'));
 check('SQL recovery rejects a different exact numeric value',()=>{
  const expected=JSON.stringify(s.payload).replace('"requesterOriginClosestRoute":{"latitude":6.43', '"requesterOriginClosestRoute":{"latitude":6.43000000000000000001');
  assert.notEqual(expected,JSON.stringify(s.payload));
  assert.equal(JSON.parse(c.target(`SELECT public.get_current_requester_availability_route_match_for_server('${f.requester}','${f.need}','${f.availability}',${quote(expected)}::jsonb);`)).state,'not_found');
 });
 check('SQL recovery rejects different derived expiry',()=>{
  const got=c.target(`BEGIN; ALTER TABLE private.trusted_route_match_evidence DISABLE TRIGGER USER;
   UPDATE private.trusted_route_match_evidence SET expires_at=clock_timestamp()+interval '5 minutes' WHERE id='${first.evidence.routeMatchEvidenceId}';
   ${lookup(f,s.payload)} ROLLBACK;`);
  assert.equal(JSON.parse(got).state,'not_found');
 });
 check('current reuse preserves canonical timestamp and row count',()=>{assert.deepEqual(normalize(JSON.parse(c.target(lookup(f)))),first);assert.equal(c.target(`SELECT count(*) FROM private.trusted_route_match_evidence WHERE movement_need_id='${f.need}';`),'1');});
 check('reused evidence authorizes the unchanged explicit interest RPC',()=>{
  const capacity=c.target(`SELECT remaining_places FROM private.offering_movement_availability WHERE id='${f.availability}';`);
  const interest=JSON.parse(c.target(`SET request.jwt.claim.sub='${f.requester}'; SET ROLE authenticated;
   SELECT row_to_json(i) FROM public.create_requester_movement_interest(gen_random_uuid(),'${f.need}','${f.availability}','${first.evidence.routeMatchEvidenceId}') i;`));
  assert.equal(interest.interest_status,'active');
  assert.equal(c.target(`SELECT route_match_evidence_id FROM private.requester_movement_interests WHERE id='${interest.interest_id}';`),first.evidence.routeMatchEvidenceId);
  assert.equal(c.target(`SELECT remaining_places FROM private.offering_movement_availability WHERE id='${f.availability}';`),capacity);
 });
 check('concurrent current-use may retain winner timestamp',()=>{const next={...s,payload:{...s.payload,calculatedAt:new Date().toISOString()}};assert.deepEqual(normalize(JSON.parse(c.target(publish(f,next)))),first);});
 check('different computed result rejected',()=>assert.throws(()=>c.target(publish(f,{...s,payload:{...s.payload,requesterOriginDistanceToRouteMeters:s.payload.requesterOriginDistanceToRouteMeters+1}})),/23514/));
 check('noncanonical first publication rolls back entirely',()=>{
  const x=fixture(c),v=payload(c,x);assert.throws(()=>c.target(publish(x,{...v,payload:{...v.payload,extra:true}})),/23514/);
  assert.equal(c.target(`SELECT count(*) FROM private.trusted_route_match_evidence WHERE movement_need_id='${x.need}';`),'0');
 });
 check('changed current need lifecycle prevents reuse',()=>assert.throws(()=>c.target(`BEGIN; UPDATE public.movement_needs SET status='paused' WHERE id='${f.need}'; ${lookup(f)} ROLLBACK;`),/23514/));
 check('new movement need never reuses another need evidence',()=>{const x=fixture(c);assert.equal(JSON.parse(c.target(lookup(x))).state,'not_found');});
 for(const role of ['anon','authenticated'])check(role+' denied both RPCs',()=>{assert.throws(()=>c.target('SET ROLE '+role+'; '+lookup(f)),/42501/);assert.throws(()=>c.target('SET ROLE '+role+'; '+publish(f,s)),/42501/);});
 check('service only lookup succeeds',()=>assert.equal(JSON.parse(c.target('SET ROLE service_role; '+lookup(f))).state,'reuse_existing'));
 check('wrong requester denied',()=>assert.throws(()=>c.target(lookup({...f,requester:f.offerer})),/42501/));
 check('different availability never cross-binds evidence',()=>{const other=fixture(c);assert.equal(JSON.parse(c.target(lookup({...f,availability:other.availability}))).state,'not_found');});
 const otherEndpoints=payload(c,fixture(c));
 for(const [label,column,value] of [['route version','route_evidence_version','2'],['endpoint binding','requester_origin_location_reference_id',`'${otherEndpoints.identity.requesterOriginLocationReferenceId}'`],['historical status','status',"'superseded'"],['expired evidence','expires_at',"clock_timestamp()-interval '1 second'"]]){
  check(label+' cannot reuse',()=>{const extra=label==='expired evidence'?`UPDATE private.trusted_route_match_evidence SET calculated_at=created_at-interval '2 seconds' WHERE id='${first.evidence.routeMatchEvidenceId}';`:'';
   const got=c.target(`BEGIN; ALTER TABLE private.trusted_route_match_evidence DISABLE TRIGGER USER; ${extra} UPDATE private.trusted_route_match_evidence SET ${column}=${value} WHERE id='${first.evidence.routeMatchEvidenceId}'; ${lookup(f)} ROLLBACK;`);assert.equal(JSON.parse(got).state,'not_found');});
 }
 // Real SQL-backed HTTP requests, including commit followed by lost response.
 const {createRouteMatchHandler}=require('../functions/_shared/route-match-orchestration.ts');
 const request=f=>new Request('https://edge.invalid/calculate-route-match',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({movementNeedId:f.need,availabilityId:f.availability})});
 const fresh=fixture(c),db=backend(c,fresh);let computations=0,writes=0,frozen;
 const publishReal=db.publishRequesterAvailabilityRouteMatch;db.publishRequesterAvailabilityRouteMatch=async(...args)=>{writes++;frozen=args[4];return publishReal(...args);};
 const handler=createRouteMatchHandler(db,input=>{computations++;return calculateTrustedRouteMatchGeometry(input);});
 const a=await handler(request(fresh)),aBody=await a.json();assert.equal(a.status,200);
 const b=await handler(request(fresh));assert.equal(b.status,200);assert.deepEqual(await b.json(),aBody);assert.equal(computations,1);assert.equal(writes,1);count++;console.log('PASS real HTTP repeat: second calculation 0, second publication 0, stable six-field response');
 const lost=fixture(c),lostDb=backend(c,lost);computations=0;writes=0;
 const real=lostDb.publishRequesterAvailabilityRouteMatch;lostDb.publishRequesterAvailabilityRouteMatch=async(...args)=>{writes++;frozen=args[4];await real(...args);throw Error('response lost after COMMIT');};
 const recovered=await createRouteMatchHandler(lostDb,input=>{computations++;return calculateTrustedRouteMatchGeometry(input);})(request(lost));assert.equal(recovered.status,200);assert.equal(writes,1);assert.equal(computations,1);assert.deepEqual(normalize(JSON.parse(c.target(lookup(lost)))).payload,frozen);count++;console.log('PASS real committed publication with lost response recovered exactly once');
 const mismatch=fixture(c),bad=backend(c,mismatch),realBad=bad.publishRequesterAvailabilityRouteMatch;
 bad.publishRequesterAvailabilityRouteMatch=async(...args)=>{args[4]={...args[4],calculatedAt:new Date(Date.parse(args[4].calculatedAt)-1).toISOString()};await realBad(...args);throw Error('uncertain');};
 assert.equal((await createRouteMatchHandler(bad)(request(mismatch))).status,503);count++;console.log('PASS uncertain response with different canonical timestamp fails closed');
 for(const mode of ['geometry','context']){
  const x=fixture(c),d=backend(c,x),publishReal=d.publishRequesterAvailabilityRouteMatch;let computations=0,publications=0;
  d.publishRequesterAvailabilityRouteMatch=async(...args)=>{
   publications++;
   if(mode==='geometry')args[4]={...args[4],requesterOriginDistanceToRouteMeters:args[4].requesterOriginDistanceToRouteMeters+1};
   await publishReal(...args);
   if(mode==='context')c.target(`UPDATE public.movement_needs SET status='paused' WHERE id='${x.need}';`);
   throw Error('lost after commit');
  };
  const result=await createRouteMatchHandler(d,input=>{computations++;return calculateTrustedRouteMatchGeometry(input);})(request(x));
  assert.equal(result.status,503);assert.equal(computations,1);assert.equal(publications,1);count++;console.log('PASS real uncertain response with different '+mode+' fails closed without recalculate');
 }
 });console.log(`0098 focused SQL/HTTP behavior: ${count}/${count} passed`);}
module.exports={run,verify,fixture,lookup,context,payload,publish,backend,normalize,main};if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1;});
