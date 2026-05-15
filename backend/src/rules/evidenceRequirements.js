function requiredEvidenceForDispute(order) {
  // V1 minimal: Buyer must upload at least 1 evidence item before dispute can proceed
  return { buyer_min_uploads: 1 };
}

module.exports = { requiredEvidenceForDispute };