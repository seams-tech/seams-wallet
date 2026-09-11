import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';
import { signWalletRecoveryEcdsaMaterialPossessionProofWasm } from '@/core/signingEngine/threshold/crypto/ecdsaDerivationClientWasm';
import type { WalletRecoveryPreparationKeyManifestEntry } from '@/core/rpcClients/relayer/walletRecoveryPrepare';
import type { WalletCustodyEvmFamilyPublicFacts } from '@shared/passkey-custody';
import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/encoders';
import {
  parseRouterAbEcdsaDerivationPublicCapabilityV1,
  parseRouterAbEcdsaRegistrationActivationReceiptV1,
  sameRouterAbEcdsaDerivationPublicIdentityV1,
  sameRouterAbServerIdentityV1,
  type RouterAbEcdsaDerivationPublicCapabilityV1,
  type RouterAbEcdsaRegistrationActivationReceiptV1,
} from '@shared/utils/routerAbEcdsaDerivation';
import { sameRouterAbMpcMaterialActivationRef } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  walletRecoveryEcdsaPossessionChallengeDigestB64uV1,
  parseWalletRecoveryEcdsaPossessionChallengeV1,
  type WalletRecoveryEcdsaPossessionChallengeV1,
  type WalletRecoveryEcdsaPossessionProofV1,
} from '@shared/wallet-recovery/walletRecoveryEcdsaPossession';
import type { EcdsaRoleLocalReadyStateBlob } from '@/core/platform';

type EcdsaRecoveryEntry = Extract<
  WalletRecoveryPreparationKeyManifestEntry,
  { readonly kind: 'evm_family_ecdsa' }
>;

export type WalletRecoveryEcdsaActivation = {
  readonly activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  readonly possessionProof: WalletRecoveryEcdsaPossessionProofV1;
};

function ethereumAddressFromAddress20B64u(value: string): `0x${string}` {
  const address = base64UrlDecode(value);
  if (address.length !== 20) {
    throw new Error('wallet recovery ECDSA identity has an invalid address');
  }
  return `0x${Array.from(address, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function requireCurrentActivationMatchesCapability(input: {
  readonly activationReceipt: RouterAbEcdsaRegistrationActivationReceiptV1;
  readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
  readonly serverGeneration: string;
}): void {
  const activation = input.activationReceipt.ecdsa_activation;
  if (
    activation.context.application_binding_digest_b64u !==
      input.publicCapability.context.application_binding_digest_b64u ||
    !sameRouterAbEcdsaDerivationPublicIdentityV1(
      activation.public_identity,
      input.publicCapability.public_identity,
    ) ||
    !sameRouterAbServerIdentityV1(
      activation.signing_worker,
      input.publicCapability.signer_set.selected_server,
    ) ||
    !sameRouterAbMpcMaterialActivationRef(
      activation.material_activation,
      input.publicCapability.material_activation,
    ) ||
    activation.activation_epoch !== input.publicCapability.activation_epoch ||
    input.activationReceipt.server_generation !== input.serverGeneration
  ) {
    throw new Error('wallet recovery ECDSA activation changed its registered capability');
  }
}

function requirePossessionChallengeMatchesEntry(input: {
  readonly challenge: WalletRecoveryEcdsaPossessionChallengeV1;
  readonly entry: EcdsaRecoveryEntry;
  readonly walletId: string;
  readonly reservationId: string;
  readonly replacementId: string;
  readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
}): void {
  const identity = input.publicCapability.public_identity;
  if (
    input.challenge.walletId !== input.walletId ||
    input.challenge.reservationId !== input.reservationId ||
    input.challenge.replacementId !== input.replacementId ||
    input.challenge.keySetId !== input.entry.keySetId ||
    input.challenge.keyHandle !== input.entry.keyHandle ||
    input.challenge.recordedKeyManifestDigestB64u !== input.entry.recordedKeyManifestDigestB64u ||
    input.challenge.expectedServerGeneration !==
      String(input.entry.recoveryBasis.serverGeneration) ||
    input.challenge.derivationClientSharePublicKey33B64u !==
      identity.derivation_client_share_public_key33_b64u
  ) {
    throw new Error('wallet recovery ECDSA possession challenge changed its registered identity');
  }
}

function requireRecoveredPublicFactsMatch(input: {
  readonly publicFacts: WalletCustodyEvmFamilyPublicFacts;
  readonly publicCapability: RouterAbEcdsaDerivationPublicCapabilityV1;
}): void {
  const identity = input.publicCapability.public_identity;
  if (
    input.publicFacts.contextBinding32B64u !== identity.context_binding_b64u ||
    input.publicFacts.derivationClientSharePublicKey33B64u !==
      identity.derivation_client_share_public_key33_b64u ||
    input.publicFacts.clientVerifyingShare33B64u !==
      identity.derivation_client_share_public_key33_b64u ||
    input.publicFacts.relayerPublicKey33B64u !== identity.server_public_key33_b64u ||
    input.publicFacts.groupPublicKey33B64u !== identity.threshold_public_key33_b64u ||
    input.publicFacts.clientShareRetryCounter !== identity.client_share_retry_counter ||
    input.publicFacts.relayerShareRetryCounter !== identity.server_share_retry_counter ||
    input.publicFacts.ethereumAddress !==
      ethereumAddressFromAddress20B64u(identity.ethereum_address20_b64u)
  ) {
    throw new Error('wallet recovery ECDSA custody public facts changed the capability');
  }
}

function readyStateBlobFromRecoveryOutput(stateBlobB64u: string): EcdsaRoleLocalReadyStateBlob {
  const stateBlob = stateBlobB64u.trim();
  if (!stateBlob) throw new Error('wallet recovery ECDSA returned no ready state blob');
  return {
    kind: 'ecdsa_role_local_state_blob_v1',
    curve: 'secp256k1',
    encoding: 'base64url',
    producer: 'signer_core',
    stateBlobB64u: stateBlob,
  };
}

export async function signRecoveredWalletCustodyEcdsa(input: {
  readonly entry: EcdsaRecoveryEntry;
  readonly walletId: string;
  readonly reservationId: string;
  readonly replacementId: string;
  readonly readyStateBlobB64u: string;
  readonly publicFacts: WalletCustodyEvmFamilyPublicFacts;
  readonly workerCtx: WorkerOperationContext;
}): Promise<WalletRecoveryEcdsaActivation> {
  const publicCapability = parseRouterAbEcdsaDerivationPublicCapabilityV1(
    input.entry.recoveryBasis.publicCapability,
  );
  const activationReceipt = parseRouterAbEcdsaRegistrationActivationReceiptV1(
    input.entry.recoveryBasis.activationReceipt,
  );
  requireCurrentActivationMatchesCapability({
    activationReceipt,
    publicCapability,
    serverGeneration: String(input.entry.recoveryBasis.serverGeneration),
  });
  const challenge = parseWalletRecoveryEcdsaPossessionChallengeV1(
    input.entry.recoveryBasis.possessionChallenge,
  );
  requirePossessionChallengeMatchesEntry({
    challenge,
    entry: input.entry,
    walletId: input.walletId,
    reservationId: input.reservationId,
    replacementId: input.replacementId,
    publicCapability,
  });
  const publicCapabilityDigestB64u = base64UrlEncode(
    await sha256BytesUtf8(alphabetizeStringify(publicCapability)),
  );
  if (challenge.publicCapabilityDigestB64u !== publicCapabilityDigestB64u) {
    throw new Error('wallet recovery ECDSA possession challenge changed the capability digest');
  }
  requireRecoveredPublicFactsMatch({
    publicFacts: input.publicFacts,
    publicCapability,
  });
  const signed = await signWalletRecoveryEcdsaMaterialPossessionProofWasm({
    workerCtx: input.workerCtx,
    challenge,
    stateBlob: readyStateBlobFromRecoveryOutput(input.readyStateBlobB64u),
  });
  const challengeDigestB64u = await walletRecoveryEcdsaPossessionChallengeDigestB64uV1(challenge);
  if (
    signed.challengeDigestB64u !== challengeDigestB64u ||
    signed.derivationClientSharePublicKey33B64u !== challenge.derivationClientSharePublicKey33B64u
  ) {
    throw new Error('wallet recovery ECDSA possession proof changed its challenge binding');
  }
  return {
    activationReceipt,
    publicCapability,
    possessionProof: signed.proof,
  };
}
