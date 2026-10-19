import type { RegistrationAuthority } from '../../packages/shared-ts/src/utils/registrationAuthMethodInput';
import type {
  CloudflareD1WalletRegistrationCommitStore,
  D1WalletRegistrationCommitStore,
  RegistrationFoundingRead,
  RegistrationFoundingSnapshot,
} from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationCommitStore';
import type { runRouterAbEd25519YaoRegistrationSideEffectV2 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationSideEffectBoundary';
import type { RegistrationInitialSessionCommit } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/walletRegistrationEstablishedSessionIssuer';
import type { RegistrationInitialSessionPlan } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationInitialSession';

declare const store: D1WalletRegistrationCommitStore;
declare const authority: RegistrationAuthority;
declare const commit: Awaited<ReturnType<D1WalletRegistrationCommitStore['reserveAuthority']>>;
declare const input: Parameters<typeof commit>[0];

declare const concreteStore: CloudflareD1WalletRegistrationCommitStore;

store.reserveAuthority(authority, null, null);
// @ts-expect-error Callers must explicitly provide founding IDs or null.
store.reserveAuthority(authority, null);
// @ts-expect-error Undefined cannot replace the explicit no-founding choice.
store.reserveAuthority(authority, null, undefined);
// @ts-expect-error The concrete implementation must also require founding.
concreteStore.reserveAuthority(authority, null);
// @ts-expect-error The concrete implementation must not default undefined to null.
concreteStore.reserveAuthority(authority, null, undefined);

// @ts-expect-error A commit is available only after authority reservation succeeds.
store.commit(input);
// @ts-expect-error The commit retains its reserved authority; callers cannot replace it.
commit({ ...input, authority });

type JournalRun = Parameters<typeof runRouterAbEd25519YaoRegistrationSideEffectV2>[1];
declare const journalRun: JournalRun;
const { initialRecord, ...withoutInitialRead } = journalRun;
// @ts-expect-error Every registration run must carry its initial journal read.
const missingInitialRead: JournalRun = withoutInitialRead;
const invalidInitialRead: JournalRun = {
  ...journalRun,
  // @ts-expect-error A present journal record must carry its parsed value and CAS version.
  initialRecord: { kind: 'present' },
};
void [initialRecord, missingInitialRead, invalidInitialRead];

declare const committedSession: Extract<RegistrationInitialSessionCommit, { kind: 'committed' }>;
declare const initialSessionPlan: Extract<RegistrationInitialSessionPlan, { kind: 'initial_near' }>;
// @ts-expect-error A committed session requires the transaction's parsed result.
const missingSessionCommit: RegistrationInitialSessionCommit = { kind: 'committed' };
// @ts-expect-error A spread must not carry a committed result into the uncommitted branch.
const contradictorySessionCommit: RegistrationInitialSessionCommit = {
  ...committedSession,
  kind: 'uncommitted',
};
// @ts-expect-error A separate session cannot carry the initial-session transaction inputs.
const contradictorySessionPlan: RegistrationInitialSessionPlan = {
  ...initialSessionPlan,
  kind: 'separate',
};
void [missingSessionCommit, contradictorySessionCommit, contradictorySessionPlan];

declare const snapshotFounding: RegistrationFoundingSnapshot;
// @ts-expect-error A snapshot cannot also request an independent read.
const conflictingFoundingRead: RegistrationFoundingRead = {
  ...snapshotFounding,
  kind: 'read',
  ids: {
    walletAuthorityId: snapshotFounding.records.walletAuthorityId,
    walletAuthMethodId: snapshotFounding.records.walletAuthMethodId,
  },
};
void conflictingFoundingRead;


// Custody cannot claim a prepared commit without its terminal transaction.
import type { RegistrationCustodyReservation } from '../../packages/wallet-server/src/router/domains/passkeyCustody/registrationCustodyOutcome';
import type { RegistrationCommitExecution } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/walletRegistrationSessionCommitReceipt';

// @ts-expect-error Prepared custody must carry the write that its receipt commits.
const custodyWithoutWrite: RegistrationCustodyReservation = { kind: 'prepared', outcome: { status: 'committed' } };
// @ts-expect-error Settled custody cannot retain pending writes.
const settledWithWrite: RegistrationCustodyReservation = { kind: 'settled', outcome: { status: 'committed' }, write: { statements: [] } };
declare const preparedCustody: Extract<RegistrationCustodyReservation, { kind: 'prepared' }>;
// @ts-expect-error A broad spread cannot silently discard the prepared lifecycle.
const spreadCustody: RegistrationCustodyReservation = { ...preparedCustody, kind: 'settled' };
// @ts-expect-error A replay cannot introduce a new custody write.
const replayWithCustody: RegistrationCommitExecution<unknown> = { kind: 'replayed', response: {}, custodyWrite: { statements: [] } };
void [custodyWithoutWrite, settledWithWrite, spreadCustody, replayWithCustody];
