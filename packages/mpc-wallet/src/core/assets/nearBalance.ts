// NEAR charges 10^19 yoctoNEAR of balance for each byte that the account stores.
export const NEAR_STORAGE_AMOUNT_PER_BYTE = 10n ** 19n;

type NearAccountBalanceView = {
  readonly amount: string | number | bigint;
  readonly locked: string | number | bigint;
  readonly storage_usage: string | number | bigint;
};

export type NearSpendableBalance = {
  /** The liquid balance, `amount` in `view_account`. */
  readonly balance: bigint;
  /** What the account can send now: the balance less the storage that staking does not cover. */
  readonly spendable: bigint;
  /** The part of `balance` that storage keeps. */
  readonly reserved: bigint;
  readonly storageReserve: bigint;
  /** The balance and the locked stake together do not cover storage, so no cost passes. */
  readonly shortOfStorage: boolean;
};

/**
 * NEAR's two balance rules for a cost: the balance must cover it (`NotEnoughBalance`), and what
 * remains plus the locked stake must cover storage (`LackBalanceForState`). The spendable amount
 * is the largest cost that passes both rules.
 */
export function nearSpendableBalance(account: NearAccountBalanceView): NearSpendableBalance {
  const balance = BigInt(String(account.amount));
  const locked = BigInt(String(account.locked));
  const storageReserve = BigInt(String(account.storage_usage)) * NEAR_STORAGE_AMOUNT_PER_BYTE;
  const afterStorage = balance + locked - storageReserve;
  const spendable = afterStorage < 0n ? 0n : afterStorage < balance ? afterStorage : balance;
  return {
    balance,
    spendable,
    reserved: balance - spendable,
    storageReserve,
    shortOfStorage: afterStorage < 0n,
  };
}
