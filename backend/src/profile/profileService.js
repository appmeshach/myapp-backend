const profileRepo = require("./profileRepo");

async function getOrders(user_id) {
  return profileRepo.listBuyerOrders(user_id);
}

async function getOrderDetails(orderId, user_id) {
  return profileRepo.getBuyerOrder(orderId, user_id);
}

module.exports = { getOrders, getOrderDetails };