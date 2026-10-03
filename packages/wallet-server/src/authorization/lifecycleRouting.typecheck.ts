import type { WalletId } from '@shared/utils/domainIds';
import { WalletLifecycleLocator, type WalletLifecycleRoutingPublisher } from './lifecycleRouting';

declare const locator: WalletLifecycleLocator;
declare const walletId: WalletId;
declare const publisher: WalletLifecycleRoutingPublisher;
// @ts-expect-error Lifecycle locators require boundary validation.
const literal: WalletLifecycleLocator = { kind: 'yao_export', value: 'lifecycle' };
// @ts-expect-error Spreading loses the validated identity.
const spread: WalletLifecycleLocator = { ...locator };
// @ts-expect-error The constructor is private.
new WalletLifecycleLocator('yao_export', 'lifecycle');
// @ts-expect-error Publication requires a wallet.
publisher.publishLifecycle({ locator });
// @ts-expect-error Publication requires a validated locator.
publisher.publishLifecycle({ walletId, locator: { kind: 'yao_recovery', value: 'lifecycle' } });
void [literal, spread];
