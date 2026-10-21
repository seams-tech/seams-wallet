import type { RegistrationCapability } from '@/SeamsWeb/signingSurface/types';
import type { RegistrationResult } from '@/core/types/seams';
import type {
  WalletRegistrationCommand,
  WalletRegistrationCommands,
} from '@/SeamsWeb/publicApi/createPublicApi';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toError } from '@shared/utils/errors';
import { isRegistrationBenchmarkDiagnosticsEnabled } from '@/core/diagnostics/registration';

type RegistrationIframe = Pick<
  WalletIframeCoordinator,
  'requireRouter' | 'getTransportDiagnosticsSnapshot'
>;

export function createApplicationRegistrationCommands(
  walletIframe: RegistrationIframe,
): WalletRegistrationCommands {
  return {
    registerWallet: registerWallet.bind(null, walletIframe),
    getNearAccountState: getNearAccountState.bind(null, walletIframe),
    addSigner: addSigner.bind(null, walletIframe),
    addPasskey: addPasskey.bind(null, walletIframe),
    removeAuthMethod: removeAuthMethod.bind(null, walletIframe),
    addEmail: addEmail.bind(null, walletIframe),
  };
}

async function registerWallet(
  walletIframe: RegistrationIframe,
  args: WalletRegistrationCommand,
): Promise<RegistrationResult> {
  try {
    const walletRouterId =
      args.wallet.kind === 'provided' ? String(args.wallet.walletId) : undefined;
    const router = await walletIframe.requireRouter();
    emitTransportTiming(walletIframe, {
      operation: 'registerWallet',
      walletId: walletRouterId ?? null,
    });
    const res = await router.registerWallet(args);
    await args.options?.afterCall?.(true, res);
    return res;
  } catch (error: unknown) {
    const e = toError(error);
    await args.options?.onError?.(e);
    await args.options?.afterCall?.(false, undefined, e);
    throw e;
  }
}

async function getNearAccountState(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['getNearAccountState']>[0],
): ReturnType<RegistrationCapability['getNearAccountState']> {
  const walletId = toWalletId(args.walletId);

  const router = await walletIframe.requireRouter();
  return await router.getNearAccountState({ walletId });
}

async function addSigner(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['addSigner']>[0],
): Promise<RegistrationResult> {
  try {
    const router = await walletIframe.requireRouter();
    const res = await router.addSigner(args);
    await args.options?.afterCall?.(true, res);
    return res;
  } catch (error: unknown) {
    const e = toError(error);
    await args.options?.onError?.(e);
    await args.options?.afterCall?.(false);
    throw e;
  }
}

async function addPasskey(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['addPasskey']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['addPasskey']>>> {
  try {
    const router = await walletIframe.requireRouter();
    const result = await router.addPasskey(args);
    await args.options?.afterCall?.(true, result);
    return result;
  } catch (error: unknown) {
    const normalized = toError(error);
    await args.options?.onError?.(normalized);
    await args.options?.afterCall?.(false);
    throw normalized;
  }
}

async function removeAuthMethod(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['removeAuthMethod']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['removeAuthMethod']>>> {
  const router = await walletIframe.requireRouter();
  return await router.removeAuthMethod(args);
}

async function addEmail(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['addEmail']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['addEmail']>>> {
  try {
    const router = await walletIframe.requireRouter();
    const result = await router.addEmail(args);
    await args.options?.afterCall?.(true, result);
    return result;
  } catch (error: unknown) {
    const normalized = toError(error);
    await args.options?.onError?.(normalized);
    await args.options?.afterCall?.(false);
    throw normalized;
  }
}
function emitTransportTiming(
  walletIframe: RegistrationIframe,
  input: {
    operation: 'registerWallet';
    walletId: string | null;
  },
): void {
  if (!isRegistrationBenchmarkDiagnosticsEnabled()) return;
  const diagnostics = walletIframe.getTransportDiagnosticsSnapshot();
  if (!diagnostics) return;
  const { kind: transportKind, ...timings } = diagnostics;
  console.info('[Registration] wallet iframe transport timing summary', {
    kind: 'wallet_iframe_registration_transport_timing_v1',
    operation: input.operation,
    walletId: input.walletId,
    transportKind,
    ...timings,
  });
}
