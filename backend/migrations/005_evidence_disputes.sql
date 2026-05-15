-- 1) Evidence table (metadata only in V1)
CREATE TABLE IF NOT EXISTS order_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  uploaded_by text NOT NULL CHECK (uploaded_by IN ('BUYER','SELLER','RIDER','ADMIN')),
  media_type text NOT NULL CHECK (media_type IN ('IMAGE','VIDEO')),
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_evidence_order_id ON order_evidence(order_id);

-- 2) Disputes table
CREATE TABLE IF NOT EXISTS disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  reason_code text NOT NULL CHECK (reason_code IN (
    'ITEM_DAMAGED',
    'ITEM_DEFECTIVE',
    'ITEM_NOT_AS_DESCRIBED',
    'WRONG_VARIANT'
  )),
  status text NOT NULL CHECK (status IN ('OPEN','RESOLVED','ESCALATED_ADMIN')) DEFAULT 'OPEN',
  decision text NULL CHECK (decision IN ('REFUND','REJECT','UPGRADE','ADMIN_REQUIRED')),
  fault_attribution text NULL CHECK (fault_attribution IN ('SELLER','BUYER','DELIVERY','UNCLEAR')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);

-- 3) Extend ledger entry types to include BUYER_REFUND
ALTER TABLE ledger_entries
DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;

ALTER TABLE ledger_entries
ADD CONSTRAINT ledger_entries_entry_type_check
CHECK (entry_type IN (
  'ESCROW_LOCK',
  'SELLER_CREDIT',
  'PLATFORM_FEE_CREDIT',
  'BUYER_REFUND'
));