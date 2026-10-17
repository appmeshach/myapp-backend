'use strict';
const {assessmentResult}=require('../../supabase/functions/_shared/shared-segment-assessment-runtime.ts');
const reasons=['no_positive_support_on_reference_route','reverse_direction_only','ambiguous_traversal','below_positive_support_standard','unsupported_provider_contract','processing_limit','calculation_failed'];
function parseResult(value){
 const r=assessmentResult(value);
 if(r.reasons.some(v=>!reasons.includes(v))||r.supportIntervals.length>20000)throw Error('Invalid compute result');
 for(const key of ['ambiguityCount','sameDirectionCount','reverseDirectionCount','offererPointCount','requesterPointCount','workUnits'])
  if(!Number.isSafeInteger(r[key])||r[key]>1000000)throw Error('Invalid compute result');
 if(r.offererPointCount>20000||r.requesterPointCount>20000||r.sameDirectionCount>20000||r.offererFraction>1||r.requesterFraction>1)throw Error('Invalid compute result');
 for(const i of r.supportIntervals){
  if(!i||Object.keys(i).sort().join('|')!=='chain|offererEnd|offererStart|requesterEnd|requesterStart'
   ||!Number.isSafeInteger(i.chain)||i.chain<0||i.chain>20000
   ||['offererStart','offererEnd','requesterStart','requesterEnd'].some(k=>typeof i[k]!=='number'||!Number.isFinite(i[k])||i[k]<0)
   ||i.offererEnd<i.offererStart||i.requesterEnd<i.requesterStart)throw Error('Invalid compute result');
 }
 if(r.assessmentState==='complete'&&(r.inputState!=='ready'||r.geographicResult===null))throw Error('Invalid compute result');
 if(r.assessmentState!=='complete'&&r.geographicResult!==null)throw Error('Invalid compute result');
 if(r.assessmentState==='assessment_unavailable'&&(r.inputState!=='ready'||r.reasons.length!==1||!['processing_limit','calculation_failed'].includes(r.reasons[0])))throw Error('Invalid compute result');
 return r;
}
module.exports={parseResult};
