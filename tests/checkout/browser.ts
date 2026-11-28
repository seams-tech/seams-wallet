import type { Page, Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { CHECKOUT_FRAME_HTML, CHECKOUT_FRAME_SCRIPT, checkoutFrameCsp } from '../../packages/checkout/src/frame/document';
import { PROVIDER_SCRIPTS } from '../../packages/checkout/src/frame/providers';
import { CHECKOUT_ORIGIN, PUBLISHABLE_KEY, SHOP_ORIGIN, type TestCheckout } from './harness';

type CheckoutClient = typeof import('../../packages/checkout/src/client/index');

declare global {
  // The bundled page SDK, and the result of the checkout that the test opened.
  var checkoutClient: CheckoutClient;
  var checkoutResult: Promise<{ kind: string }>;
  var checkoutDone: string | undefined;
}

const root = path.resolve(import.meta.dirname, '../..');
const bundles = new Map<string, Promise<string>>();

function bundle(entry: string): Promise<string> {
  let made = bundles.get(entry);
  if (!made) {
    made = build({
      entryPoints: [path.join(root, entry)],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      tsconfig: path.join(root, 'packages/checkout/tsconfig.json'),
    }).then((result) => result.outputFiles[0]!.text);
    bundles.set(entry, made);
  }
  return made;
}

const SHOP_PAGE = `<!doctype html>
<html>
  <body style="margin:0;font:16px sans-serif">
    <h1>Baumkuchen shop</h1>
    <button id="pay" type="button">Pay</button>
    <div id="inline" style="width:420px"></div>
  </body>
</html>`;

/**
 * Stripe.js as the frame sees it: a card field and a confirm call. The card number decides the
 * result, as Stripe's test cards do. The "provider" behind it is the test's fake provider.
 */
const FAKE_STRIPE = `
window.fakeStripe = { calls: [] };
window.Stripe = (publishableKey, options) => {
  window.fakeStripe.calls.push({ publishableKey, options });
  let input;
  return {
    elements(elementsOptions) {
      window.fakeStripe.elements = elementsOptions;
      return {
        create(type, createOptions) {
          window.fakeStripe.create = { type, createOptions };
          if (type === 'expressCheckout') {
            // The button of a device wallet. A click is the approval in the sheet of the device.
            const handlers = {};
            let walletButton;
            return {
              on(event, handler) { handlers[event] = handler; },
              mount(container) {
                const wallet = createOptions.paymentMethods.applePay === 'always' ? 'Apple Pay' : 'Google Pay';
                const available = !window.fakeStripe.noWallet;
                setTimeout(() => handlers.availablepaymentmethodschange?.({ paymentMethods: available ? { applePay: true } : undefined }));
                if (!available) return;
                walletButton = document.createElement('button');
                walletButton.type = 'button';
                walletButton.textContent = wallet;
                walletButton.onclick = () => handlers.confirm?.({ paymentFailed(payload) { window.fakeStripe.walletFailed = payload; } });
                container.append(walletButton);
              },
              destroy() { walletButton?.remove(); },
            };
          }
          let onChange = () => {};
          return {
            mount(container) {
              input = document.createElement('input');
              input.setAttribute('aria-label', 'Card number');
              input.inputMode = 'numeric';
              input.addEventListener('input', () => onChange({ complete: input.value.length >= 16 }));
              container.append(input);
            },
            on(event, handler) { if (event === 'change') onChange = handler; },
            destroy() { input?.remove(); },
          };
        },
      };
    },
    async confirmPayment({ elements, confirmParams }) {
      window.fakeStripe.confirm = confirmParams;
      const response = await fetch('https://api.stripe.com/fake/confirm', {
        method: 'POST',
        body: JSON.stringify({ clientSecret: window.fakeStripe.elements.clientSecret, card: input?.value ?? window.fakeStripe.walletCard ?? '4242424242424242' }),
      });
      return response.json();
    },
  };
};
`;

/** KOMOJU Fields as the frame sees them: a custom element that pays a session and redirects. */
const FAKE_KOMOJU = `
class FakeKomojuFields extends HTMLElement {
  connectedCallback() {
    this.input = document.createElement('input');
    this.input.setAttribute('aria-label', 'Card number');
    this.append(this.input);
  }
  async submit() {
    if (this.input.value.length < 16) {
      this.dispatchEvent(new CustomEvent('komoju-invalid', { bubbles: true, cancelable: true, detail: { errors: ['number'] } }));
      return undefined;
    }
    const response = await fetch('https://komoju.com/fake/pay', {
      method: 'POST',
      body: JSON.stringify({ sessionId: this.getAttribute('session-id'), card: this.input.value }),
    });
    const answer = await response.json();
    if (answer.error) {
      this.dispatchEvent(new CustomEvent('komoju-error', { bubbles: true, cancelable: true, detail: { error: answer.error } }));
      return undefined;
    }
    window.location.href = answer.redirect_url;
  }
}
customElements.define('komoju-fields', FakeKomojuFields);
`;

const DECLINED_CARD = '4000000000000002';
const CHALLENGE_CARD = '4000000000003220';

async function fulfill(route: Route, body: string, contentType: string, headers: Record<string, string> = {}) {
  await route.fulfill({ status: 200, contentType, body, headers });
}

type BrowserOptions = {
  /** The origins that can embed the frame. The default is the shop. */
  readonly frameAncestors?: readonly string[];
};

/**
 * Serves the shop page, the checkout frame with its real Content-Security-Policy, the fake
 * provider scripts and the Worker of `checkout`, and opens the shop page with the SDK loaded.
 * Returns the Content-Security-Policy violations that the browser reports.
 */
export async function openShop(page: Page, checkout: TestCheckout, options: BrowserOptions = {}): Promise<string[]> {
  const { provider } = checkout;
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy') || message.text().includes('Content-Security-Policy')) {
      violations.push(message.text());
    }
  });
  const csp = checkoutFrameCsp(options.frameAncestors ?? [SHOP_ORIGIN]);
  const client = await bundle('packages/checkout/src/client/index.ts');
  const frame = await bundle('packages/checkout/src/frame/main.ts');

  await page.route(`${SHOP_ORIGIN}/`, (route) => fulfill(route, SHOP_PAGE, 'text/html'));
  await page.route(`${SHOP_ORIGIN}/checkout-client.js`, (route) => fulfill(route, client, 'text/javascript'));
  await page.route(`${CHECKOUT_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === `/${CHECKOUT_FRAME_SCRIPT}`) return fulfill(route, frame, 'text/javascript');
    if (!url.pathname.startsWith('/checkout/')) {
      return fulfill(route, CHECKOUT_FRAME_HTML, 'text/html', { 'content-security-policy': csp });
    }
    const background: Promise<unknown>[] = [];
    const response = await checkout.worker.fetch(
      new Request(request.url(), {
        method: request.method(),
        headers: await request.allHeaders(),
        body: request.postData() ?? undefined,
      }),
      (work) => background.push(work),
    );
    await Promise.all(background);
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: await response.text(),
    });
  });
  await page.route(PROVIDER_SCRIPTS.stripe, (route) => fulfill(route, FAKE_STRIPE, 'text/javascript'));
  await page.route(PROVIDER_SCRIPTS.komoju, (route) => fulfill(route, FAKE_KOMOJU, 'text/javascript'));

  const cors = { 'access-control-allow-origin': '*' };
  async function settle(ref: string, card: string): Promise<boolean> {
    if (card === DECLINED_CARD) provider.decline(ref);
    else {
      if (card === CHALLENGE_CARD) {
        provider.set(ref, 'requires_action');
        await checkout.webhook(ref);
      }
      provider.pay(ref);
    }
    await checkout.webhook(ref);
    return card !== DECLINED_CARD;
  }
  await page.route('https://api.stripe.com/fake/confirm', async (route) => {
    const { clientSecret, card } = JSON.parse(route.request().postData() ?? '{}');
    const paid = await settle(String(clientSecret).replace('_secret', ''), card);
    const body = paid ? {} : { error: { message: 'Your card was declined.' } };
    await fulfill(route, JSON.stringify(body), 'application/json', cors);
  });
  await page.route('https://komoju.com/fake/pay', async (route) => {
    const { sessionId, card } = JSON.parse(route.request().postData() ?? '{}');
    const paid = await settle(sessionId, card);
    const body = paid
      ? { redirect_url: `${CHECKOUT_ORIGIN}/return?session_id=${sessionId}` }
      : { error: { code: 'card_declined', message: 'KOMOJU declined the card.' } };
    await fulfill(route, JSON.stringify(body), 'application/json', cors);
  });

  await page.goto(`${SHOP_ORIGIN}/`);
  await page.evaluate(async () => {
    const sdkPath = '/checkout-client.js';
    globalThis.checkoutClient = await import(sdkPath);
  });
  return violations;
}

type OpenInput = {
  readonly clientToken: string;
  readonly options?: Record<string, unknown>;
  readonly inline?: boolean;
};

/** Opens the checkout in the shop page: a dialog, or the inline element. */
export async function openCheckoutInPage(page: Page, input: OpenInput): Promise<void> {
  await page.evaluate(
    ({ checkoutOrigin, publishableKey, clientToken, options, inline }) => {
      const checkout = globalThis.checkoutClient.createCheckout({ checkoutOrigin, publishableKey });
      const all = { clientToken, ...options };
      globalThis.checkoutResult = inline
        ? checkout.mount(document.getElementById('inline')!, all).result
        : checkout.open(all);
      globalThis.checkoutDone = undefined;
      void globalThis.checkoutResult.then((result) => {
        globalThis.checkoutDone = result.kind;
      });
    },
    { checkoutOrigin: CHECKOUT_ORIGIN, publishableKey: PUBLISHABLE_KEY, ...input, options: input.options ?? {}, inline: input.inline ?? false },
  );
}

/** The result of the checkout, after it settled. */
export async function checkoutResult(page: Page): Promise<string> {
  await page.waitForFunction(() => globalThis.checkoutDone !== undefined);
  return page.evaluate(() => globalThis.checkoutDone!);
}

export const GOOD_CARD = '4242424242424242';
export { CHALLENGE_CARD, DECLINED_CARD };
