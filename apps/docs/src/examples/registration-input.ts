import type { SeamsWeb } from '@seams/wallet';
import { parseWebAuthnRpId } from '@seams/wallet/advanced';

const rpId = parseWebAuthnRpId('wallet.example.com');
if (!rpId.ok) throw new Error(rpId.error.message);

export const registration: Parameters<SeamsWeb['registration']['registerWallet']>[0] = {
  authMethod: { kind: 'passkey', rpId: rpId.value },
  wallet: { kind: 'server_allocated' },
  signerSelection: {
    kind: 'signer_set',
    signers: [
      {
        kind: 'near_ed25519',
        accountProvisioning: {
          kind: 'implicit_account',
          accountIdSource: 'ed25519_public_key',
        },
        signerSlot: 1,
        participantIds: [1, 2],
        derivationVersion: 1,
      },
    ],
  },
};
