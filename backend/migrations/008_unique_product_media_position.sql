-- 008_unique_product_media_position.sql
-- Enforce: per product, each "position" can only be used once.

ALTER TABLE product_media
ADD CONSTRAINT product_media_product_position_unique
UNIQUE (product_id, position);