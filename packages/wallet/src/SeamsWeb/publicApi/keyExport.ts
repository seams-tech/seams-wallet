import type { SeamsConfigsReadonly } from '@/core/types/seams';
import type {
  ExportKeyInput,
  KeyExportCapability,
  KeyExportOutcome,
} from '@/SeamsWeb/publicApi/types';
import type {
  SigningEngineExportKeypairWithUIInput,
  SigningEngineResolveExactKeyExportLaneInput as ResolveExactKeyExportLaneInput,
  SigningEngineResolveExactKeyExportLaneResult as ResolveExactKeyExportLaneResult,
} from '@/core/signingEngine/flows/recovery/public';
import {
  CAPABILITY_KINDS,
  EVM_ECDSA_MPC_OPERATION_KINDS,
  NEAR_ED25519_MPC_OPERATION_KINDS,
} from '@shared/authorization/capabilityKinds';
import { requireBrowserCapabilityOperation } from '@/SeamsWeb/publicApi/capabilitySelection';
import { resolveConfiguredChainTarget } from '@/SeamsWeb/publicApi/chainTargets';
import type { CurrentWalletResolver } from '@/SeamsWeb/publicApi/currentWallet';

/**
 * Domain methods sit below the public boundary: `options` has already been
 * normalized, so they take the signing-engine input shape.
 */
export type KeyExportDomainMethods = {
  resolveExactKeyExportLane(
    input: ResolveExactKeyExportLaneInput,
  ): Promise<ResolveExactKeyExportLaneResult>;
  exportKeypairWithUI(input: SigningEngineExportKeypairWithUIInput): Promise<void>;
};

export function requireKeyExportCapability(
  configs: SeamsConfigsReadonly,
  input: ResolveExactKeyExportLaneInput,
): void {
  switch (input.kind) {
    case 'ed25519':
      requireBrowserCapabilityOperation(configs, {
        capabilityKind: CAPABILITY_KINDS.nearEd25519MpcSigning,
        operationKind: NEAR_ED25519_MPC_OPERATION_KINDS.exportKey,
      });
      return;
    case 'ecdsa':
      requireBrowserCapabilityOperation(configs, {
        capabilityKind: CAPABILITY_KINDS.evmEcdsaMpcSigning,
        operationKind: EVM_ECDSA_MPC_OPERATION_KINDS.exportKey,
        chainTarget: input.chainTarget,
      });
      return;
  }
}

type KeyExportDependencies = {
  configs: SeamsConfigsReadonly;
  currentWallet: CurrentWalletResolver;
  domain: KeyExportDomainMethods;
};

/** Resolve an export lane and open its viewer without exposing internal steps. */
export function createKeyExportCapability(deps: KeyExportDependencies): KeyExportCapability {
  return { exportKey: exportKey.bind(null, deps) };
}

async function exportKey(
  deps: KeyExportDependencies,
  input: ExportKeyInput,
): Promise<KeyExportOutcome> {
  const options = input.options ?? {};
  if (input.kind === 'ed25519') {
    const subject = await deps.currentWallet.nearSubject(input);
    const laneInput = { kind: 'ed25519' as const, ...subject };
    requireKeyExportCapability(deps.configs, laneInput);
    const lane = await deps.domain.resolveExactKeyExportLane(laneInput);
    if (lane.kind !== 'ed25519') {
      throw new Error(`[key-export] expected an Ed25519 lane, received ${lane.kind}`);
    }
    await deps.domain.exportKeypairWithUI({
      ...laneInput,
      laneIdentity: lane.laneIdentity,
      materialActivation: lane.materialActivation,
      options,
    });
    return { kind: 'exported' };
  }
  const walletSession = await deps.currentWallet.walletSession(input.walletSession);
  const chainTarget = resolveConfiguredChainTarget(
    deps.configs.network.chains,
    input.chainTarget,
  );
  const laneInput = { kind: 'ecdsa' as const, walletSession, chainTarget };
  requireKeyExportCapability(deps.configs, laneInput);
  const lane = await deps.domain.resolveExactKeyExportLane(laneInput);
  if (lane.kind !== 'ecdsa') {
    throw new Error(`[key-export] expected an ECDSA lane, received ${lane.kind}`);
  }
  await deps.domain.exportKeypairWithUI({
    ...laneInput,
    laneIdentity: lane.laneIdentity,
    options,
  });
  return { kind: 'exported' };
}
