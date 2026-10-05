import type {
  RegistrationCapability,
  RegistrationWebContext,
} from '@/SeamsWeb/signingSurface/types';
import type { RegistrationResult } from '@/core/types/seams';
import type { WalletRegistrationCommands } from '@/SeamsWeb/publicApi/createPublicApi';
import {
  addWalletSigner as addWalletSignerWithUnifiedCeremony,
  registerWallet as registerWalletWithUnifiedCeremony,
} from '@/SeamsWeb/operations/registration/registration';
import { resumePendingEcdsaRegistrationFromStoredCommit } from '@/SeamsWeb/operations/registration/pendingRegistrationRecovery';
import { addPasskeyWalletAuthMethod } from '@/SeamsWeb/operations/authMethods/passkey/addPasskey';
import { revokeWalletAuthMethodOperation } from '@/SeamsWeb/operations/authMethods/revokeAuthMethod';
import { addEmailOtpWalletAuthMethod } from '@/SeamsWeb/operations/authMethods/emailOtp/addEmailOtp';
import { readNearProvisioningState } from '@/core/signingEngine/flows/registration/nearProvisioningRegistry';
import { cloneAuthenticatorOptions } from '@/core/types/authenticatorOptions';
import { toWalletId } from '@/core/signingEngine/interfaces/ecdsaChainTarget';

export function createWalletHostRegistrationCommands(
  getContext: () => RegistrationWebContext,
): WalletRegistrationCommands {
  return {
    registerWallet: registerWallet.bind(null, getContext),
    getNearAccountState: getNearAccountState.bind(null, getContext),
    resumePendingEcdsaRegistration: resumePendingEcdsaRegistration.bind(null, getContext),
    addWalletSigner: addWalletSigner.bind(null, getContext),
    addPasskey: addPasskey.bind(null, getContext),
    revokeAuthMethod: revokeAuthMethod.bind(null, getContext),
    addEmailOtp: addEmailOtp.bind(null, getContext),
  };
}

async function registerWallet(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['registerWallet']>[0],
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

async function resumePendingEcdsaRegistration(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['resumePendingEcdsaRegistration']>[0],
): ReturnType<RegistrationCapability['resumePendingEcdsaRegistration']> {
  const relayerUrl = String(getContext().configs.network.relayer?.url || '').trim();
  if (!relayerUrl) throw new Error('pending ECDSA registration recovery requires a relayer URL');
  return await resumePendingEcdsaRegistrationFromStoredCommit({
    relayerUrl,
    request: args,
    signingSurface: getContext().signingEngine,
  });
}

async function addWalletSigner(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['addWalletSigner']>[0],
): Promise<RegistrationResult> {
  return await addWalletSignerWithUnifiedCeremony({
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

async function revokeAuthMethod(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['revokeAuthMethod']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['revokeAuthMethod']>>> {
  return await revokeWalletAuthMethodOperation({
    context: getContext(),
    walletId: args.walletId,
    walletAuthMethodId: args.walletAuthMethodId,
  });
}

async function addEmailOtp(
  getContext: () => RegistrationWebContext,
  args: Parameters<RegistrationCapability['addEmailOtp']>[0],
): Promise<Awaited<ReturnType<RegistrationCapability['addEmailOtp']>>> {
  return await addEmailOtpWalletAuthMethod({
    context: getContext(),
    walletId: args.walletId,
    emailAddress: args.emailAddress,
    options: args.options,
  });
}
