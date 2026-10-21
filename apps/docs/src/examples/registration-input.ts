import type { SeamsWeb } from '@seams/wallet';
import { parseWebAuthnRpId } from '@seams/wallet/advanced';

const rpId = parseWebAuthnRpId('wallet.example.com');
if (!rpId.ok) throw new Error(rpId.error.message);

export const registration: Parameters<SeamsWeb['registration']['registerWallet']>[0] = {
  authMethod: { kind: 'passkey', rpId: rpId.value },
};
