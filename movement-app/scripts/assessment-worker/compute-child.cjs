'use strict';
// Credential-free compute process. No database/provider modules or identifiers.
const {assessSharedSegment}=require('../../supabase/functions/_shared/shared-segment-assessment-geometry.ts');
let received=false;
process.on('message',input=>{
 if(received||!input||Object.keys(input).sort().join('|')!=='offerer_shape|requester_shape')process.exit(2);
 received=true;
 const started=performance.now(),cpu=process.cpuUsage();
 const shapes=/** @type {{offerer_shape:unknown,requester_shape:unknown}} */(input);
 const result=assessSharedSegment(shapes.offerer_shape,shapes.requester_shape);
 const used=process.cpuUsage(cpu);
 // Separate, bounded diagnostic channel; the IPC response is AssessmentResult only.
 process.stderr.write(JSON.stringify({computeMs:performance.now()-started,cpuMs:(used.user+used.system)/1000,
  peakRssBytes:process.resourceUsage().maxRSS*1024})+'\n');
 process.send(result,error=>{process.exit(error?2:0);});
});
