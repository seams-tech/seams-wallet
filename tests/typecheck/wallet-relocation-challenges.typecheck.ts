import { WalletRelocationOwnerRequest } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/d1WalletRelocationOwnerRequest';
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
