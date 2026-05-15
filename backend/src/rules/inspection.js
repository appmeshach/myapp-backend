function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function computeInspectionSeconds(itemCount) {
  const base = 10 * 60; // 10 minutes
  const extraPerItem = 2 * 60; // 2 minutes per item
  const seconds = base + extraPerItem * itemCount;
  return clamp(seconds, base, 24 * 60 * 60); // cap at 24h
}

module.exports = { computeInspectionSeconds };