-- 014_order_items.sql

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  qty INT NOT NULL CHECK (qty > 0),
  unit_price_kobo BIGINT NOT NULL CHECK (unit_price_kobo >= 0),
  line_total_kobo BIGINT NOT NULL CHECK (line_total_kobo >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order
ON order_items(order_id);