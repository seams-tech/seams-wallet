import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { VoiceIdDevicePublicKeyB64u } from '@shared/authorization/voiceIdDeviceAssertion';
import type { WalletAuthMethodId } from '@shared/utils/domainIds';
import type {
  ActiveEmailOtpWalletAuthMethodRecordV2,
  ActivePasskeyWalletAuthMethodRecordV2,
  ActiveVoiceIdWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import {
  parsePasskeyCustodyEnvelopeRecord,
  type PasskeyCustodyEnvelopeRecord,
} from '@shared/passkey-custody/custodyEnvelope';
import type { IssuedWalletSessionAuthorizationV2 } from '../../../authorization/domain';

export type VoiceIdActivationEnvelope = PasskeyCustodyEnvelopeRecord & {
  readonly ownership: Extract<PasskeyCustodyEnvelopeRecord['ownership'], { readonly kind: 'method_bound' }>;
  readonly binding: Extract<PasskeyCustodyEnvelopeRecord['binding'], { readonly kind: 'wallet_custody_seed_v1' }>;
  readonly factor: Extract<PasskeyCustodyEnvelopeRecord['factor'], { readonly kind: 'voiceid' }>;
  readonly lifecycle: Extract<PasskeyCustodyEnvelopeRecord['lifecycle'], { readonly state: 'active' }>;
};

export type VoiceIdActivationOwnerSession = Readonly<{
  authorization: IssuedWalletSessionAuthorizationV2;
  authority: ActiveWalletAuthorityV1;
  authMethod: ActivePasskeyWalletAuthMethodRecordV2 | ActiveEmailOtpWalletAuthMethodRecordV2;
}>;

export type VoiceIdActivationCommand = Readonly<{
  source: VoiceIdActivationOwnerSession;
  targetWalletAuthMethodId: WalletAuthMethodId;
  devicePublicKeyB64u: VoiceIdDevicePublicKeyB64u;
  envelope: VoiceIdActivationEnvelope;
  nowMs: number;
}>;

export type VoiceIdActivationResult =
  | { readonly kind: 'activated'; readonly authMethod: ActiveVoiceIdWalletAuthMethodRecordV2 }
  | { readonly kind: 'rejected'; readonly code: 'invalid_source' | 'invalid_target' | 'conflict' };

/** Accepts only a method-bound owner seed envelope for the new VoiceID method. */
export function parseVoiceIdActivationEnvelope(raw: unknown): VoiceIdActivationEnvelope {
  const envelope = parsePasskeyCustodyEnvelopeRecord(raw);
  if (
    envelope.ownership.kind !== 'method_bound' ||
    envelope.binding.kind !== 'wallet_custody_seed_v1' ||
    envelope.factor.kind !== 'voiceid' ||
    envelope.lifecycle.state !== 'active' ||
    Number(envelope.envelopeRevision) !== 1
  ) {
    throw new Error('VoiceID activation requires an active, method-bound wallet seed envelope');
  }
  return {
    kind: envelope.kind,
    envelopeId: envelope.envelopeId,
    walletId: envelope.walletId,
    ownership: envelope.ownership,
    binding: envelope.binding,
    factor: envelope.factor,
    envelopeVersion: envelope.envelopeVersion,
    envelopeRevision: envelope.envelopeRevision,
    nonceB64u: envelope.nonceB64u,
    sealedCustodySecretB64u: envelope.sealedCustodySecretB64u,
    ciphertextDigestB64u: envelope.ciphertextDigestB64u,
    aadHashB64u: envelope.aadHashB64u,
    lifecycle: envelope.lifecycle,
    createdAtMs: envelope.createdAtMs,
    updatedAtMs: envelope.updatedAtMs,
  };
}
