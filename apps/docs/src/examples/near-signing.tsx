import {
  functionCall,
  logWalletEvents,
  TxExecutionStatus,
  useSeams,
  type BoundNearSigner,
} from '@seams/wallet/react';

async function signGreeting(near: BoundNearSigner): Promise<void> {
  await near.signAndSendTransaction({
    receiverId: 'guest-book.testnet',
    actions: [functionCall({ method: 'set_greeting', args: { greeting: 'Hello from Seams' } })],
    options: {
      waitUntil: TxExecutionStatus.EXECUTED_OPTIMISTIC,
      onEvent: logWalletEvents(),
    },
  });
}

export function SetGreetingButton() {
  const { wallet } = useSeams();
  if (!wallet?.near) return null;

  // Each request opens wallet confirmation for this transaction.
  return <button onClick={signGreeting.bind(null, wallet.near)}>Sign transaction</button>;
}
