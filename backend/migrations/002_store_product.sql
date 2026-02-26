-- 002_store_product.sql
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  price_kobo BIGINT NOT NULL CHECK (price_kobo >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  category_group TEXT NOT NULL CHECK (category_group IN (
    'POWER_FUNCTIONAL',
    'WEARABLES_SAMPLE',
    'WEARABLES_NON_SAMPLE',
    'CONSUMABLES',
    'STATIC_GOODS',
    'FRAGILE'
  )),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
CREATE INDEX IF NOT EXISTS idx_products_category_group ON products(category_group);