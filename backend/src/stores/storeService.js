const storeRepo = require("./storeRepo");

async function listStores() {
  return storeRepo.listStores();
}

async function getStoreById(storeId) {
  return storeRepo.getStoreById(storeId);
}

async function listStoreProducts(storeId) {
  return storeRepo.listStoreProducts(storeId);
}

module.exports = { listStores, getStoreById, listStoreProducts };