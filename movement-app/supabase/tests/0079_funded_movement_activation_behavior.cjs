'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {fixtures:baseFixtures}=require('./0078_requester_movement_funding_hold_behavior.cjs');
const {inspect}=require('./0079_funded_movement_activation_harness.cjs');
const {query,snapshot}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8').replace(/\r\n/g,'\n');
const migration=read('../migrations/0079_funded_movement_activation.sql');
const migrationBody=migration.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'');
const live=read('0079_funded_movement_activation_test.sql');
function fixtures(zero=false) {
 let base=baseFixtures(zero);
 const start=base.indexOf("SELECT pg_temp.probe('legacy operational behavior retained outside financial cutover'");
 const end=base.indexOf("END $x$');",start);assert(start>=0&&end>start);
 let probe=base.slice(start,end);
 probe=probe.replace('DECLARE f record; r jsonb; BEGIN','DECLARE f record; r jsonb; a uuid; member_id uuid; submission uuid; media uuid; face uuid; payment uuid; BEGIN');
 probe+=`SELECT id INTO STRICT a FROM public.alignments WHERE movement_need_id=f.need;
 FOR member_id IN SELECT x.member_id FROM private.required_face_members(a) x LOOP
  submission:=public.create_profile_photo_submission_for_server(member_id,gen_random_uuid()::text||''/original.png'',''image/png'',128);
  media:=public.prepare_profile_photo_submission_for_server(submission,gen_random_uuid()::text||''/processed.png'');
  face:=public.start_alignment_face_verification_for_server(a,member_id,''legacy-0079'',gen_random_uuid()::text);
  PERFORM public.complete_alignment_face_verification_for_server(face,media,true,true);
 END LOOP;
 SELECT payment_id INTO payment FROM public.create_alignment_activation_payment(a,100,''NGN'',''legacy-0079'');
 PERFORM public.mark_alignment_activation_payment_succeeded(payment,''legacy-ref'');
 IF (SELECT status FROM public.alignments WHERE id=a)<>''activated'' OR (SELECT count(*) FROM public.journeys WHERE alignment_id=a)<>1
  OR (SELECT count(*) FROM private.post_activation_reveal_subjects(f.need,f.requester))<>1 THEN RAISE EXCEPTION ''Legacy activation regression''; END IF;
 `;
 base=base.slice(0,start)+probe+base.slice(end);
 return base+live.slice(0,live.indexOf('-- ACTIVATION_0079_TESTS:')).replace(/^BEGIN;/,'');
}
function main() {
 assert.equal(query('postgres',"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='0078';"),'1');
 const mode=inspect(query);
 console.log('0079 behavioral mode: '+mode+'; installed definitions checked against source');
 const before=query('postgres',snapshot);
 try {
  for(const zero of [false,true]) {
   const setup=mode==='source'?fixtures(zero).replace(/^BEGIN;/,()=> 'BEGIN;\n'+migrationBody):fixtures(zero);
   process.stdout.write(query('postgres',setup+live.slice(live.indexOf('-- ACTIVATION_0079_TESTS:')))+'\n');
   console.log('PASS 0079 behavioral variant zero='+zero);
  }
 } finally { assert.equal(query('postgres',snapshot),before,'0079 application data/catalog/ACL/history fully restored'); }
}
module.exports={fixtures,migrationBody};
if(require.main===module)try{main();}catch(e){console.error(e.stack);process.exitCode=1;}
