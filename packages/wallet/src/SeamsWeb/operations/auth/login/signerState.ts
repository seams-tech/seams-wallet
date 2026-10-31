import type { LoginUnlockSigningSurface } from '@/SeamsWeb/signingSurface/types';
import { secureRandomId } from '@shared/utils/secureRandomId';
import {
  parseThresholdEcdsaSessionId,
  type ThresholdEcdsaSessionId,
} from '@shared/utils/domainIds';
import { parseWalletSessionMintId } from '@shared/authorization/capabilityKinds';
import { type RouterAbEd25519NormalSigningState } from '@shared/utils/signingSessionSeal';
import { type PasskeySessionEcdsaCustodyContinuityV1 } from '@/core/rpcClients/near/rpcCalls';
import { type ExactWalletSessionAuthorization } from '@/core/signingEngine/session/persistence/walletSessionAuthorizationProjection';
import {
  isEcdsaCredentialFreeSessionActivationAuthorization,
  type EcdsaPreauthorizedSessionActivation,
} from '@/core/signingEngine/threshold/ecdsa/postRegistrationSessionActivation';
import { type ThresholdRuntimePolicyScope } from '@/core/signingEngine/threshold/sessionPolicy';
import {
  mergeCanonicalThresholdEcdsaWarmSessionContexts,
  type CanonicalThresholdEcdsaWarmSessionContext,
} from '@/core/signingEngine/session/passkey/unlockEcdsaWarmupPlanner';
import { base64UrlDecode } from '@shared/utils/base64';

export function thresholdSessionIdFromPasskeyEcdsaActivation(
  activation: EcdsaPreauthorizedSessionActivation,
): ThresholdEcdsaSessionId {
  return isEcdsaCredentialFreeSessionActivationAuthorization(activation)
    ? activation.activation.session.threshold_session_id
    : activation.session.threshold_session_id;
}

export function exactAuthorizationFromPasskeyEcdsaActivation(
  activation: EcdsaPreauthorizedSessionActivation,
): ExactWalletSessionAuthorization {
  if (isEcdsaCredentialFreeSessionActivationAuthorization(activation)) {
    return activation.authorization;
  }
  return {
    record: activation.session.wallet_session,
    operationCredential: activation.session.operation_credential,
  };
}

export function assertRejoinedPasskeyEcdsaPublicFacts(args: {
  readonly publicFacts: Awaited<
    ReturnType<LoginUnlockSigningSurface['rejoinWalletCustodyEvmFamilyKeySet']>
  >['publicFacts'];
  readonly signer: PasskeySessionEcdsaCustodyContinuityV1['signers'][number];
}): void {
  const identity = args.signer.walletKey.publicCapability.public_identity;
  if (
    args.publicFacts.contextBinding32B64u !== identity.context_binding_b64u ||
    args.publicFacts.derivationClientSharePublicKey33B64u !==
      identity.derivation_client_share_public_key33_b64u ||
    args.publicFacts.relayerPublicKey33B64u !== identity.server_public_key33_b64u ||
    args.publicFacts.groupPublicKey33B64u !== identity.threshold_public_key33_b64u ||
    args.publicFacts.ethereumAddress !==
      ethereumAddressFromEcdsaIdentityB64u(identity.ethereum_address20_b64u) ||
    args.publicFacts.clientShareRetryCounter !== identity.client_share_retry_counter ||
    args.publicFacts.relayerShareRetryCounter !== identity.server_share_retry_counter
  ) {
    throw new Error('Passkey ECDSA custody rejoin changed registered public identity');
  }
}

export function sameEd25519ParticipantIds(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((participantId, index) => participantId === right[index])
  );
}

export function sameRouterAbEd25519NormalSigningState(
  left: RouterAbEd25519NormalSigningState,
  right: RouterAbEd25519NormalSigningState,
): boolean {
  return left.kind === right.kind && left.signingWorkerId === right.signingWorkerId;
}

export function sameThresholdRuntimePolicyScope(
  left: ThresholdRuntimePolicyScope,
  right: ThresholdRuntimePolicyScope,
): boolean {
  return (
    left.orgId === right.orgId &&
    left.projectId === right.projectId &&
    left.envId === right.envId &&
    left.signingRootVersion === right.signingRootVersion
  );
}

export function mergeThresholdEcdsaWarmSessionContexts(args: {
  current: CanonicalThresholdEcdsaWarmSessionContext;
  incoming: CanonicalThresholdEcdsaWarmSessionContext;
  source: string;
}): CanonicalThresholdEcdsaWarmSessionContext {
  if (
    args.current.runtimePolicyScope &&
    args.incoming.runtimePolicyScope &&
    !sameThresholdRuntimePolicyScope(
      args.current.runtimePolicyScope,
      args.incoming.runtimePolicyScope,
    )
  ) {
    throw new Error(
      `[login] threshold ECDSA ${args.source} has a conflicting runtime policy scope`,
    );
  }
  return mergeCanonicalThresholdEcdsaWarmSessionContexts(args.current, args.incoming);
}

export function ethereumAddressFromEcdsaIdentityB64u(value: string): `0x${string}` {
  const bytes = base64UrlDecode(value);
  if (bytes.length !== 20) throw new Error('[login] ECDSA custody address is invalid');
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex as `0x${string}`;
}

export function createThresholdLoginWarmSessionId(prefix: string): string {
  return secureRandomId(prefix, 32, 'threshold login warm session IDs');
}

export function requireThresholdLoginEcdsaSessionId(value: string) {
  const parsed = parseThresholdEcdsaSessionId(value);
  if (!parsed.ok) throw new Error('[login] failed to create threshold ECDSA session identity');
  return parsed.value;
}

export function requireThresholdLoginWalletSessionMintId(value: string) {
  const parsed = parseWalletSessionMintId(value);
  if (!parsed.ok) throw new Error('[login] failed to create Wallet Session mint identity');
  return parsed.value;
}

export function requireLoginUnlockSessionUses(remainingUses: number | null): number {
  if (remainingUses == null || remainingUses <= 0) {
    throw new Error('[login] unlock warm-up requires positive unlock session uses');
  }
  return remainingUses;
}

export function createThresholdEcdsaDeviceLinkRequiredError(targetKey: string): Error & {
  code: 'device_link_required';
} {
  const error = new Error(
    `[login] device_link_required: local threshold ECDSA material is unavailable for ${targetKey}`,
  ) as Error & { code: 'device_link_required' };
  error.code = 'device_link_required';
  return error;
}

export function createThresholdEd25519DeviceLinkRequiredError(): Error & {
  code: 'device_link_required';
} {
  const error = new Error(
    '[login] device_link_required: local threshold Ed25519 material is unavailable',
  ) as Error & { code: 'device_link_required' };
  error.code = 'device_link_required';
  return error;
}
