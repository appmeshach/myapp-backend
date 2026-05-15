const wishlistRepo = require("./wishlistRepo");

async function addItem({ user_id, product_id }) {
  return wishlistRepo.addWishlistItem({ user_id, product_id });
}

async function listItems(user_id) {
  return wishlistRepo.listWishlistItems(user_id);
}

async function removeItem(id, user_id) {
  return wishlistRepo.removeWishlistItem(id, user_id);
}

module.exports = {
  addItem,
  listItems,
  removeItem,
};