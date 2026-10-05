import type { RegistrationFlowEvent, SeamsWeb } from '@seams/wallet';
import { useSeams, type SeamsContextType } from '@seams/wallet/react';

function logRegistrationEvent(event: RegistrationFlowEvent): void {
  console.log(event.phase, event.status, event.message);
}

function assertNever(value: never): never {
  throw new Error(`Unexpected NEAR readiness result: ${JSON.stringify(value)}`);
}

async function createWallet(
  registerWallet: SeamsContextType['registerWallet'],
  seams: SeamsWeb,
  registration: Parameters<SeamsContextType['registerWallet']>[0],
): Promise<void> {
  try {
    const result = await registerWallet({
      ...registration,
      options: { ...registration.options, onEvent: logRegistrationEvent },
    });
    if (!result.success) {
      console.error('Registration failed:', result.error);
      return;
    }
    // `walletId` is the stable identifier for every later wallet operation.
    console.log(`Wallet ${result.walletId} registered (${result.kind})`);

    if (
      result.kind === 'ecdsa_wallet_registered_near_pending' ||
      result.kind === 'near_wallet_registered_pending'
    ) {
      const near = await seams.registration.waitForNearAccount({ walletId: result.walletId });
      switch (near.kind) {
        case 'near_ready':
          console.log('NEAR account ready:', near.nearAccountId);
          break;
        case 'near_failed_retryable':
          console.warn('NEAR provisioning needs a retry:', near.reason);
          break;
        case 'timed_out':
          console.warn('NEAR is still pending. Keep this wallet id and check readiness again.');
          break;
        default:
          assertNever(near);
      }
    }
  } catch (error) {
    console.error('Wallet creation interrupted:', error);
  }
}

export function CreateWalletButton({ registration }: {
  registration: Parameters<SeamsContextType['registerWallet']>[0];
}) {
  const { registerWallet, seams } = useSeams();

  return (
    <button onClick={createWallet.bind(null, registerWallet, seams, registration)}>
      Create wallet
    </button>
  );
}
