import type { ThresholdEcdsaChainTarget } from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { MpcMaterialActivationRef } from '@shared/utils/domainIds';

type ExactSealedSessionIdentity =
  | {
      authMethod: 'email_otp' | 'passkey';
      curve: 'ed25519';
      materialActivation: MpcMaterialActivationRef;
      thresholdSessionId?: never;
    }
  | {
      authMethod: 'email_otp' | 'passkey';
      curve: 'ecdsa';
      thresholdSessionId: string;
      chainTarget: ThresholdEcdsaChainTarget;
    };

export type DurableSealedSessionDeleteReason =
  | 'account_removed'
  | 'device_removed'
  | 'expired'
  | 'exhausted'
  | 'invalid_persisted_record'
  | 'migration_rejected'
  | 'trusted_persisted_delete';

export type DeleteDurableSealedSessionCommand = {
  kind: 'delete_durable_sealed_session';
  durableRecord: ExactSealedSessionIdentity;
  deleteReason: DurableSealedSessionDeleteReason;
  preserveResolvedIdentity: boolean;
  scope?: never;
};

type ExactSealedSessionRecordFilter =
  | {
      authMethod: 'email_otp' | 'passkey';
      curve: 'ed25519';
    }
  | {
      authMethod: 'email_otp' | 'passkey';
      curve: 'ecdsa';
      chainTarget: ThresholdEcdsaChainTarget;
    };

function assertNever(value: never): never {
  throw new Error(`Unhandled durable sealed-session identity: ${String(value)}`);
}

export function createDeleteDurableSealedSessionCommand(args: {
  durableRecord: ExactSealedSessionIdentity;
  deleteReason: DurableSealedSessionDeleteReason;
  preserveResolvedIdentity: boolean;
}): DeleteDurableSealedSessionCommand {
  return {
    kind: 'delete_durable_sealed_session',
    durableRecord: args.durableRecord,
    deleteReason: args.deleteReason,
    preserveResolvedIdentity: args.preserveResolvedIdentity,
  };
}

export function exactSealedSessionFilterForIdentity(
  identity: ExactSealedSessionIdentity,
): ExactSealedSessionRecordFilter {
  switch (identity.curve) {
    case 'ed25519':
      return {
        authMethod: identity.authMethod,
        curve: 'ed25519',
      };
    case 'ecdsa':
      return {
        authMethod: identity.authMethod,
        curve: 'ecdsa',
        chainTarget: identity.chainTarget,
      };
    default:
      return assertNever(identity);
  }
}
