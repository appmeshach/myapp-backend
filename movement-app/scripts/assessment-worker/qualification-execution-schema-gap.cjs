'use strict';
// Local evidence inventory only. Field names are not a GraphQL type definition.
const {STATUSES}=require('./qualification-execution-reader.cjs');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
module.exports=freeze({
 decision:'insufficient',queryImplemented:false,
 sources:['docs/0104-qualification-child-and-provider-adapters.md','scripts/assessment-worker/qualification-railway-evidence.cjs','scripts/assessment-worker/qualification-execution-reader.cjs'],
 known:{fieldName:'deploymentInstanceExecutions',serviceInstanceFields:['id','environmentId','serviceId','serviceName','region','restartPolicyMaxRetries','restartPolicyType','latestDeployment'],restartPolicies:['ALWAYS','NEVER','ON_FAILURE'],executionFields:['id','deploymentId','createdAt','updatedAt','completedAt','status','deploymentMeta'],statuses:STATUSES},
 missing:['parent type','argument names, types and requiredness','input object name and field names/types/nullability','output type and nullability','wrapper/connection/edge/node/pageInfo structure','pagination arguments and cursor semantics','service/environment/deployment filters and scope','ordering semantics','complete unambiguous selection rules'],
 runtime:{supportedImmutableVariableNames:[],identityProven:null,limitation:'runtime_identity_provenance_unresolved'},
});
