import { alphabetizeStringify, sha256BytesUtf8 } from '@shared/utils/digests';
import { base64UrlEncode } from '@shared/utils/encoders';
import type { WalletEd25519YaoActiveCapabilityRecord } from '../../../../core/WalletStore';

/**
 * How an Ed25519 Yao lifecycle was finalized. A lifecycle has at most one
 * decision, and the decision is the linearization point of its finalization:
 * it commits in the same batch as the writes that make the finalization
 * visible, so the result is visible if and only if the decision exists.
 *
 * The Router's wallet object binds the first finalization that consumes a
 * registration's execution. The decision records which one became visible,
 * and nothing else records it.
 */
export type RouterAbEd25519YaoLifecycleDecisionKindV1 =
  | 'registration_finalized'
  | 'add_signer_finalized';

export type RouterAbEd25519YaoLifecycleDecisionV1 = {
  readonly lifecycleId: string;
  readonly kind: RouterAbEd25519YaoLifecycleDecisionKindV1;
  /** Names the finalization: its consumer binding and the capability it installs. */
  readonly decisionId: string;
  readonly walletId: string;
};

/** The decision one finalization would record. */
export async function routerAbEd25519YaoLifecycleDecisionV1(input: {
  readonly kind: RouterAbEd25519YaoLifecycleDecisionKindV1;
  readonly lifecycleId: string;
  readonly walletId: string;
  /** The binding the Router's wallet object consumed the execution for. */
  readonly consumerBinding: string;
  readonly capability: WalletEd25519YaoActiveCapabilityRecord;
}): Promise<RouterAbEd25519YaoLifecycleDecisionV1> {
  const decisionId = base64UrlEncode(
    await sha256BytesUtf8(
      alphabetizeStringify({
        version: 'router_ab_ed25519_yao_lifecycle_decision_v1',
        kind: input.kind,
        lifecycleId: input.lifecycleId,
        walletId: input.walletId,
        consumerBinding: input.consumerBinding,
        capability: input.capability,
      }),
    ),
  );
  return {
    lifecycleId: input.lifecycleId,
    kind: input.kind,
    decisionId,
    walletId: input.walletId,
  };
}

/** What a finalization finds when it looks up its lifecycle's decision. */
export type RouterAbEd25519YaoLifecycleDecisionLookupV1 =
  /** No finalization has become visible: this one may decide. */
  | { readonly kind: 'undecided' }
  /** This finalization already became visible: its visibility writes are done. */
  | { readonly kind: 'decided' }
  /** Another finalization became visible for this lifecycle. */
  | { readonly kind: 'decided_otherwise'; readonly decision: RouterAbEd25519YaoLifecycleDecisionV1 };

export function routerAbEd25519YaoLifecycleDecisionLookupV1(
  wanted: RouterAbEd25519YaoLifecycleDecisionV1,
  stored: RouterAbEd25519YaoLifecycleDecisionV1 | null,
): RouterAbEd25519YaoLifecycleDecisionLookupV1 {
  if (stored === null) return { kind: 'undecided' };
  if (
    stored.lifecycleId === wanted.lifecycleId &&
    stored.kind === wanted.kind &&
    stored.decisionId === wanted.decisionId &&
    stored.walletId === wanted.walletId
  ) {
    return { kind: 'decided' };
  }
  return { kind: 'decided_otherwise', decision: stored };
}
