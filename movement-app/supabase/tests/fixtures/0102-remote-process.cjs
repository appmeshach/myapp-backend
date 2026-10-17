'use strict';
// Local-only process driver. No custom domain or remote host is accepted.
const {start}=require('../../../scripts/assessment-worker/qualification-remote-process.cjs');
async function main(){
 const url=new URL(process.env.MOVEMENT_QUALIFICATION_SUPABASE_URL);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Local driver only');
 await start({config:{url:url.origin,secret:process.env.MOVEMENT_QUALIFICATION_SERVICE_ROLE_KEY}});
}
main().catch(()=>{process.stderr.write('Local qualification process unavailable\n');process.exitCode=1;if(process.connected)process.disconnect();});
