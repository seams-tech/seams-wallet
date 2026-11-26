import type { Variant } from '@shared/utils/variant';
import { projectExactWalletSessionAuthorizationV1 } from '../../../authorization/domain';
import type { RouterAbEd25519NormalSigningAuthorizationResult } from './routerAbEd25519NormalSigningRoute';
import type { RouterAbEcdsaNormalSigningAuthorizationResult } from './routerAbEcdsaDerivationNormalSigningRoute';

/** The session snapshot validated for this admission, before its quota claim. */
export function signingPrepareSessionResponse(
  signing: unknown,
  authorization: Variant<
    RouterAbEcdsaNormalSigningAuthorizationResult | RouterAbEd25519NormalSigningAuthorizationResult,
    'ok',
    true
  >,
) {
  switch (authorization.kind) {
    case 'operation_step_up':
      return { kind: 'operation_step_up' as const, signing };
    case 'wallet_session_operation_credential_v1': {
      const { session, quota } = authorization.validated.admission.context.authorization;
      return {
        kind: 'reusable_wallet_session' as const,
        signing,
        session_status: {
          ok: true,
          status: 'active',
          walletSessionId: session.walletSessionId,
          quotaId: session.quotaId,
          remainingUses: quota.remainingUses,
          expiresAtMs: quota.expiresAtMs,
          quotaLifecycle: 'active',
          authorization: projectExactWalletSessionAuthorizationV1(session),
        },
      };
    }
    case 'wallet_session_operation_credential_exhausted_candidate_v1':
      // An exhausted candidate can only resolve an existing operation. A fresh
      // successful prepare must have claimed an active session's quota.
      throw new Error('An exhausted Wallet Session cannot publish a fresh prepare response');
  }
}
