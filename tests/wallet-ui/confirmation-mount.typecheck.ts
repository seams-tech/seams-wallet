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

const transactionReceipt: ReceiptProgress = { subject: 'transaction', state: { kind: 'broadcasting' } };
// @ts-expect-error A message signature is never broadcast, so its receipt has no network stages.
const broadcastMessage: ReceiptProgress = { subject: 'message', state: { kind: 'broadcasting' } };
// @ts-expect-error A message signature has no transaction hash.
const confirmedMessage: ReceiptProgress = { subject: 'message', state: { kind: 'confirmed', hash: null } };
declare const receipt: ReceiptProgress;
// @ts-expect-error Receipt progress is replaced whole, never changed in place.
receipt.state = { kind: 'broadcasting' };
void [transactionReceipt, broadcastMessage, confirmedMessage];
