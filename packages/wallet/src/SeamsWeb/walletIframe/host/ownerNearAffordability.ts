import type { OwnerOperationNearClient } from '@/core/rpcClients/near/NearClient';
import { ActionType, type TransactionInputWasm } from '@/core/types/actions';
import type { OwnerNearShortfall } from '../shared/ownerNearOperation';

// NEAR charges 10^19 yoctoNEAR of balance for each byte that the account stores.
const STORAGE_AMOUNT_PER_BYTE = 10n ** 19n;
// Covers the transaction's conversion fee and each action's send and execution fees.
const FEE_ALLOWANCE_GAS_PER_ACTION = 5_000_000_000_000n;

/**
 * Applies NEAR's two balance rules before a signature exists: the balance must cover the
 * maximum cost (`NotEnoughBalance`), and what remains must cover storage
 * (`LackBalanceForState`). A failed read returns `null`, because NEAR checks again anyway.
 */
export async function ownerNearShortfall(
  nearClient: OwnerOperationNearClient,
  accountId: string,
  transaction: TransactionInputWasm,
): Promise<OwnerNearShortfall | null> {
  let account: Awaited<ReturnType<OwnerOperationNearClient['viewAccount']>>;
  let gasPrice: bigint;
  try {
    [account, gasPrice] = await Promise.all([
      nearClient.viewAccount(accountId),
      nearClient.gasPurchasePrice(),
    ]);
  } catch {
    return null;
  }
  let deposits = 0n;
  let gas = 0n;
  for (const action of transaction.actions) {
    gas += FEE_ALLOWANCE_GAS_PER_ACTION;
    if (action.action_type === ActionType.Transfer) deposits += BigInt(action.deposit);
    if (action.action_type === ActionType.FunctionCall) {
      deposits += BigInt(action.deposit);
      gas += BigInt(action.gas);
    }
  }
  const balance = BigInt(String(account.amount));
  const locked = BigInt(String(account.locked));
  const maximumCost = deposits + gas * gasPrice;
  const storageReserve = BigInt(account.storage_usage) * STORAGE_AMOUNT_PER_BYTE;
  if (balance >= maximumCost && balance - maximumCost + locked >= storageReserve) return null;
  return {
    balance: balance.toString(),
    maximumCost: maximumCost.toString(),
    storageReserve: storageReserve.toString(),
  };
}
