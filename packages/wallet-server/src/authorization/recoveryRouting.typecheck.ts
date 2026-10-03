import type { WalletRecoveryRoutingPublication } from './recoveryRouting';
import type { WalletId, WalletRecoveryOperationId } from '@shared/utils/domainIds';
import type { RecoveryCodeLocatorV1 } from '@shared/wallet-recovery/recoveryCodeLocator';

declare const walletId: WalletId;
declare const operationId: WalletRecoveryOperationId;
declare const digest: RecoveryCodeLocatorV1;
const codes: WalletRecoveryRoutingPublication = { kind: 'codes', walletId, locators: [digest] };
const operation: WalletRecoveryRoutingPublication = { kind: 'operation', walletId, operationId };
// @ts-expect-error A publication must name its owning wallet.
const missingWallet: WalletRecoveryRoutingPublication = { kind: 'codes', locators: [digest] };
// @ts-expect-error A broad spread cannot combine code and operation branches.
const crossed: WalletRecoveryRoutingPublication = { ...codes, operationId };
// @ts-expect-error An unparsed string is not a validated locator digest.
const raw: WalletRecoveryRoutingPublication = { kind: 'codes', walletId, locators: ['raw'] };
void [codes, operation, missingWallet, crossed, raw];

import type { RouterApiPasskeyCustodyService } from '../router/cloudflare/d1/passkeyCustody/d1PasskeyCustodyRouteService';
type Preparation = Awaited<ReturnType<RouterApiPasskeyCustodyService['prepareRecovery']>>;
declare const prepared: Extract<Preparation, { kind: 'prepared' }>;
// @ts-expect-error An unavailable route cannot carry a prepared wallet through a spread.
const unavailable: Preparation = { ...prepared, kind: 'routing_unavailable' };
void unavailable;
