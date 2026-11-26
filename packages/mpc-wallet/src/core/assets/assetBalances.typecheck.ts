import type { AssetBalance } from './readAssetBalances';

declare const balance: AssetBalance;

// @ts-expect-error A failed read has no amount: check the kind before showing a number.
void balance.available;

if (balance.kind === 'read') {
  void balance.available;
  void balance.reserved;
} else {
  void balance.reason;
  // @ts-expect-error An unavailable balance carries no amount, not even a zero.
  void balance.available;
}
