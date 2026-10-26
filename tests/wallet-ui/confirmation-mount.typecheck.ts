import type {
  ConfirmationSurfaceHandle,
  ConfirmSurfaceModel,
} from '@/core/signingEngine/uiConfirm/ui/preact/mountConfirmationSurface';
import type { ReceiptProgress } from '@/core/signingEngine/uiConfirm/ui/transaction-receipt';

declare const handle: ConfirmationSurfaceHandle;
declare const model: ConfirmSurfaceModel;

handle.update(model);
// @ts-expect-error The renderer accepts a complete model, never a controller patch.
handle.update({ appearance: model.appearance });
// @ts-expect-error Appearance is required for every render.
handle.update({ content: model.content });
// @ts-expect-error Raw controller fields cannot replace the normalized content branch.
handle.update({ ...model, loading: true });

const transactionReceipt: ReceiptProgress = {
  subject: 'transaction',
  state: { kind: 'broadcasting' },
};
// @ts-expect-error A message signature is never broadcast, so its receipt has no network stages.
const broadcastMessage: ReceiptProgress = { subject: 'message', state: { kind: 'broadcasting' } };
// @ts-expect-error A message signature has no transaction hash.
const confirmedMessage: ReceiptProgress = {
  subject: 'message',
  state: { kind: 'confirmed', hash: null },
};
declare const receipt: ReceiptProgress;
// @ts-expect-error Receipt progress is replaced whole, never changed in place.
receipt.state = { kind: 'broadcasting' };
void [transactionReceipt, broadcastMessage, confirmedMessage];

const waitingWithHash: ReceiptProgress = {
  subject: 'transaction',
  // @ts-expect-error A material wait has no transaction hash before signing.
  state: { kind: 'waiting', reason: 'material', message: 'Waiting', hash: 'tx' },
};
// @ts-expect-error Waiting requires an explicit reason and display message.
const missingWaitReason: ReceiptProgress = { subject: 'transaction', state: { kind: 'waiting' } };
const waitingMessage: ReceiptProgress = {
  ...transactionReceipt,
  subject: 'message',
  // @ts-expect-error A message receipt cannot acquire transaction-only wait state through a spread.
  state: { kind: 'waiting', reason: 'cooldown', message: 'Waiting' },
};
void [waitingWithHash, missingWaitReason, waitingMessage];
