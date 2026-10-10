import type { RegistrationAuthority } from '../../packages/shared-ts/src/utils/registrationAuthMethodInput';
import type { D1WalletRegistrationCommitStore } from '../../packages/wallet-server/src/router/cloudflare/d1/registration/d1WalletRegistrationCommitStore';

declare const store: D1WalletRegistrationCommitStore;
declare const authority: RegistrationAuthority;
declare const commit: Awaited<ReturnType<D1WalletRegistrationCommitStore['reserveAuthority']>>;
declare const input: Parameters<typeof commit>[0];

// @ts-expect-error A commit is available only after authority reservation succeeds.
store.commit(input);
// @ts-expect-error The commit retains its reserved authority; callers cannot replace it.
commit({ ...input, authority });
