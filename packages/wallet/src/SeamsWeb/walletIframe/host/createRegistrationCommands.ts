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
import { walletAuthMethodPluginEnabled } from '@/core/authMethods/plugins';

export function createWalletHostRegistrationCommands(
  getContext: () => RegistrationWebContext,
): WalletRegistrationCommands {
  return {
    registerWallet: registerWallet.bind(null, getContext),
    getNearAccountState: getNearAccountState.bind(null, getContext),
    addSigner: addSigner.bind(null, getContext),
    addPasskey: addPasskey.bind(null, getContext),
    addVoiceId: addVoiceId.bind(null, getContext),
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

async function addVoiceId(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['addVoiceId']>[0],
): ReturnType<RegistrationCapability['addVoiceId']> {
  const context = getContext();
  if (!walletAuthMethodPluginEnabled(context.configs.authMethods, 'voiceid')) {
    throw new Error('Enable the VoiceID auth method plugin before activation.');
  }
  const { addVoiceIdWalletAuthMethod } = await import(
    '@/SeamsWeb/operations/authMethods/voiceId/addVoiceId'
  );
  return await addVoiceIdWalletAuthMethod({ context, walletId: args.walletId });
}

async function removeAuthMethod(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['removeAuthMethod']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['removeAuthMethod']>>> {
  return await revokeWalletAuthMethodOperation({
    context: getContext(),
    walletId: args.walletId,
    walletAuthMethodId: args.walletAuthMethodId,
  });
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
