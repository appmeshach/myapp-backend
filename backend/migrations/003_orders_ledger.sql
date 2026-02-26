-- 003_orders_ledger.sql
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_user_id UUID NOT NULL REFERENCES users(id),
  store_id UUID NOT NULL REFERENCES stores(id),
  state TEXT NOT NULL CHECK (state IN (
    'CREATED','PAID','ESCROW_LOCKED','HANDOVER_TO_RIDER','IN_TRANSIT','DELIVERED',
    'INSPECTION_ACTIVE','DISPUTE_OPENED','RETURN_IN_PROGRESS','SETTLED','REFUNDED',
    'CANCELLED_SELLER','CANCELLED_ADMIN'
  )),
  item_count INT NOT NULL DEFAULT 1 CHECK (item_count > 0),
  inspection_seconds INT,
  inspection_expires_at TIMESTAMPTZ,
  total_amount_kobo BIGINT NOT NULL CHECK (total_amount_kobo >= 0),
  delivery_fee_kobo BIGINT NOT NULL CHECK (delivery_fee_kobo >= 0),
  platform_fee_kobo BIGINT NOT NULL CHECK (platform_fee_kobo >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN (
    'ESCROW_LOCK','PLATFORM_FEE_EARMARK','SETTLE_TO_SELLER','REFUND_TO_BUYER'
  )),
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
CREATE INDEX IF NOT EXISTS idx_ledger_order ON ledger_entries(order_id);