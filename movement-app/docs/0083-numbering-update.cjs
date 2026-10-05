'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const files=['tests/trustedTemporalEvidenceHardening.test.cjs','tests/temporalHardeningAudit.test.cjs','supabase/tests/financial_proposal.test.cjs','supabase/tests/financial_agreement.test.cjs','supabase/tests/0082_financial_movement_completion_harness.cjs','supabase/tests/0082_financial_movement_completion_behavior.cjs','supabase/tests/movement_context.test.cjs','tests/financialMovementCompletion.test.cjs','docs/0082-temporal-focused-audit.cjs','docs/0082-temporal-external-model.cjs','docs/0082-client-validation.cjs','docs/0082-temporal-validation.cjs'];
for(const file of files){const before=fs.readFileSync(file,'utf8');fs.writeFileSync(file,before.replaceAll('0082_financial_movement_completion.sql','0083_financial_movement_completion.sql'));}
const harness='supabase/tests/0082_financial_movement_completion_harness.cjs';
fs.writeFileSync(harness,fs.readFileSync(harness,'utf8').replaceAll('Installed 0082','Installed 0083').replaceAll('Incomplete 0082','Incomplete 0083').replace("version='0082'","version='0083'"));
const test='tests/financialMovementCompletion.test.cjs';fs.writeFileSync(test,fs.readFileSync(test,'utf8').replaceAll('Installed 0082','Installed 0083').replaceAll('Incomplete 0082','Incomplete 0083'));
const context=fs.readFileSync('supabase/tests/movement_context.test.cjs','utf8').replace(/\r\n/g,'\n');
const pin='supabase/tests/0048_offerer_interest_inbox.test.cjs';
fs.writeFileSync(pin,fs.readFileSync(pin,'utf8').replace('72fb74aaeea535e3f86bd1f596f6b465c060b7cdfff4919532082cade568b91e',crypto.createHash('sha256').update(context).digest('hex')));
console.log(files.concat(pin).join('\n'));
