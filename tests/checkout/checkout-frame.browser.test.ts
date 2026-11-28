import { expect, test, type Page } from '@playwright/test';
import { FakeProvider, fakeRail } from './fakeRail';
import { CHALLENGE_CARD, DECLINED_CARD, GOOD_CARD, checkoutResult, openCheckoutInPage, openShop } from './browser';
import { openCheckout, type TestCheckout } from './harness';

let checkout: TestCheckout;

test.afterEach(async () => {
  await checkout.close();
});

async function shopWithOrder(page: Page, order: Record<string, unknown> = {}) {
  checkout = await openCheckout();
  await checkout.setUp();
  const violations = await openShop(page, checkout);
  const { body } = await checkout.createOrder(order);
  return { order: body, violations };
}

const frameOf = (page: Page, title = 'Checkout') => page.frameLocator(`iframe[title="${title}"]`);

test.describe('the checkout frame, in a dialog', () => {
  test('a card payment: the receipt comes after the rail event, and the result is paid', async ({ page }) => {
    const { order, violations } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await expect(page.locator('dialog.seams-stage-dialog')).toHaveAttribute('aria-label', 'Checkout');
    // One method and a known email address: the card fields open at once.
    await expect(frame.getByRole('radio', { name: 'Card' })).toBeChecked();
    const pay = frame.getByRole('button', { name: 'Pay ￥4,600' }).or(frame.getByRole('button', { name: 'Pay ¥4,600' }));
    await expect(pay).toBeDisabled();
    await frame.getByLabel('Card number').fill(GOOD_CARD);
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
    expect((await checkout.getOrder(order.id)).state).toBe('paid');

    await frame.getByRole('button', { name: 'Done' }).click();
    expect(await checkoutResult(page)).toBe('paid');
    await expect(page.locator('iframe[title="Checkout"]')).toHaveCount(0);
    expect(violations).toEqual([]);
  });

  test('a declined card shows the provider text, and a second card pays the same attempt', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await frame.getByLabel('Card number').fill(DECLINED_CARD);
    await frame.getByRole('button', { name: /^Pay/ }).click();
    await expect(frame.getByRole('alert')).toHaveText('Your card was declined.');
    expect((await checkout.getOrder(order.id)).state).toBe('open');

    await frame.getByLabel('Card number').fill(GOOD_CARD);
    await frame.getByRole('button', { name: /^Pay/ }).click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
    expect((await checkout.getOrder(order.id)).attempts).toHaveLength(1);
  });

  test('3-D Secure: the frame waits, and then shows the receipt', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await frame.getByLabel('Card number').fill(CHALLENGE_CARD);
    await frame.getByRole('button', { name: /^Pay/ }).click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
  });

  test('a guest gives an email address, and then pays', async ({ page }) => {
    checkout = await openCheckout({ rails: [fakeRail(new FakeProvider(), 'fake', ['card'], ['email'])] });
    await checkout.setUp();
    await openShop(page, checkout);
    const { body: order } = await checkout.createOrder({ customerEmail: undefined });
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await expect(frame.getByLabel('Card number')).toHaveCount(0);
    await frame.getByLabel('Email address').fill('guest@example.com');
    await frame.getByRole('button', { name: 'Continue' }).click();
    await expect(frame.getByLabel('Card number')).toBeVisible();
    const attempts = await checkout.db
      .prepare('SELECT input_json FROM checkout_attempts')
      .all<{ input_json: string }>();
    expect(attempts.results[0]?.input_json).toContain('guest@example.com');
  });

  test('the customer closes the dialog before a payment: the result is cancelled', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    await expect(frameOf(page).getByLabel('Card number')).toBeVisible();
    await frameOf(page).getByRole('button', { name: 'Close' }).click();
    expect(await checkoutResult(page)).toBe('cancelled');
    expect((await checkout.getOrder(order.id)).state).toBe('open');

    await openCheckoutInPage(page, { clientToken: order.clientToken });
    await expect(frameOf(page).getByLabel('Card number')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await checkoutResult(page)).toBe('cancelled');
  });

  test('the keyboard alone pays: the fields and the button are in the tab order', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await frame.getByLabel('Card number').focus();
    await page.keyboard.type(GOOD_CARD);
    await page.keyboard.press('Enter');
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
    await expect(frame.getByRole('status')).toHaveCount(1);
  });

  test('an expired order cannot be paid: the result is failed', async ({ page }) => {
    const { order } = await shopWithOrder(page, { expiresInMinutes: 5 });
    checkout.clock.nowMs += 6 * 60_000;
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await expect(frame.getByRole('heading', { name: 'This order expired' })).toBeVisible();
    await frame.getByRole('button', { name: 'Done' }).click();
    expect(await checkoutResult(page)).toBe('failed');
  });

  test('Japanese: the Seams texts and the provider fields get the same locale', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { locale: 'ja' } });
    const frame = frameOf(page, 'お支払い');
    await expect(frame.getByRole('radio', { name: 'クレジットカード' })).toBeChecked();
    await expect(frame.getByRole('button', { name: /を支払う$/ })).toBeVisible();
    await expect(frame.locator('main')).toHaveAttribute('lang', 'ja');
    const locale = await frame.locator('main').evaluate(() => (window as any).fakeStripe.elements.locale);
    expect(locale).toBe('ja');
  });
});

test.describe('the theme and the layout', () => {
  test('one theme object styles the Seams button and becomes a Stripe appearance', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    const theme = { accent: '#2b7a52', radius: 12, buttonHeight: 52, fontFamily: 'Noto Sans JP' };
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { theme, layout: 'accordion' } });
    const frame = frameOf(page);
    const button = frame.getByRole('button', { name: /^Pay/ });
    await expect(button).toHaveCSS('background-color', 'rgb(43, 122, 82)');
    await expect(button).toHaveCSS('height', '52px');
    await expect(button).toHaveCSS('border-radius', '12px');
    await expect(frame.locator('main')).toHaveAttribute('data-layout', 'accordion');
    // In an accordion the card fields open inside the row of the method.
    await expect(frame.locator('.co-method .co-provider')).toHaveCount(1);
    const stripe = await frame.locator('main').evaluate(() => (window as any).fakeStripe);
    expect(stripe.elements.appearance).toEqual({
      theme: 'stripe',
      variables: { colorPrimary: '#2b7a52', borderRadius: '12px', fontFamily: 'Noto Sans JP, system-ui, sans-serif' },
    });
    expect(stripe.create).toEqual({
      type: 'payment',
      createOptions: { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never', link: 'never' } },
    });
  });

  test('a theme value that is not a colour, a number or a font name is dropped', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    const theme = { accent: 'red;background:url(https://evil.example)', radius: 400, fontFamily: 'x"; } body { display:none' };
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { theme } });
    const frame = frameOf(page);
    await expect(frame.getByRole('button', { name: /^Pay/ })).toHaveCSS('background-color', 'rgb(31, 41, 55)');
    await expect(frame.getByLabel('Card number')).toBeVisible();
    const stripe = await frame.locator('main').evaluate(() => (window as any).fakeStripe);
    expect(stripe.elements.appearance).toEqual({ theme: 'stripe', variables: {} });
  });

  test('the page can hide a method, and never add one', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { methods: [] } });
    await expect(frameOf(page).getByRole('alert')).toHaveText('No payment method is available for this order.');
  });
});

test.describe('the checkout frame, inline', () => {
  test('the frame takes the height of its content, and the result settles when the order is paid', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken, inline: true });
    const frame = frameOf(page);
    await frame.getByLabel('Card number').fill(GOOD_CARD);
    const box = await page.locator('#inline iframe').boundingBox();
    expect(box?.width).toBe(420);
    expect(box?.height).toBeGreaterThan(200);
    // An inline checkout has no close button: the page owns its place.
    await expect(frame.getByRole('button', { name: 'Close' })).toHaveCount(0);
    await frame.getByRole('button', { name: /^Pay/ }).click();
    expect(await checkoutResult(page)).toBe('paid');
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
  });
});

test.describe('KOMOJU card fields', () => {
  async function komojuShop(page: Page) {
    const provider = new FakeProvider();
    checkout = await openCheckout({ rails: [fakeRail(provider, 'fake', ['card'], [], 'komoju')] });
    await checkout.setUp();
    const shop = await openShop(page, { ...checkout, provider });
    const { body } = await checkout.createOrder();
    return { order: body, violations: shop, provider };
  }

  test('the fields pay the session, the frame comes back at the return page and shows the receipt', async ({ page }) => {
    const { order, violations } = await komojuShop(page);
    const theme = { accent: '#2b7a52', radius: 12 };
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { theme } });
    const frame = frameOf(page);
    const fields = frame.locator('komoju-fields');
    await expect(fields).toHaveAttribute('session-id', 'fp_1');
    await expect(fields).toHaveAttribute('payment-type', 'credit_card');
    const themeUrl = await fields.getAttribute('theme');
    expect(decodeURIComponent(themeUrl ?? '')).toBe(
      'data:text/css,:root,:host{--selected-color:#2b7a52}.field input,.radio{border-radius:12px}',
    );
    // KOMOJU's fields report no state, so the pay button is on from the start.
    const pay = frame.getByRole('button', { name: /^Pay/ });
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect(frame.getByRole('alert')).toHaveText(/declined|Check the details/);

    await frame.getByLabel('Card number').fill(GOOD_CARD);
    await pay.click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
    await frame.getByRole('button', { name: 'Done' }).click();
    expect(await checkoutResult(page)).toBe('paid');
    expect(violations).toEqual([]);
  });
});

test.describe('who can embed the frame', () => {
  test('a page that the project does not allow gets no order', async ({ page }) => {
    checkout = await openCheckout();
    await checkout.setUp();
    await openShop(page, checkout);
    const { body: order } = await checkout.createOrder();
    await page.evaluate(
      ({ clientToken }) => {
        const other = globalThis.checkoutClient.createCheckout({
          checkoutOrigin: 'https://checkout.example.test',
          publishableKey: 'pk_other_project',
        });
        globalThis.checkoutDone = undefined;
        void other.open({ clientToken }).then((result) => {
          globalThis.checkoutDone = result.kind;
        });
      },
      { clientToken: order.clientToken },
    );
    const frame = frameOf(page);
    await expect(frame.getByRole('heading', { name: 'This order cannot be paid here' })).toBeVisible();
    await expect(frame.getByText('4,600')).toHaveCount(0);
    await frame.getByRole('button', { name: 'Done' }).click();
    expect(await checkoutResult(page)).toBe('failed');
  });

  test('the browser refuses the frame in a page that the policy does not name', async ({ page }) => {
    checkout = await openCheckout();
    await checkout.setUp();
    await openShop(page, checkout, { frameAncestors: ['https://another-shop.example.test'] });
    const { body: order } = await checkout.createOrder();
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    await page.waitForTimeout(1500);
    const frame = page.frames().find((candidate) => candidate.parentFrame() === page.mainFrame());
    expect(await frame?.locator('main.co').count().catch(() => 0)).toBe(0);
  });
});

test.describe('konbini, bank transfer and PayPay in the frame', () => {
  let japan: FakeProvider;

  /** Cards on one rail and the Japanese methods on another: two providers in one page. */
  async function mixedShop(page: Page) {
    japan = new FakeProvider();
    const cards = new FakeProvider();
    checkout = await openCheckout({
      rails: [fakeRail(cards, 'fake', ['card']), fakeRail(japan, 'fake2', ['konbini', 'bank_transfer', 'paypay'])],
    });
    await checkout.setUp({ card: 'fake', konbini: 'fake2', bank_transfer: 'fake2', paypay: 'fake2' });
    await openShop(page, { ...checkout, provider: cards });
    // The wallet's page opens in a tab of its own, so the route is of the browser context.
    await page.context().route('https://provider.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Provider page</h1>' }),
    );
    return (await checkout.createOrder()).body;
  }

  test('konbini: the voucher is a Seams screen, the result is pending, and another method cancels it', async ({ page }) => {
    const order = await mixedShop(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await expect(frame.getByRole('radio')).toHaveCount(4);
    // No method is selected at the start, and nothing is issued.
    await expect(frame.getByRole('radio', { checked: true })).toHaveCount(0);
    await frame.getByRole('radio', { name: 'Convenience store' }).check();
    await frame.getByRole('combobox', { name: 'Store' }).selectOption('lawson');
    expect(japan.calls).toEqual([]);
    await frame.getByRole('button', { name: /^Pay/ }).click();

    await expect(frame.getByRole('heading', { name: 'Pay at the store' })).toBeVisible();
    await expect(frame.getByText('123456')).toBeVisible();
    await expect(frame.getByText('Lawson, FamilyMart')).toBeVisible();
    await expect(frame.getByText(/^Pay by /)).toBeVisible();
    await expect(frame.getByRole('link', { name: 'Open the payment instructions' })).toHaveAttribute(
      'href',
      'https://provider.example.test/voucher/fp_1',
    );
    await frame.getByRole('button', { name: 'Done' }).click();
    expect(await checkoutResult(page)).toBe('pending');

    // The voucher comes back when the customer opens the checkout again.
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    await expect(frame.getByText('123456')).toBeVisible();
    await frame.getByRole('button', { name: 'Use another payment method' }).click();
    await frame.getByRole('radio', { name: 'Card' }).check();
    await frame.getByLabel('Card number').fill(GOOD_CARD);
    expect(japan.calls).toEqual(['start:konbini', 'cancel:fp_1']);
    await frame.getByRole('button', { name: /^Pay/ }).click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
  });

  test('bank transfer: the account details are a Seams screen', async ({ page }) => {
    const order = await mixedShop(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { locale: 'ja' } });
    const frame = frameOf(page, 'お支払い');
    await frame.getByRole('radio', { name: '銀行振込' }).check();
    await frame.getByRole('button', { name: /を支払う$/ }).click();
    await expect(frame.getByRole('heading', { name: '銀行振込でお支払いください' })).toBeVisible();
    await expect(frame.getByText('Seams Bank')).toBeVisible();
    await expect(frame.getByText('1234567')).toBeVisible();
  });

  test('PayPay: the wallet opens in its own tab, and the frame shows the receipt after the approval', async ({ page }) => {
    const order = await mixedShop(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await frame.getByRole('radio', { name: 'PayPay' }).check();
    await frame.getByRole('button', { name: /^Pay/ }).click();
    await expect(frame.getByRole('heading', { name: 'Approve the payment with PayPay' })).toBeVisible();
    const [wallet] = await Promise.all([
      page.waitForEvent('popup'),
      frame.getByRole('link', { name: 'Open PayPay' }).click(),
    ]);
    await wallet.waitForURL('https://provider.example.test/paypay/fp_1');
    await expect(frame.getByRole('heading', { name: 'Confirming your payment' })).toBeVisible();
    // The shop's page is still there, under the dialog.
    await expect(page.getByRole('heading', { name: 'Baumkuchen shop' })).toBeAttached();

    japan.pay('fp_1');
    await checkout.webhook('fp_1', 'fake2', japan);
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
  });

  test('the return page in a tab of its own tells the customer to go back to the shop', async ({ page }) => {
    await mixedShop(page);
    await page.goto('https://checkout.example.test/return?session_id=x');
    await expect(page.getByText('You can close this window and go back to the shop.')).toBeVisible();
  });
});

test.describe('Apple Pay and Google Pay in the frame', () => {
  test('the frame has the payment permission for its own origin only', async ({ page }) => {
    const { order } = await shopWithOrder(page);
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    await expect(page.locator('iframe[title="Checkout"]')).toHaveAttribute('allow', 'payment https://checkout.example.test');
    await expect(frameOf(page).getByLabel('Card number')).toBeVisible();
  });

  test('the button of the wallet replaces the Seams pay button, and the approval pays the order', async ({ page }) => {
    const cards = new FakeProvider();
    checkout = await openCheckout({ rails: [fakeRail(cards, 'fake', ['card', 'apple_pay', 'google_pay'])] });
    await checkout.setUp({ apple_pay: 'fake', google_pay: 'fake', card: 'fake' });
    await openShop(page, { ...checkout, provider: cards });
    const { body: order } = await checkout.createOrder();
    await openCheckoutInPage(page, { clientToken: order.clientToken, options: { theme: { buttonHeight: 60 } } });
    const frame = frameOf(page);
    await frame.getByRole('radio', { name: 'Apple Pay' }).check();
    const applePay = frame.getByRole('button', { name: 'Apple Pay' });
    await expect(applePay).toBeVisible();
    await expect(frame.getByRole('button', { name: /^Pay ¥/ })).toBeHidden();
    const created = await frame.locator('main').evaluate(() => (window as any).fakeStripe.create);
    expect(created).toEqual({
      type: 'expressCheckout',
      createOptions: {
        paymentMethods: { applePay: 'always', googlePay: 'never', link: 'never', paypal: 'never', amazonPay: 'never', klarna: 'never' },
        buttonHeight: 55,
      },
    });
    await applePay.click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
    const paid = await checkout.getOrder(order.id);
    expect(paid.attempts.map((attempt) => [attempt.method, attempt.state])).toEqual([['apple_pay', 'succeeded']]);
  });

  test('a browser with no such wallet says so, and the card still works', async ({ page }) => {
    const cards = new FakeProvider();
    checkout = await openCheckout({ rails: [fakeRail(cards, 'fake', ['card', 'google_pay'])] });
    await checkout.setUp({ google_pay: 'fake', card: 'fake' });
    await openShop(page, { ...checkout, provider: cards });
    const { body: order } = await checkout.createOrder();
    await openCheckoutInPage(page, { clientToken: order.clientToken });
    const frame = frameOf(page);
    await frame.getByRole('radio', { name: 'Card' }).check();
    await frame.getByLabel('Card number').waitFor();
    await frame.locator('main').evaluate(() => {
      (window as any).fakeStripe.noWallet = true;
    });
    await frame.getByRole('radio', { name: 'Google Pay' }).check();
    await expect(frame.getByRole('alert')).toHaveText(/Google Pay is not available in this browser/);
    await frame.getByRole('radio', { name: 'Card' }).check();
    await frame.getByLabel('Card number').fill(GOOD_CARD);
    await frame.getByRole('button', { name: /^Pay ¥/ }).click();
    await expect(frame.getByRole('heading', { name: 'Payment complete' })).toBeVisible();
  });
});
