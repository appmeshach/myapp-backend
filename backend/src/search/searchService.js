const searchRepo = require("./searchRepo");

async function search({ q, store_id }) {
  return searchRepo.searchProducts({ q, store_id });
}

async function suggest(q) {
  return searchRepo.suggestProducts(q);
}

module.exports = { search, suggest };