import { normalizeRuntimePolicyScope } from '@shared/threshold/signingRootScope';
import type { ThresholdRuntimePolicyScope } from '../types';

export function normalizeThresholdRuntimePolicyScope(
  raw: unknown,
): ThresholdRuntimePolicyScope | undefined {
  try {
    return normalizeRuntimePolicyScope(raw);
  } catch {
    return undefined;
  }
}
