import type { OwnerOperationNearClient } from '@/core/rpcClients/near/NearClient';
import { ActionType, type TransactionInputWasm } from '@/core/types/actions';
import type { OwnerNearShortfall } from '../shared/ownerNearOperation';
import { nearSpendableBalance } from '@/core/assets/nearBalance';
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
  const maximumCost = deposits + gas * gasPrice;
  const { balance, spendable, storageReserve, shortOfStorage } = nearSpendableBalance(account);
  if (spendable >= maximumCost && !shortOfStorage) return null;
  return {
    balance: balance.toString(),
    maximumCost: maximumCost.toString(),
    storageReserve: storageReserve.toString(),
  };
}
