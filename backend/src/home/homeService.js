const homeRepo = require("./homeRepo");

async function getHomeFeed() {
  const featured_products = await homeRepo.getFeaturedProducts(8);
  const latest_products = await homeRepo.getLatestProducts(20);

  return {
    featured_products,
    latest_products,
  };
}

module.exports = { getHomeFeed };