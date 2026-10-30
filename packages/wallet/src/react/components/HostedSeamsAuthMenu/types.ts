import type { WalletAlternativesConfig } from './walletAlternatives';
export type { WalletAlternative, WalletAlternativesConfig } from './walletAlternatives';
import type {
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
export interface HostedSeamsAuthMenuProps {
  /** Explicit ordered wallet groups. Omitted or empty groups render no UI. */
  walletAlternatives?: WalletAlternativesConfig;
  /** Initial panel height for a continuous transition from an app-origin menu. */
  initialHeightCssPx?: number;
  /** Inert app-origin content displayed while the wallet-origin menu loads. */
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
  /** Receives exactly one terminal outcome for each mounted session. */
  onOutcome: HostedAuthMenuOutcomeHandler;
}
