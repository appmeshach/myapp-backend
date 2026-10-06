'use strict';
const {query}=require('./0074_trusted_financial_proposal_issuer_behavior.cjs');
const sql=`BEGIN READ ONLY;
SELECT jsonb_build_object(
 'reviews',(SELECT count(*) FROM public.journey_reviews),
 'members',(SELECT count(*) FROM public.members),
 'nonzero_counts',(SELECT count(*) FROM public.members WHERE completed_movements<>0),
 'nonnull_rating',(SELECT count(*) FROM public.members WHERE rating IS NOT NULL),
 'completions',(SELECT count(*) FROM private.funded_movement_completions),
 'history',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version>='0082'),
 'aggregate_triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid)) FROM pg_trigger t WHERE t.tgrelid='public.members'::regclass AND NOT t.tgisinternal));
ROLLBACK;`;
if(require.main===module)console.log(query('postgres',sql));
module.exports={sql};
