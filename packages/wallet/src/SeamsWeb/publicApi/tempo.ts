import { createEvmSignerCapability } from './evm';
import type { ExecuteEvmFamilyTransactionArgs, ExecuteEvmFamilyTransactionResult } from './types';
import { resolveConfiguredChainTarget, resolveTempoChainTarget } from './chainTargets';
import type { CurrentWalletResolver, WalletSessionInput } from './currentWallet';
import type { EvmFamilyCommands } from './evmFamilyCommands';
import type { TempoSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import {
  executeEvmFamilyTransactionLifecycle,
  withResolvedChainId,
  type EvmFamilyTransactionSignArgs,
} from '@/SeamsWeb/operations/tempo/executeEvmFamilyTransaction';
import {
  CAPABILITY_KINDS,
  EVM_ECDSA_MPC_OPERATION_KINDS,
} from '@shared/authorization/capabilityKinds';
import { requireBrowserCapabilityOperation } from './capabilitySelection';
import {
  getTempoFeeTokenPreference,
  setTempoFeeTokenPreference,
  validateConfiguredTempoFeeToken,
} from '@/SeamsWeb/operations/tempo/feeTokenPreference';

type TempoDependencies = {
  configs: SeamsConfigsReadonly;
  currentWallet: CurrentWalletResolver;
  commands: EvmFamilyCommands;
};

type CapabilitySignEvmFamilyArgs = Omit<EvmFamilyTransactionSignArgs, 'walletSession'> & {
  walletSession?: WalletSessionInput;
};

export function createEvmFamilyCapabilities(deps: TempoDependencies) {
  const signer = new EvmFamilySigner(deps);
  const commands = deps.commands;
  const advanced = {
    reportBroadcastAccepted: commands.reportBroadcastAccepted,
    reportBroadcastRejected: commands.reportBroadcastRejected,
    reportFinalized: commands.reportFinalized,
    reportDroppedOrReplaced: commands.reportDroppedOrReplaced,
    reconcileNonceLane: commands.reconcileNonceLane,
  };
  const signTempo = signer.signTempo.bind(signer);
  const executeEvmFamilyTransaction = signer.executeEvmFamilyTransaction.bind(signer);
  const tempo: TempoSignerCapability = {
    signTransaction: signTempo,
    signAndSendTransaction: executeEvmFamilyTransaction,
    advanced,
    getFeeToken: getTempoFeeTokenPreference.bind(null, deps.configs.network.chains),
    validateFeeToken: validateConfiguredTempoFeeToken.bind(null, deps.configs.network.chains),
    setFeeToken: setTempoFeeTokenPreference.bind(null, {
      chains: deps.configs.network.chains,
      execute: executeEvmFamilyTransaction,
    }),
  };
  return {
    tempo,
    evm: createEvmSignerCapability({
      ...deps,
      advanced,
      signAndSendTransaction: executeEvmFamilyTransaction,
    }),
  };
}

class EvmFamilySigner {
  constructor(private readonly deps: TempoDependencies) {}

  async signEvmFamily(args: CapabilitySignEvmFamilyArgs) {
    const chainTarget = resolveConfiguredChainTarget(
      this.deps.configs.network.chains,
      args.chainTarget,
    );
    const walletSession = await this.deps.currentWallet.walletSession(args.walletSession);
    requireBrowserCapabilityOperation(this.deps.configs, {
      capabilityKind: CAPABILITY_KINDS.evmEcdsaMpcSigning,
      operationKind: EVM_ECDSA_MPC_OPERATION_KINDS.signTransaction,
      chainTarget,
    });
    return await this.deps.commands.signEvmFamily({
      walletSession,
      chainTarget,
      request: args.request,
      options: args.options,
    });
  }

  async signTempo(
    args: Parameters<TempoSignerCapability['signTransaction']>[0],
  ): ReturnType<TempoSignerCapability['signTransaction']> {
    const result = await this.signEvmFamily({
      ...args,
      chainTarget: resolveTempoChainTarget(this.deps.configs.network.chains, args.chainTarget),
    });
    if (result.chain !== 'tempo' || result.kind !== 'tempoTransaction') {
      throw new Error(`[Tempo capability] expected Tempo result, received ${result.chain}`);
    }
    return result;
  }

  async executeEvmFamilyTransaction(
    args: ExecuteEvmFamilyTransactionArgs,
  ): Promise<ExecuteEvmFamilyTransactionResult> {
    const chainTarget = resolveConfiguredChainTarget(
      this.deps.configs.network.chains,
      args.chainTarget,
    );
    const walletSession = await this.deps.currentWallet.walletSession(args.walletSession);
    return await executeEvmFamilyTransactionLifecycle({
      lifecycle: { ...this.deps.commands, signEvmFamily: this.signEvmFamily.bind(this) },
      chains: this.deps.configs.network.chains,
      input: {
        ...args,
        chainTarget,
        walletSession,
        request: withResolvedChainId(args.request, chainTarget),
      },
    });
  }
}
