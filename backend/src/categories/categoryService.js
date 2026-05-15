const categoryRepo = require("./categoryRepo");

async function getCategories() {
  return categoryRepo.listCategories();
}

async function getProductsByCategory(category_group) {
  return categoryRepo.listProductsByCategory(category_group);
}

module.exports = { getCategories, getProductsByCategory };