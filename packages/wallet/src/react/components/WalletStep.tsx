import React from 'react';
import { flushSync } from 'react-dom';
import type { Variant } from '@shared/utils/variant';
import type { WalletSurfaceSend } from '../../SeamsWeb/publicApi/surfaces';
import {
  WALLET_CARD_RESIZE_EASING,
  WALLET_CARD_RESIZE_MS,
  type WalletStepChrome,
  type WalletStepEvents,
  type WalletStepProgress,
  type WalletStepSize,
  type WalletStepTransition,
} from '../../SeamsWeb/walletIframe/shared/walletStep';
import { HostedSeamsAuthMenu } from './HostedSeamsAuthMenu/shell';
import type { HostedAuthMenuOutcome, HostedSeamsAuthMenuProps } from './HostedSeamsAuthMenu/types';

type AuthMenuStepProps = Omit<
  HostedSeamsAuthMenuProps,
  'onOutcome' | 'chrome' | 'layer' | 'transition' | keyof WalletStepEvents
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

type WalletStepOptions<T> = WalletStepEvents &
  Readonly<{
    /** Back, Close or both inside the card. Defaults to none. */
    chrome?: WalletStepChrome;
    /**
     * Minimize inside the card, beside Close. A press hides the card and runs `onMinimize`;
     * the card's work goes on. Defaults to false. The step reads it when it mounts.
     */
    minimize?: boolean;
    /**
     * How long the card waits and fades. Defaults to the Wallet's own times. The step reads it
     * when it mounts.
     */
    transition?: WalletStepTransition;
    /**
     * The height that the step keeps until the card has its size, such as the height of the app
     * step before it. Then the app's dialog changes size once. Defaults to 0.
     */
    initialHeight?: number;
    onOutcome?: (outcome: WalletStepOutcome<T>) => void;
    className?: string;
  }>;

export type WalletStepProps<T> = WalletStepOptions<T> & Readonly<{ surface: WalletStepSurface<T> }>;

/**
 * A Wallet card as one step of the app's own dialog. The card stays in the Wallet iframe: the SDK
 * places it over this step, above all app content, and the step takes the card's size. Mount the
 * step when the card should open; unmount it to end the card. Each mount starts one call.
 */
export function WalletStep<T>(props: WalletStepProps<T>): React.ReactElement {
  const { surface, ...options } = props;
  if (surface.kind === 'auth_menu') return <AuthMenuWalletStep {...options} surface={surface} />;
  return <SentWalletStep {...options} kind={surface.kind} send={surface.send} />;
}

function AuthMenuWalletStep<T>(
  props: WalletStepOptions<T> &
    Readonly<{ surface: Variant<WalletStepSurface<T>, 'kind', 'auth_menu'> }>,
): React.ReactElement {
  const { latest, events, entered } = useStepEvents(props);
  const { kind: _kind, ...menu } = props.surface;
  return (
    <div
      className={props.className}
      data-seams-wallet-step="auth_menu"
      style={{ minHeight: entered ? undefined : props.initialHeight }}
    >
      <HostedSeamsAuthMenu
        {...menu}
        {...events}
        layer="top"
        chrome={props.chrome ?? 'none'}
        transition={props.transition}
        onOutcome={(outcome) => latest.current.onOutcome?.({ kind: 'auth_menu', outcome })}
      />
    </div>
  );
}

type SentWalletStepProps<T> = WalletStepOptions<T> &
  Readonly<{
    kind: 'auth_menu' | 'transaction_confirm' | 'speak_to_sign';
    send: WalletSurfaceSend<T>;
  }>;

/** A step whose call sends the Wallet card with an anchored presentation over this step. */
export function SentWalletStep<T>(props: SentWalletStepProps<T>): React.ReactElement {
  const { latest, events, entered, ready } = useStepEvents(props);
  const anchor = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const element = anchor.current;
    if (!element) return undefined;
    const { send, chrome = 'none', minimize = false, transition } = latest.current;
    const controller = new AbortController();
    // Strict Mode mounts twice: only the mount that stays sends the call.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      send({
        ...events,
        kind: 'anchored',
        anchor: element,
        chrome,
        minimize,
        transition,
        signal: controller.signal,
      }).then(
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
      data-seams-wallet-step={props.kind}
      style={{ minHeight: entered ? undefined : props.initialHeight }}
    >
      <div
        ref={anchor}
        style={{
          display: 'block',
          width: '100%',
          minHeight: 'var(--seams-auth-menu-height, 0px)',
          // After its first size the card eases each new size; the step eases with it.
          transition: ready && !prefersReducedMotion() ? RESIZE_TRANSITION : undefined,
        }}
      />
    </div>
  );
}

const RESIZE_TRANSITION = `min-height ${WALLET_CARD_RESIZE_MS}ms ${WALLET_CARD_RESIZE_EASING}`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Events that read the newest props, and that end the held height when the card enters. */
function useStepEvents<P extends WalletStepEvents>(
  props: P,
): {
  latest: React.MutableRefObject<P>;
  events: Required<WalletStepEvents>;
  entered: boolean;
  ready: boolean;
} {
  const [entered, setEntered] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const latest = React.useRef(props);
  latest.current = props;
  const events = React.useMemo<Required<WalletStepEvents>>(
    () => ({
      onEnter: (size: WalletStepSize) => {
        // The anchor already reserves the card's height: drop the held height in the same frame.
        flushSync(() => setEntered(true));
        latest.current.onEnter?.(size);
      },
      onReady: () => {
        setReady(true);
        latest.current.onReady?.();
      },
      onResize: (size: WalletStepSize) => latest.current.onResize?.(size),
      onExit: (exit) => latest.current.onExit?.(exit),
      onBack: () => latest.current.onBack?.(),
      onClose: () => latest.current.onClose?.(),
      onMinimize: (restore: () => void) => latest.current.onMinimize?.(restore),
      onRestore: () => latest.current.onRestore?.(),
      onProgress: (progress: WalletStepProgress) => latest.current.onProgress?.(progress),
    }),
    [],
  );
  return { latest, events, entered, ready };
}
