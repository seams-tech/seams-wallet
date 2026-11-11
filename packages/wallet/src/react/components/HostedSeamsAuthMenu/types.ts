import type { WalletAlternativesConfig } from './walletAlternatives';
import type { AnchoredSurfaceLayer } from '@/SeamsWeb/walletIframe/client/anchoredSurface';
import type {
  WalletStepChrome,
  WalletStepEvents,
  WalletStepTransition,
} from '@/SeamsWeb/walletIframe/shared/walletStep';
export type { WalletAlternative, WalletAlternativesConfig } from './walletAlternatives';
import type {
  HostedAuthMenuFooterBrand,
  HostedAuthMenuRecoveryOptions,
  HostedAuthMenuCopy,
  HostedAuthMenuCopyInput,
  HostedAuthMenuExternalAuthEvidence,
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuExternalProvider,
  HostedAuthMenuMode,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuRegistrationAccountInput,
  HostedAuthMenuSessionId,
} from '@/SeamsWeb/walletIframe/shared/messages';

export type {
  HostedAuthMenuFooterBrand,
  HostedAuthMenuRecoveryOptions,
  HostedAuthMenuCopy,
  HostedAuthMenuCopyInput,
  HostedAuthMenuExternalAuthEvidence,
  HostedAuthMenuExternalAuthRequest,
  HostedAuthMenuExternalProvider,
  HostedAuthMenuMode,
  HostedAuthMenuOpenRequest,
  HostedAuthMenuOutcome,
  HostedAuthMenuRegistrationAccountInput,
  HostedAuthMenuSessionId,
};

/**
 * Acquires app-origin evidence for a provider interaction requested by the wallet host.
 * The request carries the exact session and provider-request identities from the iframe.
 */
export type HostedAuthMenuExternalAuthBroker = (
  request: HostedAuthMenuExternalAuthRequest,
) => HostedAuthMenuExternalAuthEvidence | Promise<HostedAuthMenuExternalAuthEvidence>;

type HostedAuthMenuOutcomeHandler = (outcome: HostedAuthMenuOutcome) => void;
/**
 * The step events report the card's size, readiness, Back, Close and exit, so an app can show
 * the menu as one step of its own dialog. See docs/wallet-steps.md.
 */
export interface HostedSeamsAuthMenuProps extends WalletStepEvents {
  /** Recovery and device-link controls. Defaults to collapsible. */
  recoveryOptions?: HostedAuthMenuRecoveryOptions;
  /** Replace the Seams footer with an HTTPS or image data URL and accessible name. */
  footerBrand?: HostedAuthMenuFooterBrand;
  /** Explicit ordered wallet groups. Omitted or empty groups render no UI. */
  walletAlternatives?: WalletAlternativesConfig;
  /** Initial panel height for a continuous transition from an app-origin menu. */
  initialHeightCssPx?: number;
  /** Inert app-origin content displayed while the wallet-origin menu loads. A `top` layer step shows none by default. */
  placeholder?: import('react').ReactNode;
  /** Initial view selected by the wallet-host menu. Defaults to login. */
  initialMode?: HostedAuthMenuMode;
  /** Wallet/account policy used by registration. Defaults to implicit wallet. */
  registrationAccountInput?: HostedAuthMenuRegistrationAccountInput;
  /** Whether the wallet-host registration view exposes its account input. */
  showRegistrationInput?: boolean;
  /** Whether the wallet-host surface displays SDK operation progress. Defaults to false. */
  showProgress?: boolean;
  /** Serializable copy overrides normalized before crossing the iframe boundary. */
  copy?: HostedAuthMenuCopyInput;
  /** App-origin provider broker, or null when no external provider is enabled. */
  externalAuthBroker?: HostedAuthMenuExternalAuthBroker | null;
  /** Back, Close or both inside the card, beside the card's own controls. Defaults to none. */
  chrome?: WalletStepChrome;
  /**
   * How long the card waits and fades. Defaults to the Wallet's own times. A menu reads it when
   * it opens.
   */
  transition?: WalletStepTransition;
  /**
   * Where the card paints. `'page'` (default): in the page's own stacking order, as page
   * content does. `'top'`: above all app content, with the rest of the page inert while the
   * card shows. Use `'top'` for a step in the app's own dialog.
   */
  layer?: AnchoredSurfaceLayer;
  /** Receives exactly one terminal outcome for each mounted session. */
  onOutcome: HostedAuthMenuOutcomeHandler;
}
