import type { EvmSignerCapability } from '@/SeamsWeb/signingSurface/types';
import type { SeamsConfigsReadonly } from '@/core/types/seams';

export function buildEvmBootstrapArgs(
  configs: SeamsConfigsReadonly,
  args: Parameters<EvmSignerCapability['bootstrapEcdsaSession']>[0],
): Parameters<EvmSignerCapability['bootstrapEcdsaSession']>[0] {
  const managedRegistration = configs.registration.mode === 'managed' ? configs.registration : null;
  const runtimeScopeBootstrap =
    args.runtimeScopeBootstrap ||
    (managedRegistration
      ? {
          projectEnvironmentId: managedRegistration.projectEnvironmentId,
          publishableKey: managedRegistration.publishableKey,
        }
      : undefined);
  const chainTarget = args.chainTarget;
  if (chainTarget.kind !== 'evm') {
    throw new Error('[SeamsWeb][evm] bootstrapEcdsaSession requires an EVM chainTarget');
  }
  return {
    ...args,
    ...(runtimeScopeBootstrap ? { runtimeScopeBootstrap } : {}),
  };
}
