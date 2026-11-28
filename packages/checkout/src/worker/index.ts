import { secureRandomBase64Url } from '@shared/utils/secureRandomId';
import { isPlainObject } from '@shared/utils/validation';
import {
  CHECKOUT_ROUTES,
  type CheckoutErrorBody,
  type CheckoutErrorCode,
  type StartAttemptInput,
} from '../shared/api';
import { isCheckoutMethod } from '../shared/methods';
import {
  connectRail,
  eventSecretSlot,
  parseProjectConfig,
  railAccountSlot,
  railEncryptionKey,
  railModule,
  type CheckoutContext,
  type CheckoutKeys,
} from './context';
import type { D1 } from './d1';
import { deliverDueEvents } from './events';
import { cancelOrder, createOrder } from './orders';
import {
  applyRailPayment,
  CheckoutError,
  orderView,
  readSession,
  recordUnmatchedFunds,
  settleOrder,
  startAttempt,
} from './payments';
import { RailError, type RailModule } from './rails/rail';
import { completeRefund, recordDispute, refundOrder } from './refunds';
import {
  findAttemptByRef,
  getAttempt,
  getOrder,
  getProject,
  listDueOrderIds,
  putProject,
  putRailAccount,
} from './store';
import { readClientToken, seal } from './vault';

/**
 * The checks of the project credentials. They belong to the host that deploys the Worker, which
 * owns the keys, the allowed origins and the operator's own credential.
 */
export type CheckoutCredentials = {
  /** The project of a secret key, for the merchant's server. */
  secretKey(key: string): Promise<{ readonly projectId: string } | null>;
  /** The project of a publishable key, when `origin` is one of its allowed origins. */
  publishableKey(key: string, origin: string): Promise<{ readonly projectId: string } | null>;
  /** True for a request of the operator, who connects accounts and sets the routing. */
  operator(request: Request): Promise<boolean>;
};

export type CheckoutWorkerOptions = {
  readonly db: D1;
  /** The rails that this deployment loads. */
  readonly rails: readonly RailModule[];
  readonly keys: CheckoutKeys;
  readonly credentials: CheckoutCredentials;
  /** The origin that serves the checkout frame and these routes. */
  readonly checkoutOrigin: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
};

export type CheckoutWorker = {
  fetch(request: Request, waitUntil?: (work: Promise<unknown>) => void): Promise<Response>;
  /** The work of each schedule tick: end what is past its time, and send the due events. */
  scheduled(): Promise<void>;
};

const STATUS: Readonly<Record<CheckoutErrorCode, number>> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  reference_reused: 409,
  order_not_open: 409,
  refund_not_possible: 409,
  method_not_available: 409,
  details_required: 422,
  rail_refused: 402,
  rail_unavailable: 503,
  invalid_signature: 400,
};

const SETTLE_BATCH = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function errorResponse(code: CheckoutErrorCode, message: string): Response {
  const body: CheckoutErrorBody = { error: { code, message } };
  return json(body, STATUS[code]);
}

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new CheckoutError('invalid_request', 'The body is not JSON');
  }
}

function unauthorized(): CheckoutError {
  return new CheckoutError('unauthorized', 'The credential is missing or not valid');
}

function parseStartAttempt(input: unknown): StartAttemptInput {
  if (!isPlainObject(input) || !isCheckoutMethod(input.method)) {
    throw new CheckoutError('invalid_request', 'The request needs a method');
  }
  const { details, locale } = input;
  if (details !== undefined && !isPlainObject(details)) {
    throw new CheckoutError('invalid_request', 'details is an object');
  }
  if (locale !== undefined && locale !== 'en' && locale !== 'ja') {
    throw new CheckoutError('invalid_request', 'locale is en or ja');
  }
  const texts = Object.entries(details ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return { method: input.method, details: Object.fromEntries(texts), locale };
}

export function createCheckoutWorker(options: CheckoutWorkerOptions): CheckoutWorker {
  const { credentials } = options;
  const context: CheckoutContext = {
    db: options.db,
    rails: new Map(options.rails.map((rail) => [rail.id, rail])),
    keys: options.keys,
    fetch: options.fetch ?? fetch.bind(globalThis),
    now: options.now ?? Date.now,
    checkoutOrigin: options.checkoutOrigin,
  };

  /** The order of the merchant's own project, for a request with a secret key. */
  async function merchantOrderId(request: Request, orderId: string): Promise<string> {
    const principal = await credentials.secretKey(bearer(request));
    if (!principal) throw unauthorized();
    const order = await getOrder(context.db, orderId);
    if (order?.project_id !== principal.projectId) {
      throw new CheckoutError('not_found', 'No such order');
    }
    return orderId;
  }

  /** The order of a client token. The frame also names the page that embeds it. */
  async function browserOrderId(request: Request): Promise<string> {
    const orderId = await readClientToken(context.keys.clientToken, bearer(request));
    const order = orderId ? await getOrder(context.db, orderId) : null;
    if (!order) throw unauthorized();
    const principal = await credentials.publishableKey(
      request.headers.get('seams-publishable-key') ?? '',
      request.headers.get('seams-parent-origin') ?? '',
    );
    if (principal?.projectId !== order.project_id) throw unauthorized();
    return order.order_id;
  }

  async function putProjectConfig(projectId: string, input: unknown): Promise<Response> {
    const config = parseProjectConfig(input, context.rails);
    const existing = await getProject(context.db, projectId);
    // The merchant sees the event secret once, when the project is made.
    const eventSecret = existing ? null : `ces_${secureRandomBase64Url(32)}`;
    const sealed =
      existing?.event_secret_sealed ??
      (await seal(context.keys.events, eventSecretSlot(projectId), eventSecret ?? ''));
    await putProject(
      context.db,
      { project_id: projectId, config_json: JSON.stringify(config), event_secret_sealed: sealed },
      context.now(),
    );
    return json({ projectId, config, eventSecret });
  }

  async function putAccount(projectId: string, railId: string, input: unknown): Promise<Response> {
    if (!context.rails.has(railId) || !(await getProject(context.db, projectId))) {
      throw new CheckoutError('not_found', 'No such project or rail');
    }
    const account = railModule(context, railId).parseAccount(input);
    const secrets = await seal(
      railEncryptionKey(context, railId),
      railAccountSlot(projectId, railId),
      JSON.stringify(account.secrets),
    );
    await putRailAccount(
      context.db,
      {
        project_id: projectId,
        rail_id: railId,
        public_json: JSON.stringify(account.public),
        secrets_sealed: secrets,
      },
      context.now(),
    );
    return json({ projectId, rail: railId, public: account.public });
  }

  /**
   * A webhook of a rail. The signature is checked on the raw body before anything reads it.
   * Then the Worker reads the payment from the provider and applies that state, so a repeated,
   * late or replayed event cannot set a state that the payment does not have.
   */
  async function webhook(request: Request, railId: string, projectId: string): Promise<Response> {
    const rail = context.rails.has(railId) ? await connectRail(context, projectId, railId) : null;
    if (!rail) return errorResponse('not_found', 'No such webhook');
    const body = await request.text();
    const event = await rail.events.verify({
      body,
      header: (name) => request.headers.get(name),
      nowMs: context.now(),
    });
    if (!event) return errorResponse('invalid_signature', 'The signature is not valid');
    if (event.kind === 'refund') await completeRefund(context, event.refundId, event.state);
    if (event.kind === 'dispute') {
      const attempt =
        (event.attemptId ? await getAttempt(context.db, event.attemptId) : null) ??
        (event.ref ? await findAttemptByRef(context.db, railId, event.ref) : null);
      const order = attempt ? await getOrder(context.db, attempt.order_id) : null;
      if (attempt && attempt.rail_id === railId && order?.project_id === projectId) {
        await recordDispute(context, attempt, event.disputeRef);
      }
    }
    if (event.kind === 'unmatched_funds') {
      const attempt = await getAttempt(context.db, event.attemptId);
      const order = attempt ? await getOrder(context.db, attempt.order_id) : null;
      if (attempt && attempt.rail_id === railId && order?.project_id === projectId) {
        await recordUnmatchedFunds(context, attempt, event.ref, event);
      }
    }
    if (event.kind === 'payment') {
      const attempt =
        (event.attemptId ? await getAttempt(context.db, event.attemptId) : null) ??
        (event.ref ? await findAttemptByRef(context.db, railId, event.ref) : null);
      const order = attempt ? await getOrder(context.db, attempt.order_id) : null;
      const ref = attempt?.rail_ref ?? null;
      // An event names its own project in the URL, so it cannot act on another project's order.
      if (attempt && ref && attempt.rail_id === railId && order?.project_id === projectId) {
        await applyRailPayment(context, attempt, ref, await rail.read(ref));
      }
    }
    return json({ received: true });
  }

  async function route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { method } = request;
    const [root, area, first, second, third] = url.pathname.split('/').filter(Boolean);
    if (root !== 'checkout') return errorResponse('not_found', 'No such route');
    const path = `/${root}/${area}`;

    if (path === CHECKOUT_ROUTES.projects && method === 'PUT' && first) {
      if (!(await credentials.operator(request))) throw unauthorized();
      try {
        if (!second) return await putProjectConfig(first, await readJson(request));
        if (second === 'rails' && third) return await putAccount(first, third, await readJson(request));
      } catch (error) {
        if (error instanceof CheckoutError) throw error;
        // The message says which field is wrong, and it holds no key.
        throw new CheckoutError('invalid_request', error instanceof Error ? error.message : 'Bad input');
      }
    }
    if (path === CHECKOUT_ROUTES.orders) {
      if (method === 'POST' && !first) {
        const principal = await credentials.secretKey(bearer(request));
        if (!principal) throw unauthorized();
        return json(await createOrder(context, principal.projectId, await readJson(request)), 201);
      }
      if (method === 'GET' && first && !second) {
        return json(orderView(await settleOrder(context, await merchantOrderId(request, first))));
      }
      if (method === 'POST' && first && second === 'refunds') {
        const orderId = await merchantOrderId(request, first);
        return json(orderView(await refundOrder(context, orderId, await readJson(request))), 201);
      }
      if (method === 'POST' && first && second === 'cancel') {
        return json(orderView(await cancelOrder(context, await merchantOrderId(request, first))));
      }
    }
    if (path === CHECKOUT_ROUTES.session && method === 'GET') {
      return json(await readSession(context, await browserOrderId(request)));
    }
    if (path === CHECKOUT_ROUTES.attempts && method === 'POST') {
      const orderId = await browserOrderId(request);
      return json(await startAttempt(context, orderId, parseStartAttempt(await readJson(request))), 201);
    }
    if (path === CHECKOUT_ROUTES.webhooks && method === 'POST' && first && second) {
      return webhook(request, first, second);
    }
    return errorResponse('not_found', 'No such route');
  }

  return {
    async fetch(request, waitUntil) {
      try {
        const response = await route(request);
        // A request can add an event. The merchant gets it at once, not at the next tick.
        waitUntil?.(deliverDueEvents(context));
        return response;
      } catch (error) {
        if (error instanceof CheckoutError) return errorResponse(error.code, error.message);
        if (error instanceof RailError) {
          return errorResponse(error.kind === 'refused' ? 'rail_refused' : 'rail_unavailable', error.message);
        }
        throw error;
      }
    },
    async scheduled() {
      for (const orderId of await listDueOrderIds(context.db, context.now(), SETTLE_BATCH)) {
        await settleOrder(context, orderId);
      }
      await deliverDueEvents(context);
    },
  };
}
