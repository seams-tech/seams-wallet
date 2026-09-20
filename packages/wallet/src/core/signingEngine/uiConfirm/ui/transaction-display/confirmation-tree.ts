import { fromTransactionInputsWasm, type TransactionInputWasm } from '@/core/types/actions';
import type { TxDisplayModel } from '@/core/signingEngine/interfaces/display';
import { buildDisplayTreeFromModel, buildDisplayTreeFromTxPayloads, type TreeNode } from './tree';

export function buildConfirmationTree(input: {
  txSigningRequests?: TransactionInputWasm[];
  model?: TxDisplayModel;
}): TreeNode | null {
  const txs = Array.isArray(input.txSigningRequests) ? input.txSigningRequests : [];
  if (txs.length > 0) return buildDisplayTreeFromTxPayloads(fromTransactionInputsWasm(txs));

  const model = input.model;
  if (!model) return null;
  const operations = Array.isArray(model.operations) ? model.operations : [];
  const warnings = Array.isArray(model.warnings) ? model.warnings : [];
  return operations.length > 0 || warnings.length > 0 ? buildDisplayTreeFromModel(model) : null;
}
