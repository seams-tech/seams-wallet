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
