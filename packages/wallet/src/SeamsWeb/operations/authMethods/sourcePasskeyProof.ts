import type { WebAuthnAllowCredential } from '@/core/signingEngine/webauthnAuth/credentials/collectAuthenticationCredentialForChallengeB64u';
import type { ActivePasskeyWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';

export function addAuthMethodSourcePasskeyAllowCredentials(
  sourceAuthMethod: ActivePasskeyWalletAuthMethodRecordV2,
): [WebAuthnAllowCredential] {
  return [
    {
      id: sourceAuthMethod.credentialIdB64u,
      type: 'public-key',
      transports: [],
    },
  ];
}
