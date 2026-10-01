-- Retain every connector referenced by selected segments, including connectors
-- outside the selection bbox. No traversal or routing policy is applied.
CREATE TEMP TABLE selected_connectors AS
SELECT c.* FROM source_connectors c
WHERE c.id IN (
  SELECT ref.connector_id
  FROM (SELECT unnest(connectors) AS ref FROM selected_segments)
)
ORDER BY c.id;
