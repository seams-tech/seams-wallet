import type { RegistrationCapability } from '@/SeamsWeb/signingSurface/types';
import type { RegistrationResult } from '@/core/types/seams';
import type { WalletRegistrationCommands } from '@/SeamsWeb/publicApi/createPublicApi';
import type { WalletIframeCoordinator } from '@/SeamsWeb/walletIframe/coordinator';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { toError } from '@shared/utils/errors';
import { isRegistrationBenchmarkDiagnosticsEnabled } from '@/core/diagnostics/registration';

type RegistrationIframe = Pick<
  WalletIframeCoordinator,
  'requireRouter' | 'init' | 'getTransportDiagnosticsSnapshot'
>;

export function createApplicationRegistrationCommands(
  walletIframe: RegistrationIframe,
): WalletRegistrationCommands {
  return {
    registerWallet: registerWallet.bind(null, walletIframe),
    getNearProvisioningState: getNearProvisioningState.bind(null, walletIframe),
    resumePendingEcdsaRegistration: resumePendingEcdsaRegistration.bind(null, walletIframe),
    addWalletSigner: addWalletSigner.bind(null, walletIframe),
    addPasskey: addPasskey.bind(null, walletIframe),
    revokeAuthMethod: revokeAuthMethod.bind(null, walletIframe),
    addEmailOtp: addEmailOtp.bind(null, walletIframe),
  };
}

async function registerWallet(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['registerWallet']>[0],
): Promise<RegistrationResult> {
  try {
    const walletRouterId =
      args.wallet.kind === 'provided' ? String(args.wallet.walletId) : undefined;
    const router = await walletIframe.requireRouter(walletRouterId);
    emitTransportTiming(walletIframe, {
      operation: 'registerWallet',
      walletId: walletRouterId ?? null,
    });
    const res = await router.registerWallet(args);
    const registeredWalletId = res.success ? String(res.walletId || '').trim() : '';
    if (registeredWalletId) {
      void refreshRegisteredSession(walletIframe, registeredWalletId);
    }
    await args.options?.afterCall?.(true, res);
    return res;
  } catch (error: unknown) {
    const e = toError(error);
    await args.options?.onError?.(e);
    await args.options?.afterCall?.(false);
    throw e;
  }
}

async function getNearProvisioningState(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['getNearProvisioningState']>[0],
): ReturnType<RegistrationCapability['getNearProvisioningState']> {
  const walletId = toWalletId(args.walletId);

  const router = await walletIframe.requireRouter(String(walletId));
  return await router.getNearProvisioningState({ walletId });
}

async function resumePendingEcdsaRegistration(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['resumePendingEcdsaRegistration']>[0],
): ReturnType<RegistrationCapability['resumePendingEcdsaRegistration']> {
  const router = await walletIframe.requireRouter(String(args.walletId));
  return await router.resumePendingEcdsaRegistration(args);
}

async function addWalletSigner(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['addWalletSigner']>[0],
): Promise<RegistrationResult> {
  try {
    const router = await walletIframe.requireRouter(String(args.walletId || ''));
    const res = await router.addWalletSigner(args);
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
    const router = await walletIframe.requireRouter(String(args.walletId || ''));
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

async function revokeAuthMethod(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['revokeAuthMethod']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['revokeAuthMethod']>>> {
  const router = await walletIframe.requireRouter(String(args.walletId || ''));
  return await router.revokeAuthMethod(args);
}

async function addEmailOtp(
  walletIframe: RegistrationIframe,
  args: Parameters<RegistrationCapability['addEmailOtp']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['addEmailOtp']>>> {
  try {
    const router = await walletIframe.requireRouter(String(args.walletId || ''));
    const result = await router.addEmailOtp(args);
    await args.options?.afterCall?.(true, result);
    return result;
  } catch (error: unknown) {
    const normalized = toError(error);
    await args.options?.onError?.(normalized);
    await args.options?.afterCall?.(false);
    throw normalized;
  }
}
async function refreshRegisteredSession(
  walletIframe: RegistrationIframe,
  walletId: string,
): Promise<void> {
  try {
    await walletIframe.init(walletId);
  } catch {}
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
