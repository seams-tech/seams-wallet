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

// @ts-expect-error Authentication owns ECDSA bootstrap.
void seams.evm.advanced.bootstrapEcdsaSession;
// @ts-expect-error Authentication owns ECDSA bootstrap.
void seams.tempo.advanced.bootstrapEcdsaSession;

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
void seams.recovery.getCodeStatus({ walletId: 'frost-vermillion-k7p9m2' });
void seams.recovery.confirmBackup({ walletId: 'frost-vermillion-k7p9m2' });

void seams.devices.cancelLinking();
void seams.devices.list({
  walletId: 'frost-vermillion-k7p9m2',
  limit: 50,
  cursor: null,
});
void seams.devices.remove({
  walletId: 'frost-vermillion-k7p9m2',
  walletAuthMethodId: 'email_otp:wallet:method-1',
});
void seams.devices.remove({
  walletId: 'frost-vermillion-k7p9m2',
  walletAuthMethodId: 'email_otp:wallet:method-1',
  // @ts-expect-error The host owns removal proof collection.
  sourceProof: {},
});

seams.preferences.setConfirmationBehavior('requireClick');
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

// @ts-expect-error Use devices.startLinking.
void seams.devices.startDevice2LinkingFlow;
// @ts-expect-error Use devices.cancelLinking.
void seams.devices.cancelDeviceLinking;
// @ts-expect-error Use devices.approveLinking.
void seams.devices.scanAndLinkDevice;
// @ts-expect-error Use devices.list.
void seams.devices.listLinkedDevices;
// @ts-expect-error Use devices.remove.
void seams.devices.revokeLinkedDevice;

// @ts-expect-error Use recovery.getCodeStatus.
void seams.recovery.getWalletRecoveryCodeStatus;
// @ts-expect-error Use recovery.confirmBackup.
void seams.recovery.acknowledgeWalletRecoveryCodeBackup;
// @ts-expect-error Use recovery.rotateCodes.
void seams.recovery.rotateWalletRecoveryCodes;

// @ts-expect-error Use preferences.setConfirmationBehavior.
void seams.preferences.setConfirmBehavior;

void seams.keys.exportKey({ kind: 'ecdsa', chainTarget: 'arc-testnet' });
// @ts-expect-error Use keys.exportKey.
void seams.keys.exportKeypair;
// @ts-expect-error Export lane resolution belongs to internal dispatch.
void seams.keys.resolveExactKeyExportLane;
// @ts-expect-error The public operation owns the viewer and lane handoff.
void seams.keys.exportKeypairWithUI;

void seams.auth.requestEmailCode({
  method: 'google',
  idToken: 'provider-token',
  target: { kind: 'wallet', walletId: 'alice.testnet' },
});
void seams.auth.requestEmailCode({ method: 'email', walletId: 'alice.testnet', email: 'alice@example.com' });
// @ts-expect-error Signing challenges cannot enter the unlock API.
void seams.auth.requestEmailCode({ method: 'email', walletId: 'alice.testnet', email: 'alice@example.com', operation: 'transaction_sign' });
// @ts-expect-error Specialized unlock is internal to the host.
void seams.auth.loginWithEmailOtpEcdsaCapability;
// @ts-expect-error Added email methods use the unified unlock API.
void seams.auth.unlockAddedEmailOtpWallet;
