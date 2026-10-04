import { resolveEvmChainTarget } from './chainTargets';
import type { CurrentWalletResolver } from './currentWallet';
import type { EvmFamilyCommands } from './evmFamilyCommands';
import type { EvmSignerCapability, TempoSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { buildEvmBootstrapArgs } from '@/SeamsWeb/operations/evm';
import {
  CAPABILITY_KINDS,
  EVM_ECDSA_MPC_OPERATION_KINDS,
} from '@shared/authorization/capabilityKinds';
import { requireBrowserCapabilityOperation } from './capabilitySelection';

type EvmDependencies = {
  configs: SeamsConfigsReadonly;
  currentWallet: CurrentWalletResolver;
  commands: EvmFamilyCommands;
  evmFamily: TempoSignerCapability;
};

export function createEvmSignerCapability(deps: EvmDependencies): EvmSignerCapability {
  const signer = new EvmSigner(deps);
  return {
    executeTransaction: deps.evmFamily.executeEvmFamilyTransaction,
    advanced: deps.evmFamily.advanced,
    signTransaction: signer.signTransaction.bind(signer),
    registerEvmWallet: deps.commands.registerEvmWallet,
    bootstrapEcdsaSession: signer.bootstrapEcdsaSession.bind(signer),
  };
}

class EvmSigner {
  constructor(private readonly deps: EvmDependencies) {}

  async signTransaction(
    args: Parameters<EvmSignerCapability['signTransaction']>[0],
  ): ReturnType<EvmSignerCapability['signTransaction']> {
    const chainTarget = resolveEvmChainTarget(this.deps.configs.network.chains, args.chainTarget);
    const walletSession = await this.deps.currentWallet.walletSession(args.walletSession);
    requireBrowserCapabilityOperation(this.deps.configs, {
      capabilityKind: CAPABILITY_KINDS.evmEcdsaMpcSigning,
      operationKind: EVM_ECDSA_MPC_OPERATION_KINDS.signTransaction,
      chainTarget,
    });
    const result = await this.deps.commands.signEvmFamily({
      walletSession,
      request: args.request,
      chainTarget,
      options: args.options,
    });
    if (result.chain !== 'evm' || result.kind !== 'eip1559') {
      throw new Error(`[EVM capability] expected EVM result, received ${result.chain}`);
    }
    return result;
  }

  async bootstrapEcdsaSession(
    args: Parameters<EvmSignerCapability['bootstrapEcdsaSession']>[0],
  ): ReturnType<EvmSignerCapability['bootstrapEcdsaSession']> {
    return await this.deps.commands.bootstrapEcdsaSession(
      buildEvmBootstrapArgs(this.deps.configs, args),
    );
  }
}
