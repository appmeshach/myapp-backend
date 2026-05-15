const repo = require("./orderRepo");
const { computeInspectionSeconds } = require("../rules/inspection");

function assertState(order, allowed) {
  if (!allowed.includes(order.state)) {
    const err = new Error(`Invalid state transition from ${order.state}`);
    err.status = 409;
    throw err;
  }
}

async function createEscrowLockedOrder(payload) {
  // Minimal validation
  if (!payload.buyer_user_id || !payload.store_id) {
    const err = new Error("buyer_user_id and store_id are required");
    err.status = 400;
    throw err;
  }
  if (!payload.item_count || payload.item_count < 1) {
    const err = new Error("item_count must be >= 1");
    err.status = 400;
    throw err;
  }
  return repo.createOrder(payload);
}

async function handoverToRider(orderId) {
  const order = await repo.getOrderById(orderId);
  if (!order) return null;
  assertState(order, ["ESCROW_LOCKED"]);
  return repo.updateOrderState(orderId, "HANDOVER_TO_RIDER");
}

async function markInTransit(orderId) {
  const order = await repo.getOrderById(orderId);
  if (!order) return null;
  assertState(order, ["HANDOVER_TO_RIDER"]);
  return repo.updateOrderState(orderId, "IN_TRANSIT");
}

async function markDelivered(orderId) {
  const order = await repo.getOrderById(orderId);
  if (!order) return null;
  assertState(order, ["IN_TRANSIT"]);

  const secs = computeInspectionSeconds(order.item_count);
  const now = new Date();
  const expires = new Date(now.getTime() + secs * 1000);

  // We set state directly to INSPECTION_ACTIVE and store timer fields
  return repo.updateOrderState(orderId, "INSPECTION_ACTIVE", {
    inspection_seconds: secs,
    inspection_expires_at: expires.toISOString(),
  });
}

async function openDispute(orderId) {
  const order = await repo.getOrderById(orderId);
  if (!order) return null;
  assertState(order, ["INSPECTION_ACTIVE"]);

  const expiresMs = order.inspection_expires_at
  ? Date.parse(order.inspection_expires_at)
  : NaN;

const nowMs = Date.now();

if (!Number.isFinite(expiresMs) || nowMs >= expiresMs) {
    const err = new Error("Inspection window expired");
    err.status = 409;
    throw err;
  }

  return repo.updateOrderState(orderId, "DISPUTE_OPENED");
}

async function confirmOk(orderId) {
  const order = await repo.getOrderById(orderId);
  if (!order) return null;
  assertState(order, ["INSPECTION_ACTIVE"]);

  const expires = order.inspection_expires_at ? new Date(order.inspection_expires_at) : null;
  if (!expires || new Date() >= expires) {
    const err = new Error("Inspection window expired");
    err.status = 409;
    throw err;
  }

  // Early settle
  return repo.updateOrderState(orderId, "SETTLED");
}

module.exports = {
  createEscrowLockedOrder,
  handoverToRider,
  markInTransit,
  markDelivered,
  openDispute,
  confirmOk,
};