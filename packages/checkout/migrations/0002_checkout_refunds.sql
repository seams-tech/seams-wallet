-- Refunds of paid orders. A row is stored before the rail call, so a retry finds it.

CREATE TABLE checkout_refunds (
  -- Also the idempotency key of the rail call.
  refund_id TEXT PRIMARY KEY NOT NULL CHECK (length(refund_id) > 0),
  order_id TEXT NOT NULL REFERENCES checkout_orders (order_id),
  attempt_id TEXT NOT NULL REFERENCES checkout_attempts (attempt_id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  -- pending: the rail has the refund and the money is not back yet.
  state TEXT NOT NULL CHECK (state IN ('pending', 'succeeded', 'failed')),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE INDEX checkout_refunds_order ON checkout_refunds (order_id);
