-- 007_product_media_types.sql
-- Allow IMAGE and MODEL_3D_GLB for product_media.media_type

ALTER TABLE product_media DROP CONSTRAINT IF EXISTS product_media_media_type_check;

ALTER TABLE product_media
ADD CONSTRAINT product_media_media_type_check
CHECK (media_type IN ('IMAGE', 'MODEL_3D_GLB'));