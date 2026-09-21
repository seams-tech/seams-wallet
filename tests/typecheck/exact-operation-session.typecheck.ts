import type {
  RouterApiWalletSessionExactOperationContext,
  RouterApiWalletSessionAuthorizationV2AdmissionContext,
} from '../../packages/wallet-server/src/router/framework/authServicePort';

declare const exact: RouterApiWalletSessionExactOperationContext;

// Exact-operation identity carries no reusable allowance, including through a spread.
// @ts-expect-error Exact-operation context is not reusable-session admission.
const reusable: RouterApiWalletSessionAuthorizationV2AdmissionContext = exact;
// @ts-expect-error A spread cannot manufacture reusable-session authority.
const spread: RouterApiWalletSessionAuthorizationV2AdmissionContext = { ...exact };
// @ts-expect-error A reusable allowance is required for direct admission construction.
const direct: RouterApiWalletSessionAuthorizationV2AdmissionContext = {
  authority: exact.authority,
  authMethod: exact.authMethod,
  retiredAtMs: null,
};

void reusable;
void spread;
void direct;
