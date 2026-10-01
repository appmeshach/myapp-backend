-- Bbox overlap is a prefilter; exact geometry intersection decides inclusion.
-- Retain whole features, including edge touching. Do not clip geometry.
-- source_segments and extract_bounds are created by the local-only runner.
CREATE TEMP TABLE selected_segments AS
SELECT s.* FROM source_segments s, extract_bounds b
WHERE s.subtype = 'road'
  AND s.bbox.xmin <= b.xmax AND s.bbox.xmax >= b.xmin
  AND s.bbox.ymin <= b.ymax AND s.bbox.ymax >= b.ymin
  AND ST_Intersects(s.geometry, ST_MakeEnvelope(b.xmin, b.ymin, b.xmax, b.ymax))
ORDER BY s.id;
