import type { LoginWebContext } from '@/SeamsWeb/signingSurface/types';
import { IndexedDBManager } from '@/core/indexedDB';
import { type WalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';

export async function clearFailedUnlockSessionState(args: {
  context: LoginWebContext;
  walletId: WalletId;
}): Promise<void> {
  await IndexedDBManager.clearLastProfileSelection().catch(() => undefined);
  try {
    args.context.signingEngine.getNonceCoordinator().clearAll();
  } catch {}
  try {
    await args.context.signingEngine.clearVolatileWarmSigningMaterial(args.walletId);
  } catch {}
}

export async function resumeNearAfterSuccessfulUnlock(
  args: Parameters<
    typeof import('../../registration/registration').resumeNearRegistrationAfterUnlock
  >[0],
): Promise<void> {
  try {
    const registration = await import('../../registration/registration');
    await registration.resumeNearRegistrationAfterUnlock(args);
  } catch (error) {
    console.warn(
      '[login] NEAR continuation could not start',
      error instanceof Error ? error.message : 'module unavailable',
    );
  } finally {
    new Uint8Array(args.ownedFactorSecret).fill(0);
  }
}
