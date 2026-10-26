import { ActionType, toActionArgsWasm, type ActionArgs } from '../core/types/actions';

/** Wallet Selector's JSON action format, shared by HOT and Intear. */
export function externalNearAction(action: ActionArgs) {
  const normalized = toActionArgsWasm(action);
  switch (normalized.action_type) {
    case ActionType.Transfer:
      return { type: 'Transfer', params: { deposit: normalized.deposit } };
    case ActionType.FunctionCall:
      return {
        type: 'FunctionCall',
        params: {
          methodName: normalized.method_name,
          args: JSON.parse(normalized.args),
          gas: normalized.gas,
          deposit: normalized.deposit,
        },
      };
    default:
      throw new Error('Unsupported external NEAR action.');
  }
}
