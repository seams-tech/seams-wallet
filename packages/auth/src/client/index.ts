import {
  connectFrame,
  createRequestLedger,
  createStageDialog,
  isStageHost,
  type FrameConnection,
  type Stage,
  type StageHost,
} from '../../../frame-kit/src/index';
import { isPlainObject } from '@shared/utils/validation';
import type { AuthLocale, AuthMenuCopy } from '../shared/copy';
import {
  ACCOUNT_FRAME_PATH,
  AUTH_ERROR_EVENT,
  AUTH_FRAME_WIDTH_CSS_PX,
  AUTH_PROTOCOL,
  parseFrameMessage,
  type AuthMethodName,
  type AuthSessionSummary,
  type InitMessage,
  type MethodChangeResult,
  type MethodsResult,
  type PageRequestBody,
  type ProveResult,
  type SessionResult,
  type SignInResult,
} from '../shared/protocol';

export type { StageHost } from '../../../frame-kit/src/index';
export type { AuthLocale, AuthMenuCopy } from '../shared/copy';
export {
  AUTH_ERROR_EVENT,
  type AuthErrorDetail,
  type AuthMethodName,
  type AuthMethodSummary,
  type AuthSessionSummary,
  type MethodChangeResult,
  type MethodsResult,
  type ProveResult,
} from '../shared/protocol';

// Seams Auth for an app page. The page gets only results: a login token, a proof statement and
// the list of methods. Each passkey prompt, email code and voice check runs in the account
// frame, on the account origin.

/** A sign-in method that the app offers. It is data only and loads no code. */
export type AuthMethodDescriptor = { readonly method: AuthMethodName };

export function passkey(): AuthMethodDescriptor {
  return { method: 'passkey' };
}

export function emailCode(): AuthMethodDescriptor {
  return { method: 'email_code' };
}

export function voiceId(): AuthMethodDescriptor {
  return { method: 'voiceid' };
}

export type SeamsAuthConfig = {
  /** The origin that serves the account frame, for example `https://account.example.com`. */
  readonly accountOrigin: string;
  readonly publishableKey: string;
  /** The ID of the project environment of the publishable key. */
  readonly environmentId: string;
  readonly methods: readonly AuthMethodDescriptor[];
  /** The plugins of the account origin that the app uses, for example `mpc-wallet`. */
  readonly plugins?: readonly string[];
  readonly locale?: AuthLocale;
  /** The app's own words for the auth menu. */
  readonly copy?: AuthMenuCopy;
  /**
   * The dialog of the page, when another Seams package on the page already has one. Without it
   * auth makes its own dialog.
   */
  readonly stageHost?: StageHost;
};

/** The account frame cannot be reached, or it refused the configuration. */
export class SeamsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeamsAuthError';
  }
}

export type SeamsAuth = {
  /**
   * Opens the auth menu. It gives the login token for the app's backend, or null when the user
   * closed the menu. With `stage`, the menu is a stage of that dialog.
   */
  signIn(stage?: StageHost): Promise<string | null>;
  /** The login token of the signed-in user, or null. It opens no dialog. */
  token(): Promise<string | null>;
  /** The signed-in user, or null. It opens no dialog. */
  session(): Promise<AuthSessionSummary | null>;
  signOut(): Promise<void>;
  /**
   * Proves a method of the user to one audience. The server of the audience issued the
   * challenge, and it checks the statement.
   */
  prove(request: { readonly audience: string; readonly challenge: string }): Promise<ProveResult>;
  readonly methods: {
    list(): Promise<MethodsResult>;
    add(request: { readonly method: AuthMethodName }): Promise<MethodChangeResult>;
    remove(request: { readonly id: string }): Promise<MethodChangeResult>;
  };
  /**
   * A message channel to one plugin of the account origin. Auth routes the port and does not
   * read the messages. A package such as the MPC wallet builds its own API on it.
   */
  channel(pluginId: string): Promise<MessagePort>;
  /** Calls the listener when a user signs in or out in this frame. */
  onSessionChange(listener: (accountId: string | null) => void): () => void;
};

type Pending = {
  readonly resolve: (result: Record<string, unknown>) => void;
  stage: Stage | null;
};

type Link = {
  readonly connection: FrameConnection;
  readonly pending: Map<string, Pending>;
  request(message: PageRequestBody): Promise<Record<string, unknown>>;
};

const UNAVAILABLE = (reason: string) => ({ kind: 'unavailable', reason }) as const;

export function createSeamsAuth(config: SeamsAuthConfig): SeamsAuth {
  const accountOrigin = new URL(config.accountOrigin).origin;
  if (config.stageHost !== undefined && !isStageHost(config.stageHost)) {
    throw new SeamsAuthError('stageHost is not a stage host of this frame kit version');
  }
  const init: InitMessage = {
    type: 'init',
    publishableKey: config.publishableKey,
    environmentId: config.environmentId,
    methods: config.methods.map((descriptor) => descriptor.method),
    plugins: [...(config.plugins ?? [])],
    locale: config.locale ?? 'en',
    copy: config.copy ?? {},
  };
  const sessionListeners = new Set<(accountId: string | null) => void>();
  const links = new Map<StageHost, Promise<Link>>();
  let ownDialog: StageHost | null = null;

  async function openLink(host: StageHost): Promise<Link> {
    const frame = host.createFrame({
      url: `${accountOrigin}${ACCOUNT_FRAME_PATH}`,
      title: 'Sign in',
      permissions: init.methods.includes('voiceid') ? ['passkeys', 'microphone'] : ['passkeys'],
    });
    const connection = await connectFrame(frame, { protocol: AUTH_PROTOCOL });
    const { port } = connection;
    const ledger = createRequestLedger('auth');
    const pending = new Map<string, Pending>();
    const frameStages = new Map<string, Stage>();
    const ready = new Promise<void>((resolve, reject) => {
      port.onmessage = (event: MessageEvent) => {
        const message = parseFrameMessage(event.data);
        if (!message) return;
        switch (message.type) {
          case 'ready':
            resolve();
            return;
          case 'refused':
            reject(
              new SeamsAuthError(`The account frame refused the configuration: ${message.reason}`),
            );
            return;
          case 'session_changed':
            for (const listener of sessionListeners) listener(message.accountId);
            return;
          case 'error': {
            const { type: _type, ...detail } = message;
            window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT, { detail }));
            return;
          }
          case 'show': {
            const { requestId } = message;
            const onDismiss = (): void => port.postMessage({ type: 'cancel', requestId });
            const show = (): Stage =>
              host.show({
                content: { kind: 'frame', frame },
                title: message.title,
                presentation: 'modal',
                onDismiss,
              });
            const request = pending.get(requestId);
            if (request && !request.stage) request.stage = show();
            // A plugin of the account origin asks for the dialog with an ID of the frame.
            else if (requestId.startsWith('frame:') && !frameStages.has(requestId)) {
              frameStages.set(requestId, show());
            }
            return;
          }
          case 'hide':
            frameStages.get(message.requestId)?.close();
            frameStages.delete(message.requestId);
            return;
          case 'resize': {
            const stage =
              pending.get(message.requestId)?.stage ?? frameStages.get(message.requestId);
            if (!stage?.isCurrent()) return;
            stage.resize({
              widthCssPx: AUTH_FRAME_WIDTH_CSS_PX,
              heightCssPx: message.heightCssPx,
            });
            return;
          }
          case 'reply': {
            const request = pending.get(message.requestId);
            if (!request || !ledger.settle(message.requestId)) return;
            pending.delete(message.requestId);
            request.stage?.close();
            request.resolve(isPlainObject(message.result) ? message.result : {});
            return;
          }
        }
      };
    });
    connection.onClosed(() => {
      links.delete(host);
      for (const [requestId, request] of pending) {
        ledger.settle(requestId);
        request.stage?.close();
        request.resolve(UNAVAILABLE('The account frame closed'));
      }
      pending.clear();
      for (const stage of frameStages.values()) stage.close();
      frameStages.clear();
    });
    port.postMessage(init);
    await ready;
    return {
      connection,
      pending,
      request(message) {
        return new Promise((resolve) => {
          const requestId = ledger.open();
          pending.set(requestId, { resolve, stage: null });
          port.postMessage({ ...message, requestId });
        });
      },
    };
  }

  function linkFor(stage?: StageHost): Promise<Link> {
    const host = stage ?? config.stageHost ?? (ownDialog ??= createStageDialog());
    let link = links.get(host);
    if (!link) {
      link = openLink(host);
      links.set(host, link);
      link.catch(() => links.delete(host));
    }
    return link;
  }

  /** A request whose result has a `kind`. A frame that cannot be reached gives `unavailable`. */
  async function ask<Result>(
    message: PageRequestBody,
    stage?: StageHost,
  ): Promise<Result | ReturnType<typeof UNAVAILABLE>> {
    try {
      return (await (await linkFor(stage)).request(message)) as Result;
    } catch (error) {
      return UNAVAILABLE(error instanceof Error ? error.message : String(error));
    }
  }

  async function session(): Promise<AuthSessionSummary | null> {
    const result = await ask<SessionResult>({ type: 'session' });
    if (result.kind === 'unavailable') throw new SeamsAuthError(result.reason);
    if (result.kind !== 'session') return null;
    const { kind: _kind, ...summary } = result;
    return summary;
  }

  return {
    async signIn(stage) {
      if (stage !== undefined && !isStageHost(stage)) {
        throw new SeamsAuthError('stage is not a stage host of this frame kit version');
      }
      const result = await ask<SignInResult>({ type: 'sign_in' }, stage);
      if (result.kind === 'unavailable') throw new SeamsAuthError(result.reason);
      return result.kind === 'signed_in' ? result.token : null;
    },
    async token() {
      return (await session())?.token ?? null;
    },
    session,
    async signOut() {
      await ask({ type: 'sign_out' });
    },
    prove: (request) =>
      ask<ProveResult>({ type: 'prove', audience: request.audience, challenge: request.challenge }),
    methods: {
      list: () => ask<MethodsResult>({ type: 'methods_list' }),
      add: (request) => ask<MethodChangeResult>({ type: 'methods_add', method: request.method }),
      remove: (request) => ask<MethodChangeResult>({ type: 'methods_remove', id: request.id }),
    },
    async channel(pluginId) {
      const link = await linkFor();
      const channel = new MessageChannel();
      link.connection.port.postMessage({ type: 'channel', pluginId }, [channel.port2]);
      return channel.port1;
    },
    onSessionChange(listener) {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
  };
}
