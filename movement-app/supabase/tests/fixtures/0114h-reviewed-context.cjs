'use strict';
// TEST ONLY. A separate VM owner model; never installed in normal modules.
const targets=require('../../../scripts/assessment-worker/qualification-railway-introspection-target.cjs');
function connect(module) {
 const permits=new WeakMap();
 module.exports._connectAcquisitionTargetConsumer((...args)=>{
  const e=permits.get(args[0]);if(!e)throw Error('Synthetic permit unavailable');permits.delete(args[0]);
  if(args.length!==2||args[1]!==e.binding)throw Error('Synthetic permit unavailable');return e.context;
 });
 const lifecycleCarrier=Object.freeze({check(){}});
 return (binding,name='myapp-backend')=>{const permit=Object.freeze({});permits.set(permit,{binding,context:Object.freeze({expectedTarget:Object.freeze({...targets.describeTarget(binding),serviceName:name}),manifestSha256:'a'.repeat(64),lifecycleCarrier})});return permit;};
}
module.exports={connect};
