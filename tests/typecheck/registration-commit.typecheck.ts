import type { RegistrationAuthority } from '../../packages/shared-ts/src/utils/registrationAuthMethodInput';
import type { D1WalletRegistrationCommitStore } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationCommitStore';
import type { runRouterAbEd25519YaoRegistrationSideEffectV2 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationSideEffectBoundary';

declare const store: D1WalletRegistrationCommitStore;
declare const authority: RegistrationAuthority;
declare const commit: Awaited<ReturnType<D1WalletRegistrationCommitStore['reserveAuthority']>>;
declare const input: Parameters<typeof commit>[0];

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
