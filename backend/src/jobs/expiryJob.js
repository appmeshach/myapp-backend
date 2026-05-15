const orderRepo = require("../orders/orderRepo");
const ledgerService = require("../ledger/ledgerService");
const disputeRepo = require("../disputes/disputeRepo");

async function runInspectionExpiry() {
  // Find orders where:
  // state = INSPECTION_ACTIVE
  // inspection_expires_at <= now
  const expired = await orderRepo.listExpiredInspectionOrders();

  let settled = 0;
  let skipped_due_to_dispute = 0;

  for (const order of expired) {
    const d = await disputeRepo.getDisputeByOrder(order.id);
    if (d && (d.status === "OPEN" || d.status === "ESCALATED_ADMIN")) {
      skipped_due_to_dispute++;
      continue;
    }

    // Auto-settle
    const updated = await orderRepo.settleIfStillInspectionActive(order.id);
if (!updated) continue; // state changed elsewhere, skip
await ledgerService.recordSettlement(updated);
settled++;
  }

  return { found: expired.length, settled, skipped_due_to_dispute };
}

module.exports = { runInspectionExpiry };