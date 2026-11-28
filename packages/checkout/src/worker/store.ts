import type { CheckoutMethod } from '../shared/methods';
import type { Currency } from '../shared/money';
import {
  ACTIVE_ATTEMPT_STATES,
  type AttemptState,
  type OrderState,
} from '../shared/orderState';
import { changedRows, type D1, type D1Statement } from './d1';

export type ProjectRow = {
  readonly project_id: string;
  readonly config_json: string;
  readonly event_secret_sealed: string;
};

export type RailAccountRow = {
  readonly project_id: string;
  readonly rail_id: string;
  readonly public_json: string;
  readonly secrets_sealed: string;
};

export type OrderRow = {
  readonly order_id: string;
  readonly project_id: string;
  readonly reference: string;
  readonly currency: Currency;
  readonly amount: number;
  readonly lines_json: string;
  readonly shipping_amount: number;
  readonly customer_email: string | null;
  readonly state: OrderState;
  readonly needs_review: number;
  readonly disputed: number;
  readonly expires_at_ms: number;
  readonly cancelled_at_ms: number | null;
  readonly created_at_ms: number;
};

export type AttemptRow = {
  readonly attempt_id: string;
  readonly order_id: string;
  readonly method: CheckoutMethod;
  readonly rail_id: string;
  readonly state: AttemptState;
  readonly input_json: string;
  readonly rail_ref: string | null;
  readonly start_json: string | null;
  readonly failure_json: string | null;
  readonly deadline_ms: number;
  readonly created_at_ms: number;
};

export type EventRow = {
  readonly event_id: string;
  readonly project_id: string;
  readonly payload_json: string;
  readonly delivery_attempts: number;
};

type NewEvent = {
  readonly eventId: string;
  readonly order: Pick<OrderRow, 'order_id' | 'project_id'>;
  readonly type: string;
  /** One event for each cause in one order. A second insert with the same cause does nothing. */
  readonly cause: string;
  readonly payloadJson: string;
  readonly nowMs: number;
};

const ACTIVE_STATES_SQL = ACTIVE_ATTEMPT_STATES.map((state) => `'${state}'`).join(', ');

export function getProject(db: D1, projectId: string): Promise<ProjectRow | null> {
  return db
    .prepare('SELECT * FROM checkout_projects WHERE project_id = ?')
    .bind(projectId)
    .first<ProjectRow>();
}

/** Makes the project, or replaces its configuration. The event secret of a project stays. */
export async function putProject(
  db: D1,
  project: ProjectRow,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkout_projects (project_id, config_json, event_secret_sealed, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (project_id) DO UPDATE SET
         config_json = excluded.config_json, updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(project.project_id, project.config_json, project.event_secret_sealed, nowMs)
    .run();
}

export function getRailAccount(
  db: D1,
  projectId: string,
  railId: string,
): Promise<RailAccountRow | null> {
  return db
    .prepare('SELECT * FROM checkout_rail_accounts WHERE project_id = ? AND rail_id = ?')
    .bind(projectId, railId)
    .first<RailAccountRow>();
}

export async function listRailAccountIds(db: D1, projectId: string): Promise<string[]> {
  const rows = await db
    .prepare('SELECT rail_id FROM checkout_rail_accounts WHERE project_id = ?')
    .bind(projectId)
    .all<{ rail_id: string }>();
  return rows.results.map((row) => row.rail_id);
}

export async function putRailAccount(db: D1, account: RailAccountRow, nowMs: number): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkout_rail_accounts
         (project_id, rail_id, public_json, secrets_sealed, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (project_id, rail_id) DO UPDATE SET
         public_json = excluded.public_json,
         secrets_sealed = excluded.secrets_sealed,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(account.project_id, account.rail_id, account.public_json, account.secrets_sealed, nowMs)
    .run();
}

export async function insertOrder(db: D1, order: OrderRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkout_orders
         (order_id, project_id, reference, currency, amount, lines_json, shipping_amount,
          customer_email, state, expires_at_ms, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      order.order_id,
      order.project_id,
      order.reference,
      order.currency,
      order.amount,
      order.lines_json,
      order.shipping_amount,
      order.customer_email,
      order.state,
      order.expires_at_ms,
      order.created_at_ms,
    )
    .run();
}

export function getOrder(db: D1, orderId: string): Promise<OrderRow | null> {
  return db
    .prepare('SELECT * FROM checkout_orders WHERE order_id = ?')
    .bind(orderId)
    .first<OrderRow>();
}

export function getOrderByReference(
  db: D1,
  projectId: string,
  reference: string,
): Promise<OrderRow | null> {
  return db
    .prepare('SELECT * FROM checkout_orders WHERE project_id = ? AND reference = ?')
    .bind(projectId, reference)
    .first<OrderRow>();
}

export async function listAttempts(db: D1, orderId: string): Promise<AttemptRow[]> {
  const rows = await db
    .prepare('SELECT * FROM checkout_attempts WHERE order_id = ? ORDER BY rowid')
    .bind(orderId)
    .all<AttemptRow>();
  return rows.results;
}

export function getAttempt(db: D1, attemptId: string): Promise<AttemptRow | null> {
  return db
    .prepare('SELECT * FROM checkout_attempts WHERE attempt_id = ?')
    .bind(attemptId)
    .first<AttemptRow>();
}

export function findAttemptByRef(db: D1, railId: string, ref: string): Promise<AttemptRow | null> {
  return db
    .prepare('SELECT * FROM checkout_attempts WHERE rail_id = ? AND rail_ref = ?')
    .bind(railId, ref)
    .first<AttemptRow>();
}

/** Stores a new attempt before the rail call. Fails when the order has an active attempt. */
export async function insertAttempt(db: D1, attempt: AttemptRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO checkout_attempts
         (attempt_id, order_id, method, rail_id, state, input_json, deadline_ms,
          created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      attempt.attempt_id,
      attempt.order_id,
      attempt.method,
      attempt.rail_id,
      attempt.state,
      attempt.input_json,
      attempt.deadline_ms,
      attempt.created_at_ms,
      attempt.created_at_ms,
    )
    .run();
}

type AttemptChange = {
  readonly state: AttemptState;
  readonly railRef?: string;
  readonly startJson?: string;
  readonly failureJson?: string | null;
  readonly deadlineMs?: number;
};

/**
 * Changes an attempt only if it still has the state `from`. Two writers that read the same
 * state cannot both change it. Returns false when another writer was first.
 */
export async function changeAttempt(
  db: D1,
  attemptId: string,
  from: AttemptState,
  change: AttemptChange,
  nowMs: number,
): Promise<boolean> {
  const run = await db
    .prepare(
      `UPDATE checkout_attempts SET
         state = ?,
         rail_ref = coalesce(?, rail_ref),
         start_json = coalesce(?, start_json),
         failure_json = CASE WHEN ? THEN ? ELSE failure_json END,
         deadline_ms = coalesce(?, deadline_ms),
         updated_at_ms = ?
       WHERE attempt_id = ? AND state = ?`,
    )
    .bind(
      change.state,
      change.railRef ?? null,
      change.startJson ?? null,
      change.failureJson === undefined ? 0 : 1,
      change.failureJson ?? null,
      change.deadlineMs ?? null,
      nowMs,
      attemptId,
      from,
    )
    .run();
  return changedRows(run) === 1;
}

export function insertEventStatement(db: D1, event: NewEvent): D1Statement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO checkout_events
         (event_id, project_id, order_id, type, cause, payload_json, created_at_ms,
          next_attempt_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.eventId,
      event.order.project_id,
      event.order.order_id,
      event.type,
      event.cause,
      event.payloadJson,
      event.nowMs,
      event.nowMs,
    );
}

/** Writes a new order state, only over the state that the caller read, with its event. */
export async function changeOrderState(
  db: D1,
  order: OrderRow,
  state: OrderState,
  event: NewEvent | null,
): Promise<void> {
  await db.batch([
    db
      .prepare('UPDATE checkout_orders SET state = ? WHERE order_id = ? AND state = ?')
      .bind(state, order.order_id, order.state),
    ...(event ? [insertEventStatement(db, event)] : []),
  ]);
}

export async function cancelOrderRow(db: D1, orderId: string, nowMs: number): Promise<void> {
  await db
    .prepare(
      `UPDATE checkout_orders SET cancelled_at_ms = ?
       WHERE order_id = ? AND cancelled_at_ms IS NULL`,
    )
    .bind(nowMs, orderId)
    .run();
}

type UnexpectedPayment = {
  readonly paymentId: string;
  readonly attempt: AttemptRow;
  readonly railRef: string;
  readonly amount: number;
  readonly currency: string;
  readonly reason: 'attempt_not_active' | 'wrong_amount';
};

/**
 * Records money that the order did not wait for, marks the order for review and adds the event.
 * A second record of the same provider payment changes nothing.
 */
export async function recordUnexpectedPayment(
  db: D1,
  payment: UnexpectedPayment,
  event: NewEvent,
): Promise<void> {
  const { attempt } = payment;
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO checkout_unexpected_payments
           (payment_id, order_id, attempt_id, rail_id, rail_ref, amount, currency, reason,
            created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        payment.paymentId,
        attempt.order_id,
        attempt.attempt_id,
        attempt.rail_id,
        payment.railRef,
        payment.amount,
        payment.currency,
        payment.reason,
        event.nowMs,
      ),
    db
      .prepare('UPDATE checkout_orders SET needs_review = 1 WHERE order_id = ?')
      .bind(attempt.order_id),
    insertEventStatement(db, event),
  ]);
}

/** The open orders that are past their expiry, or that have an attempt past its deadline. */
export async function listDueOrderIds(db: D1, nowMs: number, limit: number): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT order_id FROM checkout_orders WHERE state = 'open' AND expires_at_ms <= ?1
       UNION
       SELECT order_id FROM checkout_attempts
       WHERE state IN (${ACTIVE_STATES_SQL}) AND deadline_ms <= ?1
       LIMIT ?2`,
    )
    .bind(nowMs, limit)
    .all<{ order_id: string }>();
  return rows.results.map((row) => row.order_id);
}

export async function listDueEvents(db: D1, nowMs: number, limit: number): Promise<EventRow[]> {
  const rows = await db
    .prepare(
      `SELECT event_id, project_id, payload_json, delivery_attempts FROM checkout_events
       WHERE delivered_at_ms IS NULL AND next_attempt_at_ms <= ?
       ORDER BY next_attempt_at_ms LIMIT ?`,
    )
    .bind(nowMs, limit)
    .all<EventRow>();
  return rows.results;
}

/** Records the result of one delivery: `nextAttemptAtMs` is null after a 2xx answer. */
export async function recordEventDelivery(
  db: D1,
  eventId: string,
  nowMs: number,
  nextAttemptAtMs: number | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE checkout_events SET
         delivery_attempts = delivery_attempts + 1,
         delivered_at_ms = CASE WHEN ?1 IS NULL THEN ?2 ELSE NULL END,
         next_attempt_at_ms = coalesce(?1, next_attempt_at_ms)
       WHERE event_id = ?3`,
    )
    .bind(nextAttemptAtMs, nowMs, eventId)
    .run();
}
