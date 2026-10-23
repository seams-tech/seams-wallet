import {
  buildMethodBoundEnvelopeOwnership,
  buildWalletCustodySeedBinding,
  buildPasskeyCustodyEnvelopeRecord,
  buildVoiceIdEnvelopeFactor,
  custodyEnvelopeBindingJsonV1,
  isVoiceIdSeedEnvelope,
  parseEnvelopeRevision,
  parsePasskeyCustodyEnvelopeRecord,
  type VoiceIdSeedEnvelope,
} from '@shared/passkey-custody';
import { parseDigestB64u, sha256DigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import { base64UrlDecode } from '@shared/utils/base64';
import type { WalletSessionOperationCredentialV1 } from '@shared/device-linking/contracts';
import {
  parseWalletAuthMethodId,
  parseWalletId,
  type PasskeyEnvelopeId,
  type WalletAuthMethodId,
  type WalletId,
} from '@shared/utils/domainIds';
import {
  parseVoiceIdDevicePublicKeyB64u,
  type VoiceIdDevicePublicKeyB64u,
} from '@shared/authorization/voiceIdDeviceAssertion';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { requireRecord } from '@shared/utils/validation';
import { parseResealedEnvelopeResult } from '@/core/signingEngine/walletCustody/resealedEnvelopeResult';
import type { UnlockedWalletEd25519ExportRootCapabilityV1 } from '@/core/signingEngine/workerManager/workerTypes';
import { captureVoiceIdActivation } from '@/core/signingEngine/uiConfirm/voiceId/deviceBridge';
import type { VoiceIdHttpClient } from './httpClient';

export type PendingVoiceIdActivation = Readonly<{
  kind: 'pending_voiceid_activation_v1';
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  devicePublicKeyB64u: VoiceIdDevicePublicKeyB64u;
  deviceKeyId: DigestB64u;
  custodyEnvelope: VoiceIdSeedEnvelope;
}>;

export async function parsePendingVoiceIdActivation(raw: unknown): Promise<PendingVoiceIdActivation> {
  const record = requireRecord(raw, 'pending VoiceID activation');
  rejectUnknownFields(
    record,
    ['kind', 'walletId', 'walletAuthMethodId', 'devicePublicKeyB64u', 'deviceKeyId', 'custodyEnvelope'],
    'pending VoiceID activation',
  );
  if (record.kind !== 'pending_voiceid_activation_v1') {
    throw new Error('Pending VoiceID activation kind is invalid.');
  }
  const walletId = parseWalletId(record.walletId);
  const walletAuthMethodId = parseWalletAuthMethodId(record.walletAuthMethodId);
  if (!walletId.ok || !walletAuthMethodId.ok) {
    throw new Error('Pending VoiceID activation identity is invalid.');
  }
  const devicePublicKeyB64u = parseVoiceIdDevicePublicKeyB64u(record.devicePublicKeyB64u);
  const deviceKeyId = parseDigestB64u(record.deviceKeyId);
  const custodyEnvelope = parsePasskeyCustodyEnvelopeRecord(record.custodyEnvelope);
  if (
    !isVoiceIdSeedEnvelope(custodyEnvelope) ||
    custodyEnvelope.walletId !== walletId.value ||
    custodyEnvelope.ownership.walletAuthMethodId !== walletAuthMethodId.value ||
    custodyEnvelope.factor.deviceKeyId !== deviceKeyId ||
    Number(custodyEnvelope.envelopeRevision) !== 1 ||
    await sha256DigestB64u(base64UrlDecode(devicePublicKeyB64u)) !== deviceKeyId
  ) {
    throw new Error('Pending VoiceID activation binding is invalid.');
  }
  return {
    kind: 'pending_voiceid_activation_v1',
    walletId: walletId.value,
    walletAuthMethodId: walletAuthMethodId.value,
    devicePublicKeyB64u,
    deviceKeyId,
    custodyEnvelope,
  };
}

type NewVoiceIdActivation = Readonly<{
  kind: 'new';
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  envelopeId: PasskeyEnvelopeId;
  capability: UnlockedWalletEd25519ExportRootCapabilityV1;
  reseal: VoiceIdSeedResealPort;
  pending?: never;
}>;

type ResumeVoiceIdActivation = Readonly<{
  kind: 'resume';
  pending: PendingVoiceIdActivation;
  walletId?: never;
  walletAuthMethodId?: never;
  envelopeId?: never;
  capability?: never;
  reseal?: never;
}>;

export type VoiceIdSeedResealPort = (input: {
  readonly capability: UnlockedWalletEd25519ExportRootCapabilityV1;
  readonly bindingJson: string;
  readonly factorSecret: ArrayBuffer;
}) => Promise<unknown>;

export type VoiceIdActivationPlan = NewVoiceIdActivation | ResumeVoiceIdActivation;

export type VoiceIdActivationOutcome = Readonly<{
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2;
  pending: PendingVoiceIdActivation;
}>;

function assertNever(value: never): never {
  throw new Error(`Unhandled VoiceID activation plan: ${String(value)}`);
}

function requireNewActivationSource(
  plan: NewVoiceIdActivation,
  ownerCredential: WalletSessionOperationCredentialV1,
): void {
  const { capability } = plan;
  if (
    capability.walletId !== plan.walletId ||
    capability.walletSessionId !== ownerCredential.walletSessionId ||
    capability.expiresAtMs <= Date.now()
  ) {
    throw new Error('VoiceID activation requires the unlocked owner seed and Wallet Session.');
  }
}

async function sealNewActivation(
  plan: NewVoiceIdActivation,
  capture: Awaited<ReturnType<typeof captureVoiceIdActivation>>,
): Promise<PendingVoiceIdActivation> {
  const factor = buildVoiceIdEnvelopeFactor({ deviceKeyId: capture.deviceKeyId });
  const binding = buildWalletCustodySeedBinding();
  const ownership = buildMethodBoundEnvelopeOwnership(plan.walletAuthMethodId);
  const envelopeRevision = parseEnvelopeRevision(1);
  const bindingJson = custodyEnvelopeBindingJsonV1({
    walletId: plan.walletId,
    envelopeId: plan.envelopeId,
    factor,
    envelopeRevision,
    binding,
    ownership,
  });
  const workerSecret = capture.factorSecret32.slice();
  let sealed: ReturnType<typeof parseResealedEnvelopeResult>;
  try {
    sealed = parseResealedEnvelopeResult(await plan.reseal({
      capability: plan.capability,
      bindingJson,
      factorSecret: workerSecret.buffer,
    }));
  } finally {
    if (workerSecret.byteLength > 0) workerSecret.fill(0);
  }
  const ciphertextDigest = await sha256DigestB64u(base64UrlDecode(sealed.sealedCustodySecretB64u));
  if (ciphertextDigest !== sealed.ciphertextDigestB64u) {
    throw new Error('VoiceID worker returned a mismatched ciphertext digest.');
  }
  const nowMs = Date.now();
  const envelope = parsePasskeyCustodyEnvelopeRecord(buildPasskeyCustodyEnvelopeRecord({
    envelopeId: plan.envelopeId,
    walletId: plan.walletId,
    ownership,
    binding,
    factor,
    envelopeRevision,
    nonceB64u: sealed.nonceB64u,
    sealedCustodySecretB64u: sealed.sealedCustodySecretB64u,
    ciphertextDigestB64u: sealed.ciphertextDigestB64u,
    aadHashB64u: sealed.aadHashB64u,
    lifecycle: { state: 'active', activatedAtMs: nowMs },
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }));
  if (!isVoiceIdSeedEnvelope(envelope)) {
    throw new Error('VoiceID worker produced an invalid seed envelope.');
  }
  return {
    kind: 'pending_voiceid_activation_v1',
    walletId: plan.walletId,
    walletAuthMethodId: plan.walletAuthMethodId,
    devicePublicKeyB64u: capture.publicKeyB64u,
    deviceKeyId: capture.deviceKeyId,
    custodyEnvelope: envelope,
  };
}

export async function activateVoiceIdForUnlockedWallet(input: {
  readonly plan: VoiceIdActivationPlan;
  readonly ownerCredential: WalletSessionOperationCredentialV1;
  readonly http: Pick<VoiceIdHttpClient, 'activate'>;
  readonly signal: AbortSignal;
  readonly onListening: () => void;
  readonly capture: typeof captureVoiceIdActivation;
  readonly persistPending: (pending: PendingVoiceIdActivation) => Promise<void>;
  readonly persistActive: (
    authMethod: ActiveVoiceIdWalletAuthMethodRecordV2,
    pending: PendingVoiceIdActivation,
  ) => Promise<void>;
}): Promise<VoiceIdActivationOutcome> {
  const plan = input.plan;
  switch (plan.kind) {
    case 'new':
      requireNewActivationSource(plan, input.ownerCredential);
      break;
    case 'resume':
      break;
    default:
      return assertNever(plan);
  }
  const walletId = plan.kind === 'new' ? plan.walletId : plan.pending.walletId;
  const walletAuthMethodId = plan.kind === 'new'
    ? plan.walletAuthMethodId
    : plan.pending.walletAuthMethodId;
  const capture = await input.capture({
    walletId,
    walletAuthMethodId,
    signal: input.signal,
    onListening: input.onListening,
  });
  let pending: PendingVoiceIdActivation;
  try {
    switch (plan.kind) {
      case 'new':
        pending = await sealNewActivation(plan, capture);
        await input.persistPending(pending);
        break;
      case 'resume':
        if (
          plan.pending.devicePublicKeyB64u !== capture.publicKeyB64u ||
          plan.pending.deviceKeyId !== capture.deviceKeyId
        ) {
          throw new Error('VoiceID activation retry found a different device key.');
        }
        pending = plan.pending;
        break;
      default:
        return assertNever(plan);
    }
  } finally {
    capture.factorSecret32.fill(0);
  }
  if (input.signal.aborted) throw new Error('VoiceID activation was cancelled.');
  const authMethod = await input.http.activate({
    ownerCredential: input.ownerCredential,
    walletId: pending.walletId,
    walletAuthMethodId: pending.walletAuthMethodId,
    devicePublicKeyB64u: pending.devicePublicKeyB64u,
    deviceKeyId: pending.deviceKeyId,
    custodyEnvelope: pending.custodyEnvelope,
    signal: input.signal,
  });
  await input.persistActive(authMethod, pending);
  return { authMethod, pending };
}
