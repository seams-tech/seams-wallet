import React from 'react';
import { flushSync } from 'react-dom';
import type { WalletSurfaceSend } from '../../SeamsWeb/publicApi/surfaces';
import type {
  WalletStepChrome,
  WalletStepEvents,
  WalletStepSize,
} from '../../SeamsWeb/walletIframe/shared/walletStep';
import { HostedSeamsAuthMenu } from './HostedSeamsAuthMenu/shell';
import type { HostedAuthMenuOutcome, HostedSeamsAuthMenuProps } from './HostedSeamsAuthMenu/types';

type AuthMenuStepProps = Omit<
  HostedSeamsAuthMenuProps,
  'onOutcome' | 'chrome' | 'layer' | keyof WalletStepEvents
>;

/**
 * The Wallet card of a step. A transaction confirm and a Speak-to-Sign request send their call
 * with the presentation that the step gives them, such as
 * `send: (presentation) => wallet.near.signAndSendTransaction({ ...bet, presentation })`.
 */
export type WalletStepSurface<T> =
  | (Readonly<{ kind: 'auth_menu' }> & AuthMenuStepProps)
  | Readonly<{ kind: 'transaction_confirm' | 'speak_to_sign'; send: WalletSurfaceSend<T> }>;

export type WalletStepOutcome<T> =
  | Readonly<{ kind: 'auth_menu'; outcome: HostedAuthMenuOutcome }>
  | Readonly<{ kind: 'result'; result: T }>
  | Readonly<{ kind: 'error'; error: unknown }>;

export type WalletStepProps<T> = WalletStepEvents &
  Readonly<{
    surface: WalletStepSurface<T>;
    /** Back or Close inside the card. Defaults to none. */
    chrome?: WalletStepChrome;
    /**
     * The height that the step keeps until the card has its size, such as the height of the app
     * step before it. Then the app's dialog changes size once. Defaults to 0.
     */
    initialHeight?: number;
    onOutcome?: (outcome: WalletStepOutcome<T>) => void;
    className?: string;
  }>;

/**
 * A Wallet card as one step of the app's own dialog. The card stays in the Wallet iframe: the SDK
 * places it over this step, above all app content, and the step takes the card's size. Mount the
 * step when the card should open; unmount it to end the card. Each mount starts one call.
 */
export function WalletStep<T>(props: WalletStepProps<T>): React.ReactElement {
  const [entered, setEntered] = React.useState(false);
  const latest = React.useRef(props);
  latest.current = props;
  const events = React.useMemo(() => stepEvents(latest, setEntered), []);
  const anchor = React.useRef<HTMLDivElement>(null);
  const { surface } = props;
  const chrome = props.chrome ?? 'none';

  React.useEffect(() => {
    const element = anchor.current;
    const current = latest.current.surface;
    if (!element || current.kind === 'auth_menu') return undefined;
    const controller = new AbortController();
    // Strict Mode mounts twice: only the mount that stays sends the call.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      current
        .send({ ...events, kind: 'anchored', anchor: element, chrome, signal: controller.signal })
        .then(
          (result) => latest.current.onOutcome?.({ kind: 'result', result }),
          (error: unknown) => latest.current.onOutcome?.({ kind: 'error', error }),
        );
    });
    return () => controller.abort();
    // One mount is one call: later props change only the events, through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={props.className}
      data-seams-wallet-step={surface.kind}
      style={{ minHeight: entered ? undefined : props.initialHeight }}
    >
      {surface.kind === 'auth_menu' ? (
        <HostedSeamsAuthMenu
          {...authMenuProps(surface)}
          {...events}
          layer="top"
          chrome={chrome}
          onOutcome={(outcome) => latest.current.onOutcome?.({ kind: 'auth_menu', outcome })}
        />
      ) : (
        <div
          ref={anchor}
          style={{
            display: 'block',
            width: '100%',
            minHeight: 'var(--seams-auth-menu-height, 0px)',
          }}
        />
      )}
    </div>
  );
}

function authMenuProps(
  surface: Extract<WalletStepSurface<unknown>, { kind: 'auth_menu' }>,
): AuthMenuStepProps {
  const { kind: _kind, ...props } = surface;
  return props;
}

/** Events that read the newest props, and that end the held height when the card enters. */
function stepEvents<T>(
  latest: React.MutableRefObject<WalletStepProps<T>>,
  setEntered: (entered: boolean) => void,
): Required<WalletStepEvents> {
  return {
    onEnter: (size: WalletStepSize) => {
      // The anchor already reserves the card's height: drop the held height in the same frame.
      flushSync(() => setEntered(true));
      latest.current.onEnter?.(size);
    },
    onReady: () => latest.current.onReady?.(),
    onResize: (size: WalletStepSize) => latest.current.onResize?.(size),
    onExit: (exit) => latest.current.onExit?.(exit),
    onBack: () => latest.current.onBack?.(),
    onClose: () => latest.current.onClose?.(),
  };
}
