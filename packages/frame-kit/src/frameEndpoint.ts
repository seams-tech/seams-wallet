import {
  parseConnectMessage,
  readyMessage,
  refusedMessage,
  type FrameProtocol,
} from './handshake';

export type AcceptedFrameConnection = {
  readonly port: MessagePort;
  readonly parentOrigin: string;
};

type AcceptOptions = {
  readonly protocol: FrameProtocol;
  /** The owner's list of the pages that may embed this frame. */
  readonly isAllowedParent: (origin: string) => boolean;
  readonly onConnect: (connection: AcceptedFrameConnection) => void;
  readonly window?: Window;
};

/**
 * The frame's side of the handshake. It accepts one connection: from the parent window, with
 * exactly one port, from an origin that the owner allows. A page that is not allowed gets no
 * answer, so it learns nothing about the frame. Returns a function that stops listening.
 */
export function acceptFrameConnection(options: AcceptOptions): () => void {
  const view = options.window ?? window;
  const { protocol } = options;
  const stop = (): void => view.removeEventListener('message', onMessage);
  function onMessage(event: MessageEvent): void {
    const message = parseConnectMessage(event.data);
    if (!message || message.protocol !== protocol.name) return;
    const port = event.ports.length === 1 ? event.ports[0] : undefined;
    const fromParent = view.parent !== view && event.source === view.parent;
    if (
      !port ||
      !fromParent ||
      event.origin === 'null' ||
      !options.isAllowedParent(event.origin)
    ) {
      for (const transferred of event.ports) transferred.close();
      return;
    }
    if (message.version !== protocol.version) {
      port.postMessage(refusedMessage(protocol));
      port.close();
      return;
    }
    stop();
    port.postMessage(readyMessage(protocol));
    options.onConnect({ port, parentOrigin: event.origin });
  }
  view.addEventListener('message', onMessage);
  return stop;
}
