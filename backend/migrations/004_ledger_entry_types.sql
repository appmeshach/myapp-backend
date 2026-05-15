-- 004_ledger_entry_types.sql
-- Make ledger_entries.entry_type allowed values explicit and correct.

-- Drop the old constraint if it exists (safe to run multiple times)
ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;

-- Add the correct constraint
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_entry_type_check
  CHECK (entry_type IN (
    'ESCROW_LOCK',
    'SELLER_CREDIT',
    'PLATFORM_FEE_CREDIT',
    'BUYER_REFUND'
  ));