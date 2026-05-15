require("dotenv").config();
const express = require("express");
const cors = require("cors");

const orderRoutes = require("./orders/orderRoutes");
const ledgerRoutes = require("./ledger/ledgerRoutes");
const evidenceRoutes = require("./evidence/evidenceRoutes");
const disputeRoutes = require("./disputes/disputeRoutes");
const rulesRoutes = require("./rules/rulesRoutes");
const jobRoutes = require("./jobs/jobRoutes");
const storeRoutes = require("./stores/storeRoutes");
const productRoutes = require("./products/productRoutes");
const cartRoutes = require("./cart/cartRoutes");
const wishlistRoutes = require("./wishlist/wishlistRoutes");
const searchRoutes = require("./search/searchRoutes");
const checkoutRoutes = require("./checkout/checkoutRoutes");
const paymentRoutes = require("./payments/paymentRoutes");
const homeRoutes = require("./home/homeRoutes");
const categoryRoutes = require("./categories/categoryRoutes");
const profileRoutes = require("./profile/profileRoutes");
const authRoutes = require("./auth/authRoutes");
const sellerProductRoutes = require("./seller/sellerProductRoutes");
const opsOrderRoutes = require("./ops/opsOrderRoutes");
const buyerOrderActionsRoutes = require("./buyer/buyerOrderActionsRoutes");
const auditRoutes = require("./audit/auditRoutes");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// v1 routes
app.use("/v1/orders", orderRoutes);
app.use("/v1", ledgerRoutes);
app.use("/v1", evidenceRoutes);
app.use("/v1", disputeRoutes);
app.use("/v1", rulesRoutes);
app.use("/v1", jobRoutes);
app.use("/v1/stores", storeRoutes);
app.use("/v1/products", productRoutes);
app.use("/v1/cart", cartRoutes);
app.use("/v1/wishlist", wishlistRoutes);
app.use("/v1/search", searchRoutes);
app.use("/v1/checkout", checkoutRoutes);
app.use("/v1/payments", paymentRoutes);
app.use("/v1/home", homeRoutes);
app.use("/v1/categories", categoryRoutes);
app.use("/v1/profile", profileRoutes);
app.use("/v1/auth", authRoutes);
app.use("/v1/seller", sellerProductRoutes);
app.use("/v1/ops", opsOrderRoutes);
app.use("/v1/buyer", buyerOrderActionsRoutes);
app.use("/v1/audit", auditRoutes);

// Error handler (so you get clean errors)
app.use((err, req, res, next) => {
  console.error("ERROR:", err.message || err);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || "Server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("API running on", PORT);
});
