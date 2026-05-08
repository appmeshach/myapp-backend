export function getOrderStatusLabel(state: string): string {
  switch (state) {
    case "PENDING_PAYMENT":
      return "Pending Payment";
    case "ESCROW_LOCKED":
      return "Payment Confirmed";
    case "HANDOVER_TO_RIDER":
      return "Ready for Dispatch";
    case "IN_TRANSIT":
      return "In Transit";
    case "INSPECTION_ACTIVE":
      return "Delivered – Review Item";
    case "SETTLED":
      return "Completed";
    case "DISPUTE_OPENED":
      return "Dispute Opened";
    case "REFUNDED":
      return "Refunded";
    default:
      return state;
  }
}

export function getOrderStatusColors(state: string) {
  switch (state) {
    case "PENDING_PAYMENT":
      return { bg: "#FFF4D6", text: "#8A5B00" };
    case "ESCROW_LOCKED":
      return { bg: "#E8F1FF", text: "#1D4ED8" };
    case "HANDOVER_TO_RIDER":
      return { bg: "#F3E8FF", text: "#7C3AED" };
    case "IN_TRANSIT":
      return { bg: "#E0F2FE", text: "#0369A1" };
    case "INSPECTION_ACTIVE":
      return { bg: "#FEF3C7", text: "#92400E" };
    case "SETTLED":
      return { bg: "#DCFCE7", text: "#166534" };
    case "DISPUTE_OPENED":
      return { bg: "#FEE2E2", text: "#B91C1C" };
    case "REFUNDED":
      return { bg: "#F3F4F6", text: "#374151" };
    default:
      return { bg: "#E5E7EB", text: "#374151" };
  }
}