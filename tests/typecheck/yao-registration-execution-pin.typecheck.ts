import type { RouterAbEd25519YaoRegistrationExecutionRecordV1 } from '../../packages/wallet-server/src/router/domains/ed25519Yao/registration/routerAbEd25519YaoRegistrationExecutionRecord';

type ReadyExecution = Extract<
  RouterAbEd25519YaoRegistrationExecutionRecordV1,
  { readonly kind: 'ready' }
>;
type ClaimedExecution = Extract<
  RouterAbEd25519YaoRegistrationExecutionRecordV1,
  { readonly kind: 'claimed' }
>;

declare const ready: ReadyExecution;
declare const claimed: ClaimedExecution;

// @ts-expect-error A dispatch claim must carry the persisted root and lineage.
const unpinnedClaim: ClaimedExecution = {
  ...ready,
  kind: 'claimed',
  requestDigestSha256Hex: 'digest',
  request: claimed.request,
  claimedAtMs: 1,
  reconcileAfterMs: 2,
};

// @ts-expect-error A ready record cannot retain a claimed dispatch root.
const prematurePin: ReadyExecution = { ...claimed, kind: 'ready' };

void [unpinnedClaim, prematurePin];
