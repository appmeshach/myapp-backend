const orderRepo = require("../orders/orderRepo");
const ledgerService = require("../ledger/ledgerService");
const { query } = require("../db");
const orderItemRepo = require("../orders/orderItemRepo");
const variantRepo = require("../products/productVariantRepo");
const auditRepo = require("../audit/auditRepo");

async function confirmPayment(orderId) {
  const order = await orderRepo.getById(orderId);
  if (!order) return { error: "Order not found", status: 404 };

  if (order.state !== "PENDING_PAYMENT") {
    return { error: "Only PENDING_PAYMENT orders can be confirmed", status: 409 };
  }

  // 1) Load order items
  const items = await orderItemRepo.listOrderItems(orderId);

  // 2) Reduce stock for variant-backed items
  for (const item of items) {
    if (!item.variant_id) continue;

    const reduced = await variantRepo.reduceStock(item.variant_id, item.qty);
    if (!reduced) {
      return {
        error: `Insufficient stock while confirming payment for variant "${item.variant_label}"`,
        status: 409,
      };
    }
  }

  // 3) Move order to escrow locked
  const updated = await orderRepo.updateState(orderId, "ESCROW_LOCKED");
  await ledgerService.recordEscrowLock(updated);

  await auditRepo.logEvent({
    actor_user_id: updated.buyer_user_id,
    actor_role: "BUYER",
    action: "PAYMENT_CONFIRMED",
    entity_type: "ORDER",
    entity_id: updated.id,
    meta: {
      state: updated.state,
      total_amount_kobo: updated.total_amount_kobo,
    },
  });

  return { order: updated };
}
async function confirmPaymentBatch(orderIds) {
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return { error: "order_ids must be a non-empty array", status: 400 };
  }

  const confirmed = [];

  for (const orderId of orderIds) {
    const result = await confirmPayment(orderId);

    if (result.error) {
      return {
        error: `Failed on order ${orderId}: ${result.error}`,
        status: result.status,
      };
    }

    confirmed.push({
      order_id: result.order.id,
      state: result.order.state,
    });
  }

  return { confirmed };
}

async function confirmPaymentGroup(checkoutGroupId) {
  // 1) Load checkout group
  const cg = await query(
    `
    SELECT *
    FROM checkout_groups
    WHERE id = $1
    `,
    [checkoutGroupId]
  );

  const checkoutGroup = cg.rows[0];
  if (!checkoutGroup) {
    return { error: "Checkout group not found", status: 404 };
  }

  if (checkoutGroup.status !== "PENDING_PAYMENT") {
    return {
      error: "Only PENDING_PAYMENT checkout groups can be confirmed",
      status: 409,
    };
  }

  // 2) Load linked orders
  const linked = await query(
    `
    SELECT order_id
    FROM checkout_group_orders
    WHERE checkout_group_id = $1
    ORDER BY order_id ASC
    `,
    [checkoutGroupId]
  );

  const orderIds = linked.rows.map((r) => r.order_id);

  if (orderIds.length === 0) {
    return { error: "No orders linked to checkout group", status: 400 };
  }

  // 3) Confirm all linked orders
  const confirmed = [];

  for (const orderId of orderIds) {
    const result = await confirmPayment(orderId);

    if (result.error) {
      return {
        error: `Failed on order ${orderId}: ${result.error}`,
        status: result.status,
      };
    }

    confirmed.push({
      order_id: result.order.id,
      state: result.order.state,
    });
  }

  // 4) Mark checkout group as PAID
  await query(
    `
    UPDATE checkout_groups
    SET status = 'PAID'
    WHERE id = $1
    `,
    [checkoutGroupId]
  );

  return {
    checkout_group_id: checkoutGroupId,
    status: "PAID",
    confirmed,
  };
}

module.exports = { confirmPayment, confirmPaymentBatch, confirmPaymentGroup };