import type { CloudflareD1AuthorizationStore } from '../authorization/d1AuthorizationStore';
import type { D1WalletRegistrationCommitStore } from './d1WalletRegistrationCommitStore';
import {
  commitInitialEd25519RegistrationSession,
  type RegistrationInitialSessionCommit,
} from './walletRegistrationEstablishedSessionIssuer';

export type RegistrationSessionTransactionStore = Pick<
  CloudflareD1AuthorizationStore,
  'commitRegistrationWalletSessionAuthorizationV2'
>;

export type RegistrationInitialSessionPlan =
  | { readonly kind: 'separate'; readonly store?: never; readonly request?: never }
  | {
      readonly kind: 'initial_near';
      readonly store: RegistrationSessionTransactionStore;
      readonly request: Omit<
        Parameters<typeof commitInitialEd25519RegistrationSession>[0],
        'foundingAuthority'
      >;
    };

type ReservedWalletCommit = Awaited<
  ReturnType<D1WalletRegistrationCommitStore['reserveAuthority']>
>;

export async function commitWalletRegistration(
  commitWallet: ReservedWalletCommit,
  input: Parameters<ReservedWalletCommit>[0],
  session: RegistrationInitialSessionPlan,
): Promise<RegistrationInitialSessionCommit> {
  switch (session.kind) {
    case 'separate':
      await commitWallet(input);
      return { kind: 'uncommitted' };
    case 'initial_near': {
      if (!input.foundingAuthority) {
        throw new Error('An initial registration session requires its founding authority');
      }
      const committed = await commitInitialEd25519RegistrationSession(
        {
          authorizationService: session.request.authorizationService,
          authorizationTenantId: session.request.authorizationTenantId,
          registrationCeremonyId: session.request.registrationCeremonyId,
          authority: session.request.authority,
          foundingAuthority: input.foundingAuthority,
          walletAuthMethodId: session.request.walletAuthMethodId,
          expiresAtMs: session.request.expiresAtMs,
          remainingUses: session.request.remainingUses,
          proof: session.request.proof,
        },
        session.store.commitRegistrationWalletSessionAuthorizationV2.bind(
          session.store,
          commitWallet.bind(undefined, input),
        ),
      );
      return { kind: 'committed', value: committed };
    }
    default:
      return assertNeverSessionPlan(session);
  }
}

function assertNeverSessionPlan(value: never): never {
  throw new Error(`Unsupported registration session plan: ${String(value)}`);
}
