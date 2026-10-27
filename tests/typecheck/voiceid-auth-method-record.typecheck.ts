import type {
  ActiveEmailOtpWalletAuthMethodRecordV2,
  ActiveVoiceIdWalletAuthMethodRecordV2,
  WalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';

declare const activeVoiceId: ActiveVoiceIdWalletAuthMethodRecordV2;
declare const activeEmailOtp: ActiveEmailOtpWalletAuthMethodRecordV2;

const method: WalletAuthMethodRecordV2 = activeVoiceId;
void method;

// @ts-expect-error A VoiceID method cannot contain a passkey credential.
const withPasskeyFields: ActiveVoiceIdWalletAuthMethodRecordV2 = {
  ...activeVoiceId,
  credentialIdB64u: 'passkey-id',
};
void withPasskeyFields;

const { activatedAtMs: _activatedAtMs, ...withoutActivation } = activeVoiceId;
void _activatedAtMs;
// @ts-expect-error An active VoiceID method requires its activation time.
const missingActivation: ActiveVoiceIdWalletAuthMethodRecordV2 = withoutActivation;
void missingActivation;

// @ts-expect-error An Email OTP method cannot be used as a VoiceID method.
const wrongFactor: ActiveVoiceIdWalletAuthMethodRecordV2 = activeEmailOtp;
void wrongFactor;
