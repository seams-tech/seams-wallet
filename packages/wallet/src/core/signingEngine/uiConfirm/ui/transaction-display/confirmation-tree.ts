import { fromTransactionInputsWasm, type TransactionInputWasm } from '@/core/types/actions';
import type {
  TxDisplayModel,
  TxDisplayOperation,
} from '@/core/signingEngine/interfaces/display';
import { buildDisplayTreeFromModel, buildDisplayTreeFromTxPayloads, type TreeNode } from './tree';

function operationHasAbiDecodeHint(operation: TxDisplayOperation): boolean {
  const hint = operation.abiDecodeHint;
  if (hint && Array.isArray(hint.abi) && hint.abi.length > 0) {
    const dataHex = String(hint.dataHex || '').trim();
    if (dataHex && dataHex !== '0x') return true;
  }
  const children = Array.isArray(operation.children) ? operation.children : [];
  return children.some(operationHasAbiDecodeHint);
}

export function modelHasAbiDecodeHints(model: TxDisplayModel): boolean {
  const operations = Array.isArray(model.operations) ? model.operations : [];
  return operations.some(operationHasAbiDecodeHint);
}

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
