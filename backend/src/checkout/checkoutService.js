const { query } = require("../db");
const orderRepo = require("../orders/orderRepo");
const orderItemRepo = require("../orders/orderItemRepo");
const variantRepo = require("../products/productVariantRepo");

async function checkoutFromCart(user_id, cart_item_ids = []) {
    if (!Array.isArray(cart_item_ids) || cart_item_ids.length === 0) {
    return { error: "No cart items selected", status: 400 };
  }
  // 1) Get cart items, including variant + effective price
  const r = await query(
  `
  SELECT
    c.id,
    c.store_id,
    c.product_id,
    c.variant_id,
    c.qty,
    COALESCE(v.price_override_kobo, p.price_kobo) AS effective_price_kobo
  FROM cart_items c
  JOIN products p ON p.id = c.product_id
  LEFT JOIN product_variants v ON v.id = c.variant_id
  WHERE c.user_id = $1
    AND c.id = ANY($2::uuid[]);
  `,
  [user_id, cart_item_ids]
);

  const items = r.rows;
  if (items.length === 0) {
    return { error: "Cart is empty", status: 400 };
  }

    // 1b) Validate stock for variant-based items
  for (const item of items) {
    if (!item.variant_id) continue;

    const variant = await variantRepo.getVariantById(item.variant_id);
    if (!variant) {
      return {
        error: `Variant not found for product ${item.product_id}`,
        status: 400,
      };
    }

    if (Number(item.qty) > Number(variant.stock_qty)) {
      return {
        error: `Not enough stock for variant "${variant.option_label}". Available: ${variant.stock_qty}`,
        status: 409,
      };
    }
  }

  // 2) Group cart items by store
  const grouped = new Map();

  for (const item of items) {
    if (!grouped.has(item.store_id)) {
      grouped.set(item.store_id, []);
    }
    grouped.get(item.store_id).push(item);
  }

  const createdOrders = [];
  let grand_total_kobo = 0;

  // 3) Create checkout group first
  const cg = await query(
    `
    INSERT INTO checkout_groups (user_id, status, grand_total_kobo)
    VALUES ($1, 'PENDING_PAYMENT', 0)
    RETURNING *;
    `,
    [user_id]
  );

  const checkoutGroup = cg.rows[0];

  // 4) Create one pending-payment order per store
  for (const [store_id, storeItems] of grouped.entries()) {
    let total_amount_kobo = 0;

    for (const item of storeItems) {
      total_amount_kobo += Number(item.effective_price_kobo) * Number(item.qty);
    }

    grand_total_kobo += total_amount_kobo;

    const order = await orderRepo.createPendingPaymentOrder({
      buyer_user_id: user_id,
      store_id,
      item_count: storeItems.length,
      total_amount_kobo,
      delivery_fee_kobo: 0, // V1 simple
      platform_fee_kobo: 0, // V1 simple
    });

    // 5) Link order to checkout group
    await query(
      `
      INSERT INTO checkout_group_orders (checkout_group_id, order_id)
      VALUES ($1, $2);
      `,
      [checkoutGroup.id, order.id]
    );

    // 6) Save actual order items
    for (const item of storeItems) {
      const unit_price_kobo = Number(item.effective_price_kobo);
      const line_total_kobo = unit_price_kobo * Number(item.qty);

      await orderItemRepo.addOrderItem({
        order_id: order.id,
        product_id: item.product_id,
        variant_id: item.variant_id,
        qty: item.qty,
        unit_price_kobo,
        line_total_kobo,
      });
    }

    createdOrders.push({
      store_id,
      order_id: order.id,
      total_amount_kobo,
    });
  }

  // 7) Update grand total on checkout group
  await query(
    `
    UPDATE checkout_groups
    SET grand_total_kobo = $2
    WHERE id = $1;
    `,
    [checkoutGroup.id, grand_total_kobo]
  );

  // 8) Clear cart
  await query(
  `
  DELETE FROM cart_items
  WHERE user_id = $1
    AND id = ANY($2::uuid[]);
  `,
  [user_id, cart_item_ids]
);

  return {
    checkout_group: {
      checkout_group_id: checkoutGroup.id,
      store_count: createdOrders.length,
      grand_total_kobo,
      status: "PENDING_PAYMENT",
    },
    orders: createdOrders,
  };
}

module.exports = { checkoutFromCart };