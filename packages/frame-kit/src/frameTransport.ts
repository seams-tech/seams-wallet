import { connectMessage, parseReplyMessage, type FrameProtocol } from './handshake';
import type { FramePermission, FrameSpec } from './stageHost';

const PERMISSION_FEATURES: Readonly<Record<FramePermission, readonly string[]>> = {
  passkeys: ['publickey-credentials-get', 'publickey-credentials-create'],
  clipboard: ['clipboard-read', 'clipboard-write'],
  microphone: ['microphone'],
  payment: ['payment'],
};

const DEFAULT_CONNECT_TIMEOUT_MS = 8000;

/** The frame's origin for each frame that `createFrame` made. */
const frameOrigins = new WeakMap<HTMLIFrameElement, string>();
/** How many documents each frame has loaded. */
const frameLoads = new WeakMap<HTMLIFrameElement, number>();

function frameOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`A frame loads only an http or https URL, not ${parsed.protocol}`);
  }
  return parsed.origin;
}

/** Each permission goes to the frame's origin only. */
function allowAttribute(origin: string, permissions: readonly FramePermission[]): string {
  const features = new Set(permissions.flatMap((permission) => PERMISSION_FEATURES[permission]));
  return [...features].map((feature) => `${feature} ${origin}`).join('; ');
}

/** Makes a frame and loads it in `parent`. Moving it later makes it load again. */
export function createFrame(parent: Element, spec: FrameSpec): HTMLIFrameElement {
  const origin = frameOrigin(spec.url);
  const frame = parent.ownerDocument.createElement('iframe');
  frame.title = spec.title;
  const allow = allowAttribute(origin, spec.permissions);
  // The allow attribute applies at navigation, so it is set before the source.
  if (allow) frame.setAttribute('allow', allow);
  frame.setAttribute('loading', 'eager');
  frameOrigins.set(frame, origin);
  frameLoads.set(frame, 0);
  frame.addEventListener('load', () => frameLoads.set(frame, (frameLoads.get(frame) ?? 0) + 1));
  frame.src = spec.url;
  parent.appendChild(frame);
  return frame;
}

export type FrameConnectErrorCode = 'timeout' | 'version_mismatch' | 'aborted' | 'detached';

export class FrameConnectError extends Error {
  readonly code: FrameConnectErrorCode;
  /** The version that the frame speaks, for `version_mismatch`. */
  readonly frameVersion: string | null;

  constructor(code: FrameConnectErrorCode, message: string, frameVersion: string | null = null) {
    super(message);
    this.name = 'FrameConnectError';
    this.code = code;
    this.frameVersion = frameVersion;
  }
}

export type FrameConnection = {
  readonly port: MessagePort;
  readonly origin: string;
  /** Called once, when the frame loads another document or the connection closes. */
  onClosed(listener: () => void): () => void;
  close(): void;
};

type ConnectOptions = {
  readonly protocol: FrameProtocol;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
};

function retryDelayMs(attempt: number): number {
  if (attempt < 10) return 200;
  if (attempt < 20) return 400;
  return 800;
}

function openConnection(frame: HTMLIFrameElement, port: MessagePort, origin: string): FrameConnection {
  const loadsAtConnect = frameLoads.get(frame) ?? 0;
  const listeners = new Set<() => void>();
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    frame.removeEventListener('load', onLoad);
    port.close();
    const pending = [...listeners];
    listeners.clear();
    for (const listener of pending) listener();
  };
  // The load counter runs first, because it was added when the frame was made.
  const onLoad = (): void => {
    if ((frameLoads.get(frame) ?? 0) > loadsAtConnect) close();
  };
  frame.addEventListener('load', onLoad);
  return {
    port,
    origin,
    onClosed(listener) {
      if (closed) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close,
  };
}

/**
 * Connects to a frame that `createFrame` made. Each attempt posts a new port to the exact frame
 * origin, never to `*`, so a document of another origin in the frame never gets a port.
 */
export function connectFrame(
  frame: HTMLIFrameElement,
  options: ConnectOptions,
): Promise<FrameConnection> {
  const knownOrigin = frameOrigins.get(frame);
  if (!knownOrigin) {
    return Promise.reject(new Error('connectFrame needs a frame that createFrame made'));
  }
  const origin: string = knownOrigin;
  const { protocol, signal } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const ports: MessagePort[] = [];
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  return new Promise<FrameConnection>((resolve, reject) => {
    const finish = (winner: MessagePort | null): void => {
      settled = true;
      if (timer !== null) clearTimeout(timer);
      frame.removeEventListener('load', post);
      signal?.removeEventListener('abort', onAbort);
      for (const port of ports) if (port !== winner) port.close();
    };
    const fail = (error: FrameConnectError): void => {
      if (settled) return;
      finish(null);
      reject(error);
    };
    const onAbort = (): void => fail(new FrameConnectError('aborted', 'The frame connection was aborted'));
    const onReply = (port: MessagePort, data: unknown): void => {
      if (settled) return;
      const reply = parseReplyMessage(data, protocol.name);
      if (!reply) return;
      if (reply.kind === 'frame_kit_refused_v1') {
        fail(
          new FrameConnectError(
            'version_mismatch',
            `The frame speaks ${protocol.name} ${reply.version}, not ${protocol.version}`,
            reply.version,
          ),
        );
        return;
      }
      if (reply.version !== protocol.version) return;
      finish(port);
      port.onmessage = null;
      resolve(openConnection(frame, port, origin));
    };
    function post(): void {
      if (settled) return;
      if (timer !== null) clearTimeout(timer);
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        fail(new FrameConnectError('timeout', `The frame did not answer in ${timeoutMs} ms`));
        return;
      }
      const target = frame.contentWindow;
      if (!target) {
        fail(new FrameConnectError('detached', 'The frame is not in a document'));
        return;
      }
      const channel = new MessageChannel();
      const port = channel.port1;
      port.onmessage = (event: MessageEvent) => onReply(port, event.data);
      ports.push(port);
      target.postMessage(connectMessage(protocol), origin, [channel.port2]);
      attempt += 1;
      timer = setTimeout(post, Math.min(retryDelayMs(attempt), remaining));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    // A load means a new document that can listen now, so it does not wait for the next attempt.
    frame.addEventListener('load', post);
    post();
  });
}
