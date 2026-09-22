import { assertPendingWalletRegistrationIdentity } from '@/core/indexedDB';
import type {
  PendingWalletRegistrationCommitV1,
  PendingWalletRegistrationLocalMaterialV1,
} from '@/core/indexedDB';
import type {
  PublishPendingWalletRegistrationCommitInputV1,
  StoreWalletRegistrationFinalizeBatchResult,
} from '@/core/indexedDB/seamsWalletDB/repositories';
import type { RegistrationSigningSurface } from '@/SeamsWeb/signingSurface/types';
import {
  activateWalletRegistration,
  type WalletRegistrationActivateResponseV2,
  type WalletRegistrationEcdsaWalletKey,
} from '@/core/rpcClients/relayer/walletRegistration';
import type { WalletCustodyEvmFamilyPublicFacts } from '@shared/passkey-custody';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { sha256HexUtf8 } from '@shared/utils/digests';
import { parseEmailOtpWalletAuthAuthority } from '@shared/utils/walletAuthAuthority';
import type { RegistrationEstablishedSessionResultV2 } from '@shared/utils/registrationEstablishedSession';
import {
  sameRouterAbEcdsaDerivationNormalSigningStateV1,
  sameRouterAbEcdsaVerifiedClientActivationFactsV1,
  type RouterAbEcdsaDerivationPublicIdentityV1,
  type RouterAbEcdsaPostRegistrationSessionActivationResponseV1,
  type RouterAbEcdsaRegistrationActivationReceiptV1,
  type RouterAbEcdsaVerifiedClientActivationFactsV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type {
  ThresholdEcdsaDerivationRoleLocalBootstrapValue,
  EcdsaDerivationRoleLocalPublicIdentity,
} from '@/core/rpcClients/relayer/thresholdEcdsa';
import { assertSharedRegistrationEvmFamilyWalletKeyMaterial } from './registrationStrictEcdsa';

export type PendingEcdsaRegistrationKeyFamilies =
  readonly ['ecdsa_secp256k1'];

type PendingEcdsaOnlyLocalMaterial = Extract<
  PendingWalletRegistrationLocalMaterialV1,
  { readonly keyFamilies: readonly ['ecdsa_secp256k1'] }
>;

export type PendingEcdsaOnlyRegistrationCommit = Extract<
  PendingWalletRegistrationCommitV1,
  { readonly operation: 'registration_activate' }
> & {
  readonly signerPlanKind: 'evm_family_ecdsa';
  readonly localMaterial: PendingEcdsaOnlyLocalMaterial;
};

export type PendingMixedEcdsaRegistrationCommit = Extract<
  PendingWalletRegistrationCommitV1,
  { readonly operation: 'registration_activate' }
> & {
  readonly signerPlanKind: 'near_ed25519_and_evm_family_ecdsa';
  readonly localMaterial: PendingEcdsaOnlyLocalMaterial;
};

export type PendingEcdsaRegistrationCommit =
  | PendingEcdsaOnlyRegistrationCommit
  | PendingMixedEcdsaRegistrationCommit;

export type PendingRegistrationExactMethod =
  | { readonly kind: 'passkey'; readonly expectedOrigin: string }
  | { readonly kind: 'email_otp'; readonly otpCode: string; readonly challengeId: string };

export type PendingRegistrationRecoverySigningSurface = Pick<
  RegistrationSigningSurface,
  | 'finalizeWalletRegistrationEcdsaSessions'
  | 'rejoinWalletCustodyEvmFamilyKeySet'
  | 'getAuthenticationCredentialsSerialized'
  | 'getSignerWorkerContext'
>;

export type PendingEcdsaRegistrationUnlockMaterial = {
  readonly session: RouterAbEcdsaPostRegistrationSessionActivationResponseV1;
  readonly readyStateBlobB64u: string;
  readonly publicFacts: WalletCustodyEvmFamilyPublicFacts;
};

export type PendingEcdsaRegistrationRecoveryPorts = {
  readonly activateWalletRegistration: (
    input: Parameters<typeof activateWalletRegistration>[0],
  ) => Promise<WalletRegistrationActivateResponseV2>;
  readonly publishPendingWalletRegistrationCommit: (
    input: PublishPendingWalletRegistrationCommitInputV1,
  ) => Promise<StoreWalletRegistrationFinalizeBatchResult>;
  readonly unlockPendingEcdsaRegistration: (
    input: PendingEcdsaRegistrationUnlockInput,
  ) => Promise<PendingEcdsaRegistrationUnlockMaterial>;
};

export type CommittedEcdsaRegistrationResponse = Extract<
  WalletRegistrationActivateResponseV2,
  { readonly ok: true; readonly kind: 'evm_family_ecdsa' }
> & {
  readonly registrationEstablishedSession: Extract<
    RegistrationEstablishedSessionResultV2,
    { readonly kind: 'already_committed' }
  >;
};

export type PendingEcdsaRegistrationUnlockInput = {
  readonly relayerUrl: string;
  readonly pending: PendingEcdsaRegistrationCommit;
  readonly response: CommittedEcdsaRegistrationResponse;
  readonly walletKeys: readonly [
    WalletRegistrationEcdsaWalletKey,
    ...WalletRegistrationEcdsaWalletKey[],
  ];
  readonly exactMethod: PendingRegistrationExactMethod;
  readonly signingSurface: PendingRegistrationRecoverySigningSurface;
};

export function isEcdsaRegistrationCommit(
  pending: PendingWalletRegistrationCommitV1,
): pending is PendingEcdsaOnlyRegistrationCommit {
  if (
    pending.operation !== 'registration_activate' ||
    pending.signerPlanKind !== 'evm_family_ecdsa'
  ) {
    return false;
  }
  const families = pending.localMaterial.keyFamilies;
  return families.length === 1 && families[0] === 'ecdsa_secp256k1';
}

export function isMixedEcdsaRegistrationCommit(
  pending: PendingWalletRegistrationCommitV1,
): pending is PendingMixedEcdsaRegistrationCommit {
  if (
    pending.operation !== 'registration_activate' ||
    pending.signerPlanKind !== 'near_ed25519_and_evm_family_ecdsa'
  ) {
    return false;
  }
  const families = pending.localMaterial.keyFamilies;
  return families.length === 1 && families[0] === 'ecdsa_secp256k1';
}

export function requireEcdsaProjection(
  response: CommittedEcdsaRegistrationResponse,
): Extract<
  CommittedEcdsaRegistrationResponse['registrationEstablishedSession']['session']['tokens'],
  { readonly kind: 'evm_family_ecdsa' | 'near_ed25519_and_evm_family_ecdsa' }
> {
  const tokens = response.registrationEstablishedSession.session.tokens;
  if (tokens.kind === 'evm_family_ecdsa' || tokens.kind === 'near_ed25519_and_evm_family_ecdsa') {
    return tokens;
  }
  throw new Error('pending ECDSA activation returned no ECDSA projection');
}

function samePendingEcdsaProjection(
  pending: PendingEcdsaRegistrationCommit,
  response: CommittedEcdsaRegistrationResponse,
  walletKey: WalletRegistrationEcdsaWalletKey,
): boolean {
  const session = response.registrationEstablishedSession.session;
  const projection = requireEcdsaProjection(response);
  return (
    response.walletId === pending.walletId &&
    response.custodyKeyManifestDigestB64u ===
      pending.localMaterial.custodyCommit.keyManifestDigestB64u &&
    response.walletCustody?.status === 'committed' &&
    session.walletId === pending.walletId &&
    session.walletSession.walletId === pending.walletId &&
    session.walletSession.authMethodId === pending.walletAuthMethodId &&
    session.tokens.kind === 'evm_family_ecdsa' &&
    projection.ecdsa.keyHandle === walletKey.keyHandle &&
    projection.ecdsa.thresholdSessionId === response.ecdsa.bootstrap.thresholdSessionId &&
    session.expiresAtMs === response.ecdsa.bootstrap.expiresAtMs &&
    session.remainingUses === response.ecdsa.bootstrap.remainingUses
  );
}

function samePendingEcdsaClientActivationFacts(
  activation: RouterAbEcdsaRegistrationActivationReceiptV1,
  expected: RouterAbEcdsaVerifiedClientActivationFactsV1,
): boolean {
  const identity = activation.ecdsa_activation.public_identity;
  const actual: RouterAbEcdsaVerifiedClientActivationFactsV1 = {
    registrationRequestDigestB64u: base64UrlEncode(
      Uint8Array.from(activation.activation_request_digest.bytes),
    ),
    proofTranscriptDigestB64u: base64UrlEncode(Uint8Array.from(activation.transcript_digest.bytes)),
    contextBinding32B64u: identity.context_binding_b64u,
    derivationClientSharePublicKey33B64u: identity.derivation_client_share_public_key33_b64u,
    clientShareRetryCounter: identity.client_share_retry_counter,
    participantId: 1,
  };
  return sameRouterAbEcdsaVerifiedClientActivationFactsV1(actual, expected);
}

function samePendingEcdsaBootstrapPublicIdentity(
  actual: EcdsaDerivationRoleLocalPublicIdentity,
  expected: WalletRegistrationEcdsaWalletKey,
): boolean {
  return (
    actual.derivationClientSharePublicKey33B64u === expected.derivationClientSharePublicKey33B64u &&
    actual.relayerPublicKey33B64u === expected.relayerVerifyingShareB64u &&
    actual.groupPublicKey33B64u === expected.thresholdEcdsaPublicKeyB64u &&
    actual.ethereumAddress === expected.thresholdOwnerAddress.toLowerCase()
  );
}

function samePendingEcdsaActivationPublicIdentity(
  actual: RouterAbEcdsaDerivationPublicIdentityV1,
  expected: WalletRegistrationEcdsaWalletKey,
): boolean {
  return (
    actual.server_public_key33_b64u === expected.relayerVerifyingShareB64u &&
    actual.threshold_public_key33_b64u === expected.thresholdEcdsaPublicKeyB64u &&
    ethereumAddressFromActivationIdentity(actual.ethereum_address20_b64u) ===
      expected.thresholdOwnerAddress &&
    actual.server_share_retry_counter === expected.relayerShareRetryCounter
  );
}

function samePendingEcdsaBootstrapKeyIdentity(
  bootstrap: ThresholdEcdsaDerivationRoleLocalBootstrapValue,
  walletKey: WalletRegistrationEcdsaWalletKey,
): boolean {
  return (
    bootstrap.walletId === walletKey.walletId &&
    bootstrap.keyHandle === walletKey.keyHandle &&
    bootstrap.ecdsaThresholdKeyId === walletKey.ecdsaThresholdKeyId &&
    bootstrap.evmFamilySigningKeySlotId === walletKey.evmFamilySigningKeySlotId &&
    bootstrap.signingRootId === walletKey.signingRootId &&
    bootstrap.signingRootVersion === walletKey.signingRootVersion &&
    bootstrap.thresholdEcdsaPublicKeyB64u === walletKey.thresholdEcdsaPublicKeyB64u &&
    bootstrap.ethereumAddress.toLowerCase() === walletKey.thresholdOwnerAddress.toLowerCase() &&
    bootstrap.relayerKeyId === walletKey.relayerKeyId &&
    bootstrap.relayerVerifyingShareB64u === walletKey.relayerVerifyingShareB64u &&
    bootstrap.clientShareRetryCounter === walletKey.clientShareRetryCounter &&
    bootstrap.relayerShareRetryCounter === walletKey.relayerShareRetryCounter
  );
}

export function pendingEcdsaActivateRequest(
  relayerUrl: string,
  pending: PendingEcdsaRegistrationCommit,
): Parameters<typeof activateWalletRegistration>[0] {
  const common = {
    relayerUrl,
    registrationCeremonyId: pending.registrationCeremonyId,
    signedSetup: pending.signedSetup,
    idempotencyKey: pending.idempotencyKey,
    walletCustodyCommit: pending.localMaterial.custodyCommit,
    ...(pending.auth.kind === 'email_otp' ? { emailOtpEnrollment: pending.auth.enrollment } : {}),
  };
  const ecdsa = {
    activationCorrelationId: pending.localMaterial.ecdsa.activationJournalId,
    activationRequestDigestB64u: pending.localMaterial.ecdsa.activationRequestDigestB64u,
    clientActivation: pending.localMaterial.ecdsa.clientActivation,
  };
  return { ...common, signerPlanKind: pending.signerPlanKind, ecdsa };
}

export function requireResponseWalletKeys(
  response: CommittedEcdsaRegistrationResponse,
): readonly [WalletRegistrationEcdsaWalletKey, ...WalletRegistrationEcdsaWalletKey[]] {
  const first = response.ecdsa.walletKeys[0];
  if (!first) throw new Error('pending ECDSA activation returned no wallet keys');
  assertSharedRegistrationEvmFamilyWalletKeyMaterial(response.ecdsa.walletKeys);
  return [first, ...response.ecdsa.walletKeys.slice(1)];
}

function ethereumAddressFromActivationIdentity(value: string): string {
  const bytes = base64UrlDecode(value);
  if (bytes.length !== 20) throw new Error('pending ECDSA activation returned an invalid address');
  let hex = '0x';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function assertProjectionMatchesPending(
  pending: PendingEcdsaRegistrationCommit,
  response: CommittedEcdsaRegistrationResponse,
  walletKey: WalletRegistrationEcdsaWalletKey,
): void {
  if (!samePendingEcdsaProjection(pending, response, walletKey)) {
    throw new Error('pending ECDSA activation projection mismatch');
  }
  assertPendingWalletRegistrationIdentity(pending, {
    operation: pending.operation,
    walletId: response.walletId,
    walletAuthMethodId: response.foundingAuthMethod.walletAuthMethodId,
    authority: response.authority,
  });
}

function isCommittedEcdsaRegistrationResponse(
  response: WalletRegistrationActivateResponseV2,
): response is CommittedEcdsaRegistrationResponse {
  return (
    response.ok === true &&
    response.kind === 'evm_family_ecdsa' &&
    response.registrationEstablishedSession.kind === 'already_committed'
  );
}

async function assertAuthMatchesPending(
  pending: PendingEcdsaRegistrationCommit,
  response: CommittedEcdsaRegistrationResponse,
): Promise<void> {
  if (pending.auth.kind === 'passkey') {
    if (
      response.authMethod.kind !== 'passkey' ||
      response.rpId !== pending.auth.rpId ||
      response.authMethod.credentialIdB64u !== pending.auth.credentialIdB64u
    ) {
      throw new Error('pending ECDSA activation returned a different Passkey method');
    }
    return;
  }
  if (
    response.authMethod.kind !== 'email_otp' ||
    response.authMethod.registrationAuthorityId !== pending.auth.registrationAuthorityId
  ) {
    throw new Error('pending ECDSA activation returned a different Email OTP method');
  }
  const authority = parseEmailOtpWalletAuthAuthority(response.authority);
  const emailHashHex = await sha256HexUtf8(pending.auth.email);
  if (
    !authority ||
    authority.factor.providerUserId !== pending.auth.providerSubject ||
    authority.verifier.emailHashHex.toLowerCase() !== emailHashHex.toLowerCase()
  ) {
    throw new Error('pending ECDSA activation returned a different Email OTP identity');
  }
}

function assertActivationFacts(
  pending: PendingEcdsaRegistrationCommit,
  response: CommittedEcdsaRegistrationResponse,
  walletKey: WalletRegistrationEcdsaWalletKey,
): void {
  const activation = response.ecdsa.activation;
  const receipt = activation.ecdsa_activation;
  const identity = receipt.public_identity;
  const client = pending.localMaterial.ecdsa.clientActivation;
  if (
    activation.activation_correlation_id !== pending.localMaterial.ecdsa.activationJournalId ||
    !samePendingEcdsaClientActivationFacts(activation, client) ||
    !samePendingEcdsaBootstrapPublicIdentity(response.ecdsa.bootstrap.publicIdentity, walletKey) ||
    receipt.context.application_binding_digest_b64u !==
      response.ecdsa.bootstrap.applicationBindingDigestB64u ||
    !samePendingEcdsaActivationPublicIdentity(identity, walletKey)
  ) {
    throw new Error('pending ECDSA activation facts mismatch');
  }
  if (!samePendingEcdsaBootstrapKeyIdentity(response.ecdsa.bootstrap, walletKey)) {
    throw new Error('pending ECDSA bootstrap changed committed key identity');
  }
}

function assertProjectionEcdsaFacts(response: CommittedEcdsaRegistrationResponse): void {
  const projection = requireEcdsaProjection(response).ecdsa;
  const receipt = response.ecdsa.activation.ecdsa_activation;
  if (
    !mpcMaterialActivationRefsEqual(
      projection.materialActivation,
      routerAbMpcMaterialActivationRefFromWire(receipt.material_activation),
    ) ||
    !sameRouterAbEcdsaDerivationNormalSigningStateV1(
      projection.routerAbEcdsaDerivationNormalSigning,
      response.ecdsa.bootstrap.routerAbEcdsaDerivationNormalSigning,
    )
  ) {
    throw new Error('pending ECDSA activation facts do not match the committed projection');
  }
}

export async function requireCommittedEcdsaRegistrationResponse(args: {
  readonly pending: PendingEcdsaRegistrationCommit;
  readonly response: WalletRegistrationActivateResponseV2;
}): Promise<CommittedEcdsaRegistrationResponse> {
  const response = args.response;
  if (!isCommittedEcdsaRegistrationResponse(response)) {
    throw new Error(
      response.ok
        ? 'pending ECDSA activation replay did not return a committed projection'
        : 'pending ECDSA activation replay failed',
    );
  }
  const walletKey = requireResponseWalletKeys(response)[0];
  assertProjectionMatchesPending(args.pending, response, walletKey);
  await assertAuthMatchesPending(args.pending, response);
  assertActivationFacts(args.pending, response, walletKey);
  assertProjectionEcdsaFacts(response);
  if (args.pending.signerPlanKind === 'evm_family_ecdsa') {
    if (response.nearProvisioning !== undefined) {
      throw new Error('ECDSA-only registration unexpectedly has deferred NEAR provisioning');
    }
  } else if (response.nearProvisioning?.status !== 'near_pending') {
    throw new Error('mixed registration did not retain deferred NEAR provisioning');
  }
  return response;
}
