import { SigningSessionIds, type ThresholdEcdsaSessionId } from '../operationState/types';

export type EcdsaSessionIdentity = {
  thresholdSessionId: ThresholdEcdsaSessionId;
};

export function buildEcdsaSessionIdentity(args: {
  thresholdSessionId: unknown;
}): EcdsaSessionIdentity {
  return {
    thresholdSessionId: SigningSessionIds.thresholdEcdsaSession(args.thresholdSessionId),
  };
}
