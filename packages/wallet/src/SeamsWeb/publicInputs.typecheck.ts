import {
  walletSessionRefFromSession,
  nearAccountRefFromAccountId,
  type ThresholdEcdsaChainTarget,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { EvmSigningRequest } from '@/core/signingEngine/chains/evm/evmSigning.types';
import type { SignedTransaction } from '@/core/rpcClients/near/NearClient';
import type {
  BootstrapThresholdEcdsaSessionArgs,
  ExecuteEvmFamilyTransactionArgs,
  KeyExportCapability,
  NearSignerCapability,
  RegistrationCapability,
  SignTempoArgs,
  PublicThresholdEcdsaSessionBootstrapResult,
} from '@/SeamsWeb/signingSurface/types';

const walletSession = walletSessionRefFromSession({
  walletId: 'wallet.testnet',
  walletSessionUserId: 'wallet-user',
});
const tempoChainTarget = {
  kind: 'tempo',
  chainId: 1313,
  networkSlug: 'tempo-local',
} satisfies ThresholdEcdsaChainTarget;
const tempoRequest = {} as SignTempoArgs['request'];

const invalidSignTempoAccountIdentity: SignTempoArgs = {
  walletSession,
  // @ts-expect-error ECDSA public signing rejects account-shaped identity.
  nearAccountId: 'wallet.testnet',
  request: tempoRequest,
  chainTarget: tempoChainTarget,
};
void invalidSignTempoAccountIdentity;

const invalidSignTempoSubjectInput: SignTempoArgs = {
  walletSession,
  request: tempoRequest,
  chainTarget: tempoChainTarget,
  // @ts-expect-error ECDSA public signing derives subject from walletSession.walletId.
  subjectId: 'wallet',
};
void invalidSignTempoSubjectInput;

const invalidExecuteEvmAccountIdentity: ExecuteEvmFamilyTransactionArgs = {
  walletSession,
  // @ts-expect-error EVM-family public signing rejects account-shaped identity.
  nearAccountId: 'wallet.testnet',
  request: tempoRequest,
  chainTarget: tempoChainTarget,
};
void invalidExecuteEvmAccountIdentity;

const invalidExecuteEvmSubjectInput: ExecuteEvmFamilyTransactionArgs = {
  walletSession,
  request: tempoRequest,
  chainTarget: tempoChainTarget,
  // @ts-expect-error EVM-family public signing derives subject from walletSession.walletId.
  subjectId: 'wallet',
};
void invalidExecuteEvmSubjectInput;

const evmExecuteRequest = {
  chain: 'evm',
  kind: 'eip1559',
  senderSignatureAlgorithm: 'secp256k1',
  tx: {
    chainId: 1313,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 1n,
    gasLimit: 21_000n,
    to: '0x1111111111111111111111111111111111111111',
    value: 0n,
    data: '0x',
  },
} satisfies EvmSigningRequest;

const invalidEvmTempoSign: SignTempoArgs = {
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Tempo signing rejects EIP-1559 requests.
  request: evmExecuteRequest,
};
void invalidEvmTempoSign;

const tempoExecuteRequest = {
  chain: 'tempo',
  kind: 'tempoTransaction',
  senderSignatureAlgorithm: 'secp256k1',
  tx: {
    chainId: 1313,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 1n,
    gasLimit: 21_000n,
    calls: [
      {
        to: '0x2222222222222222222222222222222222222222',
        value: 0n,
        input: '0x',
      },
    ],
    nonceKey: 0n,
  },
} satisfies Extract<SignTempoArgs['request'], { chain: 'tempo' }>;

const validEvmExecuteWithPayloadExpectation: Extract<
  ExecuteEvmFamilyTransactionArgs,
  { request: { chain: 'evm' } }
> = {
  walletSession,
  request: evmExecuteRequest,
  chainTarget: tempoChainTarget,
  payloadExpectation: {
    kind: 'evm_eip1559',
    to: '0x1111111111111111111111111111111111111111',
    input: '0x',
  },
};
void validEvmExecuteWithPayloadExpectation;

const invalidEvmExecuteWithTempoPayloadExpectation: Extract<
  ExecuteEvmFamilyTransactionArgs,
  { request: { chain: 'evm' } }
> = {
  walletSession,
  request: evmExecuteRequest,
  chainTarget: tempoChainTarget,
  payloadExpectation: {
    // @ts-expect-error EVM execution only accepts top-level EIP-1559 payload expectations.
    kind: 'tempo_eip2718_calls',
    calls: [{ to: '0x2222222222222222222222222222222222222222', input: '0x' }],
  },
};
void invalidEvmExecuteWithTempoPayloadExpectation;

const validTempoExecuteWithPayloadExpectation: Extract<
  ExecuteEvmFamilyTransactionArgs,
  { request: { chain: 'tempo' } }
> = {
  walletSession,
  request: tempoExecuteRequest,
  chainTarget: tempoChainTarget,
  payloadExpectation: {
    kind: 'tempo_eip2718_calls',
    calls: [{ to: '0x2222222222222222222222222222222222222222', input: '0x' }],
  },
};
void validTempoExecuteWithPayloadExpectation;

const invalidTempoExecuteWithEvmPayloadExpectation: Extract<
  ExecuteEvmFamilyTransactionArgs,
  { request: { chain: 'tempo' } }
> = {
  walletSession,
  request: tempoExecuteRequest,
  chainTarget: tempoChainTarget,
  payloadExpectation: {
    // @ts-expect-error Tempo EIP-2718 execution only accepts call-list payload expectations.
    kind: 'evm_eip1559',
    to: '0x1111111111111111111111111111111111111111',
    input: '0x',
  },
};
void invalidTempoExecuteWithEvmPayloadExpectation;

const validEcdsaBootstrapInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
};
void validEcdsaBootstrapInput;

declare const signedNearTransaction: SignedTransaction;

// Omitting the subject is valid: it resolves to the authenticated wallet.
const nearSendTransactionWithoutSubject: Parameters<NearSignerCapability['sendTransaction']>[0] = {
  signedTransaction: signedNearTransaction,
};
void nearSendTransactionWithoutSubject;

// A bare wallet id is accepted: the audit subject defaults to it.
const nearSendTransactionWithWalletId: Parameters<NearSignerCapability['sendTransaction']>[0] = {
  signedTransaction: signedNearTransaction,
  walletSession: 'wallet.testnet',
};
void nearSendTransactionWithWalletId;

// A malformed subject is still rejected.
const invalidNearSendTransactionSubject: Parameters<NearSignerCapability['sendTransaction']>[0] = {
  signedTransaction: signedNearTransaction,
  // @ts-expect-error walletSession must be a ref or a wallet id, not an arbitrary object.
  walletSession: { walletSessionUserId: 'wallet.testnet' },
};
void invalidNearSendTransactionSubject;

const validNearSendTransactionInput: Parameters<NearSignerCapability['sendTransaction']>[0] = {
  walletSession,
  nearAccount: nearAccountRefFromAccountId('wallet.testnet'),
  signedTransaction: signedNearTransaction,
};
void validNearSendTransactionInput;

declare const registrationCapability: RegistrationCapability;
void registrationCapability.getNearAccountState({ walletId: 'alice.testnet' });
const unsubscribeNearProvisioning = registrationCapability.onNearAccountChange(
  (event) => {
    const walletId: string = event.walletId;
    const status = event.state.status;
    void walletId;
    void status;
  },
);
unsubscribeNearProvisioning();
// @ts-expect-error wallet identity is required for a provisioning-state read.
void registrationCapability.getNearAccountState({});
const legacyPublicNearMode = ['ed25519', 'only'].join('_');
const legacyPublicEvmMode = ['ecdsa', 'only'].join('_');

void registrationCapability.registerWallet({
  wallet: {
    kind: 'provided',
    walletId: 'alice.testnet' as import('@shared/utils/registrationIntent').WalletId,
  },
  signerSelection: {
    kind: 'signer_set',
    signers: [
      {
        kind: 'evm_family_ecdsa',
        chainTargets: [tempoChainTarget],
        participantIds: [1, 2],
      },
    ],
  },
  authMethod: {
    kind: 'email_otp',
    proofKind: 'otp_challenge',
    email: 'alice@example.test',
    providerSubject: 'email:alice@example.test',
    otpCode: '123456',
  },
});

void registrationCapability.registerWallet({
  wallet: {
    kind: 'provided',
    walletId: 'alice.testnet' as import('@shared/utils/registrationIntent').WalletId,
  },
  authMethod: {
    kind: 'passkey',
    rpId: 'wallet.example.test' as import('@shared/utils/domainIds').WebAuthnRpId,
  },
  signerSelection: {
    // @ts-expect-error Public wallet registration accepts signer-set requests, not legacy modes.
    mode: legacyPublicNearMode,
    // @ts-expect-error Public wallet registration accepts signer-set requests, not legacy modes.
    ed25519: {
      accountProvisioning: {
        kind: 'implicit_account',
        accountIdSource: 'ed25519_public_key',
      },
      signerSlot: 1,
      participantIds: [1, 2],
      keyPurpose: 'near_tx',
      keyVersion: 'router-ab-ed25519-yao-v1',
      derivationVersion: 1,
    },
  },
});

void registrationCapability.registerWallet({
  wallet: {
    kind: 'provided',
    walletId: 'alice.testnet' as import('@shared/utils/registrationIntent').WalletId,
  },
  authMethod: {
    kind: 'email_otp',
    proofKind: 'otp_challenge',
    email: 'alice@example.test',
    providerSubject: 'email:alice@example.test',
    otpCode: '123456',
  },
  signerSelection: {
    // @ts-expect-error Public Email OTP registration accepts signer-set requests, not legacy modes.
    mode: legacyPublicEvmMode,
    // @ts-expect-error Public Email OTP registration accepts signer-set requests, not legacy modes.
    ecdsa: {
      chainTargets: [tempoChainTarget],
      participantIds: [1, 2],
    },
  },
});

const forbiddenProjectionField = ['smart', 'Account'].join('') as `${'smart'}${'Account'}`;
const forbiddenProjectionAddressField = ['counter', 'factual', 'Address'].join(
  '',
) as `${'counter'}${'factual'}Address`;
const forbiddenProjectionSponsorField = ['pay', 'master'].join('') as `${'pay'}${'master'}`;
const forbiddenProjectionRelayField = ['bundle', 'rUrl'].join('') as `${'bundle'}rUrl`;
const forbiddenProjectionProtocolField = ['erc', '4337'].join('') as `${'erc'}4337`;

const invalidEcdsaBootstrapKeyIdInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects caller-supplied internal key identity.
  ecdsaThresholdKeyId: 'ecdsa-key',
};
void invalidEcdsaBootstrapKeyIdInput;

const invalidEcdsaBootstrapParticipantIdsInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects caller-supplied internal participant identity.
  participantIds: [1, 2],
};
void invalidEcdsaBootstrapParticipantIdsInput;

const invalidEcdsaBootstrapProjectionInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects projection fields.
  [forbiddenProjectionField]: { chainId: 1313 },
};
void invalidEcdsaBootstrapProjectionInput;

const invalidEcdsaBootstrapProjectionAddressInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects projection fields.
  [forbiddenProjectionAddressField]: `0x${'11'.repeat(20)}`,
};
void invalidEcdsaBootstrapProjectionAddressInput;

const invalidEcdsaBootstrapSponsorInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects projection fields.
  [forbiddenProjectionSponsorField]: { enabled: true },
};
void invalidEcdsaBootstrapSponsorInput;

const invalidEcdsaBootstrapRouterApiInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects projection fields.
  [forbiddenProjectionRelayField]: 'https://relay.example',
};
void invalidEcdsaBootstrapRouterApiInput;

const invalidEcdsaBootstrapProtocolInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public bootstrap rejects projection fields.
  [forbiddenProjectionProtocolField]: true,
};
void invalidEcdsaBootstrapProtocolInput;

const invalidEcdsaBootstrapSubjectInput: BootstrapThresholdEcdsaSessionArgs = {
  kind: 'reuse_warm_ecdsa_bootstrap',
  walletSession,
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public base-ECDSA warm bootstrap derives subject from walletSession.walletId.
  subjectId: 'wallet',
};
void invalidEcdsaBootstrapSubjectInput;

declare const publicEcdsaBootstrapResult: PublicThresholdEcdsaSessionBootstrapResult;
const invalidPublicBootstrapEcdsaKeyId =
  // @ts-expect-error Public bootstrap keyRef hides internal threshold key identity.
  publicEcdsaBootstrapResult.thresholdEcdsaKeyRef.ecdsaThresholdKeyId;
void invalidPublicBootstrapEcdsaKeyId;
const invalidPublicBootstrapSigningRootId =
  // @ts-expect-error Public bootstrap keyRef hides internal signing-root identity.
  publicEcdsaBootstrapResult.thresholdEcdsaKeyRef.signingRootId;
void invalidPublicBootstrapSigningRootId;
const invalidPublicBootstrapSigningRootVersion =
  // @ts-expect-error Public bootstrap keyRef hides internal signing-root identity.
  publicEcdsaBootstrapResult.thresholdEcdsaKeyRef.signingRootVersion;
void invalidPublicBootstrapSigningRootVersion;
const invalidPublicBootstrapExportArtifact =
  // @ts-expect-error Public bootstrap keyRef hides internal export artifact identity.
  publicEcdsaBootstrapResult.thresholdEcdsaKeyRef.ecdsaDerivationExportArtifact;
void invalidPublicBootstrapExportArtifact;
type PublicKeyExportInput = Parameters<KeyExportCapability['exportKey']>[0];

const validEcdsaExportInput: PublicKeyExportInput = {
  kind: 'ecdsa',
  walletSession,
  chainTarget: tempoChainTarget,
  options: {},
};
void validEcdsaExportInput;

const invalidEcdsaExportLaneInput: PublicKeyExportInput = {
  kind: 'ecdsa',
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public export resolves the lane internally.
  laneIdentity: {},
};
void invalidEcdsaExportLaneInput;

const invalidEcdsaExportUserIdInput: PublicKeyExportInput = {
  kind: 'ecdsa',
  chainTarget: tempoChainTarget,
  // @ts-expect-error Public export accepts walletSession, not a raw session user id.
  walletSessionUserId: 'wallet-user',
  options: {},
};
void invalidEcdsaExportUserIdInput;

const invalidEcdsaExportSubjectInput: PublicKeyExportInput = {
  kind: 'ecdsa',
  walletSession,
  chainTarget: tempoChainTarget,
  options: {},
  // @ts-expect-error ECDSA public export derives subject from walletSession.walletId.
  subjectId: 'wallet',
};
void invalidEcdsaExportSubjectInput;

// NEAR signing accepts a bare account id, or no subject at all.
const nearSignAndSendTransactionWithAccountId: Parameters<NearSignerCapability['signAndSendTransaction']>[0] = {
  nearAccount: 'wallet.testnet',
  receiverId: 'contract.testnet',
  actions: [],
};
void nearSignAndSendTransactionWithAccountId;

const nearSignAndSendTransactionWithoutSubject: Parameters<NearSignerCapability['signAndSendTransaction']>[0] = {
  receiverId: 'contract.testnet',
  actions: [],
};
void nearSignAndSendTransactionWithoutSubject;

const invalidNearSignAndSendTransaction: Parameters<NearSignerCapability['signAndSendTransaction']>[0] = {
  receiverId: 'contract.testnet',
  actions: [],
  // @ts-expect-error nearAccount must be a NearAccountRef or an account id string.
  nearAccount: { accountId: 'wallet.testnet' },
};
void invalidNearSignAndSendTransaction;

export {};

// @ts-expect-error Wallet creation requires an explicit authentication method.
void registrationCapability.registerWallet({
  wallet: { kind: 'server_allocated' },
  signerSelection: { kind: 'signer_set', signers: [] },
});
// @ts-expect-error Use registerWallet with a passkey authentication method.
void registrationCapability.registerPasskey;
// @ts-expect-error Use registerWallet with an email authentication method.
void registrationCapability.registerWithEmailOtp;

// @ts-expect-error Use getNearAccountState for the public account-state read.
void registrationCapability.getNearProvisioningState;
// @ts-expect-error Use waitForNearAccount for the public readiness wait.
void registrationCapability.awaitNearReady;
// @ts-expect-error Use onNearAccountChange for the public subscription.
void registrationCapability.onNearProvisioningStateChanged;

// @ts-expect-error Use addSigner to add a wallet signer.
void registrationCapability.addWalletSigner;
// @ts-expect-error Use addEmail to add email authentication.
void registrationCapability.addEmailOtp;
// @ts-expect-error Use removeAuthMethod to retire an authentication method.
void registrationCapability.revokeAuthMethod;

declare const nearCapability: NearSignerCapability;
// @ts-expect-error NEAR transaction submission uses signAndSendTransaction.
void nearCapability.executeAction;

// @ts-expect-error NEAR signing uses signTransaction.
void nearCapability.signTransactionWithActions;
// @ts-expect-error NEP-413 signing uses signMessage.
void nearCapability.signNEP413Message;
// @ts-expect-error Delegate submission uses sendDelegateAction.
void nearCapability.sendDelegateActionViaRelayer;
