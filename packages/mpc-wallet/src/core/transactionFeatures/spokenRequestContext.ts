// What the spoken card shows above the sentence. The application writes the summary of a general
// transaction and of a message, so the words alone do not say what the Wallet signs. The card
// shows the request itself there, in the words of the Wallet's confirm, from the same input that
// the signer builds the bytes from. A typed kind needs none: the Wallet writes its sentence.

import {
  immediateNearTokenMetadata,
  parseNearTokenTransferCall,
} from '@/core/signingEngine/chains/near/tokenTransfers';
import { formatTokenBaseUnits } from '@/core/signingEngine/chains/tokenAmounts';
import {
  buildDisplayTreeFromTxPayloads,
  nearActionTitle,
} from '@/core/signingEngine/uiConfirm/ui/transaction-display/tree';
import {
  ActionType,
  toActionArgsWasm,
  type ActionArgs,
  type TransactionInput,
} from '@/core/types/actions';
import type { PhraseRequest } from './phraseSurface';
import type { SpeakToSignNetwork } from './plugins';
import type { SpokenIntent } from './spokenIntent';

type CardContext = NonNullable<PhraseRequest['context']>;

const REQUEST_LABEL = 'This request';
/** The box scrolls, but the arguments of a call can be megabytes. */
const MAX_ARGS_CHARS = 600;

/** The text above the sentence of this intent, or undefined for a sentence that needs none. */
export function spokenRequestContext(
  network: SpeakToSignNetwork,
  intent: SpokenIntent,
): CardContext | undefined {
  switch (intent.kind) {
    // The author sees the note that the summary signs.
    case 'community_note':
      return { label: 'Your note', text: intent.text };
    case 'transaction':
      return {
        label: REQUEST_LABEL,
        text: transactionLines(network, intent.transaction).join('\n'),
      };
    case 'signed_message':
      return {
        label: REQUEST_LABEL,
        text: [`Message for ${intent.message.recipient}`, intent.message.message].join('\n'),
      };
    default:
      return undefined;
  }
}

/** The receiver, then each action with its fields, as the review of the confirm names them. */
function transactionLines(network: SpeakToSignNetwork, transaction: TransactionInput): string[] {
  const [review] = buildDisplayTreeFromTxPayloads([transaction]).children ?? [];
  const lines = [`To ${transaction.receiverId}`];
  for (const node of review?.children ?? []) {
    const { action } = node;
    if (!action) continue;
    lines.push(nearActionTitle(action));
    const token = tokenTransferLine(network, transaction.receiverId, action);
    if (token) lines.push(token);
    for (const field of node.children ?? []) {
      // The arguments are a block of the review. Here they are one line.
      if (field.content === undefined) lines.push(field.label);
    }
    if (action.type === ActionType.FunctionCall) {
      const args = JSON.stringify(action.args);
      if (args !== '{}') lines.push(`Arguments: ${cut(args)}`);
    }
  }
  return lines;
}

/** The amount of a token transfer, only for a token on the Wallet's own list. */
function tokenTransferLine(
  network: SpeakToSignNetwork,
  receiverId: string,
  action: ActionArgs,
): string | null {
  if (action.type !== ActionType.FunctionCall) return null;
  const wasm = toActionArgsWasm(action);
  const call = parseNearTokenTransferCall(receiverId, wasm);
  if (!call) return null;
  const token = immediateNearTokenMetadata({
    network,
    txSigningRequests: [{ receiverId, actions: [wasm] }],
  }).get(call.tokenContract);
  if (!token?.verified) return null;
  const amount = formatTokenBaseUnits(call.baseUnits, token.decimals);
  return `Token transfer: ${amount} ${token.symbol} to ${call.recipient}`;
}

function cut(text: string): string {
  if (text.length <= MAX_ARGS_CHARS) return text;
  return `${text.slice(0, MAX_ARGS_CHARS)}… (${text.length - MAX_ARGS_CHARS} more characters)`;
}
