import type { SponsoredNamedNearAccountInput } from './d1SponsoredNearAccount';

declare const request: SponsoredNamedNearAccountInput;

// @ts-expect-error A sponsored effect requires its wallet owner independently of the account name.
const unowned: SponsoredNamedNearAccountInput = {
  accountId: request.accountId,
  publicKey: request.publicKey,
  idempotencyKey: request.idempotencyKey,
};

const erasedOwner = { ...request, walletId: undefined };
// @ts-expect-error Broad spreads cannot erase the wallet owner.
const invalidSpread: SponsoredNamedNearAccountInput = erasedOwner;

void unowned;
void invalidSpread;
