import type { InMemoryRouterAbEd25519YaoExportStateV1 } from './routerAbEd25519YaoExport';

declare const state: InMemoryRouterAbEd25519YaoExportStateV1;

// @ts-expect-error Replay protection must retain the wallet owner with the nonce.
state.authorizationNonceOwners.set('nonce');
// @ts-expect-error Uncertain authorizations also require a wallet owner.
state.authorizationUncertainOwners.set('digest', undefined);

const unowned = { ...state, authorizationNonceOwners: new Set<string>() };
// @ts-expect-error A broad spread cannot restore the unowned persistence shape.
const invalid: InMemoryRouterAbEd25519YaoExportStateV1 = unowned;
void invalid;
