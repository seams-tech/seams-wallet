import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';
import type {
  CheckoutOrder,
  CheckoutSession,
  CreateOrderInput,
  CreatedOrder,
} from '../../packages/checkout/src/shared/api';
import type { OrderEvent } from '../../packages/checkout/src/shared/events';
import type { D1 } from '../../packages/checkout/src/worker/d1';
import { createCheckoutWorker, type CheckoutWorker } from '../../packages/checkout/src/worker/index';
import type { RailModule } from '../../packages/checkout/src/worker/rails/rail';
import { FakeProvider, fakeRail } from './fakeRail';

const migrationsDirectory = fileURLToPath(
  new URL('../../packages/checkout/migrations/', import.meta.url),
);

export const CHECKOUT_ORIGIN = 'https://checkout.example.test';
export const SHOP_ORIGIN = 'https://shop.example.test';
export const EVENT_URL = 'https://shop.example.test/seams-events';
export const PROJECT = 'project-1';
export const SECRET_KEY = 'sk_project_1';
export const PUBLISHABLE_KEY = 'pk_project_1';
const OPERATOR_KEY = 'operator-key';
const START_MS = Date.UTC(2026, 10, 28, 3, 0, 0);
const AES_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export const ORDER: CreateOrderInput = {
  reference: 'order-1042',
  currency: 'JPY',
  lines: [
    { name: 'Plain baumkuchen', unitAmount: 1800, quantity: 1 },
    { name: 'Matcha baumkuchen', unitAmount: 2200, quantity: 1 },
  ],
  shipping: { amount: 600 },
  customerEmail: 'buyer@example.com',
};

type Answer<T> = { readonly status: number; readonly body: T };

type DeliveredEvent = { readonly event: OrderEvent; readonly signature: string; readonly body: string };

type CheckoutOptions = {
  /** The rails that the Worker loads. The default is one fake rail that takes cards. */
  readonly rails?: readonly RailModule[];
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response> | null;
};

export type TestCheckout = Awaited<ReturnType<typeof openCheckout>>;

/** A database with each migration of the checkout applied, in a local Workers runtime. */
async function openDatabase(): Promise<{ db: D1; close: () => Promise<void> }> {
  const runtime = new Miniflare({
    modules: true,
    script: 'export default {};',
    d1Databases: ['DB'],
    compatibilityDate: '2026-04-17',
    port: 0,
  });
  const database = await runtime.getD1Database('DB');
  for (const name of (await readdir(migrationsDirectory)).sort()) {
    const sql = await readFile(join(migrationsDirectory, name), 'utf8');
    await database.batch(unstable_splitSqlQuery(sql).map((query) => database.prepare(query)));
  }
  return { db: database as unknown as D1, close: () => runtime.dispose() };
}

/**
 * The checkout Worker over a real D1 database, with a clock that the test moves, a fake
 * provider and a merchant server that records the events that it gets.
 */
export async function openCheckout(options: CheckoutOptions = {}) {
  const { db, close } = await openDatabase();
  const provider = new FakeProvider();
  const clock = { nowMs: START_MS };
  const merchant = { status: 200, events: [] as DeliveredEvent[] };
  const background: Promise<unknown>[] = [];

  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const custom = options.fetch?.(url, init);
    if (custom) return custom;
    if (url !== EVENT_URL) throw new Error(`Unexpected request to ${url}`);
    const body = String(init.body);
    const signature = new Headers(init.headers).get('seams-signature') ?? '';
    if (merchant.status === 200) merchant.events.push({ event: JSON.parse(body), signature, body });
    return new Response(null, { status: merchant.status });
  };

  const worker: CheckoutWorker = createCheckoutWorker({
    db,
    rails: options.rails ?? [fakeRail(provider)],
    keys: { clientToken: 'client-token-key', events: AES_KEY, rails: { fake: AES_KEY, fake2: AES_KEY, stripe: AES_KEY, komoju: AES_KEY } },
    credentials: {
      secretKey: async (key) => (key === SECRET_KEY ? { projectId: PROJECT } : null),
      publishableKey: async (key, origin) =>
        key === PUBLISHABLE_KEY && origin === SHOP_ORIGIN ? { projectId: PROJECT } : null,
      operator: async (request) => request.headers.get('authorization') === `Bearer ${OPERATOR_KEY}`,
    },
    checkoutOrigin: CHECKOUT_ORIGIN,
    fetch: fetcher as typeof fetch,
    now: () => clock.nowMs,
  });

  async function call<T>(
    method: string,
    path: string,
    init: { bearer?: string; body?: unknown; headers?: Record<string, string>; raw?: string } = {},
  ): Promise<Answer<T>> {
    const response = await worker.fetch(
      new Request(`${CHECKOUT_ORIGIN}${path}`, {
        method,
        headers: {
          ...(init.bearer ? { authorization: `Bearer ${init.bearer}` } : {}),
          ...init.headers,
        },
        body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      }),
      (work) => background.push(work),
    );
    // The events that the request added reach the merchant before the test looks.
    await Promise.all(background.splice(0));
    return { status: response.status, body: (await response.json()) as T };
  }

  const frameHeaders = { 'seams-publishable-key': PUBLISHABLE_KEY, 'seams-parent-origin': SHOP_ORIGIN };

  return {
    db,
    worker,
    provider,
    clock,
    merchant,
    call,
    close,
    operator: <T>(method: string, path: string, body?: unknown) =>
      call<T>(method, path, { bearer: OPERATOR_KEY, body }),
    /** Makes the project with a routing table and connects an account for each rail in it. */
    async setUp(
      routing: Record<string, string> = { card: 'fake' },
      eventUrl: string | null = EVENT_URL,
      extra: Record<string, unknown> = {},
    ) {
      const made = await call<{ eventSecret: string | null }>('PUT', `/checkout/projects/${PROJECT}`, {
        bearer: OPERATOR_KEY,
        body: { routing, eventUrl, ...extra },
      });
      for (const rail of new Set(Object.values(routing))) {
        await call('PUT', `/checkout/projects/${PROJECT}/rails/${rail}`, { bearer: OPERATOR_KEY, body: {} });
      }
      return made.body.eventSecret ?? '';
    },
    createOrder: (input: Partial<CreateOrderInput> = {}) =>
      call<CreatedOrder>('POST', '/checkout/orders', { bearer: SECRET_KEY, body: { ...ORDER, ...input } }),
    getOrder: async (orderId: string) =>
      (await call<CheckoutOrder>('GET', `/checkout/orders/${orderId}`, { bearer: SECRET_KEY })).body,
    session: (clientToken: string) =>
      call<CheckoutSession>('GET', '/checkout/session', { bearer: clientToken, headers: frameHeaders }),
    start: <T = CheckoutSession['attempt']>(clientToken: string, body: unknown = { method: 'card' }) =>
      call<T>('POST', '/checkout/attempts', { bearer: clientToken, headers: frameHeaders, body }),
    /** Sends the provider's webhook for a payment of the fake rail. */
    async webhook(ref: string, rail = 'fake', railProvider = provider, funds?: number) {
      const { body, signature } =
        funds === undefined ? await railProvider.webhook(ref) : await railProvider.fundsWebhook(ref, funds);
      return call('POST', `/checkout/webhooks/${rail}/${PROJECT}`, {
        raw: body,
        headers: { 'fake-signature': signature },
      });
    },
    /** One tick of the schedule. */
    async tick() {
      await worker.scheduled();
    },
    eventTypes: () => merchant.events.map((delivered) => delivered.event.type),
  };
}
