import {
  describeWalletAlternatives,
  WalletAlternativesBroker,
  walletAlternativesControllerKey,
  type WalletAlternativesConfig,
} from './walletAlternatives';
import React from 'react';
import { SeamsAuthMenuMock } from './SeamsAuthMenuMock';
import { useSeams } from '@/react/context';
import {
  buildHostedAuthMenuOpenRequest,
  hostedAuthMenuExternalAuthRequestIdFromBoundary,
  hostedAuthMenuSessionIdFromBoundary,
  type HostedAuthMenuExternalAuthEvidence,
  type HostedAuthMenuExternalProvider,
  type HostedAuthMenuExternalAuthRequest,
  type HostedAuthMenuExternalAuthRequestId,
  type HostedAuthMenuMode,
  type HostedAuthMenuOutcome,
  type HostedAuthMenuSessionId,
} from '@/SeamsWeb/walletIframe/shared/messages';
import type { SeamsWeb } from '@/SeamsWeb';
import {
  endHostedAuthMenuAnchor,
  resetHostedAuthMenuAnchor,
} from '@/SeamsWeb/walletIframe/client/authMenuAnchor';
import type { HostedAuthMenuExternalAuthBroker, HostedSeamsAuthMenuProps } from './types';

type HostedAuthMenuBridge = Pick<SeamsWeb, 'authMenu'>;

type OutcomeRef = React.MutableRefObject<HostedSeamsAuthMenuProps['onOutcome']>;
type BrokerRef = React.MutableRefObject<HostedAuthMenuExternalAuthBroker | null>;
type HostedAuthMenuFailureCode = Extract<HostedAuthMenuOutcome, { kind: 'failed' }>['code'];

type HostedAuthMenuSessionArgs = {
  seams: HostedAuthMenuBridge;
  anchorElement: HTMLElement;
  authMenuSessionId: HostedAuthMenuSessionId;
  initialMode: HostedAuthMenuMode;
  initialHeightCssPx: HostedSeamsAuthMenuProps['initialHeightCssPx'];
  registrationAccountInput: HostedSeamsAuthMenuProps['registrationAccountInput'];
  showRegistrationInput: boolean;
  showProgress: boolean;
  copy: HostedSeamsAuthMenuProps['copy'];
  externalAuthBroker: BrokerRef;
  walletAlternatives: React.MutableRefObject<WalletAlternativesConfig | undefined>;
  onOutcome: OutcomeRef;
};

type ExternalAuthEvidenceRecord = {
  kind?: unknown;
  idToken?: unknown;
  reason?: unknown;
  code?: unknown;
  message?: unknown;
};

type HostedAuthMenuEffectConfig = {
  readonly initialMode: HostedAuthMenuMode;
  readonly initialHeightCssPx: HostedSeamsAuthMenuProps['initialHeightCssPx'];
  readonly registrationAccountInput: HostedSeamsAuthMenuProps['registrationAccountInput'];
  readonly showRegistrationInput: boolean;
  readonly showProgress: boolean;
  readonly copy: HostedSeamsAuthMenuProps['copy'];
  readonly enabledExternalProviders: readonly HostedAuthMenuExternalProvider[];
  readonly walletAlternatives: WalletAlternativesConfig | undefined;
};

let sessionCounter = 0;

function createHostedAuthMenuSessionId(): HostedAuthMenuSessionId {
  const randomId =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${sessionCounter++}-${Math.random().toString(36).slice(2)}`;
  const sessionId = hostedAuthMenuSessionIdFromBoundary(`react-${randomId}`);
  if (!sessionId) throw new Error('Unable to create a hosted auth-menu session identity');
  return sessionId;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Hosted auth-menu operation failed';
}

function failureCodeForError(error: unknown): HostedAuthMenuFailureCode {
  const message = errorMessage(error).toLowerCase();
  if (message.includes('open configuration')) return 'invalid_request';
  if (
    message.includes('wallet iframe') &&
    (message.includes('configured') || message.includes('unavailable'))
  ) {
    return 'connection_closed';
  }
  return 'wallet_error';
}

function isExternalAuthEvidenceRecord(value: unknown): value is ExternalAuthEvidenceRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidEvidence(message: string): HostedAuthMenuExternalAuthEvidence {
  return { kind: 'failed', code: 'invalid_evidence', message };
}

function externalProvidersForBroker(
  broker: HostedAuthMenuExternalAuthBroker | null,
): readonly HostedAuthMenuExternalProvider[] {
  return broker ? ['google'] : [];
}

function normalizeExternalAuthEvidence(value: unknown): HostedAuthMenuExternalAuthEvidence {
  if (!isExternalAuthEvidenceRecord(value)) {
    return invalidEvidence('External-auth broker returned an invalid evidence object');
  }

  switch (value.kind) {
    case 'google_id_token':
      return typeof value.idToken === 'string' && value.idToken.trim()
        ? { kind: 'google_id_token', idToken: value.idToken.trim() }
        : invalidEvidence('External-auth broker returned an empty Google ID token');
    case 'cancelled':
      return value.reason === 'user_cancelled'
        ? { kind: 'cancelled', reason: 'user_cancelled' }
        : invalidEvidence('External-auth broker returned an invalid cancellation reason');
    case 'failed':
      if (
        (value.code === 'provider_unavailable' ||
          value.code === 'provider_error' ||
          value.code === 'invalid_evidence') &&
        typeof value.message === 'string' &&
        value.message.trim()
      ) {
        return {
          kind: 'failed',
          code: value.code,
          message: value.message.trim(),
        };
      }
      return invalidEvidence('External-auth broker returned an invalid failure branch');
    default:
      return invalidEvidence('External-auth broker returned an unknown evidence branch');
  }
}

/** Outcomes after which an auth menu has done its job and must not re-open. */
function isTerminalHostedAuthMenuSuccess(outcome: HostedAuthMenuOutcome): boolean {
  return (
    outcome.kind === 'authenticated' ||
    outcome.kind === 'registered' ||
    outcome.kind === 'account_synced'
  );
}

function providerFailureEvidence(
  code: 'provider_unavailable' | 'provider_error',
  message: string,
): HostedAuthMenuExternalAuthEvidence {
  return { kind: 'failed', code, message };
}

function assertMatchingExternalAuthRequest(
  request: HostedAuthMenuExternalAuthRequest,
  authMenuSessionId: HostedAuthMenuSessionId,
): HostedAuthMenuExternalAuthRequestId | null {
  if (request.authMenuSessionId !== authMenuSessionId) return null;
  return hostedAuthMenuExternalAuthRequestIdFromBoundary(request.externalAuthRequestId);
}

function hostedAuthMenuEffectConfigKey(config: HostedAuthMenuEffectConfig): string {
  const configSessionId = hostedAuthMenuSessionIdFromBoundary('react-effect-config');
  if (!configSessionId) return 'invalid';

  try {
    const normalized = buildHostedAuthMenuOpenRequest({
      authMenuSessionId: configSessionId,
      initialMode: config.initialMode,
      initialHeightCssPx: config.initialHeightCssPx,
      registrationAccountInput: config.registrationAccountInput,
      showRegistrationInput: config.showRegistrationInput,
      showProgress: config.showProgress,
      copy: config.copy,
      enabledExternalProviders: config.enabledExternalProviders,
      walletAlternatives: describeWalletAlternatives(config.walletAlternatives),
    });
    return JSON.stringify({
      initialMode: normalized.initialMode,
      initialHeightCssPx: normalized.initialHeightCssPx,
      registrationAccountInput: normalized.registrationAccountInput,
      showRegistrationInput: normalized.showRegistrationInput,
      showProgress: normalized.showProgress,
      copy: normalized.copy,
      enabledExternalProviders: normalized.enabledExternalProviders,
      walletAlternatives: normalized.walletAlternatives,
      walletControllers: walletAlternativesControllerKey(config.walletAlternatives),
    });
  } catch {
    return 'invalid';
  }
}

class HostedAuthMenuSessionController {
  private readonly seams: HostedAuthMenuBridge;
  private readonly anchorElement: HTMLElement;
  private readonly authMenuSessionId: HostedAuthMenuSessionId;
  private readonly initialMode: HostedAuthMenuMode;
  private readonly initialHeightCssPx: HostedSeamsAuthMenuProps['initialHeightCssPx'];
  private readonly registrationAccountInput: HostedSeamsAuthMenuProps['registrationAccountInput'];
  private readonly showRegistrationInput: boolean;
  private readonly showProgress: boolean;
  private readonly copy: HostedSeamsAuthMenuProps['copy'];
  private readonly externalAuthBroker: BrokerRef;
  private readonly walletAlternatives: React.MutableRefObject<WalletAlternativesConfig | undefined>;
  private readonly walletBroker: WalletAlternativesBroker;
  private readonly onOutcome: OutcomeRef;
  private readonly externalAuthRequestIds = new Set<HostedAuthMenuExternalAuthRequestId>();
  private readonly handleExternalAuthRequestBound: (
    request: HostedAuthMenuExternalAuthRequest,
  ) => void;
  private unsubscribeExternalAuthRequest: (() => void) | null = null;
  private isActive = false;
  private hasOpenRequest = false;
  private hasTerminalOutcome = false;
  private hasFinalizedCleanup = false;

  constructor(args: HostedAuthMenuSessionArgs) {
    this.seams = args.seams;
    this.anchorElement = args.anchorElement;
    this.authMenuSessionId = args.authMenuSessionId;
    this.initialMode = args.initialMode;
    this.initialHeightCssPx = args.initialHeightCssPx;
    this.registrationAccountInput = args.registrationAccountInput;
    this.showRegistrationInput = args.showRegistrationInput;
    this.showProgress = args.showProgress;
    this.copy = args.copy;
    this.externalAuthBroker = args.externalAuthBroker;
    this.walletAlternatives = args.walletAlternatives;
    this.walletBroker = new WalletAlternativesBroker(
      args.seams.authMenu,
      args.authMenuSessionId,
      args.walletAlternatives,
    );
    this.onOutcome = args.onOutcome;
    this.handleExternalAuthRequestBound = this.handleExternalAuthRequest.bind(this);
  }

  start(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.walletBroker.start();
    resetHostedAuthMenuAnchor(this.anchorElement);
    this.unsubscribeExternalAuthRequest = this.seams.authMenu.onExternalAuthRequest(
      this.handleExternalAuthRequestBound,
    );
    void this.open();
  }

  cleanup(): void {
    if (this.hasFinalizedCleanup) return;
    this.hasFinalizedCleanup = true;
    this.isActive = false;
    this.walletBroker.cleanup();
    this.unsubscribeExternalAuthRequest?.();
    this.unsubscribeExternalAuthRequest = null;
    this.externalAuthRequestIds.clear();
    if (this.hasOpenRequest) {
      void this.seams.authMenu
        .cancel({ authMenuSessionId: this.authMenuSessionId })
        .catch(() => {});
    }
  }

  private async open(): Promise<void> {
    await Promise.resolve();
    if (!this.isActive) return;

    let request;
    try {
      request = buildHostedAuthMenuOpenRequest({
        authMenuSessionId: this.authMenuSessionId,
        initialMode: this.initialMode,
        initialHeightCssPx: this.initialHeightCssPx,
        loginTarget: { kind: 'discoverable' },
        registrationAccountInput: this.registrationAccountInput,
        showRegistrationInput: this.showRegistrationInput,
        showProgress: this.showProgress,
        copy: this.copy,
        enabledExternalProviders: this.externalAuthBroker.current ? ['google'] : [],
        walletAlternatives: describeWalletAlternatives(this.walletAlternatives.current),
      });
    } catch (error: unknown) {
      this.emitFailure(failureCodeForError(error), errorMessage(error));
      return;
    }

    try {
      this.hasOpenRequest = true;
      const outcome = await this.seams.authMenu.open(request, this.anchorElement);
      if (outcome.authMenuSessionId !== this.authMenuSessionId) {
        if (!this.isActive) return;
        this.emitFailure(
          'internal_error',
          'Hosted auth-menu returned a mismatched session identity',
        );
        return;
      }
      if (!this.isActive) return;
      this.emitOutcome(outcome);
    } catch (error: unknown) {
      if (!this.isActive) return;
      this.emitFailure(failureCodeForError(error), errorMessage(error));
    }
  }

  private handleExternalAuthRequest(request: HostedAuthMenuExternalAuthRequest): void {
    if (!this.isActive) return;
    const requestId = assertMatchingExternalAuthRequest(request, this.authMenuSessionId);
    if (!requestId || this.externalAuthRequestIds.has(requestId)) return;
    this.externalAuthRequestIds.add(requestId);
    void this.resolveExternalAuthRequest(request, requestId);
  }

  private async resolveExternalAuthRequest(
    request: HostedAuthMenuExternalAuthRequest,
    requestId: HostedAuthMenuExternalAuthRequestId,
  ): Promise<void> {
    const broker = this.externalAuthBroker.current;
    let evidence: HostedAuthMenuExternalAuthEvidence;
    if (!broker) {
      evidence = providerFailureEvidence(
        'provider_unavailable',
        'No external-auth broker is configured for this auth-menu session',
      );
    } else {
      try {
        evidence = normalizeExternalAuthEvidence(await broker(request));
      } catch (error: unknown) {
        evidence = providerFailureEvidence('provider_error', errorMessage(error));
      }
    }

    if (!this.isActive) {
      this.externalAuthRequestIds.delete(requestId);
      return;
    }

    try {
      await this.seams.authMenu.resolveExternalAuth({
        kind: 'hosted_auth_menu_external_auth_resolution_v1',
        authMenuSessionId: this.authMenuSessionId,
        externalAuthRequestId: requestId,
        evidence,
      });
    } catch {
      // The router ignores stale resolutions after cancellation or a terminal outcome.
    } finally {
      this.externalAuthRequestIds.delete(requestId);
    }
  }

  private emitFailure(code: HostedAuthMenuFailureCode, message: string): void {
    this.emitOutcome({
      kind: 'failed',
      authMenuSessionId: this.authMenuSessionId,
      code,
      message,
    });
  }

  private emitOutcome(outcome: HostedAuthMenuOutcome): void {
    if (this.hasTerminalOutcome) return;
    this.hasTerminalOutcome = true;
    endHostedAuthMenuAnchor(this.anchorElement);
    try {
      if (outcome.kind === 'wallet_connected') this.walletBroker.complete(outcome.alternativeId);
    } catch {
      // Application connection handlers cannot interrupt terminal cleanup.
    }
    this.walletBroker.cleanup();
    try {
      this.onOutcome.current(outcome);
    } catch {
      // An application callback cannot invalidate the wallet-host terminal state.
    }
  }
}

type HostedAuthMenuContext = {
  readonly seams: SeamsWeb | null;
  readonly isLoggedIn: boolean;
};

type HostedAuthMenuTerminalGate = {
  completed: boolean;
  observedLoggedIn: boolean;
  logoutGeneration: number;
};

const hostedAuthMenuTerminalGates = new WeakMap<SeamsWeb, HostedAuthMenuTerminalGate>();

function useOptionalSeams(): HostedAuthMenuContext {
  try {
    const context = useSeams();
    return {
      seams: context.seams,
      isLoggedIn: context.loginState.isLoggedIn,
    };
  } catch (error: unknown) {
    if (typeof window === 'undefined') return { seams: null, isLoggedIn: false };
    throw error;
  }
}

function terminalGateFor(seams: SeamsWeb | null): HostedAuthMenuTerminalGate | null {
  if (!seams) return null;
  const existing = hostedAuthMenuTerminalGates.get(seams);
  if (existing) return existing;
  const gate: HostedAuthMenuTerminalGate = {
    completed: false,
    observedLoggedIn: false,
    logoutGeneration: 0,
  };
  hostedAuthMenuTerminalGates.set(seams, gate);
  return gate;
}

function syncTerminalGate(gate: HostedAuthMenuTerminalGate | null, isLoggedIn: boolean): void {
  if (!gate) return;
  if (isLoggedIn) {
    gate.completed = true;
    gate.observedLoggedIn = true;
    return;
  }
  if (!gate.observedLoggedIn) return;
  gate.completed = false;
  gate.observedLoggedIn = false;
  gate.logoutGeneration += 1;
}

function forwardHostedAuthMenuOutcome(
  terminalGateRef: React.MutableRefObject<HostedAuthMenuTerminalGate | null>,
  onOutcomeRef: OutcomeRef,
  outcome: HostedAuthMenuOutcome,
): void {
  if (isTerminalHostedAuthMenuSuccess(outcome) && terminalGateRef.current) {
    terminalGateRef.current.completed = true;
  }
  onOutcomeRef.current(outcome);
}

export const HostedSeamsAuthMenu: React.FC<HostedSeamsAuthMenuProps> = ({
  initialMode = 'login',
  initialHeightCssPx,
  placeholder,
  registrationAccountInput = 'implicit_wallet',
  showRegistrationInput = false,
  showProgress = false,
  copy,
  externalAuthBroker = null,
  walletAlternatives,
  onOutcome,
}) => {
  const { seams, isLoggedIn } = useOptionalSeams();
  const terminalGate = terminalGateFor(seams);
  syncTerminalGate(terminalGate, isLoggedIn);
  const effectConfigRef = React.useRef<HostedAuthMenuEffectConfig>({
    initialMode,
    initialHeightCssPx,
    registrationAccountInput,
    showRegistrationInput,
    showProgress,
    copy,
    enabledExternalProviders: externalProvidersForBroker(externalAuthBroker),
    walletAlternatives,
  });
  const externalAuthBrokerRef = React.useRef<HostedAuthMenuExternalAuthBroker | null>(
    externalAuthBroker,
  );
  const walletAlternativesRef = React.useRef(walletAlternatives);
  walletAlternativesRef.current = walletAlternatives;
  const onOutcomeRef = React.useRef<HostedSeamsAuthMenuProps['onOutcome']>(onOutcome);
  const terminalGateRef = React.useRef<HostedAuthMenuTerminalGate | null>(terminalGate);
  const forwardedOutcomeRef = React.useRef<HostedSeamsAuthMenuProps['onOutcome']>(() => {});
  const anchorRef = React.useRef<HTMLSpanElement | null>(null);
  effectConfigRef.current = {
    initialMode,
    initialHeightCssPx,
    registrationAccountInput,
    showRegistrationInput,
    showProgress,
    copy,
    enabledExternalProviders: externalProvidersForBroker(externalAuthBroker),
    walletAlternatives,
  };
  externalAuthBrokerRef.current = externalAuthBroker;
  onOutcomeRef.current = onOutcome;
  terminalGateRef.current = terminalGate;
  forwardedOutcomeRef.current = forwardHostedAuthMenuOutcome.bind(
    null,
    terminalGateRef,
    onOutcomeRef,
  );
  const effectConfigKey = hostedAuthMenuEffectConfigKey(effectConfigRef.current);
  const logoutGeneration = terminalGate?.logoutGeneration ?? 0;

  // Authentication can publish before open() resolves. Keep that controller alive
  // to deliver its terminal outcome; a later logout starts a new menu lifecycle.
  React.useEffect(() => {
    const anchorElement = anchorRef.current;
    if (!seams || !anchorElement || typeof window === 'undefined') return undefined;
    if (terminalGateRef.current?.completed) return undefined;

    const config = effectConfigRef.current;
    const session = new HostedAuthMenuSessionController({
      seams,
      anchorElement,
      authMenuSessionId: createHostedAuthMenuSessionId(),
      initialMode: config.initialMode,
      initialHeightCssPx: config.initialHeightCssPx,
      registrationAccountInput: config.registrationAccountInput,
      showRegistrationInput: config.showRegistrationInput,
      showProgress: config.showProgress,
      copy: config.copy,
      externalAuthBroker: externalAuthBrokerRef,
      walletAlternatives: walletAlternativesRef,
      onOutcome: forwardedOutcomeRef,
    });
    session.start();
    return session.cleanup.bind(session);
  }, [seams, logoutGeneration, effectConfigKey]);

  return (
    <span
      ref={anchorRef}
      data-seams-root=""
      className="seams-auth-menu-host"
      data-seams-auth-menu-host="true"
      aria-hidden="true"
      style={{
        display: 'block',
        width: 'min(100%, 420px)',
        // The wallet host measures the menu and publishes its height back onto
        // this element, so the anchor reserves the space the menu paints over.
        minHeight: `var(--seams-auth-menu-height, ${initialHeightCssPx ?? 450}px)`,
        position: 'relative',
        boxSizing: 'border-box',
        margin: 0,
        padding: 0,
        border: 0,
      }}
    >
      {!terminalGate?.completed && (
        <span
          style={{
            position: 'absolute',
            inset: '0 0 auto',
            opacity: 'var(--seams-auth-menu-placeholder-opacity, 1)',
            pointerEvents: 'none',
          }}
        >
          {placeholder ?? <SeamsAuthMenuMock initialMode={initialMode} />}
        </span>
      )}
    </span>
  );
};

export default HostedSeamsAuthMenu;
