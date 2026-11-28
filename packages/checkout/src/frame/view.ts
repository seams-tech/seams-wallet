import type { MethodOption } from '../shared/api';
import type { FrameMessage, OpenMessage } from '../shared/protocol';

type Child = Node | string | null;

/** Makes an element with its properties, its attributes and its children. */
export function el<K extends keyof HTMLElementTagNameMap>(
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

/**
 * Puts `root` into the document with the page's theme and language, and sends each new height
 * of `root` to the page.
 */
export function showRoot(root: HTMLElement, open: OpenMessage, send: (message: FrameMessage) => void): void {
  const { theme } = open;
  if (theme.accent) root.style.setProperty('--co-accent', theme.accent);
  if (theme.radius !== undefined) root.style.setProperty('--co-radius', `${theme.radius}px`);
  if (theme.buttonHeight !== undefined) root.style.setProperty('--co-button-height', `${theme.buttonHeight}px`);
  if (theme.fontFamily) root.style.setProperty('--co-font', `${theme.fontFamily}, system-ui, sans-serif`);
  document.documentElement.lang = open.locale;
  document.body.replaceChildren(root);
  new ResizeObserver(() => {
    send({ type: 'size', stage: open.stage, heightCssPx: root.getBoundingClientRect().height });
  }).observe(root);
}

/** The project's methods, as a subset and in the order of the page when the page gives one. */
export function offeredMethods(methods: readonly MethodOption[], open: OpenMessage): MethodOption[] {
  const order = open.methods;
  if (!order) return [...methods];
  return methods
    .filter((option) => order.includes(option.method))
    .sort((a, b) => order.indexOf(a.method) - order.indexOf(b.method));
}
