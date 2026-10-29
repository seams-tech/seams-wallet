import {
  readVoiceIdAvailability,
  writeAuthMethodEnabled,
  hasOtherActiveAuthMethod,
  removeVoiceEnrollments,
} from '@/core/authMethods/availability';
import { walletAuthMethodPluginEnabled } from '@/core/authMethods/plugins';
import type { WalletSessionCommands } from '@/SeamsWeb/publicApi/auth';
import type {
  RegistrationCapability,
  RegistrationWebContext,
} from '@/SeamsWeb/signingSurface/types';
import type { RegistrationResult } from '@/core/types/seams';
import type {
  WalletRegistrationCommand,
  WalletRegistrationCommands,
} from '@/SeamsWeb/publicApi/createPublicApi';
import {
  addSigner as addSignerWithUnifiedCeremony,
  registerWallet as registerWalletWithUnifiedCeremony,
} from '@/SeamsWeb/operations/registration/registration';
import { addPasskeyWalletAuthMethod } from '@/SeamsWeb/operations/authMethods/passkey/addPasskey';
import { revokeWalletAuthMethodOperation } from '@/SeamsWeb/operations/authMethods/revokeAuthMethod';
import { addEmailOtpWalletAuthMethod } from '@/SeamsWeb/operations/authMethods/emailOtp/addEmailOtp';
import { readNearProvisioningState } from '@/core/signingEngine/flows/registration/nearProvisioningRegistry';
import { cloneAuthenticatorOptions } from '@/core/types/authenticatorOptions';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import { loadWalletAuthMethodHostPlugin } from '@/core/authMethods/hostRegistry';

export function createWalletHostRegistrationCommands(
  getContext: () => RegistrationWebContext,
  auth: Pick<WalletSessionCommands, 'lock' | 'getSession'>,
): WalletRegistrationCommands {
  return {
    registerWallet: registerWallet.bind(null, getContext),
    getNearAccountState: getNearAccountState.bind(null, getContext),
    addSigner: addSigner.bind(null, getContext),
    addPasskey: addPasskey.bind(null, getContext),
    activateAuthMethod: activateAuthMethod.bind(null, getContext),
    getAuthMethodAvailability: getAuthMethodAvailability.bind(null, getContext),
    setAuthMethodEnabled: setAuthMethodEnabled.bind(null, getContext, auth),
    removeAuthMethod: removeAuthMethod.bind(null, getContext),
    addEmail: addEmail.bind(null, getContext),
  };
}

async function registerWallet(
  getContext: () => RegistrationWebContext,
  args: WalletRegistrationCommand,
): Promise<RegistrationResult> {
  const context = getContext();
  return await registerWalletWithUnifiedCeremony({
    context,
    completion: args.completion,
    authMethod: args.authMethod,
    wallet: args.wallet,
    signerSelection: args.signerSelection,
    options: args.options || {},
    authenticatorOptions: cloneAuthenticatorOptions(context.configs.webauthn.authenticatorOptions),
  });
}

async function getNearAccountState(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['getNearAccountState']>[0],
): ReturnType<RegistrationCapability['getNearAccountState']> {
  const walletId = toWalletId(args.walletId);

  const live = readNearProvisioningState(walletId);
  if (live) return live;
  return await getContext().signingEngine.getWalletNearProvisioningState(walletId);
}

async function addSigner(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['addSigner']>[0],
): Promise<RegistrationResult> {
  return await addSignerWithUnifiedCeremony({
    context: getContext(),
    walletId: args.walletId,
    rpId: args.rpId,
    signerSelection: args.signerSelection,
    options: args.options || {},
  });
}

async function addPasskey(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['addPasskey']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['addPasskey']>>> {
  return await addPasskeyWalletAuthMethod({
    context: getContext(),
    walletId: args.walletId,
    rpId: args.rpId,
    options: args.options,
  });
}

async function activateAuthMethod(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['activateAuthMethod']>[0],
): ReturnType<RegistrationCapability['activateAuthMethod']> {
  const context = getContext();
  const plugin = await loadWalletAuthMethodHostPlugin(context.configs.authMethods, args.method);
  return await plugin.activate({ context, walletId: toWalletId(args.walletId) });
}

async function removeAuthMethod(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['removeAuthMethod']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['removeAuthMethod']>>> {
  const result = await revokeWalletAuthMethodOperation({
    context: getContext(),
    walletId: args.walletId,
    walletAuthMethodId: args.walletAuthMethodId,
  });
  if (result.authMethod.kind === 'voiceid') {
    await removeVoiceEnrollments(result.walletId, result.walletAuthMethodId);
  }
  return result;
}

async function addEmail(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['addEmail']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['addEmail']>>> {
  return await addEmailOtpWalletAuthMethod({
    context: getContext(),
    walletId: args.walletId,
    emailAddress: args.emailAddress,
    options: args.options,
  });
}

async function getAuthMethodAvailability(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['getAuthMethodAvailability']>[0],
): ReturnType<RegistrationCapability['getAuthMethodAvailability']> {
  if (!walletAuthMethodPluginEnabled(getContext().configs.authMethods, args.method))
    throw new Error('Enable the authentication plugin in the SDK first.');
  return readVoiceIdAvailability(toWalletId(args.walletId));
}
async function setAuthMethodEnabled(
  getContext: () => RegistrationWebContext,
  auth: Pick<WalletSessionCommands, 'lock' | 'getSession'>,
  args: Parameters<RegistrationCapability['setAuthMethodEnabled']>[0],
): ReturnType<RegistrationCapability['setAuthMethodEnabled']> {
  if (typeof args.enabled !== 'boolean')
    throw new Error('Authentication method availability must be a boolean.');
  const walletId = toWalletId(args.walletId);
  const availability = await getAuthMethodAvailability(getContext, args);
  if (availability.kind === 'not_enrolled') throw new Error('Enroll VoiceID before enabling it.');
  const session = await auth.getSession(walletId);
  if (
    session.authentication.kind !== 'authenticated' ||
    session.authentication.walletId !== walletId
  )
    throw new Error('Unlock this wallet before managing VoiceID.');
  if (args.enabled && session.authentication.authMethod === 'voiceid')
    throw new Error('Unlock with a passkey or Email OTP before enabling VoiceID.');
  if (!args.enabled && !(await hasOtherActiveAuthMethod(walletId, availability.walletAuthMethodId)))
    throw new Error('Add another authentication method before turning off VoiceID.');
  await writeAuthMethodEnabled(walletId, availability.walletAuthMethodId, args.enabled);
  if (!args.enabled && session.authentication.authMethod === 'voiceid') await auth.lock();
  return args.enabled
    ? { kind: 'enabled', walletAuthMethodId: availability.walletAuthMethodId }
    : { kind: 'disabled', walletAuthMethodId: availability.walletAuthMethodId };
}
