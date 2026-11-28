import { acceptFrameConnection } from '../../../frame-kit/src/index';
import { isPlainObject } from '@shared/utils/validation';
import { authMenuText } from '../shared/copy';
import {
  AUTH_PROTOCOL,
  parseInitMessage,
  parsePageRequest,
  type AuthMethodSummary,
  type FrameMessage,
  type InitMessage,
  type PageRequest,
} from '../shared/protocol';
import { createAuthApi } from './api';
import { ACCOUNT_CONFIG_ELEMENT_ID, type AccountOriginConfig } from './document';
import {
  MenuClosedError,
  addMethodFlow,
  listMethods,
  pluginProveFlow,
  proveFlow,
  readSession,
  removeMethodFlow,
  signInFlow,
  type FlowContext,
} from './flows';
import { Menu, el } from './menu';
import { loadPlugins, type AuthPlugin, type PluginHost } from './plugins';
import { createSessionStore } from './sessionStore';
import { ACCOUNT_FRAME_CSS } from './styles';

// The account frame. It accepts one connection from the app page that embeds it, takes the
// page's requests and answers each one with a result. The auth core starts no worker and loads
// no signing code. A plugin does that in its own files.

function readConfig(): AccountOriginConfig {
  const parsed: unknown = JSON.parse(
    document.getElementById(ACCOUNT_CONFIG_ELEMENT_ID)?.textContent ?? 'null',
  );
  if (!isPlainObject(parsed) || typeof parsed.rpId !== 'string') {
    throw new Error('The account document has no configuration');
  }
  return {
    authApiUrl: typeof parsed.authApiUrl === 'string' ? parsed.authApiUrl : '',
    rpId: parsed.rpId,
    purposes: (isPlainObject(parsed.purposes)
      ? parsed.purposes
      : {}) as AccountOriginConfig['purposes'],
  };
}

type Dialog = { readonly requestId: string; readonly controller: AbortController };

function start(port: MessagePort, appOrigin: string, init: InitMessage): void {
  const config = readConfig();
  const post = (message: FrameMessage, transfer: Transferable[] = []): void =>
    port.postMessage(message, transfer);
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(ACCOUNT_FRAME_CSS);
  document.adoptedStyleSheets = [sheet];
  document.documentElement.lang = init.locale;
  const text = authMenuText(init.locale, init.copy);
  const menu = new Menu(document.body, text, (detail) =>
    post({ type: 'error', kind: 'auth_error_v1', ...detail }),
  );
  const gateSurface = el('div', { className: 'surface', hidden: true });
  const pluginSurface = el('div', { className: 'surface', hidden: true });
  document.body.append(gateSurface, pluginSurface);
  const api = createAuthApi({
    baseUrl: config.authApiUrl,
    publishableKey: init.publishableKey,
    environmentId: init.environmentId,
    appOrigin,
  });
  const sessions = createSessionStore(init.environmentId);
  let dialog: Dialog | null = null;
  let frameDialogs = 0;

  new ResizeObserver(() => {
    if (!dialog) return;
    const heightCssPx = Math.ceil(document.body.getBoundingClientRect().height);
    if (heightCssPx > 0) post({ type: 'resize', requestId: dialog.requestId, heightCssPx });
  }).observe(document.body);

  // Escape goes to the frame while the focus is in it. It closes the dialog as it does on the page.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dialog) dialog.controller.abort();
  });

  /**
   * Runs one flow in the dialog of the page. One flow runs at a time. Null: another flow has
   * the dialog. A closed dialog gives `cancelled`.
   */
  async function inDialog<Result>(
    requestId: string,
    title: string,
    run: (context: FlowContext) => Promise<Result>,
  ): Promise<Result | { kind: 'cancelled' } | null> {
    if (dialog) return null;
    const controller = new AbortController();
    dialog = { requestId, controller };
    menu.onClose = () => controller.abort();
    controller.signal.addEventListener('abort', () => menu.cancelView());
    post({ type: 'show', requestId, title });
    try {
      return await run({
        api,
        sessions,
        menu,
        text,
        locale: init.locale,
        methods: init.methods,
        rpId: config.rpId,
        purposes: config.purposes,
        gateSurface,
        signal: controller.signal,
        beforeMethodRemoval,
      });
    } catch (error) {
      if (error instanceof MenuClosedError || controller.signal.aborted)
        return { kind: 'cancelled' };
      throw error;
    } finally {
      menu.hide();
      dialog = null;
    }
  }

  function hostFor(plugin: AuthPlugin): PluginHost {
    return {
      appOrigin,
      async account() {
        const stored = sessions.read();
        return stored ? { accountId: stored.accountId } : null;
      },
      async prove(request) {
        // A plugin proves only to the audiences that it registered.
        if (!plugin.audiences.includes(request.audience)) {
          return { kind: 'unavailable', reason: 'audience_not_allowed' };
        }
        const requestId = `frame:${(frameDialogs += 1)}`;
        try {
          const result = await inDialog(requestId, text.proveTitle, (context) =>
            pluginProveFlow(context, request),
          );
          return result ?? { kind: 'unavailable', reason: 'busy' };
        } finally {
          post({ type: 'hide', requestId });
        }
      },
      openSurface(title) {
        const requestId = `frame:${(frameDialogs += 1)}`;
        const controller = new AbortController();
        const element = el('div');
        dialog = { requestId, controller };
        pluginSurface.replaceChildren(element);
        pluginSurface.hidden = false;
        post({ type: 'show', requestId, title });
        return {
          element,
          close() {
            pluginSurface.hidden = true;
            pluginSurface.replaceChildren();
            if (dialog?.requestId === requestId) dialog = null;
            post({ type: 'hide', requestId });
          },
        };
      },
    };
  }

  const plugins = loadPlugins(init.plugins, hostFor);

  /** True when no plugin refuses the removal. */
  async function beforeMethodRemoval(method: AuthMethodSummary): Promise<boolean> {
    for (const loading of plugins.values()) {
      const loaded = await loading;
      if (loaded?.instance.beforeMethodRemoval) {
        const agreed = await loaded.instance.beforeMethodRemoval({
          id: method.id,
          method: method.method,
        });
        if (!agreed) return false;
      }
    }
    return true;
  }

  /** An audience of a plugin is for that plugin only. The app page cannot ask for it. */
  async function isPluginAudience(audience: string): Promise<boolean> {
    for (const loading of plugins.values()) {
      if ((await loading)?.plugin.audiences.includes(audience)) return true;
    }
    return false;
  }

  async function handle(request: PageRequest, ports: readonly MessagePort[]): Promise<void> {
    if (request.type === 'channel') {
      const [channel] = ports;
      const loaded = await plugins.get(request.pluginId);
      if (channel && loaded && ports.length === 1) loaded.instance.connect(channel);
      else for (const unused of ports) unused.close();
      return;
    }
    if (request.type === 'cancel') {
      if (dialog?.requestId === request.requestId) dialog.controller.abort();
      return;
    }
    const { requestId } = request;
    const reply = (result: object | null): void =>
      post({ type: 'reply', requestId, result: result ?? { kind: 'unavailable', reason: 'busy' } });
    switch (request.type) {
      case 'session':
        return reply(await readSession({ api, sessions }));
      case 'sign_out': {
        const stored = sessions.read();
        if (stored) await api.post('/v1/session/sign-out', {}, stored.sessionToken);
        sessions.clear();
        post({ type: 'session_changed', accountId: null });
        return reply({ kind: 'done' });
      }
      case 'methods_list':
        return reply(await listMethods({ api, sessions }));
      case 'sign_in': {
        const result = await inDialog(requestId, text.title, signInFlow);
        if (result?.kind === 'signed_in') {
          post({ type: 'session_changed', accountId: result.accountId });
        }
        return reply(result);
      }
      case 'prove': {
        if (await isPluginAudience(request.audience)) {
          return reply({ kind: 'unavailable', reason: 'audience_not_allowed' });
        }
        return reply(
          await inDialog(requestId, text.proveTitle, (context) => proveFlow(context, request)),
        );
      }
      case 'methods_add':
        return reply(
          await inDialog(requestId, text.methodsTitle, (context) =>
            addMethodFlow(context, request.method),
          ),
        );
      case 'methods_remove':
        return reply(
          await inDialog(requestId, text.removeTitle, (context) =>
            removeMethodFlow(context, request.id),
          ),
        );
    }
  }

  port.onmessage = (event: MessageEvent) => {
    const request = parsePageRequest(event.data);
    if (!request) {
      for (const unused of event.ports) unused.close();
      return;
    }
    handle(request, event.ports).catch((error: unknown) => {
      if ('requestId' in request && request.type !== 'cancel') {
        post({
          type: 'reply',
          requestId: request.requestId,
          result: { kind: 'unavailable', reason: String(error) },
        });
      }
    });
  };
  post({ type: 'ready' });
}

acceptFrameConnection({
  protocol: AUTH_PROTOCOL,
  // The Auth Worker checks the publishable key against the app origin, so each page can embed
  // the frame and only a page that the key allows gets an answer from the Worker.
  isAllowedParent: (origin) => /^https?:\/\//.test(origin),
  onConnect: ({ port, parentOrigin }) => {
    port.onmessage = (event: MessageEvent) => {
      const init = parseInitMessage(event.data);
      if (!init) {
        port.postMessage({ type: 'refused', reason: 'The configuration is not valid' });
        return;
      }
      start(port, parentOrigin, init);
    };
  },
});
