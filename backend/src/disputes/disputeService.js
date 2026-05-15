const disputeRepo = require("./disputeRepo");
const orderRepo = require("../orders/orderRepo");
const ledgerRepo = require("../ledger/ledgerRepo");
const evidenceRepo = require("../evidence/evidenceRepo");
const { requiredEvidenceForDispute } = require("../rules/evidenceRequirements");
/**
 * V1: Buyer can open dispute only during INSPECTION_ACTIVE
 * V1: Admin resolves dispute via endpoint (no auth yet)
 */

async function openDispute(orderId, reason_code) {
  const order = await orderRepo.getById(orderId);
  if (!order) return { error: "Order not found", status: 404 };

  if (order.state !== "INSPECTION_ACTIVE") {
    return { error: "Dispute allowed only during inspection", status: 409 };
  }
    // -------- Evidence Gate (V1) --------
  const evidenceList = await evidenceRepo.listEvidence(orderId);
  const requirements = requiredEvidenceForDispute(order);

  const buyerUploads = evidenceList.filter(e => e.uploaded_by === "BUYER").length;

  if (buyerUploads < requirements.buyer_min_uploads) {
    // Create dispute but escalate immediately
    const dispute = await disputeRepo.createDispute({
      order_id: orderId,
      reason_code
    });

    await orderRepo.updateState(orderId, "DISPUTE_OPENED");

    await disputeRepo.resolveDispute({
      order_id: orderId,
      status: "ESCALATED_ADMIN",
      decision: "ADMIN_REQUIRED",
      fault_attribution: "UNCLEAR"
    });

    return { dispute: await disputeRepo.getDisputeByOrder(orderId) };
  }
  // -------------------------------------

  // Only one dispute per order (table enforces UNIQUE)
  const existing = await disputeRepo.getDisputeByOrder(orderId);
  if (existing) return { error: "Dispute already exists for this order", status: 409 };

  const dispute = await disputeRepo.createDispute({ order_id: orderId, reason_code });

  // move order state -> DISPUTE_OPENED
  await orderRepo.updateState(orderId, "DISPUTE_OPENED");
  const updatedOrder = await orderRepo.getById(orderId);
if (updatedOrder.state !== "DISPUTE_OPENED") {
  return { error: "Failed to update order state to DISPUTE_OPENED", status: 500 };
}

  return { dispute };
}

async function resolveDispute(orderId, { decision, fault_attribution }) {
  const order = await orderRepo.getById(orderId);
  if (!order) return { error: "Order not found", status: 404 };

  const dispute = await disputeRepo.getDisputeByOrder(orderId);
  if (!dispute) return { error: "Dispute not found", status: 404 };

  if (dispute.status !== "OPEN") return { error: "Dispute already resolved", status: 409 };

  // Decision normalization (V1)
  // decision: REFUND or REJECT or ADMIN_REQUIRED
  // fault_attribution: SELLER/BUYER/DELIVERY/UNCLEAR
  let status = "RESOLVED";
  if (decision === "ADMIN_REQUIRED" || fault_attribution === "UNCLEAR") status = "ESCALATED_ADMIN";

  const updated = await disputeRepo.resolveDispute({
    order_id: orderId,
    status,
    decision,
    fault_attribution,
  });

  // If refund approved -> order state REFUNDED + ledger BUYER_REFUND
  if (decision === "REFUND") {
    await orderRepo.updateState(orderId, "REFUNDED");

    // Idempotent: avoid double refund
    const already = await ledgerRepo.hasEntry(orderId, "BUYER_REFUND");
    if (!already) {
      const refundAmount = Number(order.total_amount_kobo) + Number(order.platform_fee_kobo);
      await ledgerRepo.insertEntry({
        order_id: orderId,
        entry_type: "BUYER_REFUND",
        amount_kobo: refundAmount,
        currency: "NGN",
      });
    }
  }

  // If rejected -> return order to INSPECTION_ACTIVE? (No: keep dispute resolved)
  if (decision === "REJECT") {
    // In V1 we keep order as SETTLED only if inspection already ended.
    // For simplicity: set order back to INSPECTION_ACTIVE is not correct.
    // We'll set it to SETTLED only if admin rejects.
    await orderRepo.updateState(orderId, "SETTLED");
  }

  return { dispute: updated };
}

module.exports = { openDispute, resolveDispute };