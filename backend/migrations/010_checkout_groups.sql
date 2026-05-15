-- 010_checkout_groups.sql

CREATE TABLE IF NOT EXISTS checkout_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING_PAYMENT'
    CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'FAILED', 'CANCELLED')),
  grand_total_kobo bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkout_group_orders (
  checkout_group_id uuid NOT NULL REFERENCES checkout_groups(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  PRIMARY KEY (checkout_group_id, order_id)
);