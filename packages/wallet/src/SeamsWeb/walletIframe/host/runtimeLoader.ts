import type { RuntimeWalletHostRoute } from './requestRouter';

type WalletHostRuntimeModule = typeof import('./runtime');
type WalletHostRuntimeKind = RuntimeWalletHostRoute['kind'];

const runtimePromises: Partial<Record<WalletHostRuntimeKind, Promise<WalletHostRuntimeModule>>> =
  {};
let recoveryCodeRuntimePromise: Promise<WalletHostRuntimeModule> | null = null;
let recoveryCodeSurfacePromise: Promise<void> | null = null;

export function loadWalletHostRuntime(
  route: RuntimeWalletHostRoute,
): Promise<WalletHostRuntimeModule> {
  if (route.type === 'PM_ACKNOWLEDGE_WALLET_RECOVERY_CODE_BACKUP') {
    recoveryCodeRuntimePromise ??= import('./runtime-recovery-codes');
    return recoveryCodeRuntimePromise;
  }
  return loadRuntime(route.kind);
}

/**
 * Downloads the auth runtime ahead of its first request, on sign-in intent. Every
 * runtime kind shares most of its code, so this covers the other kinds too.
 */
export function preloadWalletHostRuntime(): void {
  void loadRuntime('auth').catch(ignorePreloadFailure);
}

function ignorePreloadFailure(): void {}

function loadRuntime(kind: WalletHostRuntimeKind): Promise<WalletHostRuntimeModule> {
  const existing = runtimePromises[kind];
  if (existing) return existing;
  const loading = loadRuntimeForKind(kind);
  runtimePromises[kind] = loading;
  // A failed chunk load is retried by the next request instead of failing it too.
  loading.catch(forgetFailedRuntimeLoad.bind(null, kind, loading));
  return loading;
}

function forgetFailedRuntimeLoad(
  kind: WalletHostRuntimeKind,
  loading: Promise<WalletHostRuntimeModule>,
): void {
  if (runtimePromises[kind] === loading) delete runtimePromises[kind];
}

export async function preloadWalletHostRecoveryCodeSurface(): Promise<void> {
  recoveryCodeRuntimePromise ??= import('./runtime-recovery-codes');
  recoveryCodeSurfacePromise ??= Promise.all([
    recoveryCodeRuntimePromise,
    import(
      '../../../core/signingEngine/uiConfirm/ui/preact/mountRecoveryCodeBackupSurface'
    ),
  ]).then(() => undefined);
  await recoveryCodeSurfacePromise;
}

function loadRuntimeForKind(kind: WalletHostRuntimeKind): Promise<WalletHostRuntimeModule> {
  switch (kind) {
    case 'auth':
      return import('./runtime-auth');
    case 'near':
      return import('./runtime-near');
    case 'ecdsa':
      return import('./runtime-ecdsa-tempo');
    case 'email_otp':
      return import('./runtime-email-otp');
    case 'recovery':
      return import('./runtime-recovery');
    case 'export':
      return import('./runtime-export');
    case 'device_link':
      return import('./runtime-device-link');
    case 'preferences':
      return import('./runtime-preferences');
  }
  return assertNever(kind);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled wallet host runtime route: ${String(value)}`);
}
