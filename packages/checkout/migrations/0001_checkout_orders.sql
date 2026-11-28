-- The checkout Worker's own database. It holds orders, payment attempts, the merchants' provider
-- keys (encrypted) and the events for the merchants. It holds no account or wallet secret.

CREATE TABLE checkout_projects (
  project_id TEXT PRIMARY KEY NOT NULL CHECK (length(project_id) > 0),
  -- The routing table and the merchant's event URL.
  config_json TEXT NOT NULL,
  -- The secret that signs the events for this merchant, encrypted.
  event_secret_sealed TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL
) STRICT;

CREATE TABLE checkout_rail_accounts (
  project_id TEXT NOT NULL REFERENCES checkout_projects (project_id),
  rail_id TEXT NOT NULL CHECK (length(rail_id) > 0),
  -- What the browser can see, such as a publishable key.
  public_json TEXT NOT NULL,
  -- The merchant's provider keys, encrypted with the encryption key of this rail.
  secrets_sealed TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY (project_id, rail_id)
) STRICT;

CREATE TABLE checkout_orders (
  order_id TEXT PRIMARY KEY NOT NULL CHECK (length(order_id) > 0),
  project_id TEXT NOT NULL REFERENCES checkout_projects (project_id),
  reference TEXT NOT NULL CHECK (length(reference) > 0),
  currency TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  lines_json TEXT NOT NULL,
  shipping_amount INTEGER NOT NULL CHECK (shipping_amount >= 0),
  customer_email TEXT,
  -- Written only with the result of computeOrderState.
  state TEXT NOT NULL CHECK (
    state IN ('open', 'paid', 'expired', 'cancelled', 'partially_refunded', 'refunded')
  ),
  needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  disputed INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1)),
  expires_at_ms INTEGER NOT NULL,
  cancelled_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  UNIQUE (project_id, reference)
) STRICT;

CREATE INDEX checkout_orders_open_expiry ON checkout_orders (expires_at_ms)
WHERE state = 'open';

CREATE TABLE checkout_attempts (
  -- Also the idempotency key and the Seams reference of the provider payment.
  attempt_id TEXT PRIMARY KEY NOT NULL CHECK (length(attempt_id) > 0),
  order_id TEXT NOT NULL REFERENCES checkout_orders (order_id),
  method TEXT NOT NULL,
  rail_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'created', 'requires_action', 'pending_offline', 'awaiting_chain',
      'succeeded', 'failed', 'cancelled', 'expired'
    )
  ),
  -- The input of the rail call, stored before the call.
  input_json TEXT NOT NULL,
  -- The provider's payment. One provider payment belongs to one attempt.
  rail_ref TEXT,
  start_json TEXT,
  failure_json TEXT,
  deadline_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  UNIQUE (rail_id, rail_ref)
) STRICT;

-- One active attempt for each order.
CREATE UNIQUE INDEX checkout_attempts_one_active ON checkout_attempts (order_id)
WHERE state IN ('created', 'requires_action', 'pending_offline', 'awaiting_chain');

CREATE INDEX checkout_attempts_order ON checkout_attempts (order_id);

CREATE INDEX checkout_attempts_active_deadline ON checkout_attempts (deadline_ms)
WHERE state IN ('created', 'requires_action', 'pending_offline', 'awaiting_chain');

-- Money that arrived when its order did not wait for it. Each one is recorded once.
CREATE TABLE checkout_unexpected_payments (
  payment_id TEXT PRIMARY KEY NOT NULL CHECK (length(payment_id) > 0),
  order_id TEXT NOT NULL REFERENCES checkout_orders (order_id),
  attempt_id TEXT REFERENCES checkout_attempts (attempt_id),
  rail_id TEXT NOT NULL,
  rail_ref TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('attempt_not_active', 'wrong_amount')),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (rail_id, rail_ref)
) STRICT;

-- The events for the merchants. A row stays until the merchant's server answers 2xx.
CREATE TABLE checkout_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) > 0),
  project_id TEXT NOT NULL REFERENCES checkout_projects (project_id),
  order_id TEXT NOT NULL REFERENCES checkout_orders (order_id),
  type TEXT NOT NULL,
  -- One event for each cause: a state of the order, or one payment, refund or dispute.
  cause TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  delivered_at_ms INTEGER,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  UNIQUE (order_id, cause)
) STRICT;

CREATE INDEX checkout_events_due ON checkout_events (next_attempt_at_ms)
WHERE delivered_at_ms IS NULL;
