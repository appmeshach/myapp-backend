'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const files={79:'0079_funded_movement_activation.sql',80:'0080_funded_movement_coordination_entry.sql',81:'0081_financial_movement_start.sql',82:'0082_trusted_temporal_evidence_hardening.sql',83:'0083_financial_movement_completion.sql'};
const source=v=>fs.readFileSync(path.join(__dirname,'../migrations',files[v]),'utf8').replace(/\r\n/g,'\n');
function definitions(version){
 return [...source(version).matchAll(/CREATE(?: OR REPLACE)? FUNCTION (\w+\.\w+)\(([^]*?)\)\s*RETURNS ([^]*?)\s*LANGUAGE (sql|plpgsql)\s*([^]*?)AS (\$\w*\$)([^]*?)\6/g)].map(m=>{
  assert.match(m[5],/SECURITY DEFINER/);assert.match(m[5],/SET\s+search_path\s*(?:=|TO)\s*''/);
  return {name:m[1],args:m[2],result:m[3],language:m[4],volatility:/\bSTABLE\b/.test(m[5])?'s':/\bIMMUTABLE\b/.test(m[5])?'i':'v',body:m[7],ownerVersion:version};
 });
}
function compose(original,version){
 const latest=new Map(original.map(e=>[e.name,{...e,ownerVersion:version}]));
 for(let v=version+1;v<=83;v++)for(const e of definitions(v))if(latest.has(e.name))latest.set(e.name,e);
 return original.map(e=>latest.get(e.name));
}
function finalSourceBody(version){return Array.from({length:84-version},(_,i)=>source(version+i).replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')).join('\n');}
function normalizeSignature(value){
 // pg_get_functiondef may omit public row-type qualification; catalog queries
 // under search_path='' print it explicitly. Keep every other schema distinct.
 return value.toLowerCase().replace(/\bpublic\.(alignments|journeys)\b/g,'$1').replace(/timestamp with time zone/g,'timestamptz').replace(/::(?:integer|bigint|text|boolean)/g,'').replace(/\s+/g,'').trim();
}
function assertFinalInstalled(query,database,version){
 for(let v=version+1;v<=83;v++)assert.equal(query(database,"SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='"+String(v).padStart(4,'0')+"';"),'1','Final catalog requires installed '+v+'; no automatic source replacement');
 assert.equal(query(database,"SELECT to_regclass('private.alignment_face_attempt_ordinal_seq') IS NOT NULL AND to_regclass('private.funded_movement_completion_requests') IS NOT NULL AND to_regclass('private.funded_movement_completions') IS NOT NULL;"),'t','Incomplete final 0082/0083 structures');
}
module.exports={definitions,compose,finalSourceBody,assertFinalInstalled,normalizeSignature};
