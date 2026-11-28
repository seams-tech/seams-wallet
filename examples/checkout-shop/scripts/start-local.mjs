#!/usr/bin/env node
// Runs the example on this computer: the checkout origin (the frame document and the checkout
// Worker over a local D1 database) and the shop (its page and its small server).
//
// The provider keys come from the environment. They are the merchant's own TEST keys:
//   STRIPE_PUBLISHABLE_KEY, STRIPE_RESTRICTED_KEY, STRIPE_WEBHOOK_SECRET
//   KOMOJU_PUBLISHABLE_KEY, KOMOJU_SECRET_KEY, KOMOJU_WEBHOOK_SECRET
//   CARD_RAIL=stripe|komoju   the rail of the card method (default: stripe)
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { randomBytes } from 'node:crypto';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(example, '../..');
const checkoutPackage = path.join(repo, 'packages/checkout');
const CHECKOUT_PORT = Number(process.env.CHECKOUT_PORT ?? 4410);
const SHOP_PORT = Number(process.env.SHOP_PORT ?? 4411);
const CHECKOUT_ORIGIN = `http://localhost:${CHECKOUT_PORT}`;
const SHOP_ORIGIN = `http://localhost:${SHOP_PORT}`;
const PROJECT = 'baumkuchen-shop';
// Local credentials of the example. A real deployment gets them from the host's key store.
const SECRET_KEY = `sk_local_${randomBytes(12).toString('hex')}`;
const PUBLISHABLE_KEY = 'pk_local_baumkuchen';
const OPERATOR_KEY = randomBytes(16).toString('hex');
const key = () => randomBytes(32).toString('base64url');

const outdir = await mkdtemp(path.join(tmpdir(), 'checkout-shop-'));
async function bundle(entry, platform) {
  const name = path.relative(repo, entry).replace(/[^a-z0-9]+/gi, '-');
  const outfile = path.join(outdir, `${name}-${platform}.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform,
    target: 'es2022',
    tsconfig: path.join(example, 'tsconfig.json'),
  });
  return outfile;
}
const load = async (entry) => import(pathToFileURL(await bundle(path.join(checkoutPackage, entry), 'node')).href);
const text = async (entry) => readFile(await bundle(entry, 'browser'), 'utf8');

const { createCheckoutWorker } = await load('src/worker/index.ts');
const { stripeRail } = await load('src/worker/rails/stripe.ts');
const { komojuRail } = await load('src/worker/rails/komoju.ts');
const { createCheckoutServer, verifyOrderEvent, SIGNATURE_HEADER } = await load('src/server/index.ts');
const { CHECKOUT_FRAME_HTML, CHECKOUT_FRAME_SCRIPT, checkoutFrameCsp } = await load('src/frame/document.ts');
const frameScript = await text(path.join(checkoutPackage, 'src/frame/main.ts'));
const shopScript = await text(path.join(example, 'src/shop.ts'));

const runtime = new Miniflare({ modules: true, script: 'export default {};', d1Databases: ['DB'], port: 0 });
const db = await runtime.getD1Database('DB');
const migrations = path.join(checkoutPackage, 'migrations');
for (const name of (await readdir(migrations)).sort()) {
  const sql = (await readFile(path.join(migrations, name), 'utf8')).replace(/^--.*$/gm, '');
  const statements = sql.split(/;\s*$/m).map((statement) => statement.trim()).filter(Boolean);
  await db.batch(statements.map((statement) => db.prepare(statement)));
}

const worker = createCheckoutWorker({
  db,
  rails: [stripeRail, komojuRail],
  keys: { clientToken: key(), events: key(), rails: { stripe: key(), komoju: key() } },
  credentials: {
    secretKey: async (value) => (value === SECRET_KEY ? { projectId: PROJECT } : null),
    publishableKey: async (value, origin) =>
      value === PUBLISHABLE_KEY && origin === SHOP_ORIGIN ? { projectId: PROJECT } : null,
    operator: async (request) => request.headers.get('authorization') === `Bearer ${OPERATOR_KEY}`,
  },
  checkoutOrigin: CHECKOUT_ORIGIN,
});

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function send(response, status, type, body, headers = {}) {
  response.writeHead(status, { 'content-type': type, ...headers });
  response.end(body);
}

// The checkout origin: the Worker under /checkout/, and the frame document for the other paths.
createServer(async (request, response) => {
  const url = new URL(request.url, CHECKOUT_ORIGIN);
  if (url.pathname === `/${CHECKOUT_FRAME_SCRIPT}`) return send(response, 200, 'text/javascript', frameScript);
  if (!url.pathname.startsWith('/checkout/')) {
    return send(response, 200, 'text/html', CHECKOUT_FRAME_HTML, {
      'content-security-policy': checkoutFrameCsp([SHOP_ORIGIN]),
    });
  }
  const body = request.method === 'GET' ? undefined : await readBody(request);
  const answer = await worker.fetch(
    new Request(url, { method: request.method, headers: request.headers, body }),
    (work) => void work.catch((error) => console.error('[checkout] background work failed', error)),
  );
  send(response, answer.status, answer.headers.get('content-type') ?? 'application/json', await answer.text());
}).listen(CHECKOUT_PORT);
setInterval(() => void worker.scheduled().catch((error) => console.error('[checkout] tick failed', error)), 30_000);

// Set the project up as the Console does: the routing table, then each connected account.
async function operator(pathname, body) {
  const answer = await worker.fetch(
    new Request(`${CHECKOUT_ORIGIN}${pathname}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${OPERATOR_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const result = await answer.json();
  if (!answer.ok) throw new Error(`${pathname}: ${result.error.message}`);
  return result;
}
const env = process.env;
const accounts = {
  stripe: env.STRIPE_RESTRICTED_KEY && {
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
    restrictedKey: env.STRIPE_RESTRICTED_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
  },
  komoju: env.KOMOJU_SECRET_KEY && {
    publishableKey: env.KOMOJU_PUBLISHABLE_KEY,
    secretKey: env.KOMOJU_SECRET_KEY,
    webhookSecret: env.KOMOJU_WEBHOOK_SECRET,
  },
};
const cardRail = env.CARD_RAIL === 'komoju' ? 'komoju' : 'stripe';
const { eventSecret } = await operator(`/checkout/projects/${PROJECT}`, {
  routing: { card: cardRail },
  eventUrl: `${SHOP_ORIGIN}/seams-events`,
});
for (const [rail, account] of Object.entries(accounts)) {
  if (account) await operator(`/checkout/projects/${PROJECT}/rails/${rail}`, account);
}

// The shop: its page, and a server that makes orders and receives the signed order events.
const checkout = createCheckoutServer({ checkoutOrigin: CHECKOUT_ORIGIN, secretKey: SECRET_KEY });
const files = {
  '/': ['text/html', await readFile(path.join(example, 'index.html'))],
  '/shop.css': ['text/css', await readFile(path.join(example, 'shop.css'))],
  '/shop.js': ['text/javascript', shopScript],
};
createServer(async (request, response) => {
  const url = new URL(request.url, SHOP_ORIGIN);
  const file = files[url.pathname];
  if (file) return send(response, 200, file[0], file[1]);
  if (url.pathname === '/api/config') {
    return send(response, 200, 'application/json', JSON.stringify({ checkoutOrigin: CHECKOUT_ORIGIN, publishableKey: PUBLISHABLE_KEY }));
  }
  if (url.pathname === '/api/orders' && request.method === 'POST') {
    // The cart and its prices live on the server. The browser sends no amount.
    const order = await checkout.createOrder({
      reference: `order-${Date.now()}`,
      currency: 'JPY',
      lines: [
        { name: 'Plain baumkuchen', unitAmount: 1800, quantity: 1 },
        { name: 'Matcha baumkuchen', unitAmount: 2200, quantity: 1 },
      ],
      shipping: { amount: 600 },
    });
    return send(response, 200, 'application/json', JSON.stringify({ id: order.id, clientToken: order.clientToken }));
  }
  if (url.pathname === '/seams-events' && request.method === 'POST') {
    const body = (await readBody(request)).toString('utf8');
    const event = await verifyOrderEvent({ body, signature: request.headers[SIGNATURE_HEADER], secret: eventSecret });
    if (!event) return send(response, 400, 'text/plain', 'bad signature');
    console.log(`[shop] ${event.type}: ${event.order.reference} is ${event.order.state}`);
    return send(response, 200, 'text/plain', 'ok');
  }
  send(response, 404, 'text/plain', 'not found');
}).listen(SHOP_PORT);

console.log(`Shop:            ${SHOP_ORIGIN}`);
console.log(`Checkout origin: ${CHECKOUT_ORIGIN}`);
console.log(`Card rail:       ${cardRail}`);
for (const rail of ['stripe', 'komoju']) {
  const state = accounts[rail] ? `webhook URL ${CHECKOUT_ORIGIN}/checkout/webhooks/${rail}/${PROJECT}` : 'no keys in the environment';
  console.log(`  ${rail}: ${state}`);
}
