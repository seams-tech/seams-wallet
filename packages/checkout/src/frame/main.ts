import { acceptFrameConnection } from '../../../frame-kit/src/index';
import type { CheckoutSession } from '../shared/api';
import type { CheckoutMethod, CustomerDetails, RailStart } from '../shared/methods';
import { formatAmount } from '../shared/money';
import {
  CHECKOUT_PROTOCOL,
  parseOpenMessage,
  type CheckoutStatus,
  type FrameMessage,
  type OpenMessage,
} from '../shared/protocol';
import { createFrameApi, FrameApiError, type FrameApi } from './api';
import { mountCardFields, type CardFields } from './providers';
import { FRAME_CSS } from './styles';
import { textsFor, type FrameTexts } from './texts';

const POLL_MS = 1500;
/** How long the frame waits for the rail's event after the provider took the payment. */
const CONFIRM_POLLS = 40;

type Child = Node | string | null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { readonly attrs?: Readonly<Record<string, string>> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const { attrs, ...rest } = props;
  const element = Object.assign(document.createElement(tag), rest);
  for (const [name, value] of Object.entries(attrs ?? {})) element.setAttribute(name, value);
  element.append(...children.filter((child) => child !== null));
  return element;
}

/** One checkout in the frame: it reads the order, shows the methods and runs one payment. */
function runCheckout(open: OpenMessage, port: MessagePort, parentOrigin: string): void {
  const texts: FrameTexts = textsFor(open.locale);
  const api: FrameApi = createFrameApi({
    clientToken: open.clientToken,
    publishableKey: open.publishableKey,
    parentOrigin,
  });
  const send = (message: FrameMessage): void => port.postMessage(message);
  const modal = open.presentation === 'modal';

  const title = el('h1', { className: 'co-title', textContent: texts.title });
  const closeButton = el('button', {
    className: 'co-close',
    type: 'button',
    textContent: '×',
    attrs: { 'aria-label': texts.close },
    onclick: () => send({ type: 'close' }),
  });
  const body = el('div');
  const status = el('p', { className: 'co-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  const root = el(
    'main',
    { className: 'co', lang: open.locale, attrs: { 'data-layout': open.layout, 'data-presentation': open.presentation } },
    el('div', { className: 'co-head' }, title, modal ? closeButton : null),
    body,
    status,
  );

  const { theme } = open;
  if (theme.accent) root.style.setProperty('--co-accent', theme.accent);
  if (theme.radius !== undefined) root.style.setProperty('--co-radius', `${theme.radius}px`);
  if (theme.buttonHeight !== undefined) {
    root.style.setProperty('--co-button-height', `${theme.buttonHeight}px`);
  }
  if (theme.fontFamily) {
    root.style.setProperty('--co-font', `${theme.fontFamily}, system-ui, sans-serif`);
  }
  document.documentElement.lang = open.locale;
  document.title = texts.title;
  document.body.replaceChildren(root);
  // The focus is inside the frame, so the page's dialog does not see the Escape key.
  if (modal) {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) send({ type: 'close' });
    });
  }
  new ResizeObserver(() => {
    send({ type: 'size', stage: open.stage, heightCssPx: root.getBoundingClientRect().height });
  }).observe(root);

  let cardFields: CardFields | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const report = (next: CheckoutStatus): void => send({ type: 'status', status: next });

  function show(...children: Child[]): void {
    cardFields?.destroy();
    cardFields = null;
    if (pollTimer !== null) clearTimeout(pollTimer);
    body.replaceChildren(...children.filter((child) => child !== null));
    status.textContent = '';
  }

  function showScreen(mark: Child, heading: string, text: string | null, action: Child = null): void {
    show(
      el('section', { className: 'co-screen' }, mark, el('h2', { textContent: heading }), text ? el('p', { textContent: text }) : null, action),
    );
  }

  const spinner = (): HTMLElement => el('div', { className: 'co-spinner', attrs: { 'aria-hidden': 'true' } });
  const doneButton = (): HTMLElement | null =>
    modal
      ? el('button', { className: 'co-pay', type: 'button', textContent: texts.done, onclick: () => send({ type: 'close' }) })
      : null;

  function showPaid(): void {
    report('paid');
    showScreen(
      el('div', { className: 'co-mark', textContent: '✓', attrs: { 'aria-hidden': 'true' } }),
      texts.paidTitle,
      texts.paidBody,
      doneButton(),
    );
  }

  function showClosed(reason: keyof FrameTexts['closedTitle']): void {
    report('failed');
    showScreen(null, texts.closedTitle[reason], null, doneButton());
  }

  /** Waits for the rail's event. The provider's answer in the browser is only a hint. */
  function showConfirming(polls = CONFIRM_POLLS): void {
    report('confirming');
    showScreen(spinner(), texts.confirming, null);
    const poll = async (left: number): Promise<void> => {
      const session = await api.session().catch(() => null);
      if (session && (session.order.state !== 'open' || !session.attempt)) return route(session, true);
      if (session?.attempt?.state === 'created' && session.attempt.failure) return route(session, true);
      if (left <= 0) {
        report('pending');
        return showScreen(spinner(), texts.pendingTitle, texts.pendingBody, doneButton());
      }
      pollTimer = setTimeout(() => void poll(left - 1), POLL_MS);
    };
    pollTimer = setTimeout(() => void poll(polls), POLL_MS);
  }

  function showMethods(session: CheckoutSession, refused: boolean): void {
    report('open');
    const { order } = session;
    const amount = formatAmount(order.amount, order.currency, open.locale);
    const offered = session.methods.filter((option) => !open.methods || open.methods.includes(option.method));
    const ordered = open.methods
      ? [...offered].sort((a, b) => open.methods!.indexOf(a.method) - open.methods!.indexOf(b.method))
      : offered;
    const details: { -readonly [K in keyof CustomerDetails]: string } = order.customerEmail ? { email: order.customerEmail } : {};

    const summary = el(
      'details',
      { className: 'co-summary' },
      el('summary', {}, el('span', { textContent: texts.orderSummary }), el('span', { className: 'co-amount', textContent: amount })),
      el(
        'ul',
        { className: 'co-lines' },
        ...order.lines.map((line) =>
          el(
            'li',
            {},
            el('span', { textContent: line.quantity > 1 ? `${line.name} × ${line.quantity}` : line.name }),
            el('span', { className: 'co-amount', textContent: formatAmount(line.unitAmount * line.quantity, order.currency, open.locale) }),
          ),
        ),
        order.shippingAmount > 0
          ? el('li', {}, el('span', { textContent: texts.shipping }), el('span', { className: 'co-amount', textContent: formatAmount(order.shippingAmount, order.currency, open.locale) }))
          : null,
      ),
    );
    if (ordered.length === 0) {
      show(summary, el('p', { className: 'co-error', textContent: texts.noMethods, attrs: { role: 'alert' } }));
      return;
    }

    const error = el('p', { className: 'co-error', attrs: { role: 'alert' } });
    const provider = el('div', { className: 'co-provider' });
    const inputs = el('div', { className: 'co-panel' });
    const panel = el('div', { className: 'co-panel' }, inputs, provider, error);
    const button = el('button', { className: 'co-pay', type: 'submit', textContent: texts.pay(amount), disabled: true });
    const rows = new Map<CheckoutMethod, HTMLElement>();
    const methods = el('fieldset', { className: 'co-methods' }, el('legend', { textContent: texts.methodsLabel }));
    for (const option of ordered) {
      const radio = el('input', { type: 'radio', name: 'method', value: option.method });
      radio.onchange = () => void select(option.method);
      const row = el('div', { className: 'co-method' }, el('label', {}, radio, el('span', { textContent: texts.methods[option.method] })));
      rows.set(option.method, row);
      methods.append(row);
    }
    const form = el('form', { className: 'co-form', noValidate: false }, methods, panel, button);
    show(summary, form);
    if (refused) error.textContent = texts.errorDeclined;

    /** What the pay button does next: ask for details, or submit the provider's fields. */
    let step: 'details' | 'fields' | 'busy' = 'busy';
    let selected: CheckoutMethod | null = null;

    function placePanel(method: CheckoutMethod): void {
      // In an accordion, the panel opens inside the row of its method.
      if (open.layout === 'accordion') rows.get(method)?.append(panel);
    }

    async function mount(method: CheckoutMethod, start: RailStart | null): Promise<void> {
      if (!start) throw new Error('The attempt has no next step');
      let ready = false;
      const mounted = await mountCardFields(start, {
        container: provider,
        theme,
        locale: open.locale,
        returnUrl: `${location.origin}/return`,
        onReady(next) {
          ready = next;
          if (selected === method && step === 'fields') button.disabled = !ready;
        },
      });
      if (selected !== method) return mounted.destroy();
      cardFields = mounted;
      step = 'fields';
      button.disabled = !ready;
      status.textContent = '';
    }

    async function startMethod(method: CheckoutMethod): Promise<void> {
      step = 'busy';
      button.disabled = true;
      button.textContent = texts.pay(amount);
      inputs.replaceChildren();
      status.textContent = texts.preparing;
      try {
        const attempt = await api.start({ method, details, locale: open.locale });
        if (selected === method) await mount(method, attempt.start);
      } catch (failure) {
        if (selected !== method) return;
        status.textContent = '';
        if (failure instanceof FrameApiError && failure.code === 'order_not_open') return void boot();
        error.textContent = texts.errorGeneric;
        step = 'details';
        button.textContent = texts.retry;
        button.disabled = false;
      }
    }

    async function select(method: CheckoutMethod, resume: RailStart | null = null): Promise<void> {
      selected = method;
      cardFields?.destroy();
      cardFields = null;
      provider.replaceChildren();
      if (!refused) error.textContent = '';
      placePanel(method);
      const option = ordered.find((candidate) => candidate.method === method)!;
      const missing = option.fields.filter((field) => !details[field]);
      if (resume) return mount(method, resume).catch(() => startMethod(method));
      if (missing.length === 0) return startMethod(method);
      step = 'details';
      button.textContent = texts.continue;
      button.disabled = false;
      inputs.replaceChildren(
        ...missing.map((field) => {
          const input = el('input', {
            type: field === 'email' ? 'email' : 'text',
            name: field,
            required: true,
            autocomplete: field,
            oninput: () => {
              details[field] = input.value.trim();
            },
          });
          return el('label', { className: 'co-field' }, el('span', { textContent: texts.fields[field] }), input);
        }),
      );
    }

    form.onsubmit = (event) => {
      event.preventDefault();
      if (!selected || step === 'busy') return;
      if (step === 'details') {
        if (form.reportValidity()) void startMethod(selected);
        return;
      }
      const fields = cardFields;
      if (!fields) return;
      step = 'busy';
      button.disabled = true;
      error.textContent = '';
      void fields.submit().then(
        (result) => {
          if (result.kind === 'submitted') return showConfirming();
          error.textContent = result.message ?? texts.errorDeclined;
          step = 'fields';
          button.disabled = false;
        },
        () => {
          error.textContent = texts.errorGeneric;
          step = 'fields';
          button.disabled = false;
        },
      );
    };

    const active = session.attempt;
    const first = active && rows.has(active.method) ? active.method : ordered.length === 1 ? ordered[0]!.method : null;
    if (first) {
      rows.get(first)!.querySelector('input')!.checked = true;
      void select(first, active?.method === first ? active.start : null);
    }
  }

  /** Shows the screen of the order's state. `returned`: the customer comes back from a provider. */
  function route(session: CheckoutSession, returned: boolean): void {
    const { state } = session.order;
    if (state === 'expired' || state === 'cancelled') return showClosed(state);
    if (state !== 'open') return showPaid();
    const attempt = session.attempt;
    const inFlight = attempt !== null && attempt.state !== 'created';
    if (inFlight || (returned && attempt !== null && !attempt.failure)) return showConfirming();
    showMethods(session, returned && Boolean(attempt?.failure));
  }

  async function boot(): Promise<void> {
    showScreen(spinner(), texts.loading, null);
    try {
      route(await api.session(), location.pathname === '/return');
    } catch {
      showClosed('unavailable');
    }
  }
  void boot();
}

const sheet = new CSSStyleSheet();
sheet.replaceSync(FRAME_CSS);
document.adoptedStyleSheets = [sheet];

acceptFrameConnection({
  protocol: CHECKOUT_PROTOCOL,
  // Each web page can ask. The Worker then checks the page's origin against the project of the
  // publishable key, and the frame shows nothing for a page that the project does not allow.
  isAllowedParent: (origin) => /^https?:\/\//.test(origin),
  onConnect({ port, parentOrigin }) {
    let started = false;
    port.onmessage = (event: MessageEvent) => {
      const open = parseOpenMessage(event.data);
      if (!open || started) return;
      started = true;
      runCheckout(open, port, parentOrigin);
    };
  },
});
