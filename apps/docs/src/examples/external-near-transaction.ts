import { functionCall } from '@seams/wallet';
import type { ExternalNearController } from '@seams/wallet/external-near';

export async function sendGreeting(controller: ExternalNearController) {
  const { connection } = controller.getSnapshot();
  if (connection.kind !== 'connected') return;

  const result = await controller.sendTransaction(connection, {
    receiverId: 'seams-v1.testnet',
    actions: [
      functionCall({
        method: 'set_greeting',
        args: { greeting: 'Hello from my wallet' },
      }),
    ],
  });

  if (!result.ok) {
    console.error(result.message);
    return;
  }

  const submission = result.value;
  const outcome = await controller.checkOutcome(submission);

  console.log(outcome.kind, submission.hash);
  return submission;
}
