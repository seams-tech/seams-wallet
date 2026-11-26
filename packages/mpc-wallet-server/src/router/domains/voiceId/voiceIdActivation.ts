import type { ActiveWalletAuthorityV1 } from '@shared/authorization/walletAuthority';
import type { VoiceIdDevicePublicKeyB64u } from '@shared/authorization/voiceIdDeviceAssertion';
import type { WalletAuthMethodId } from '@shared/utils/domainIds';
import type {
  ActiveEmailOtpWalletAuthMethodRecordV2,
  ActivePasskeyWalletAuthMethodRecordV2,
  ActiveVoiceIdWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import {
  isVoiceIdSeedEnvelope,
  parsePasskeyCustodyEnvelopeRecord,
  type VoiceIdSeedEnvelope,
} from '@shared/passkey-custody/custodyEnvelope';
import type { IssuedWalletSessionAuthorizationV2 } from '../../../authorization/domain';

export type VoiceIdActivationEnvelope = VoiceIdSeedEnvelope;

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
  if (!isVoiceIdSeedEnvelope(envelope) || Number(envelope.envelopeRevision) !== 1) {
    throw new Error('VoiceID activation requires an active, method-bound wallet seed envelope');
  }
  return envelope;
}
