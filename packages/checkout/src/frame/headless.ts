import type { CheckoutSession } from '../shared/api';
import type { CheckoutMethod, CustomerDetails, RailStart } from '../shared/methods';
import { parsePageCommand, type CheckoutStatus, type FrameMessage, type OpenMessage } from '../shared/protocol';
import { createFrameApi, FrameApiError } from './api';
import { mountCardFields, mountWalletButton, type CardFields } from './providers';
import { el, offeredMethods, showRoot } from './view';

const POLL_MS = 1500;
const POLLS = 240;
/** The methods whose provider part opens when the page selects them. */
const EAGER_METHODS: readonly CheckoutMethod[] = ['card', 'apple_pay', 'google_pay'];

/**
 * Headless mode. The page draws the list of methods, the vouchers and the status. The frame
 * holds only the provider's card fields or wallet button, and it makes each call to the
 * checkout Worker. So the provider's script still never runs on the page.
 */
export function runHeadless(open: OpenMessage, port: MessagePort, parentOrigin: string): void {
  const api = createFrameApi({ clientToken: open.clientToken, publishableKey: open.publishableKey, parentOrigin });
  const send = (message: FrameMessage): void => port.postMessage(message);
  const report = (status: CheckoutStatus): void => send({ type: 'status', status });
  const fail = (code: string, message: string | null = null): void => send({ type: 'error', code, message });
  const provider = el('div', { className: 'co-provider' });
  showRoot(el('main', { className: 'co', attrs: { 'data-presentation': 'headless' } }, provider), open, send);

  let selected: { readonly method: CheckoutMethod; readonly details: CustomerDetails } | null = null;
  let part: Pick<CardFields, 'destroy'> | null = null;
  let submit: CardFields['submit'] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clear(): void {
    part?.destroy();
    part = null;
    submit = null;
    if (timer !== null) clearTimeout(timer);
    provider.replaceChildren();
  }

  /** Waits for the rail's event. The provider's answer in the browser is only a hint. */
  function waitForRail(): void {
    report('confirming');
    const tick = async (left: number): Promise<void> => {
      const session = await api.session().catch(() => null);
      const state = session?.order.state;
      if (state && state !== 'open') return report(state === 'expired' || state === 'cancelled' ? 'failed' : 'paid');
      if (session && (!session.attempt || (session.attempt.state === 'created' && session.attempt.failure))) {
        report('open');
        return fail('declined', session.attempt?.failure?.message ?? null);
      }
      if (left <= 0) return report('pending');
      timer = setTimeout(() => void tick(left - 1), POLL_MS);
    };
    timer = setTimeout(() => void tick(POLLS), POLL_MS);
  }

  async function showStart(method: CheckoutMethod, start: RailStart): Promise<void> {
    const options = { container: provider, theme: open.theme, locale: open.locale, returnUrl: `${location.origin}/return` };
    if (start.kind === 'card_form') {
      const fields = await mountCardFields(start, { ...options, onReady: () => {} });
      if (selected?.method !== method) return fields.destroy();
      part = fields;
      submit = fields.submit;
      return;
    }
    if (start.kind === 'wallet_button') {
      const button = await mountWalletButton(start, {
        ...options,
        onUnavailable: () => fail('wallet_unavailable'),
        onSubmit: (result) => (result.kind === 'submitted' ? waitForRail() : fail('declined', result.message)),
      });
      if (selected?.method !== method) return button.destroy();
      part = button;
      return;
    }
    send({ type: 'next_step', method, step: start });
    if (start.kind === 'redirect') waitForRail();
    else report('pending');
  }

  async function start(method: CheckoutMethod, details: CustomerDetails): Promise<void> {
    try {
      const attempt = await api.start({ method, details, locale: open.locale });
      if (selected?.method === method && attempt.start) await showStart(method, attempt.start);
    } catch (error) {
      fail(error instanceof FrameApiError ? error.code : 'unavailable');
    }
  }

  async function command(event: MessageEvent): Promise<void> {
    const message = parsePageCommand(event.data);
    if (!message) return;
    if (message.type === 'select') {
      clear();
      selected = { method: message.method, details: message.details };
      if (EAGER_METHODS.includes(message.method)) await start(message.method, message.details);
      return;
    }
    if (submit) {
      const result = await submit().catch(() => ({ kind: 'refused', message: null }) as const);
      return result.kind === 'submitted' ? waitForRail() : fail('declined', result.message);
    }
    if (!selected) return fail('no_method');
    // A method without card fields starts at pay, because a start issues a voucher.
    if (!EAGER_METHODS.includes(selected.method)) await start(selected.method, selected.details);
  }

  async function boot(): Promise<void> {
    let session: CheckoutSession;
    try {
      session = await api.session();
    } catch {
      return report('failed');
    }
    const { state } = session.order;
    if (state !== 'open') return report(state === 'expired' || state === 'cancelled' ? 'failed' : 'paid');
    send({ type: 'methods', order: session.order, methods: offeredMethods(session.methods, open) });
    const resume = session.attempt?.start;
    if (session.attempt && resume && resume.kind !== 'card_form' && resume.kind !== 'wallet_button') {
      send({ type: 'next_step', method: session.attempt.method, step: resume });
    }
    port.onmessage = (event: MessageEvent) => void command(event);
  }
  void boot();
}
