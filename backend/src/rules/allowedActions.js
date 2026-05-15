function allowedActions(order, now = new Date()) {
  const actions = [];

  if (!order) return actions;

  const state = order.state;

  if (state === "IN_TRANSIT") actions.push("TRACK", "MESSAGE_SELLER");

  if (state === "INSPECTION_ACTIVE") {
  const expiresMs = order.inspection_expires_at
    ? Date.parse(order.inspection_expires_at)
    : NaN;

  const nowMs = Date.now();
  const active = Number.isFinite(expiresMs) && nowMs < expiresMs;

  if (active) {
    actions.push("DISPUTE", "UPLOAD_EVIDENCE", "MESSAGE_SELLER", "COMPLETE");
  }
}

  if (state === "SETTLED") actions.push("REORDER", "SHARE_ORDER", "REVIEW");

  if (state === "REFUNDED") actions.push("REORDER", "SUPPORT");

  return actions;
}

module.exports = { allowedActions };