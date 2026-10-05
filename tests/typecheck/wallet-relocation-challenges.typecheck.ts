import { WalletRelocationOwnerRequest } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationOwnerRequest';
import type { D1WalletRegistrationOperationPreparedV1 } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationService';

declare const preparedOperation: D1WalletRegistrationOperationPreparedV1;
// @ts-expect-error Operation activity requires its wallet owner before the first durable claim.
const ownerlessOperation: D1WalletRegistrationOperationPreparedV1 = {
  kind: preparedOperation.kind,
  walletAuthorityId: preparedOperation.walletAuthorityId,
  deviceId: preparedOperation.deviceId,
  walletAuthMethodId: preparedOperation.walletAuthMethodId,
};
// @ts-expect-error Broad spreads cannot remove the operation's wallet owner.
const ownerlessSpread: D1WalletRegistrationOperationPreparedV1 = {
  ...preparedOperation,
  walletId: undefined,
};
void ownerlessOperation;
void ownerlessSpread;
import type { D1WalletRelocationApprovals } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationApprovals';
import type {
  D1WalletRelocationChallenges,
  WalletRelocationChallengeBinding,
} from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationChallenges';

declare const store: D1WalletRelocationChallenges;
declare const binding: WalletRelocationChallengeBinding;
type Stored = NonNullable<Awaited<ReturnType<D1WalletRelocationChallenges['read']>>>;
declare const consumed: Stored & { readonly state: 'consumed' };
// @ts-expect-error A consumed challenge cannot enter the consumption batch again.
store.prepareConsume(consumed, 1);
// @ts-expect-error Broad spreads cannot retain a consumption time on an issued challenge.
store.prepareConsume({ ...consumed, state: 'issued' }, 1);
// @ts-expect-error A broad spread cannot forge a validated challenge binding.
const forgedBinding: WalletRelocationChallengeBinding = { ...binding };
// @ts-expect-error Challenge constructors are restricted to boundary parsing.
const directBinding = new WalletRelocationChallengeBinding();
void forgedBinding;
void directBinding;

declare const approved: NonNullable<Awaited<ReturnType<D1WalletRelocationApprovals['read']>>>;
type ApprovalResult = Awaited<ReturnType<D1WalletRelocationApprovals['approvePasskey']>>;
// @ts-expect-error A denied result cannot carry a durable approval.
const deniedApproval: ApprovalResult = { kind: 'denied', approval: approved };
// @ts-expect-error An approved result requires the durable approval record.
const absentApproval: ApprovalResult = { kind: 'approved' };
void deniedApproval;
void absentApproval;

type OtpPurpose =
  import('../../packages/wallet-server/src/core/EmailOtpStores').EmailOtpChallengePurpose;
declare const relocationPurpose: OtpPurpose & { readonly action: 'wallet_email_otp_relocation' };
// @ts-expect-error Relocation proof cannot use the signing operation.
const wrongOtpPurpose: OtpPurpose = {
  action: 'wallet_email_otp_relocation',
  operation: 'transaction_sign',
};
// @ts-expect-error Broad spreads cannot turn relocation into a login challenge.
const spreadOtpPurpose: OtpPurpose = { ...relocationPurpose, action: 'wallet_email_otp_login' };
void wrongOtpPurpose;
void spreadOtpPurpose;

declare const ownerRequest: WalletRelocationOwnerRequest;
// @ts-expect-error Spreading public metadata cannot forge an authenticated owner request.
const forgedOwnerRequest: typeof ownerRequest = { ...ownerRequest };
// @ts-expect-error Authentication is required to construct an owner request.
const directOwnerRequest = new WalletRelocationOwnerRequest();
void forgedOwnerRequest;
void directOwnerRequest;

declare const approvals: D1WalletRelocationApprovals;
// @ts-expect-error A factor assertion alone cannot authorize a new relocation approval.
approvals.approvePasskey({ binding, credential: null, nowMs: 1 });

import { WalletRelocationReadAccess } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationReadAccess';
declare const readAccess: WalletRelocationReadAccess;
// @ts-expect-error Move-only access cannot authorize new admission.
approvals.approvePasskey({ owner: readAccess, binding, credential: null, nowMs: 1 });
// @ts-expect-error A broad spread cannot forge authenticated move access.
const forgedReadAccess: WalletRelocationReadAccess = { ...readAccess };
// @ts-expect-error A move locator cannot construct authenticated move access.
const directReadAccess = new WalletRelocationReadAccess(binding);
void forgedReadAccess;
void directReadAccess;

declare const otpIssuer: import('../../packages/wallet-server/src/router/cloudflare/d1/emailOtp/d1EmailOtpChallengeIssuer').CloudflareD1EmailOtpChallengeIssuer;
// @ts-expect-error Relocation OTP issuance must retain the relocation challenge expiry.
otpIssuer.create({ action: 'wallet_email_otp_relocation', operation: 'wallet_relocation' });

import { WalletRelocationSessionSource } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationSessions';
declare const sessionSource: WalletRelocationSessionSource;
// @ts-expect-error A broad spread cannot forge a validated source identity.
const forgedSessionSource: WalletRelocationSessionSource = { ...sessionSource };
// @ts-expect-error Source identity construction requires its boundary parser.
new WalletRelocationSessionSource(
  sessionSource.walletId,
  sessionSource.moveId,
  sessionSource.requestDigestHex,
  1,
);
void forgedSessionSource;

// The SQL layout is parsed once before the snapshot engine uses it.
import { AuthorizationSnapshotLayout } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/authorizationSnapshotLayout';
declare const snapshotLayout: AuthorizationSnapshotLayout;
// @ts-expect-error A spread cannot forge validated SQL identifiers.
const forgedSnapshotLayout: AuthorizationSnapshotLayout = { ...snapshotLayout };
// @ts-expect-error Raw column names require the boundary parser.
const directSnapshotLayout = new AuthorizationSnapshotLayout(
  'wallet_authorities',
  ['wallet_id'],
  ['wallet_id'],
);
void forgedSnapshotLayout;
void directSnapshotLayout;

import type { D1WalletAuthorizationIntake } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletAuthorizationIntake';
type AuthorizationIntakeProgress = Awaited<ReturnType<D1WalletAuthorizationIntake['prepare']>>;
// @ts-expect-error Receiving progress requires the durable next chunk position.
const missingIntakePosition: AuthorizationIntakeProgress = { state: 'receiving', chunkCount: 2 };
// @ts-expect-error Verified progress cannot retain a receiving cursor.
const mixedIntakeProgress: AuthorizationIntakeProgress = {
  state: 'verified',
  digestHex: 'a'.repeat(64),
  nextIndex: 2,
  chunkCount: 2,
};
declare const intakeProgress: AuthorizationIntakeProgress;
// @ts-expect-error A spread cannot add a receiving cursor to a possibly verified result.
const spreadIntakeProgress: AuthorizationIntakeProgress = {
  ...intakeProgress,
  nextIndex: 0,
  chunkCount: 2,
};
void missingIntakePosition;
void mixedIntakeProgress;
void spreadIntakeProgress;
