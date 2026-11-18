import type {
  MpcWalletSigningQuotaId,
  WalletSessionAuthorizationId,
  WalletSessionId,
} from '../authorization/capabilityKinds';
import type { WalletSessionOperationCredentialV1 } from '../device-linking/contracts';
import type { Ed25519AuthorityScope } from '../threshold/sessionPolicy';
import type { RuntimePolicyScope } from '../threshold/signingRootScope';
import type { WalletId } from './registrationIntent';
import type { RegistrationSignerSetSelection } from './registrationSignerPlan';
import type {
  RegisterWalletInput,
  RegistrationAuthMethodInput,
} from './registrationAuthMethodInput';
import type {
  RouterAbEd25519YaoActivationAdmissionReceiptV1,
  RouterAbEd25519YaoBytes32V1,
  RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from './routerAbEd25519Yao';
import type { WALLET_AUTH_METHODS } from './signerDomain';
import type { RouterAbEd25519NormalSigningState } from './signingSessionSeal';
import { isPlainObject } from './validation';
import type { Variant } from './variant';

/** The timings that the registration finalize route measures and reports. */
const WALLET_REGISTRATION_ROUTE_TIMING_NAMES = [
  'registrationEcdsaBootstrapVerifyMs',
  'registrationEmailOtpEnrollmentPlanMs',
  'relayPersistenceMs',
  'registerFinalizeTotalMs',
] as const;

export type WalletRegistrationRouteTimingName =
  (typeof WALLET_REGISTRATION_ROUTE_TIMING_NAMES)[number];

export type WalletRegistrationRouteDiagnostics = {
  kind: 'wallet_registration_route_diagnostics_v1';
  route: 'wallets_register_finalize';
  entries: {
    name: WalletRegistrationRouteTimingName;
    durationMs: number;
  }[];
};

function isWalletRegistrationRouteTimingName(
  value: unknown,
): value is WalletRegistrationRouteTimingName {
  return (WALLET_REGISTRATION_ROUTE_TIMING_NAMES as readonly unknown[]).includes(value);
}

/**
 * Route diagnostics are for measurement only, so this parse never throws: it
 * returns null for a bad envelope and drops each entry with an unknown name or
 * a bad duration. A newer server can add a timing, and an older reader ignores it.
 */
export function parseWalletRegistrationRouteDiagnostics(
  value: unknown,
): WalletRegistrationRouteDiagnostics | null {
  if (
    !isPlainObject(value) ||
    value.kind !== 'wallet_registration_route_diagnostics_v1' ||
    value.route !== 'wallets_register_finalize' ||
    !Array.isArray(value.entries)
  ) {
    return null;
  }
  const entries: WalletRegistrationRouteDiagnostics['entries'] = [];
  for (const entry of value.entries) {
    if (!isPlainObject(entry) || !isWalletRegistrationRouteTimingName(entry.name)) continue;
    const durationMs = entry.durationMs;
    if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) continue;
    entries.push({ name: entry.name, durationMs });
  }
  return { kind: 'wallet_registration_route_diagnostics_v1', route: value.route, entries };
}

export type CreateRegistrationIntentRequest = {
  wallet: RegisterWalletInput;
  authMethod: RegistrationAuthMethodInput;
  signerSelection: RegistrationSignerSetSelection;
};

export type WalletRegistrationEd25519YaoStart = {
  admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
  admissionReceipt: RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;
};

export type WalletRegistrationEd25519YaoActivationReference = {
  kind: 'router_ab_ed25519_yao_activation_reference_v1';
  lifecycle_id: string;
  session_id: RouterAbEd25519YaoBytes32V1;
};

export type WalletRegistrationFinalizeAuthMethod =
  | {
      kind: typeof WALLET_AUTH_METHODS.passkey;
      credentialIdB64u: string;
      credentialPublicKeyB64u: string;
    }
  | {
      kind: typeof WALLET_AUTH_METHODS.emailOtp;
      registrationAuthorityId: string;
    };

export type PasskeyWalletRegistrationFinalizeAuthMethod = Variant<
  WalletRegistrationFinalizeAuthMethod,
  'kind',
  typeof WALLET_AUTH_METHODS.passkey
>;

export type EmailOtpWalletRegistrationFinalizeAuthMethod = Variant<
  WalletRegistrationFinalizeAuthMethod,
  'kind',
  typeof WALLET_AUTH_METHODS.emailOtp
>;

export type WalletRegistrationEd25519YaoSignerRuntimeBootstrap = {
  walletId: WalletId;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  authorityScope: Ed25519AuthorityScope;
  thresholdSessionId: string;
  authorizationId: WalletSessionAuthorizationId;
  walletSessionId: WalletSessionId;
  quotaId: MpcWalletSigningQuotaId;
  expiresAtMs: number;
  participantIds: readonly [number, number];
  remainingUses: number;
  signingRootId: string;
  signingRootVersion: string;
  runtimePolicyScope: RuntimePolicyScope;
  routerAbNormalSigning: RouterAbEd25519NormalSigningState;
};

/**
 * The Ed25519 Yao view of one exact Wallet Session. A session this response
 * just issued carries its own primary operation credential; a session it
 * reuses carries none, because the credential was delivered once by the
 * issuing response and a committed digest cannot reproduce plaintext.
 */
export type WalletRegistrationEd25519YaoBootstrapSession =
  | (WalletRegistrationEd25519YaoSignerRuntimeBootstrap & {
      sessionKind: 'issued_exact_wallet_session';
      operationCredential: WalletSessionOperationCredentialV1;
    })
  | (WalletRegistrationEd25519YaoSignerRuntimeBootstrap & {
      sessionKind: 'already_committed_exact_wallet_session';
      operationCredential?: never;
    });

export type WalletEd25519YaoSignerPublicResult = {
  signerSlot: number;
  nearAccountId: string;
  nearEd25519SigningKeyId: string;
  publicKey: string;
  relayerKeyId: string;
  keyVersion: string;
  recoveryExportCapable: true;
  participantIds: readonly [number, number];
};
