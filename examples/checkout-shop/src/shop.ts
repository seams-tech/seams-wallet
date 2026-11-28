import { createCheckout, type CheckoutOptions } from '@seams/checkout/client';

type ShopConfig = { readonly checkoutOrigin: string; readonly publishableKey: string };

const result = document.getElementById('result')!;
const inline = document.getElementById('inline')!;
const select = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function start(): Promise<void> {
  const config: ShopConfig = await (await fetch('/api/config')).json();
  const checkout = createCheckout(config);

  /** The shop's server makes the order. The browser gets only its client token. */
  async function options(): Promise<CheckoutOptions> {
    const order = await (await fetch('/api/orders', { method: 'POST' })).json();
    return {
      clientToken: order.clientToken,
      layout: select<HTMLSelectElement>('layout').value as CheckoutOptions['layout'],
      locale: select<HTMLSelectElement>('locale').value as CheckoutOptions['locale'],
      theme: { accent: '#2b7a52', radius: 12, buttonHeight: 48 },
    };
  }

  select<HTMLButtonElement>('pay-modal').onclick = async () => {
    const { kind } = await checkout.open(await options());
    // A hint for the page. The shop ships after the signed order event, on its server.
    result.textContent = `The checkout closed: ${kind}`;
  };
  select<HTMLButtonElement>('pay-inline').onclick = async () => {
    inline.replaceChildren();
    const { kind } = await checkout.mount(inline, await options()).result;
    result.textContent = `The inline checkout ended: ${kind}`;
  };
}

void start();
