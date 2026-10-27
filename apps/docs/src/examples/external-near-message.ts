import type { ExternalNearController } from '@seams/wallet/external-near';

export async function signOwnershipChallenge(
  controller: ExternalNearController,
  challenge: { message: string; recipient: string; nonce: Uint8Array },
) {
  const connection = controller.getSnapshot().connection;
  if (connection.kind !== 'connected') throw new Error('Connect Meteor first.');
  const result = await controller.signMessage(connection, challenge);
  if (!result.ok) throw new Error(result.message);
  return result.value;
}
