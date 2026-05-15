-- 013_cart_unique_variant.sql

ALTER TABLE cart_items
DROP CONSTRAINT IF EXISTS cart_items_user_id_product_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_product_variant_uidx
ON cart_items (
  user_id,
  product_id,
  COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
);