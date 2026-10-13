'use strict';
// Supplied official documentation facts, not observed provider evidence.
// No environment value reader, credential storage, header bag or live executor.
const context = require('./qualification-railway-project-token-context.cjs');
context.buildRequest(); // Fail initialization if the reviewed context document drifts.
const freeze = value => {
 if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
 return value;
};
const contract = freeze({
 endpoint: 'https://backboard.railway.com/graphql/v2', method: 'POST', contentType: 'application/json',
 preferredAuthKind: 'project_token', directAuthHeaderName: 'Project-Access-Token', operatorEnvironmentVariableName: 'RAILWAY_TOKEN',
 allowedHeaderNames: ['Content-Type', 'Project-Access-Token'], broaderTokensSupported: false,
 rejectedEnvironmentVariableNames: ['RAILWAY_API_TOKEN'], interactiveCliAuthenticationSupported: false,
 requestBodyKeys: ['query', 'operationName', 'variables'],
 evidenceSource: 'official_current_Railway_facts_supplied_in_0108_request',
 transportContractReady: true, providerContextAttestationReady: true,
 providerContextObserved: false, projectEnvironmentContextProven: false, serviceContextProven: false,
 serviceBindingRequiredForSchemaIntrospection: false,
 liveExecutorImplemented: false, authenticatedResultMintingImplemented: false,
 executionSchemaReady: false, identity_proven: null, causality_proven: null,
 restart_origin_proven: null, platformRestart: null,
 restartAttribution: { measurement: null, limitation: 'restart_origin_unattributable' },
 futureAdapterInterface: 'executeFixedReadonlyRailwayRequest({privatePermit,privateTarget,requestKind})',
 futureResultBinding: {
  storage: 'private_adapter_WeakMap', publicConstructor: false, serializedInputAccepted: false,
  requiredBindings: ['original_consumed_permit', 'original_target_object', 'immutable_request', 'fixed_endpoint',
   'project_token_auth_kind', 'successful_same_auth_context_attestation', 'body_from_exact_invocation'],
  permittedRequestKinds: ['project_token_context', 'schema_introspection'],
  promotionFromCallerBody: false,
 },
});
function assertTokenSource(...args) {
 const fail = () => { throw Error('Railway token source contract unavailable'); };
 if (args.length !== 1) fail();
 const selection = args[0];
 if (!selection || typeof selection !== 'object' || Array.isArray(selection) ||
  Object.keys(selection).sort().join('|') !== 'authKind|environmentVariableNames') fail();
 if (selection.authKind !== 'project_token' || !Array.isArray(selection.environmentVariableNames) ||
  selection.environmentVariableNames.length !== 1 || selection.environmentVariableNames[0] !== 'RAILWAY_TOKEN') fail();
 // This validates names/selection only. It never reads an environment or token.
 return freeze({ authKind: 'project_token', environmentVariableName: 'RAILWAY_TOKEN', headerName: 'Project-Access-Token' });
}
module.exports = Object.freeze({ contract, assertTokenSource });
