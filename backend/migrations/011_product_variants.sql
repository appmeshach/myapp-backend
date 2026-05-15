CREATE TABLE product_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,

  option_label TEXT NOT NULL,
  stock_qty INT NOT NULL DEFAULT 0,
  price_override_kobo BIGINT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_product_variants_product
ON product_variants(product_id);