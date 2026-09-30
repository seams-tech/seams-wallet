import {
  encodeLinkedDeviceRequestProofV1,
  LINKED_DEVICE_REQUEST_PROOF_SIGNATURE_BYTES_V1,
  parseLinkDevicePublicKeyB64u,
  parseWalletSessionOperationCredentialV1,
  assertLinkedDeviceWalletSessionCredentialDeliveryIntegrityV1,
  encodeLinkedDeviceWalletSessionCredentialDeliveryAadV1,
  type LinkedDeviceRequestProofV1,
  type LinkedDeviceEmailOtpFactorReleaseEnvelopeV1,
  type LinkedDeviceEmailOtpVerificationGrantV1,
  type LinkedDeviceWalletSessionCredentialDeliveryV1,
  type WalletSessionOperationCredentialV1,
  type LinkDevicePublicKeyB64u,
  type CommittedAuthorityPackagesV1,
  type CommittedEcdsaSignerPackageV1,
  type OrdinarySignerMaterialRecipientRequestV1,
} from '@shared/device-linking';
import { computeWalletSessionOperationCredentialDigestB64u } from '@shared/device-linking/digests';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { alphabetizeStringify } from '@shared/utils/digests';
import { EMAIL_OTP_FACTOR_RELEASE_AAD_DOMAIN_V1 } from '@shared/utils/emailOtpDomain';
import { sha256Utf8DigestB64u } from '@shared/utils/canonicalPrimitives';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import { routerAbMpcMaterialActivationRefFromWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { parseRouterAbEd25519YaoActivationPublicReceiptV1 } from '@shared/utils/routerAbEd25519Yao';
import { isPlainObject } from '@shared/utils/validation';
import initNearSigner, {
  ed25519_yao_client_root_transfer_recipient_v1,
  type WasmEd25519YaoClientRootTransferRecipientV1,
} from '../../../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';
import type { WalletAuthoritySignerMaterialRecordV1 } from '@/core/indexedDB';
import {
  sealWalletAuthorityLinkedSignerMaterialV1,
  walletAuthorityLinkedSignerMaterialRecordFromPackageV1,
  type LinkedSignerPackageForMaterialV1,
} from '@/core/indexedDB/linkedAuthoritySignerMaterial';
import initEd25519YaoClient, {
  WasmOrdinaryEd25519ActivationClientMaterialV1,
} from '../../../../../../../crates/router-ab-ed25519-yao-client/pkg/router_ab_ed25519_yao_client.js';
import { resolveWasmUrl } from '@/core/walletRuntimePaths/wasm-loader';
import {
  assertOrdinaryExportRootResealingMatchesCommittedV1,
  type DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1,
  type DeviceLinkingOrdinarySignerMaterialRecipientInputV1,
  type DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1,
  type DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1,
  type DeviceLinkingOrdinaryMaterialSealerV1,
  type DeviceLinkingOrdinaryTargetFactorBindingV1,
  type DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
  type SealedLocalAuthorityMaterialSetV1,
} from '../deviceLinkingPorts';
import {
  extractX25519PrivateKey,
  openLinkedDeviceEcdsaTargetClientShare,
} from './device-linking-key/ecdsaTargetShareHpke';
import {
  type DeviceLinkingOrdinaryMaterialSealStateV1,
  type DeviceLinkingOrdinaryMaterialStateV1,
  type DeviceLinkingOrdinarySignerMaterialRecipientPreparationStateV1,
  deviceLinkingSealReplayIdentityV1,
  sameEcdsaSourceSignerIdentity,
  sameEcdsaTargetRecipientPreparation,
  sameOrdinaryRecipientRequests,
  sameOrdinaryRecipientRequirements,
  sameOrdinaryTargetFactor,
  sameOrdinaryTargetFactorAndPreparations,
} from './device-linking-key/ordinaryMaterialState';
import {
  type DeviceLinkingKeyWorkerRequestV1,
  type DeviceLinkingKeyWorkerResponseV1,
  parseFrame,
  parseRequest,
} from './device-linking-key/requests';

/**
 * The worker is the only owner of these key objects. The browser receives
 * public bytes and an opaque slot id; private CryptoKeys are non-extractable
 * and never appear in a structured-clone message.
 */
type DeviceLinkingKeySlotV1 = {
  readonly identityPrivateKey: CryptoKey;
  readonly linkPrivateKey: CryptoKey;
  readonly devicePublicKeyB64u: LinkDevicePublicKeyB64u;
  readonly linkPublicKeyB64u: LinkDevicePublicKeyB64u;
  readonly deliveryRecipientPrivateKey: CryptoKey;
  readonly deliveryRecipientPublicKey65B64u: string;
  emailOtpFactorReleaseChallengeId: string | null;
  emailOtpExportRootRecipient: WasmEd25519YaoClientRootTransferRecipientV1 | null;
  ordinaryMaterialRecipientPreparation: DeviceLinkingOrdinarySignerMaterialRecipientPreparationStateV1 | null;
  ordinaryMaterial: DeviceLinkingOrdinaryMaterialStateV1 | null;
  ordinaryMaterialSeal: DeviceLinkingOrdinaryMaterialSealStateV1 | null;
};

type DeviceLinkingKeyWorkerScopeV1 = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

type InstalledDeviceLinkingKeyWorkerV1 = {
  close(): Promise<void>;
};

const keySlots = new Map<string, DeviceLinkingKeySlotV1>();
const laneRecipientWasmUrl = resolveWasmUrl(
  'router_ab_ed25519_yao_client_bg.wasm',
  'Ed25519 Yao Client',
);
const nearSignerWasmUrl = resolveWasmUrl('wasm_signer_worker_bg.wasm', 'NEAR Signer');

/** Initializes a WASM module once, and again on the next call after a failed attempt. */
function wasmInitializer(initialize: () => Promise<unknown>): () => Promise<void> {
  let initPromise: Promise<void> | null = null;
  return async () => {
    if (!initPromise) {
      initPromise = initialize().then(
        () => undefined,
        (error: unknown) => {
          initPromise = null;
          throw error;
        },
      );
    }
    return await initPromise;
  };
}

const initializeLaneRecipientWasm = wasmInitializer(() =>
  initEd25519YaoClient({ module_or_path: laneRecipientWasmUrl }),
);
const initializeNearSignerWasm = wasmInitializer(() =>
  initNearSigner({ module_or_path: nearSignerWasmUrl }),
);

function requireKeySlot(handleId: string): DeviceLinkingKeySlotV1 {
  const slot = keySlots.get(handleId);
  if (!slot) throw new Error('device-linking key handle is unknown or discarded');
  return slot;
}

function destroyKeySlot(slot: DeviceLinkingKeySlotV1): void {
  destroyOrdinaryRecipientPreparation(slot);
  destroyOrdinaryMaterial(slot);
  slot.emailOtpExportRootRecipient?.free();
  slot.emailOtpExportRootRecipient = null;
}

const productionOrdinaryMaterialSealer: DeviceLinkingOrdinaryMaterialSealerV1 = {
  async sealCommittedAuthorityPackagesV1(input) {
    if (input.preparations.length !== input.recipientInputs.length) {
      throw new Error('ordinary material recipient inputs do not match preparations');
    }
    const exportRoot = assertOrdinaryExportRootResealingMatchesCommittedV1({
      committed: input.committed,
      resealedExportRoot: input.resealedExportRoot,
    });
    const signerMaterials: WalletAuthoritySignerMaterialRecordV1[] = [];
    for (const preparation of input.preparations) {
      const packageValue = ordinarySignerPackageForPreparation(input.committed, preparation);
      const recipientInput = ordinaryRecipientInputForPreparation(
        input.preparations,
        input.recipientInputs,
        preparation,
      );
      const material = await openOrdinarySignerMaterial({
        preparation,
        packageValue,
        recipientInput,
      });
      try {
        const packageForMaterial: LinkedSignerPackageForMaterialV1 = packageValue;
        const sealed = await sealWalletAuthorityLinkedSignerMaterialV1({
          factorSecret: input.factorSecret,
          aad: {
            authorityId: input.committed.authority.authorityId,
            walletId: input.committed.authority.walletId,
            walletAuthMethodId: input.committed.authMethod.walletAuthMethodId,
            packageSetDigestB64u: input.committed.packageSetDigestB64u,
            targetFactor: input.targetFactor,
            materialActivation: packageValue.package.materialActivation,
            keyFamily: packageValue.keyFamily,
          },
          material,
        });
        signerMaterials.push(
          walletAuthorityLinkedSignerMaterialRecordFromPackageV1({
            committed: input.committed,
            targetFactor: input.targetFactor,
            packageValue: packageForMaterial,
            sealedMaterialB64u: sealed.sealedMaterialB64u,
            sealedMaterialDigestB64u: sealed.sealedMaterialDigestB64u,
          }),
        );
      } finally {
        material.fill(0);
      }
    }
    const firstSignerMaterial = signerMaterials[0];
    if (!firstSignerMaterial) throw new Error('ordinary signer material set is empty');
    const installedRecordSetDigestB64u = await sha256Utf8DigestB64u(
      alphabetizeStringify({
        domain: 'seams/wallet/ordinary-authority-material-set/v1',
        signerMaterials,
        exportRoot,
      }),
    );
    return {
      signerMaterials: [firstSignerMaterial, ...signerMaterials.slice(1)],
      exportRoot,
      installedRecordSetDigestB64u,
    };
  },
};

function ordinarySignerPackageForPreparation(
  committed: CommittedAuthorityPackagesV1,
  preparation: DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
): LinkedSignerPackageForMaterialV1 {
  if ('kind' in preparation) {
    if (!committed.signerPackages.ed25519) {
      throw new Error('ordinary Ed25519 signer package is missing');
    }
    const packageValue = committed.signerPackages.ed25519;
    const activation = preparation.targetMaterialActivation;
    if (!mpcMaterialActivationRefsEqual(activation, packageValue.materialActivation)) {
      throw new Error('ordinary Ed25519 signer package activation reference changed');
    }
    if (
      packageValue.participantIds[0] !== preparation.participantIds[0] ||
      packageValue.participantIds[1] !== preparation.participantIds[1]
    ) {
      throw new Error('ordinary Ed25519 signer package participant ids changed');
    }
    return { keyFamily: 'ed25519', package: packageValue };
  }
  if (!committed.signerPackages.ecdsa) {
    throw new Error('ordinary ECDSA signer package is missing');
  }
  const packageValue = committed.signerPackages.ecdsa;
  assertEcdsaPreparationMatchesPackage(preparation, packageValue);
  return { keyFamily: 'ecdsa_secp256k1', package: packageValue };
}

function ordinaryRecipientInputForPreparation(
  preparations: readonly DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
  inputs: readonly DeviceLinkingOrdinarySignerMaterialRecipientInputV1[],
  preparation: DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
): DeviceLinkingOrdinarySignerMaterialRecipientInputV1 {
  const index = preparations.indexOf(preparation);
  const input = inputs[index];
  if (!input) throw new Error('ordinary signer material recipient input is missing');
  const expectedKind =
    'kind' in preparation
      ? 'ordinary_ed25519_signer_material_recipient_input_v1'
      : 'ordinary_ecdsa_signer_material_recipient_input_v1';
  if (input.kind !== expectedKind) {
    throw new Error('ordinary signer material recipient input family changed');
  }
  return input;
}

async function openOrdinarySignerMaterial(input: {
  readonly preparation: DeviceLinkingOrdinarySignerMaterialReservationPreparationV1;
  readonly packageValue: LinkedSignerPackageForMaterialV1;
  readonly recipientInput: DeviceLinkingOrdinarySignerMaterialRecipientInputV1;
}): Promise<Uint8Array> {
  if (
    'kind' in input.preparation &&
    input.packageValue.keyFamily === 'ed25519' &&
    input.recipientInput.kind === 'ordinary_ed25519_signer_material_recipient_input_v1'
  ) {
    await initializeLaneRecipientWasm();
    const recipientPrivateKey = new Uint8Array(input.recipientInput.recipientPrivateKey);
    let material: WasmOrdinaryEd25519ActivationClientMaterialV1 | null = null;
    try {
      material = new WasmOrdinaryEd25519ActivationClientMaterialV1(
        JSON.stringify(input.preparation.targetAdmission.binding),
        JSON.stringify(input.packageValue.package.deriver_a_client_package),
        JSON.stringify(input.packageValue.package.deriver_b_client_package),
        recipientPrivateKey,
        JSON.stringify(input.preparation.participantIds),
        JSON.stringify(
          parseRouterAbEd25519YaoActivationPublicReceiptV1(
            input.packageValue.package.activationReceipt,
          ),
        ),
      );
      return new Uint8Array(material.take_client_material());
    } finally {
      recipientPrivateKey.fill(0);
      material?.destroy();
      material?.free();
    }
  }
  if (
    !('kind' in input.preparation) &&
    input.packageValue.keyFamily === 'ecdsa_secp256k1' &&
    input.recipientInput.kind === 'ordinary_ecdsa_signer_material_recipient_input_v1'
  ) {
    const recipientPrivateKey = new Uint8Array(input.recipientInput.clientEphemeralPrivateKey);
    try {
      return await openLinkedDeviceEcdsaTargetClientShare({
        envelope: input.packageValue.package.encryptedTargetClientShare,
        recipientPrivateKey,
      });
    } finally {
      recipientPrivateKey.fill(0);
    }
  }
  throw new Error('ordinary signer material preparation and package family differ');
}

function assertEcdsaPreparationMatchesPackage(
  preparation: Exclude<
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    { readonly kind: string }
  >,
  packageValue: CommittedEcdsaSignerPackageV1,
): void {
  const binding = packageValue.activationReceipt.binding;
  if (
    preparation.linkSessionId !== binding.linkSessionId ||
    preparation.enrollmentId !== binding.enrollmentId ||
    preparation.sourceAuthorityId !== binding.sourceAuthorityId ||
    !sameEcdsaSourceSignerIdentity(preparation.source, binding.source) ||
    !sameEcdsaTargetRecipientPreparation(preparation.target, binding.target) ||
    !mpcMaterialActivationRefsEqual(
      preparation.target.activation,
      packageValue.materialActivation,
    ) ||
    packageValue.encryptedTargetClientShare.recipientPublicKeyB64u !==
      preparation.target.clientRecipientPublicKeyB64u
  ) {
    throw new Error('ordinary ECDSA signer package differs from its source preparation');
  }
}

function createHandleId(): string {
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== 'function') {
    throw new Error('secure randomness is unavailable for device-linking worker');
  }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(24));
  const handleId = `device-linking-key-${base64UrlEncode(bytes)}`;
  bytes.fill(0);
  return handleId;
}

function requireCryptoKeyPair(value: CryptoKey | CryptoKeyPair, label: string): CryptoKeyPair {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('publicKey' in value) ||
    !('privateKey' in value)
  ) {
    throw new Error(`${label} did not produce a key pair`);
  }
  return value;
}

async function generateKeySlot(): Promise<{
  readonly slot: DeviceLinkingKeySlotV1;
  readonly result: Extract<DeviceLinkingKeyWorkerResponseV1, { readonly handleId: string }>;
}> {
  const identityPair = requireCryptoKeyPair(
    await globalThis.crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']),
    'Ed25519 identity',
  );
  const linkPair = requireCryptoKeyPair(
    await globalThis.crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']),
    'X25519 link',
  );
  const deliveryRecipientPair = requireCryptoKeyPair(
    await globalThis.crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
      'deriveBits',
    ]),
    'P-256 credential delivery recipient',
  );
  const identityPublicBytes = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('raw', identityPair.publicKey),
  );
  const linkPublicBytes = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('raw', linkPair.publicKey),
  );
  const deliveryRecipientPublicBytes = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('raw', deliveryRecipientPair.publicKey),
  );
  try {
    if (
      identityPublicBytes.length !== 32 ||
      linkPublicBytes.length !== 32 ||
      deliveryRecipientPublicBytes.length !== 65 ||
      deliveryRecipientPublicBytes[0] !== 4
    ) {
      throw new Error('device-linking worker returned an invalid public key length');
    }
    const devicePublicKeyB64u = parseLinkDevicePublicKeyB64u(base64UrlEncode(identityPublicBytes));
    const linkPublicKeyB64u = parseLinkDevicePublicKeyB64u(base64UrlEncode(linkPublicBytes));
    const deliveryRecipientPublicKey65B64u = base64UrlEncode(deliveryRecipientPublicBytes);
    const handleId = createHandleId();
    const slot: DeviceLinkingKeySlotV1 = {
      identityPrivateKey: identityPair.privateKey,
      linkPrivateKey: linkPair.privateKey,
      devicePublicKeyB64u,
      linkPublicKeyB64u,
      deliveryRecipientPrivateKey: deliveryRecipientPair.privateKey,
      deliveryRecipientPublicKey65B64u,
      emailOtpFactorReleaseChallengeId: null,
      emailOtpExportRootRecipient: null,
      ordinaryMaterialRecipientPreparation: null,
      ordinaryMaterial: null,
      ordinaryMaterialSeal: null,
    };
    return {
      slot,
      result: {
        handleId,
        linkPublicKeyB64u,
        devicePublicKeyB64u,
        deliveryRecipientPublicKey65B64u,
      },
    };
  } finally {
    identityPublicBytes.fill(0);
    linkPublicBytes.fill(0);
    deliveryRecipientPublicBytes.fill(0);
  }
}

function responseTransferables(
  result: DeviceLinkingKeyWorkerResponseV1 | undefined,
): Transferable[] | undefined {
  if (
    result &&
    'kind' in result &&
    result.kind === 'device_linking_email_otp_factor_release_result_v1'
  ) {
    return [result.factorSecret];
  }
  if (
    result &&
    'kind' in result &&
    result.kind === 'device_linking_ordinary_signer_material_recipient_preparation_v1'
  ) {
    return result.recipientInputs.map((input) =>
      input.kind === 'ordinary_ed25519_signer_material_recipient_input_v1'
        ? input.recipientPrivateKey
        : input.clientEphemeralPrivateKey,
    );
  }
  if (
    result &&
    'warmSessionFactorSecret' in result &&
    result.warmSessionFactorSecret instanceof ArrayBuffer
  ) {
    return [result.warmSessionFactorSecret];
  }
  return undefined;
}

function postWorkerResponse(
  scope: DeviceLinkingKeyWorkerScopeV1,
  message: unknown,
  transfer: Transferable[] | undefined,
): void {
  if (transfer) {
    Reflect.apply(scope.postMessage, scope, [message, transfer]);
    return;
  }
  scope.postMessage(message);
}

async function openEmailOtpFactorRelease(
  request: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_email_otp_factor_release_open_v1' }
  >,
): Promise<{
  readonly kind: 'device_linking_email_otp_factor_release_result_v1';
  readonly verificationGrant: LinkedDeviceEmailOtpVerificationGrantV1;
  readonly factorSecret: ArrayBuffer;
}> {
  const slot = requireKeySlot(request.handleId);
  assertEmailOtpFactorReleaseBinding(request);
  if (slot.emailOtpFactorReleaseChallengeId !== null) {
    throw new Error('device-linking Email OTP factor release has already been consumed');
  }
  const factorSecret = await decryptEmailOtpFactorReleaseEnvelope({
    slot,
    walletId: String(request.walletId),
    factorRelease: request.factorRelease,
    expectedChallengeId: request.expectedChallengeId,
  });
  slot.emailOtpFactorReleaseChallengeId = request.expectedChallengeId;
  try {
    return {
      kind: 'device_linking_email_otp_factor_release_result_v1',
      verificationGrant: request.verificationGrant,
      factorSecret: factorSecret.slice().buffer,
    };
  } finally {
    factorSecret.fill(0);
  }
}

function assertEmailOtpFactorReleaseBinding(
  request: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_email_otp_factor_release_open_v1' }
  >,
): void {
  const grant = request.verificationGrant;
  if (
    String(grant.walletId) !== String(request.walletId) ||
    String(grant.linkSessionId) !== String(request.linkSessionId) ||
    String(grant.enrollmentId) !== String(request.enrollmentId) ||
    String(grant.deviceId) !== String(request.deviceId) ||
    String(grant.baseWalletAuthMethodId) !== String(request.baseWalletAuthMethodId) ||
    grant.targetPreparationDigestB64u !== request.targetPreparationDigestB64u ||
    grant.challengeId !== request.expectedChallengeId ||
    request.factorRelease.challengeId !== request.expectedChallengeId
  ) {
    throw new Error('device-linking Email OTP factor release identity binding changed');
  }
  const nowMs = Date.now();
  if (grant.issuedAtMs > nowMs || grant.expiresAtMs <= nowMs) {
    throw new Error('device-linking Email OTP factor release grant is expired');
  }
}

function discardKeyMaterialSlot(handleId: string): void {
  const slot = keySlots.get(handleId);
  if (slot) destroyKeySlot(slot);
  keySlots.delete(handleId);
}

async function signRequest(
  request: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_request_sign_v1' }
  >,
): Promise<{ readonly signatureB64u: string }> {
  const slot = requireKeySlot(request.handleId);
  const zeroSignature = new Uint8Array(LINKED_DEVICE_REQUEST_PROOF_SIGNATURE_BYTES_V1);
  const proof: LinkedDeviceRequestProofV1 = {
    kind: 'linked_device_request_proof_v1',
    linkSessionId: request.linkSessionId,
    devicePublicKeyDigestB64u: request.devicePublicKeyDigestB64u,
    requestNonceB64u: request.challengeB64u,
    method: request.method,
    canonicalPath: request.canonicalPath,
    bodyDigestB64u: request.bodyDigestB64u,
    issuedAtMs: request.issuedAtMs,
    expiresAtMs: request.expiresAtMs,
    signatureB64u: base64UrlEncode(zeroSignature),
  };
  let canonicalBytes: Uint8Array | undefined;
  let signatureBytes: Uint8Array | undefined;
  try {
    canonicalBytes = encodeLinkedDeviceRequestProofV1(proof);
    signatureBytes = new Uint8Array(
      await globalThis.crypto.subtle.sign('Ed25519', slot.identityPrivateKey, canonicalBytes),
    );
    if (signatureBytes.length !== LINKED_DEVICE_REQUEST_PROOF_SIGNATURE_BYTES_V1) {
      throw new Error('device-linking worker returned an invalid signature length');
    }
    return { signatureB64u: base64UrlEncode(signatureBytes) };
  } finally {
    zeroSignature.fill(0);
    canonicalBytes?.fill(0);
    signatureBytes?.fill(0);
  }
}

async function createX25519RecipientPair(): Promise<{
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}> {
  const pair = requireCryptoKeyPair(
    await globalThis.crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']),
    'ordinary signer material recipient',
  );
  const publicKey = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', pair.publicKey));
  const privatePkcs8 = new Uint8Array(
    await globalThis.crypto.subtle.exportKey('pkcs8', pair.privateKey),
  );
  try {
    const privateKey = extractX25519PrivateKey(privatePkcs8);
    return { privateKey, publicKey };
  } finally {
    privatePkcs8.fill(0);
  }
}

function x25519PublicKeyString(publicKey: Uint8Array): string {
  let hex = '';
  for (const byte of publicKey) hex += byte.toString(16).padStart(2, '0');
  return `x25519:${hex}`;
}

async function createOrdinarySignerMaterialRecipientPreparation(
  request: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_ordinary_signer_material_recipient_prepare_v1' }
  >,
): Promise<
  DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 & {
    readonly kind: 'device_linking_ordinary_signer_material_recipient_preparation_v1';
  }
> {
  const slot = requireKeySlot(request.handleId);
  const existing = slot.ordinaryMaterialRecipientPreparation;
  if (existing) {
    if (!sameOrdinaryRecipientRequirements(existing.requirements, request.requirements)) {
      throw new Error('ordinary recipient requirements conflict with the existing preparation');
    }
    return cloneOrdinaryRecipientPreparation(existing);
  }
  const recipientRequests: OrdinarySignerMaterialRecipientRequestV1[] = [];
  const recipientInputs: DeviceLinkingOrdinarySignerMaterialRecipientInputV1[] = [];
  try {
    for (const requirement of request.requirements) {
      const pair = await createX25519RecipientPair();
      const privateKey = pair.privateKey.buffer.slice(0);
      if (requirement.keyFamily === 'ed25519') {
        recipientRequests.push({
          kind: 'ordinary_ed25519_signer_material_recipient_request_v1',
          keyFamily: 'ed25519',
          walletKeyId: requirement.walletKeyId,
          recipientPublicKeyB64u: base64UrlEncode(pair.publicKey),
        });
        recipientInputs.push({
          kind: 'ordinary_ed25519_signer_material_recipient_input_v1',
          keyFamily: 'ed25519',
          walletKeyId: requirement.walletKeyId,
          recipientPrivateKey: privateKey,
        });
      } else {
        recipientRequests.push({
          kind: 'ordinary_ecdsa_signer_material_recipient_request_v1',
          keyFamily: 'ecdsa_secp256k1',
          walletKeyId: requirement.walletKeyId,
          clientEphemeralPublicKey: x25519PublicKeyString(pair.publicKey),
        });
        recipientInputs.push({
          kind: 'ordinary_ecdsa_signer_material_recipient_input_v1',
          keyFamily: 'ecdsa_secp256k1',
          walletKeyId: requirement.walletKeyId,
          clientEphemeralPrivateKey: privateKey,
        });
      }
      pair.privateKey.fill(0);
      pair.publicKey.fill(0);
    }
    const firstRequest = recipientRequests[0];
    const firstInput = recipientInputs[0];
    if (!firstRequest || !firstInput) throw new Error('ordinary recipient requirements are empty');
    const state: DeviceLinkingOrdinarySignerMaterialRecipientPreparationStateV1 = {
      requirements: request.requirements,
      recipientRequests: [firstRequest, ...recipientRequests.slice(1)],
      recipientInputs: [firstInput, ...recipientInputs.slice(1)],
    };
    slot.ordinaryMaterialRecipientPreparation = state;
    return cloneOrdinaryRecipientPreparation(state);
  } catch (error) {
    destroyOrdinaryRecipientInputs(recipientInputs);
    throw error;
  }
}

function cloneOrdinaryRecipientPreparation(
  state: DeviceLinkingOrdinarySignerMaterialRecipientPreparationStateV1,
): DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 & {
  readonly kind: 'device_linking_ordinary_signer_material_recipient_preparation_v1';
} {
  return {
    kind: 'device_linking_ordinary_signer_material_recipient_preparation_v1',
    recipientRequests: state.recipientRequests,
    recipientInputs: cloneOrdinaryRecipientInputTuple(state.recipientInputs),
  };
}

async function prepareOrdinarySignerMaterial(
  request: DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1,
): Promise<{
  readonly kind: 'device_linking_ordinary_signer_material_preparation_v1';
  readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
  readonly preparations: readonly [
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
  ];
}> {
  const slot = keySlots.get(request.handleId);
  if (!slot) {
    new Uint8Array(request.factorSecret).fill(0);
    destroyOrdinaryRecipientInputs(request.recipientInputs);
    throw new Error('device-linking key handle is unknown or discarded');
  }
  const transferredFactorSecret = new Uint8Array(request.factorSecret);
  const factorSecret = transferredFactorSecret.slice();
  try {
    const recipientPreparation = slot.ordinaryMaterialRecipientPreparation;
    if (!recipientPreparation) {
      throw new Error('ordinary signer material recipient preparation is unavailable');
    }
    assertOrdinaryRecipientPreparationMatchesRequest(recipientPreparation, request);
    const existing = slot.ordinaryMaterial;
    if (existing) {
      if (
        !sameOrdinaryTargetFactorAndPreparations(
          {
            targetFactor: existing.targetFactor,
            preparations: existing.preparations,
          },
          {
            targetFactor: request.targetFactor,
            preparations: request.preparations,
          },
        )
      ) {
        throw new Error(
          'ordinary signer material preparation conflicts with the existing activation reference',
        );
      }
      if (!sameBytes(factorSecret, existing.factorSecret)) {
        throw new Error(
          'ordinary signer material preparation conflicts with the existing factor secret',
        );
      }
      factorSecret.fill(0);
      return {
        kind: 'device_linking_ordinary_signer_material_preparation_v1',
        targetFactor: existing.targetFactor,
        preparations: existing.preparations,
      };
    }
    const clonedRecipientInputs = cloneOrdinaryRecipientInputTuple(
      recipientPreparation.recipientInputs,
    );
    slot.ordinaryMaterial = {
      targetFactor: request.targetFactor,
      preparations: request.preparations,
      recipientInputs: clonedRecipientInputs,
      factorSecret,
    };
    return {
      kind: 'device_linking_ordinary_signer_material_preparation_v1',
      targetFactor: request.targetFactor,
      preparations: request.preparations,
    };
  } catch (error) {
    factorSecret.fill(0);
    throw error;
  } finally {
    transferredFactorSecret.fill(0);
    destroyOrdinaryRecipientInputs(request.recipientInputs);
  }
}

function assertOrdinaryRecipientPreparationMatchesRequest(
  prepared: DeviceLinkingOrdinarySignerMaterialRecipientPreparationStateV1,
  request: DeviceLinkingOrdinaryMaterialWorkerPrivateRequestV1,
): void {
  if (!sameOrdinaryRecipientRequests(prepared.recipientRequests, request.recipientRequests)) {
    throw new Error('ordinary signer material recipient request changed before preparation');
  }
  if (prepared.recipientInputs.length !== request.recipientInputs.length) {
    throw new Error('ordinary signer material recipient input count changed before preparation');
  }
  for (const expected of prepared.recipientInputs) {
    const actual = request.recipientInputs.find(
      (input) =>
        input.keyFamily === expected.keyFamily && input.walletKeyId === expected.walletKeyId,
    );
    if (!actual || !sameBytes(recipientPrivateBytes(expected), recipientPrivateBytes(actual))) {
      throw new Error('ordinary signer material recipient input changed before preparation');
    }
  }
}

function recipientPrivateBytes(
  input: DeviceLinkingOrdinarySignerMaterialRecipientInputV1,
): Uint8Array {
  return new Uint8Array(
    input.kind === 'ordinary_ed25519_signer_material_recipient_input_v1'
      ? input.recipientPrivateKey
      : input.clientEphemeralPrivateKey,
  );
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

async function sealCommittedOrdinarySignerMaterial(
  request: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_ordinary_signer_material_seal_v1' }
  >,
  sealer: DeviceLinkingOrdinaryMaterialSealerV1,
): Promise<SealedLocalAuthorityMaterialSetV1> {
  const slot = requireKeySlot(request.handleId);
  const prepared = slot.ordinaryMaterial;
  if (!prepared) {
    throw new Error('ordinary signer material preparation is unavailable');
  }
  if (!sameOrdinaryTargetFactor(prepared.targetFactor, request.targetFactor)) {
    throw new Error('ordinary signer material target factor binding changed');
  }
  assertOrdinaryMaterialCommitMatchesPreparation({
    committed: request.committed,
    preparations: prepared.preparations,
    targetFactor: prepared.targetFactor,
  });
  const existingSeal = slot.ordinaryMaterialSeal;
  if (existingSeal) {
    const replayIdentity = deviceLinkingSealReplayIdentityV1({
      committed: request.committed,
      resealedExportRoot: request.resealedExportRoot,
    });
    if (existingSeal.committedAndResealedExportRootReplayIdentity !== replayIdentity) {
      throw new Error('ordinary signer material seal conflicts with the existing result');
    }
    return existingSeal.result;
  }
  const result = await sealer.sealCommittedAuthorityPackagesV1({
    committed: request.committed,
    targetFactor: prepared.targetFactor,
    resealedExportRoot: request.resealedExportRoot,
    preparations: prepared.preparations,
    recipientInputs: prepared.recipientInputs,
    factorSecret: prepared.factorSecret,
  });
  slot.ordinaryMaterialSeal = {
    committed: request.committed,
    targetFactor: prepared.targetFactor,
    resealedExportRoot: request.resealedExportRoot,
    result,
    committedAndResealedExportRootReplayIdentity: deviceLinkingSealReplayIdentityV1({
      committed: request.committed,
      resealedExportRoot: request.resealedExportRoot,
    }),
  };
  return result;
}

function assertOrdinaryMaterialCommitMatchesPreparation(input: {
  readonly committed: CommittedAuthorityPackagesV1;
  readonly preparations: readonly [
    DeviceLinkingOrdinarySignerMaterialReservationPreparationV1,
    ...DeviceLinkingOrdinarySignerMaterialReservationPreparationV1[],
  ];
  readonly targetFactor: DeviceLinkingOrdinaryTargetFactorBindingV1;
}): void {
  if (input.committed.authMethod.walletAuthMethodId !== input.targetFactor.walletAuthMethodId) {
    throw new Error('ordinary signer material auth method binding changed');
  }
  if (input.preparations.length !== input.committed.signerPackages.keyFamilies.length) {
    throw new Error('ordinary signer material family count changed before commit');
  }
  for (let index = 0; index < input.committed.signerPackages.keyFamilies.length; index += 1) {
    const family = input.committed.signerPackages.keyFamilies[index];
    const preparation = input.preparations[index];
    if (!preparation) {
      throw new Error(`ordinary signer material ${family} preparation is missing`);
    }
    if (family === 'ed25519') {
      if (!('kind' in preparation) || !input.committed.signerPackages.ed25519) {
        throw new Error('ordinary Ed25519 signer material package family changed');
      }
      const packageValue = input.committed.signerPackages.ed25519;
      if (
        !mpcMaterialActivationRefsEqual(
          preparation.targetMaterialActivation,
          packageValue.materialActivation,
        )
      ) {
        throw new Error('ordinary Ed25519 signer material activation reference changed');
      }
      if (
        packageValue.participantIds[0] !== preparation.participantIds[0] ||
        packageValue.participantIds[1] !== preparation.participantIds[1]
      ) {
        throw new Error('ordinary Ed25519 signer material participant ids changed');
      }
      const receipt = parseRouterAbEd25519YaoActivationPublicReceiptV1(
        packageValue.activationReceipt,
      );
      const receiptActivation = routerAbMpcMaterialActivationRefFromWire(
        receipt.material_activation,
      );
      if (!mpcMaterialActivationRefsEqual(receiptActivation, packageValue.materialActivation)) {
        throw new Error('ordinary Ed25519 activation receipt reference changed');
      }
      continue;
    }
    if ('kind' in preparation || !input.committed.signerPackages.ecdsa) {
      throw new Error('ordinary ECDSA signer material package family changed');
    }
    assertEcdsaPreparationMatchesPackage(preparation, input.committed.signerPackages.ecdsa);
  }
}

function destroyOrdinaryMaterial(slot: DeviceLinkingKeySlotV1): void {
  slot.ordinaryMaterial?.factorSecret.fill(0);
  if (slot.ordinaryMaterial) {
    destroyOrdinaryRecipientInputs(slot.ordinaryMaterial.recipientInputs);
  }
  slot.ordinaryMaterial = null;
  slot.ordinaryMaterialSeal = null;
}

function destroyOrdinaryRecipientPreparation(slot: DeviceLinkingKeySlotV1): void {
  if (!slot.ordinaryMaterialRecipientPreparation) return;
  destroyOrdinaryRecipientInputs(slot.ordinaryMaterialRecipientPreparation.recipientInputs);
  slot.ordinaryMaterialRecipientPreparation = null;
}

function cloneOrdinaryRecipientInput(
  input: DeviceLinkingOrdinarySignerMaterialRecipientInputV1,
): DeviceLinkingOrdinarySignerMaterialRecipientInputV1 {
  if (input.kind === 'ordinary_ed25519_signer_material_recipient_input_v1') {
    return {
      kind: input.kind,
      keyFamily: input.keyFamily,
      walletKeyId: input.walletKeyId,
      recipientPrivateKey: input.recipientPrivateKey.slice(0),
    };
  }
  return {
    kind: input.kind,
    keyFamily: input.keyFamily,
    walletKeyId: input.walletKeyId,
    clientEphemeralPrivateKey: input.clientEphemeralPrivateKey.slice(0),
  };
}

function cloneOrdinaryRecipientInputTuple(
  inputs: readonly DeviceLinkingOrdinarySignerMaterialRecipientInputV1[],
): DeviceLinkingOrdinarySignerMaterialRecipientInputTupleV1 {
  const cloned = inputs.map(cloneOrdinaryRecipientInput);
  const first = cloned[0];
  if (!first) throw new Error('ordinary signer material recipient inputs are empty');
  return [first, ...cloned.slice(1)];
}

function destroyOrdinaryRecipientInputs(
  inputs: readonly DeviceLinkingOrdinarySignerMaterialRecipientInputV1[],
): void {
  for (const input of inputs) {
    if (input.kind === 'ordinary_ed25519_signer_material_recipient_input_v1') {
      new Uint8Array(input.recipientPrivateKey).fill(0);
    } else {
      new Uint8Array(input.clientEphemeralPrivateKey).fill(0);
    }
  }
}

async function createEmailOtpEd25519ExportRootRecipient(
  handleId: string,
): Promise<{ readonly recipientPublicKeyB64u: string }> {
  const slot = requireKeySlot(handleId);
  if (slot.emailOtpExportRootRecipient) {
    throw new Error('device-linking Email OTP export-root recipient is already active');
  }
  await initializeNearSignerWasm();
  const recipient = ed25519_yao_client_root_transfer_recipient_v1();
  slot.emailOtpExportRootRecipient = recipient;
  return { recipientPublicKeyB64u: recipient.public_key_b64u() };
}

async function decryptEmailOtpFactorReleaseEnvelope(input: {
  readonly slot: DeviceLinkingKeySlotV1;
  readonly walletId: string;
  readonly factorRelease: LinkedDeviceEmailOtpFactorReleaseEnvelopeV1;
  readonly expectedChallengeId: string;
}): Promise<Uint8Array> {
  const release = input.factorRelease;
  if (input.expectedChallengeId !== release.challengeId) {
    throw new Error('Email OTP factor release challenge does not match the submitted challenge');
  }
  const factorSecret = await openDeliveryRecipientEnvelope({
    slot: input.slot,
    envelope: release,
    aad: () =>
      `${EMAIL_OTP_FACTOR_RELEASE_AAD_DOMAIN_V1}\0${input.walletId}\0${release.enrollmentId}\0${release.enrollmentSealKeyVersion}\0${release.challengeId}`,
  });
  if (factorSecret.length !== 32) {
    factorSecret.fill(0);
    throw new Error('Email OTP factor release plaintext must contain exactly 32 bytes');
  }
  return factorSecret;
}

/**
 * Opens a P-256 ECDH, AES-256-GCM envelope sealed to the slot's delivery recipient key. `aad`
 * is encoded just before decryption, and every intermediate buffer is zeroed.
 */
async function openDeliveryRecipientEnvelope(input: {
  readonly slot: DeviceLinkingKeySlotV1;
  readonly envelope: {
    readonly serverEphemeralPublicKey65B64u: string;
    readonly nonce12B64u: string;
    readonly ciphertextB64u: string;
  };
  readonly aad: () => string;
}): Promise<Uint8Array> {
  let serverPublicKey: Uint8Array | null = null;
  let nonce: Uint8Array | null = null;
  let ciphertext: Uint8Array | null = null;
  let sharedSecret: Uint8Array | null = null;
  let aad: Uint8Array | null = null;
  try {
    serverPublicKey = base64UrlDecode(input.envelope.serverEphemeralPublicKey65B64u);
    nonce = base64UrlDecode(input.envelope.nonce12B64u);
    ciphertext = base64UrlDecode(input.envelope.ciphertextB64u);
    const importedServerKey = await globalThis.crypto.subtle.importKey(
      'raw',
      serverPublicKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      [],
    );
    sharedSecret = new Uint8Array(
      await globalThis.crypto.subtle.deriveBits(
        { name: 'ECDH', public: importedServerKey },
        input.slot.deliveryRecipientPrivateKey,
        256,
      ),
    );
    const aesKey = await globalThis.crypto.subtle.importKey(
      'raw',
      sharedSecret,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    aad = new TextEncoder().encode(input.aad());
    return new Uint8Array(
      await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
        aesKey,
        ciphertext,
      ),
    );
  } finally {
    serverPublicKey?.fill(0);
    nonce?.fill(0);
    ciphertext?.fill(0);
    sharedSecret?.fill(0);
    aad?.fill(0);
  }
}

async function openWalletSessionCredentialDelivery(
  request: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_wallet_session_credential_delivery_open_v1' }
  >,
): Promise<WalletSessionOperationCredentialV1> {
  const slot = requireKeySlot(request.handleId);
  const delivery = request.delivery;
  await assertLinkedDeviceWalletSessionCredentialDeliveryIntegrityV1(delivery);
  assertWalletSessionCredentialDeliveryBinding({
    delivery,
    expected: request.expected,
    recipientPublicKey65B64u: slot.deliveryRecipientPublicKey65B64u,
  });
  if (Date.now() >= delivery.aad.expiresAtMs) {
    throw new Error('linked-device Wallet Session credential delivery is expired');
  }

  const plaintext = await openDeliveryRecipientEnvelope({
    slot,
    envelope: delivery.envelope,
    aad: () => encodeLinkedDeviceWalletSessionCredentialDeliveryAadV1(delivery.aad),
  });
  try {
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder().decode(plaintext));
    } catch {
      throw new Error('linked-device Wallet Session credential plaintext is not valid JSON');
    }
    const operationCredential = parseWalletSessionOperationCredentialV1(decoded);
    if (operationCredential.walletSessionId !== delivery.aad.walletSessionId) {
      throw new Error('linked-device Wallet Session credential identity does not match AAD');
    }
    const credentialDigestB64u =
      await computeWalletSessionOperationCredentialDigestB64u(operationCredential);
    if (credentialDigestB64u !== delivery.aad.credentialDigestB64u) {
      throw new Error('linked-device Wallet Session credential digest does not match AAD');
    }
    return operationCredential;
  } finally {
    plaintext.fill(0);
  }
}

function assertWalletSessionCredentialDeliveryBinding(input: {
  readonly delivery: LinkedDeviceWalletSessionCredentialDeliveryV1;
  readonly expected: Extract<
    DeviceLinkingKeyWorkerRequestV1,
    { readonly kind: 'device_linking_wallet_session_credential_delivery_open_v1' }
  >['expected'];
  readonly recipientPublicKey65B64u: string;
}): void {
  const aad = input.delivery.aad;
  const expected = input.expected;
  const binding = expected.deliveryBinding;
  if (
    aad.namespace !== binding.namespace ||
    aad.orgId !== binding.orgId ||
    aad.projectId !== binding.projectId ||
    aad.envId !== binding.envId ||
    aad.tenantId !== binding.tenantId ||
    aad.principalId !== binding.principalId ||
    aad.linkSessionId !== expected.linkSessionId ||
    aad.walletId !== expected.walletId ||
    aad.authorityId !== expected.authorityId ||
    aad.walletAuthMethodId !== expected.walletAuthMethodId ||
    aad.authorizationId !== expected.authorizationId ||
    aad.walletSessionId !== expected.walletSessionId ||
    aad.quotaId !== expected.quotaId ||
    aad.credentialDigestB64u !== expected.credentialDigestB64u ||
    input.delivery.installationReceiptDigestB64u !== expected.installationReceiptDigestB64u ||
    aad.recipientPublicKey65B64u !== expected.recipientPublicKey65B64u ||
    aad.recipientPublicKey65B64u !== input.recipientPublicKey65B64u ||
    aad.issuedAtMs !== expected.issuedAtMs ||
    aad.expiresAtMs !== expected.expiresAtMs
  ) {
    throw new Error('linked-device Wallet Session credential delivery identity changed');
  }
}

async function handleRequest(
  rawRequest: unknown,
  ordinaryMaterialSealer: DeviceLinkingOrdinaryMaterialSealerV1,
): Promise<DeviceLinkingKeyWorkerResponseV1 | undefined> {
  const request = parseRequest(rawRequest);
  switch (request.kind) {
    case 'device_linking_key_material_create_v1': {
      const generated = await generateKeySlot();
      keySlots.set(generated.result.handleId, generated.slot);
      return generated.result;
    }
    case 'device_linking_ordinary_signer_material_recipient_prepare_v1':
      return await createOrdinarySignerMaterialRecipientPreparation(request);
    case 'device_linking_ordinary_signer_material_prepare_private_v1':
      return await prepareOrdinarySignerMaterial(request);
    case 'device_linking_ordinary_signer_material_seal_v1':
      return await sealCommittedOrdinarySignerMaterial(request, ordinaryMaterialSealer);
    case 'device_linking_email_otp_export_root_recipient_create_v1':
      return await createEmailOtpEd25519ExportRootRecipient(request.handleId);
    case 'device_linking_request_sign_v1':
      return await signRequest(request);
    case 'device_linking_email_otp_factor_release_open_v1':
      return await openEmailOtpFactorRelease(request);
    case 'device_linking_wallet_session_credential_delivery_open_v1':
      return await openWalletSessionCredentialDelivery(request);
    case 'device_linking_key_material_discard_v1':
      discardKeyMaterialSlot(request.handleId);
      return undefined;
    default:
      request satisfies never;
      throw new Error('device-linking worker request kind is unsupported');
  }
}

function workerError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (isPlainObject(error) && 'message' in error) {
    if (typeof error.message === 'string' && error.message.trim()) return error.message;
  }
  return 'device-linking worker request failed';
}

function installDeviceLinkingKeyWorkerV1(
  scope: DeviceLinkingKeyWorkerScopeV1,
  ordinaryMaterialSealer: DeviceLinkingOrdinaryMaterialSealerV1 = productionOrdinaryMaterialSealer,
): InstalledDeviceLinkingKeyWorkerV1 {
  let closed = false;
  let queue: Promise<void> = Promise.resolve();
  const onMessage = (event: MessageEvent): void => {
    queue = queue
      .catch(() => undefined)
      .then(async () => {
        if (closed) return;
        let id: string | undefined;
        try {
          const frame = parseFrame(event.data);
          id = frame.id;
          const result = await handleRequest(frame.request, ordinaryMaterialSealer);
          if (closed) return;
          postWorkerResponse(scope, { id, ok: true, result }, responseTransferables(result));
        } catch (error) {
          if (!closed && id) scope.postMessage({ id, ok: false, error: workerError(error) });
        }
      });
  };
  scope.addEventListener('message', onMessage);
  return {
    async close(): Promise<void> {
      if (closed) return await queue;
      closed = true;
      scope.removeEventListener('message', onMessage);
      queue = queue
        .catch(() => undefined)
        .then(() => {
          for (const slot of keySlots.values()) destroyKeySlot(slot);
          keySlots.clear();
        });
      await queue;
    },
  };
}

if (typeof self !== 'undefined') {
  installDeviceLinkingKeyWorkerV1(self);
}
