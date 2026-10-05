import {
  nearAccountRefFromAccountId,
  thresholdEcdsaChainTargetFromChainFamily,
  walletSessionRefFromSession,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { WebAuthnRpId } from '@shared/utils/domainIds';
import type { SeamsWeb } from './index';

declare const seams: SeamsWeb;
declare const rpId: WebAuthnRpId;

const nearAccount = nearAccountRefFromAccountId('alice.testnet');
const walletSession = walletSessionRefFromSession({
  walletId: 'alice.testnet',
  walletSessionUserId: 'alice.testnet',
});
const evmChainTarget = thresholdEcdsaChainTargetFromChainFamily({
  chain: 'evm',
  chainId: 1,
  networkSlug: 'ethereum',
});
const tempoChainTarget = thresholdEcdsaChainTargetFromChainFamily({
  chain: 'tempo',
  chainId: 4217,
  networkSlug: 'tempo',
});

void seams.registration.enrollEmailOtp({
  walletId: 'alice.testnet',
  otpCode: '123456',
});

void seams.auth.unlock('alice.testnet');
void seams.auth.getSession('alice.testnet');

void seams.near.signMessage({
  walletSession,
  nearAccount,
  params: {
    message: 'Sign in to Seams',
    recipient: 'seams.app',
  },
  options: {},
});

void seams.registration.registerWallet({
  wallet: { kind: 'server_allocated' },
  authMethod: { kind: 'passkey', rpId },
  signerSelection: {
    kind: 'signer_set',
    signers: [
      {
        kind: 'evm_family_ecdsa',
        chainTargets: [evmChainTarget],
        participantIds: [1, 2],
      },
    ],
  },
});
// @ts-expect-error Chain namespaces do not create wallets.
void seams.evm.registerEvmWallet;
// @ts-expect-error Chain namespaces do not create wallets.
void seams.near.registerNearWallet;

void seams.evm.advanced.bootstrapEcdsaSession({
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: evmChainTarget,
});

void seams.tempo.signTransaction({
  walletSession,
  chainTarget: tempoChainTarget,
  request: {
    chain: 'tempo',
    kind: 'tempoTransaction',
    senderSignatureAlgorithm: 'secp256k1',
    tx: {
      chainId: 4217,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 1n,
      gasLimit: 21_000n,
      calls: [
        {
          to: '0x1111111111111111111111111111111111111111',
          value: 0n,
          input: '0x',
        },
      ],
      nonceKey: 0n,
    },
  },
});

void seams.tempo.getFeeToken({
  chainTarget: tempoChainTarget,
  account: '0x1111111111111111111111111111111111111111',
});
void seams.tempo.validateFeeToken({
  chainTarget: tempoChainTarget,
  feeToken: '0x20c0000000000000000000000000000000000001',
});
void seams.tempo.setFeeToken({
  walletSession,
  chainTarget: tempoChainTarget,
  account: '0x1111111111111111111111111111111111111111',
  feeToken: '0x20c0000000000000000000000000000000000001',
  feeCaps: {
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
  },
});

void seams.evm.signTransaction({
  walletSession,
  chainTarget: evmChainTarget,
  request: {
    chain: 'evm',
    kind: 'eip1559',
    senderSignatureAlgorithm: 'secp256k1',
    tx: {
      chainId: 1,
      maxPriorityFeePerGas: 1n,
      maxFeePerGas: 1n,
      gasLimit: 21_000n,
      to: '0x1111111111111111111111111111111111111111',
      value: 0n,
      data: '0x',
    },
  },
});

void seams.recovery.syncAccount({ walletId: 'frost-vermillion-k7p9m2' });
// @ts-expect-error syncAccount identifies a wallet, not a NEAR account-shaped accountId.
void seams.recovery.syncAccount({ accountId: 'alice.testnet' });
void seams.recovery.getWalletRecoveryCodeStatus({ walletId: 'frost-vermillion-k7p9m2' });
void seams.recovery.acknowledgeWalletRecoveryCodeBackup({ walletId: 'frost-vermillion-k7p9m2' });

void seams.devices.cancelDeviceLinking();
void seams.devices.listLinkedDevices({
  walletId: 'frost-vermillion-k7p9m2',
  limit: 50,
  cursor: null,
});
void seams.devices.revokeLinkedDevice({
  walletId: 'frost-vermillion-k7p9m2',
  walletAuthMethodId: 'email_otp:wallet:method-1',
  requestedAtMs: Date.now(),
  sourceProof: {
    kind: 'webauthn_assertion',
    rpId,
    credential: {},
    expectedChallengeDigestB64u: 'operation-digest',
  },
});
// @ts-expect-error revocation requires the exact requested-at timestamp.
void seams.devices.revokeLinkedDevice({
  walletId: 'frost-vermillion-k7p9m2',
  walletAuthMethodId: 'email_otp:wallet:method-1',
  sourceProof: {
    kind: 'webauthn_assertion',
    rpId,
    credential: {},
    expectedChallengeDigestB64u: 'operation-digest',
  },
});

seams.preferences.setConfirmBehavior('requireClick');
void seams.preferences.getConfirmationConfig();

// @ts-expect-error Use signAndSendTransaction for EVM submission.
void seams.evm.executeTransaction;
// @ts-expect-error Use signAndSendTransaction for Tempo submission.
void seams.tempo.executeTransaction;
// @ts-expect-error Use signTransaction for Tempo signing.
void seams.tempo.signTempo;
// @ts-expect-error Select a chain namespace for transaction submission.
void seams.tempo.executeEvmFamilyTransaction;
// @ts-expect-error Broadcast reporting belongs to advanced.
void seams.tempo.reportBroadcastAccepted;
// @ts-expect-error Broadcast reporting belongs to advanced.
void seams.tempo.reportBroadcastRejected;
// @ts-expect-error Finalization reporting belongs to advanced.
void seams.tempo.reportFinalized;
// @ts-expect-error Replacement reporting belongs to advanced.
void seams.tempo.reportDroppedOrReplaced;
// @ts-expect-error Nonce reconciliation belongs to advanced.
void seams.tempo.reconcileNonceLane;
// @ts-expect-error Bootstrap is absent from the ordinary signing namespace.
void seams.tempo.bootstrapEcdsaSession;
// @ts-expect-error Bootstrap is absent from the ordinary signing namespace.
void seams.evm.bootstrapEcdsaSession;
// @ts-expect-error Use getFeeToken.
void seams.tempo.getFeeTokenPreference;
// @ts-expect-error Use setFeeToken.
void seams.tempo.setFeeTokenPreference;
