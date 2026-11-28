import type { AuthMenuText } from '../shared/copy';

// The auth menu: one card in the account frame that shows one view at a time. A flow asks the
// menu for the user's choice and waits. The menu knows no route of the Auth Worker.

type Child = Node | string | null | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {
    readonly attrs?: Readonly<Record<string, string>>;
  } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const { attrs, ...rest } = props;
  const element = Object.assign(document.createElement(tag), rest);
  for (const [name, value] of Object.entries(attrs ?? {})) element.setAttribute(name, value);
  element.append(...children.filter((child): child is Node | string => Boolean(child)));
  return element;
}

/** The user closed the menu, or the page closed its dialog. */
export class MenuClosedError extends Error {}

export type MenuView = {
  /** The name of the view in an error report. */
  readonly name: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly content: readonly Child[];
};

export class Menu {
  private readonly head = el('h1');
  private readonly subtitle = el('p', { className: 'subtitle' });
  private readonly body = el('div', { className: 'stack' });
  private readonly error = el('p', { className: 'error', attrs: { role: 'alert' } });
  private readonly card: HTMLElement;
  private viewName = '';
  private closed: ((error: MenuClosedError) => void) | null = null;
  /** Called when the user presses the close button. The owner ends the open request. */
  onClose: () => void = () => {};

  constructor(
    root: HTMLElement,
    readonly text: AuthMenuText,
    private readonly reportError: (detail: { code: string; message: string; view: string }) => void,
  ) {
    const close = el('button', {
      className: 'button icon',
      type: 'button',
      textContent: '×',
      attrs: { 'aria-label': text.closeCta },
    });
    close.addEventListener('click', () => this.onClose());
    this.card = el(
      'main',
      { className: 'menu', hidden: true },
      el('div', { className: 'head' }, this.head, close),
      this.subtitle,
      this.error,
      this.body,
    );
    root.append(this.card);
  }

  /** Ends the open view: its `ask` rejects with MenuClosedError. */
  cancelView(): void {
    this.closed?.(new MenuClosedError());
    this.closed = null;
  }

  hide(): void {
    this.card.hidden = true;
  }

  private render(view: MenuView): void {
    this.viewName = view.name;
    this.card.hidden = false;
    this.card.dataset.view = view.name;
    this.head.textContent = view.title;
    this.subtitle.textContent = view.subtitle ?? '';
    this.subtitle.hidden = !view.subtitle;
    this.body.replaceChildren(
      ...view.content.filter((child): child is Node | string => Boolean(child)),
    );
    this.body.querySelector<HTMLElement>('[autofocus]')?.focus();
  }

  /** Shows an error in the open view and reports its raw text to the app page. */
  showError(code: string, shown: string, raw = shown): void {
    this.error.textContent = shown;
    this.reportError({ code, message: raw, view: this.viewName });
  }

  private setBusy(busy: boolean): void {
    this.card.setAttribute('aria-busy', String(busy));
    for (const control of this.body.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button, input',
    )) {
      control.disabled = busy;
    }
  }

  /** Shows a view and waits for one choice of the user. The error of the last step stays. */
  ask<Choice>(build: (choose: (choice: Choice) => void) => MenuView): Promise<Choice> {
    return new Promise<Choice>((resolve, reject) => {
      this.closed = reject;
      this.render(
        build((choice) => {
          this.error.textContent = '';
          this.setBusy(true);
          resolve(choice);
        }),
      );
      this.setBusy(false);
    });
  }

  button(label: string, onClick: () => void, kind: 'primary' | 'plain' | 'quiet' = 'plain') {
    const button = el('button', {
      className: kind === 'plain' ? 'button' : `button ${kind}`,
      type: 'button',
      textContent: label,
    });
    button.addEventListener('click', onClick);
    return button;
  }

  /** A form with one field and one button. It gives the trimmed value of the field. */
  form(input: {
    readonly label: string;
    readonly cta: string;
    readonly field: Partial<HTMLInputElement>;
    /** False: another control of the view is the main action. */
    readonly primary?: boolean;
    readonly onSubmit: (value: string) => void;
  }): HTMLFormElement {
    const field = el('input', { className: 'field', required: true, ...input.field });
    const form = el(
      'form',
      { className: 'stack', noValidate: false },
      el('label', {}, input.label, field),
      el('button', {
        className: input.primary === false ? 'button' : 'button primary',
        type: 'submit',
        textContent: input.cta,
      }),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (field.value.trim()) input.onSubmit(field.value.trim());
    });
    return form;
  }
}
