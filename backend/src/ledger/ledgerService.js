const ledgerRepo = require("./ledgerRepo");

/**
 * V1 Ledger Entry Types we will use:
 * - ESCROW_LOCK
 * - SELLER_CREDIT
 * - PLATFORM_FEE_CREDIT
 * Later we add refunds, returns, delivery, etc.
 */

// Called when order is created and payment is successful
async function recordEscrowLock(order) {
  // Idempotent protection: don't double-write
  const exists = await ledgerRepo.hasEntry(order.id, "ESCROW_LOCK");
  if (exists) return;

  // In V1 escrow lock covers product + platform fee
  const amount = Number(order.total_amount_kobo) + Number(order.platform_fee_kobo);

  await ledgerRepo.insertEntry({
    order_id: order.id,
    entry_type: "ESCROW_LOCK",
    amount_kobo: amount,
    currency: "NGN",
  });
}

// Called when order settles (buyer confirms or later auto-settle)
async function recordSettlement(order) {
  // Prevent double settlement credits
  const sellerDone = await ledgerRepo.hasEntry(order.id, "SELLER_CREDIT");
  const feeDone = await ledgerRepo.hasEntry(order.id, "PLATFORM_FEE_CREDIT");

  if (!sellerDone) {
    await ledgerRepo.insertEntry({
      order_id: order.id,
      entry_type: "SELLER_CREDIT",
      amount_kobo: Number(order.total_amount_kobo),
      currency: "NGN",
    });
  }

  if (!feeDone) {
    await ledgerRepo.insertEntry({
      order_id: order.id,
      entry_type: "PLATFORM_FEE_CREDIT",
      amount_kobo: Number(order.platform_fee_kobo),
      currency: "NGN",
    });
  }
}

module.exports = { recordEscrowLock, recordSettlement };