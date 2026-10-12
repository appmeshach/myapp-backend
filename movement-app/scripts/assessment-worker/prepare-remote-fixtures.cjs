'use strict';
// Explicit operator fixture step; no hosted-worker Postgres admin credential.
const fs=require('node:fs'),path=require('node:path');
const schema=require('./qualify-remote-schema.cjs');
const {configuration,WARNING,seal,open}=require('./qualification-remote.cjs');
function main(args=process.argv.slice(2),env=process.env){
 if(args.length!==3||args[0]!=='--ack-disposable-environment'||args[1]!=='--output'||!args[2])throw Error('Fixture arguments unavailable');
 const config=configuration(env,true),pg=schema.postgresConfiguration(env,config),key=env.MOVEMENT_QUALIFICATION_FIXTURE_KEY;
 // Check all local output/key preconditions before the read-only DB preflight.
 if(!/^[a-f0-9]{64}$/.test(key||''))throw Error('Fixture key unavailable');
 const file=path.resolve(args[2]),fd=fs.openSync(file,'wx',0o600);
 try{
  schema.verifyCatalog(schema.psql(schema.catalogSql(),pg));process.stderr.write(WARNING);
  const pairs=schema.psql(schema.fixtureSql(),pg),value={version:'0102',createdAt:new Date().toISOString(),projectRefHash:config.projectRefHash,migrationDigest:schema.migrationDigest(),pairs};
  const capsule=seal(value,key);open(capsule,key,config.projectRefHash);fs.writeFileSync(fd,capsule+'\n');
  process.stdout.write('Synthetic fixture capsule prepared. ENVIRONMENT TEARDOWN REQUIRED.\n');
 }finally{fs.closeSync(fd);}
}
module.exports={main};if(require.main===module)try{main();}catch{process.stderr.write('Fixture preparation unavailable; inspect only on the operator workstation. ENVIRONMENT TEARDOWN REQUIRED if writes began.\n');process.exitCode=1;}
