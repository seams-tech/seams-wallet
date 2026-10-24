import { prepareOwnerNearTransaction, resumeOwnerNearTransaction } from './ownerNearOperation';
import { accountExists } from '@/core/rpcClients/near/accountExists';
import type { NearClient } from '@/core/rpcClients/near/NearClient';
import type { NearSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { toError } from '@shared/utils/errors';
import { nearTransactionFailure } from '@/core/signingEngine/nearTransactionSubmission';
import type { CurrentWalletResolver } from './currentWallet';
import type { NearCommands } from './nearCommands';
import { parseNearTransactionSignerRequest } from '@/core/signingEngine/chains/near/transactionSigner';
import { requireBrowserCapabilityOperation } from './capabilitySelection';
import {
  CAPABILITY_KINDS,
  NEAR_ED25519_MPC_OPERATION_KINDS,
  NEAR_ML_DSA_65_MPC_OPERATION_KINDS,
} from '@shared/authorization/capabilityKinds';
import {
  delegateRelayerAuthFromConfigs,
  sendDelegateAction as sendDelegateActionViaRelayerCore,
} from '@/SeamsWeb/operations/near/delegateAction';

type NearDependencies = {
  configs: SeamsConfigsReadonly;
  nearClient: NearClient;
  currentWallet: CurrentWalletResolver;
  commands: NearCommands;
};

export function createNearSignerCapability(deps: NearDependencies): NearSignerCapability {
  const signer = new NearSigner(deps);
  return {
    prepareOwnerTransaction: prepareOwnerNearTransaction.bind(null, deps.commands.ownerOperation),
    resumeOwnerTransaction: resumeOwnerNearTransaction.bind(null, deps.commands.ownerOperation),
    accountExists: accountExists.bind(null, deps.nearClient),
    getDefaultSigner: signer.getDefaultSigner.bind(signer),
    setDefaultSigner: signer.setDefaultSigner.bind(signer),
    getMlDsaSigners: signer.getMlDsaSigners.bind(signer),
    signAndSendTransaction: signer.signAndSendTransaction.bind(signer),
    signTransaction: signer.signTransaction.bind(signer),
    sendTransaction: signer.sendTransaction.bind(signer),
    signDelegateAction: signer.signDelegateAction.bind(signer),
    signMessage: signer.signMessage.bind(signer),
    sendDelegateAction: signer.sendDelegateAction.bind(signer),
    signAndSendDelegateAction: signer.signAndSendDelegateAction.bind(signer),
  };
}

function ignoreSigningCompletion(): void {}

class NearSigner {
  constructor(private readonly deps: NearDependencies) {}

  async getDefaultSigner(input: Parameters<NearSignerCapability['getDefaultSigner']>[0]) {
    return this.deps.commands.getDefaultSigner(await this.deps.currentWallet.nearSubject(input));
  }
  async setDefaultSigner(input: Parameters<NearSignerCapability['setDefaultSigner']>[0]) {
    const subject = await this.deps.currentWallet.nearSubject(input);
    const { parseNearSignerPreference } = await import('@/core/types/nearSigningKeys');
    return this.deps.commands.setDefaultSigner({
      walletSession: subject.walletSession,
      nearAccount: subject.nearAccount,
      preference: parseNearSignerPreference(input.preference),
    });
  }
  async getMlDsaSigners(input: Parameters<NearSignerCapability['getMlDsaSigners']>[0]) {
    const walletSession = await this.deps.currentWallet.walletSession(input.walletSession);
    return this.deps.commands.getMlDsaSigners({ walletSession });
  }

  async signAndSendTransaction(
    rawArgs: Parameters<NearSignerCapability['signAndSendTransaction']>[0],
  ): ReturnType<NearSignerCapability['signAndSendTransaction']> {
    let subject: Awaited<ReturnType<CurrentWalletResolver['nearSubject']>>;
    let signer: ReturnType<typeof parseNearTransactionSignerRequest>;
    try {
      subject = await this.deps.currentWallet.nearSubject(rawArgs);
      signer = parseNearTransactionSignerRequest(rawArgs.signer ?? { kind: 'wallet_default' });
      requireBrowserCapabilityOperation(this.deps.configs, {
        capabilityKind:
          signer.kind === 'near_ml_dsa_65'
            ? CAPABILITY_KINDS.nearMlDsa65MpcSigning
            : CAPABILITY_KINDS.nearEd25519MpcSigning,
        operationKind: NEAR_ML_DSA_65_MPC_OPERATION_KINDS.signTransaction,
      });
    } catch (error) {
      return nearTransactionFailure(error, 'not_submitted');
    }
    return this.deps.commands.signAndSendTransaction({
      ...rawArgs,
      ...subject,
      options: rawArgs.options ?? {},
      signer,
    });
  }

  async signTransaction(
    rawArgs: Parameters<NearSignerCapability['signTransaction']>[0],
  ): ReturnType<NearSignerCapability['signTransaction']> {
    const args = {
      ...rawArgs,
      ...(await this.deps.currentWallet.nearSubject(rawArgs)),
      options: rawArgs.options ?? {},
      signer: parseNearTransactionSignerRequest(rawArgs.signer ?? { kind: 'wallet_default' }),
    };
    requireBrowserCapabilityOperation(this.deps.configs, {
      capabilityKind:
        args.signer.kind === 'near_ml_dsa_65'
          ? CAPABILITY_KINDS.nearMlDsa65MpcSigning
          : CAPABILITY_KINDS.nearEd25519MpcSigning,
      operationKind: NEAR_ML_DSA_65_MPC_OPERATION_KINDS.signTransaction,
    });
    return await this.deps.commands.signTransaction(args);
  }

  async sendTransaction(
    rawArgs: Parameters<NearSignerCapability['sendTransaction']>[0],
  ): ReturnType<NearSignerCapability['sendTransaction']> {
    let subject: Awaited<ReturnType<CurrentWalletResolver['nearSubject']>>;
    try {
      subject = await this.deps.currentWallet.nearSubject(rawArgs);
    } catch (error) {
      return nearTransactionFailure(error, 'not_submitted');
    }
    return this.deps.commands.sendTransaction({
      ...rawArgs,
      ...subject,
      options: rawArgs.options ?? {},
    });
  }

  async signDelegateAction(
    rawArgs: Parameters<NearSignerCapability['signDelegateAction']>[0],
  ): ReturnType<NearSignerCapability['signDelegateAction']> {
    const args = {
      ...rawArgs,
      ...(await this.deps.currentWallet.nearSubject(rawArgs)),
      options: rawArgs.options ?? {},
    };
    requireBrowserCapabilityOperation(this.deps.configs, {
      capabilityKind: CAPABILITY_KINDS.nearEd25519MpcSigning,
      operationKind: NEAR_ED25519_MPC_OPERATION_KINDS.signDelegateAction,
    });
    return await this.deps.commands.signDelegateAction(args);
  }

  async signMessage(
    rawArgs: Parameters<NearSignerCapability['signMessage']>[0],
  ): ReturnType<NearSignerCapability['signMessage']> {
    const args = {
      ...rawArgs,
      ...(await this.deps.currentWallet.nearSubject(rawArgs)),
      options: rawArgs.options ?? {},
    };
    requireBrowserCapabilityOperation(this.deps.configs, {
      capabilityKind: CAPABILITY_KINDS.nearEd25519MpcSigning,
      operationKind: NEAR_ED25519_MPC_OPERATION_KINDS.signNep413Message,
    });
    return await this.deps.commands.signMessage(args);
  }
  async sendDelegateAction(
    args: Parameters<NearSignerCapability['sendDelegateAction']>[0],
  ): ReturnType<NearSignerCapability['sendDelegateAction']> {
    const base = args.relayerUrl.replace(/\/+$/, '');
    const route = (
      this.deps.configs.network.relayer?.routes?.delegateAction || '/signed-delegate'
    ).replace(/^\/?/, '/');
    return await sendDelegateActionViaRelayerCore({
      url: `${base}${route}`,
      payload: {
        hash: args.hash,
        signedDelegate: args.signedDelegate,
      },
      auth: delegateRelayerAuthFromConfigs(this.deps.configs),
      signal: args.signal,
      options: args.options,
    });
  }
  async signAndSendDelegateAction(
    rawArgs: Parameters<NearSignerCapability['signAndSendDelegateAction']>[0],
  ): ReturnType<NearSignerCapability['signAndSendDelegateAction']> {
    // `walletSession`/`nearAccount` are optional on the public surface: omitted,
    // they resolve to the authenticated wallet. `options` normalizes to `{}` so
    // every hook site below can stay unconditional.
    const args = {
      ...rawArgs,
      ...(await this.deps.currentWallet.nearSubject(rawArgs)),
      options: rawArgs.options ?? {},
    };
    const signOptions = {
      signerSlot: args.options.signerSlot,
      onEvent: args.options.onEvent,
      onError: args.options.onError,
      waitUntil: args.options.waitUntil,
      confirmationConfig: args.options.confirmationConfig,
      confirmerText: args.options.confirmerText,
      afterCall: ignoreSigningCompletion,
    };
    let signResult;
    try {
      signResult = await this.signDelegateAction({
        walletSession: args.walletSession,
        nearAccount: args.nearAccount,
        delegate: args.delegate,
        options: signOptions,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
    const relayOptions = {
      onEvent: args.options.onEvent,
      onError: args.options.onError,
    };
    let relayResult;
    try {
      relayResult = await this.sendDelegateAction({
        relayerUrl: args.relayerUrl,
        hash: signResult.hash,
        signedDelegate: signResult.signedDelegate,
        signal: args.signal,
        options: relayOptions,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
    const combined = {
      signResult,
      relayResult,
    };
    if (relayResult.ok !== false) {
      await args.options?.afterCall?.(true, combined);
    } else {
      const relayError = toError(relayResult.error || 'Delegate relay failed');
      await args.options?.afterCall?.(false, undefined, relayError);
    }
    return combined;
  }
}
