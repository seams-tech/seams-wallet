/**
 * Ed25519 Yao seed export after a fresh voice check.
 *
 * The enrolled VoiceID device key signs the export confirmation digest, the
 * digest a passkey would sign, and the Router claims the export nonce once.
 * The admission then releases the VoiceID seed envelope, which opens only with
 * the factor secret from the same voice check.
 */
import type { VoiceIdOperationConfirm } from '@/core/authMethods/voiceId/operationProof';
import type { ParsedYaoRecoveryCapabilityV1 } from '../../session/passkey/ed25519YaoRecoveryCapability';
import { walletCustodyCacheEnvelopeFromRecordV1 } from '../../walletCustody/openCustodyCache';
import {
  RouterAbEd25519YaoClientV1,
  RouterAbEd25519YaoHttpActivationTransportV1,
  type RouterAbEd25519YaoExportArtifactV1,
  type RouterAbEd25519YaoExportCustodyEnvelopeV1,
} from '../../threshold/ed25519/yaoClient';
import {
  isVoiceIdSeedEnvelope,
  parsePasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody/custodyEnvelope';
import { parseRouterAbEd25519YaoExportAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';
import {
  deriveRouterAbEd25519YaoExportAuthorizationDigestV1,
  deriveRouterAbEd25519YaoExportConfirmationDigestV1,
  deriveRouterAbEd25519YaoRuntimePolicyBindingV1,
} from '@shared/utils/routerAbEd25519YaoDigests';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import type { VoiceIdOperationAssertion } from '@shared/authorization/voiceIdDeviceAssertion';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u, type DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';

const VOICE_ID_ED25519_YAO_EXPORT_AUTH_TTL_MS = 60_000;

/** The exact NEAR capability the VoiceID session installed, and the Router it used. */
export type VoiceIdEd25519YaoExportContextV1 = Readonly<{
  relayerUrl: string;
  capability: ParsedYaoRecoveryCapabilityV1;
}>;

type ExportAuthorizationWindow = {
  readonly nonce: Uint8Array;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly confirmationDigest: number[];
};

export async function exportVoiceIdEd25519YaoSeed(args: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly deviceKeyId: DigestB64u;
  readonly context: VoiceIdEd25519YaoExportContextV1;
  readonly confirmOperation: VoiceIdOperationConfirm;
}): Promise<RouterAbEd25519YaoExportArtifactV1> {
  const capability = args.context.capability;
  if (
    capability.applicationBinding.wallet_id !== String(args.walletId) ||
    capability.lifecycle.accountId !== String(args.walletId)
  ) {
    throw new Error('[SigningEngine][ed25519-export] VoiceID export capability names another wallet');
  }
  const identity = {
    scope: {
      lifecycle_id: capability.lifecycle.lifecycleId,
      root_share_epoch: capability.lifecycle.rootShareEpoch,
      account_id: capability.lifecycle.accountId,
      threshold_session_id: capability.lifecycle.thresholdSessionId,
      signer_set_id: capability.lifecycle.signerSetId,
      signing_worker_id: capability.lifecycle.signingWorkerId,
      material_activation: routerAbMpcMaterialActivationRefToWire(capability.materialActivation),
    },
    application_binding: capability.applicationBinding,
    participant_ids: capability.participantIds,
    registered_public_key: [...capability.registeredPublicKey],
    state_epoch: capability.stateEpoch,
    runtime_policy_binding: await deriveRouterAbEd25519YaoRuntimePolicyBindingV1(
      capability.runtimePolicyScope,
    ),
  };
  // The voice surface opens the window after its models load; the export reads it back.
  const opened: { current: ExportAuthorizationWindow | null } = { current: null };
  const openWindow = async (): Promise<{
    operationChallenge: DigestB64u;
    expiresAtMs: number;
  }> => {
    const issuedAtMs = Date.now();
    const expiresAtMs = issuedAtMs + VOICE_ID_ED25519_YAO_EXPORT_AUTH_TTL_MS;
    const nonce = new Uint8Array(32);
    globalThis.crypto.getRandomValues(nonce);
    const confirmationDigest = await deriveRouterAbEd25519YaoExportConfirmationDigestV1({
      identity,
      nonce: [...nonce],
      issuedAtMs,
      expiresAtMs,
    });
    opened.current?.nonce.fill(0);
    opened.current = { nonce, issuedAtMs, expiresAtMs, confirmationDigest };
    return {
      operationChallenge: parseDigestB64u(base64UrlEncode(Uint8Array.from(confirmationDigest))),
      expiresAtMs,
    };
  };
  const proof = await args.confirmOperation({
    walletId: args.walletId,
    walletAuthMethodId: args.walletAuthMethodId,
    operationKind: 'near.export_key',
    begin: openWindow,
  });
  try {
    const window = opened.current;
    if (!window) throw new Error('[SigningEngine][ed25519-export] VoiceID export window is missing');
    const statement = proof.assertion.statement;
    if (
      statement.deviceKeyId !== args.deviceKeyId ||
      statement.operationChallenge !==
        base64UrlEncode(Uint8Array.from(window.confirmationDigest))
    ) {
      throw new Error('[SigningEngine][ed25519-export] VoiceID signed another export');
    }
    return await admitAndExport({
      walletId: args.walletId,
      walletAuthMethodId: args.walletAuthMethodId,
      deviceKeyId: args.deviceKeyId,
      relayerUrl: args.context.relayerUrl,
      identity,
      window,
      assertion: proof.assertion,
      factorSecret32: proof.factorSecret32,
    });
  } finally {
    proof.factorSecret32.fill(0);
    opened.current?.nonce.fill(0);
  }
}

async function admitAndExport(args: {
  readonly walletId: WalletId;
  readonly walletAuthMethodId: WalletAuthMethodId;
  readonly deviceKeyId: DigestB64u;
  readonly relayerUrl: string;
  readonly identity: Parameters<typeof deriveRouterAbEd25519YaoExportConfirmationDigestV1>[0]['identity'];
  readonly window: ExportAuthorizationWindow;
  readonly assertion: VoiceIdOperationAssertion;
  readonly factorSecret32: Uint8Array;
}): Promise<RouterAbEd25519YaoExportArtifactV1> {
  const { identity, window } = args;
  const authorizationDigest = await deriveRouterAbEd25519YaoExportAuthorizationDigestV1({
    identity,
    confirmationDigest: window.confirmationDigest,
    nonce: [...window.nonce],
    issuedAtMs: window.issuedAtMs,
    expiresAtMs: window.expiresAtMs,
    authority: { kind: 'voiceid', deviceKeyId: args.deviceKeyId },
  });
  const request = parseRouterAbEd25519YaoExportAdmissionRequestV1({
    ...identity,
    authorization: {
      confirmation_digest: window.confirmationDigest,
      authorization_digest: authorizationDigest,
      nonce: [...window.nonce],
      issued_at_ms: window.issuedAtMs,
      expires_at_ms: window.expiresAtMs,
    },
  });
  if (!request.ok) {
    throw new Error(`Invalid VoiceID Ed25519 Yao export admission: ${request.message}`);
  }
  const client = await RouterAbEd25519YaoClientV1.initializeBundled();
  const result = await client.exportSeed({
    request: request.value,
    authorization: {
      kind: 'voiceid_device',
      walletAuthMethodId: args.walletAuthMethodId,
      assertion: args.assertion,
    },
    resolveCustodyEnvelope: openReleasedVoiceIdEnvelope.bind(null, {
      walletId: args.walletId,
      walletAuthMethodId: args.walletAuthMethodId,
      deviceKeyId: args.deviceKeyId,
      factorSecret32: args.factorSecret32,
    }),
    transport: new RouterAbEd25519YaoHttpActivationTransportV1({
      routing: { kind: 'discovery' },
      routerOrigin: new URL(args.relayerUrl).origin,
      authorization: { kind: 'cookies' },
      fetch: globalThis.fetch.bind(globalThis),
    }),
  });
  if (!result.ok) throw new Error(result.message);
  return result.artifact;
}

async function openReleasedVoiceIdEnvelope(
  expected: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly deviceKeyId: DigestB64u;
    readonly factorSecret32: Uint8Array;
  },
  released: unknown,
): Promise<RouterAbEd25519YaoExportCustodyEnvelopeV1> {
  const envelope = parsePasskeyCustodyEnvelopeRecord(released, 'voiceIdCustodyEnvelope');
  if (
    !isVoiceIdSeedEnvelope(envelope) ||
    envelope.walletId !== expected.walletId ||
    envelope.ownership.walletAuthMethodId !== expected.walletAuthMethodId ||
    envelope.factor.deviceKeyId !== expected.deviceKeyId
  ) {
    throw new Error('VoiceID export admission released another custody envelope');
  }
  const wire = walletCustodyCacheEnvelopeFromRecordV1(envelope);
  return {
    kind: 'wallet_custody_seed_v1',
    // The Yao client zeroes this copy; the caller zeroes the voice check's own secret.
    factorSecret: expected.factorSecret32.slice(),
    bindingJson: wire.bindingJson,
    nonce: base64UrlDecode(wire.nonceB64u),
    ciphertext: base64UrlDecode(wire.ciphertextB64u),
    aadHash: base64UrlDecode(wire.aadHashB64u),
    ciphertextDigest: base64UrlDecode(wire.ciphertextDigestB64u),
  };
}
