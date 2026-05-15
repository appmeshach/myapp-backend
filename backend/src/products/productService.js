const productRepo = require("./productRepo");

async function getProduct(productId) {
  return productRepo.getProductById(productId);
}

async function getProductMedia(productId) {
  return productRepo.listProductMedia(productId);
}

module.exports = { getProduct, getProductMedia };