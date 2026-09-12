import { base64UrlDecode } from '@shared/utils/base64';
import type {
  DerivationClientSharePublicKey33B64u,
  EcdsaDerivationRelayerPublicKey33B64u,
} from '@shared/threshold/ecdsaDerivationRoleLocalBootstrap';
import type {
  FinalizeEcdsaClientBootstrapCommand as RawFinalizeEcdsaClientBootstrapCommand,
  FinalizeEcdsaClientBootstrapOutput as RawFinalizeEcdsaClientBootstrapOutput,
  PrepareEcdsaClientBootstrapCommand as RawPrepareEcdsaClientBootstrapCommand,
  PrepareEcdsaClientBootstrapOutput as RawPrepareEcdsaClientBootstrapOutput,
} from './generated/signerCoreCommands';
import type {
  EcdsaRoleLocalPendingStateBlob,
  EcdsaRoleLocalReadyStateBlob,
  FinalizeEcdsaClientBootstrapInput,
  FinalizeEcdsaClientBootstrapOutput,
  PrepareEcdsaClientBootstrapInput,
  PrepareEcdsaClientBootstrapOutput,
} from './types';

export type GeneratedPrepareEcdsaClientBootstrapCommand = RawPrepareEcdsaClientBootstrapCommand;
export type GeneratedPrepareEcdsaClientBootstrapOutput = RawPrepareEcdsaClientBootstrapOutput;
export type GeneratedFinalizeEcdsaClientBootstrapCommand = RawFinalizeEcdsaClientBootstrapCommand;
export type GeneratedFinalizeEcdsaClientBootstrapOutput = RawFinalizeEcdsaClientBootstrapOutput;

function requireBase64UrlBytes(value: string, field: string, byteLength: number): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`[signer-core-command] ${field} is required`);
  }
  if (base64UrlDecode(normalized).length !== byteLength) {
    throw new Error(`[signer-core-command] ${field} must decode to ${byteLength} bytes`);
  }
  return normalized;
}

function requireSignerCoreCommandObject(value: unknown, field: string): object {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[signer-core-command] ${field} must be an object`);
  }
  return value;
}

function requireSignerCoreCommandFields(
  value: object,
  expectedFields: readonly string[],
  field: string,
): void {
  const actualFields = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (
    actualFields.length !== expected.length ||
    actualFields.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`[signer-core-command] ${field} fields are invalid`);
  }
}

function requireSignerCoreCommandString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`[signer-core-command] ${field} must be a string`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`[signer-core-command] ${field} is required`);
  }
  return normalized;
}

function isAsciiString(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) > 0x7f) return false;
  }
  return true;
}

function requireSignerCoreCommandAsciiString(value: unknown, field: string): string {
  const normalized = requireSignerCoreCommandString(value, field);
  if (!isAsciiString(normalized)) {
    throw new Error(`[signer-core-command] ${field} must be ASCII-only`);
  }
  return normalized;
}

function requireSignerCoreCommandU32(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > 0xffffffff
  ) {
    throw new Error(`[signer-core-command] ${field} must be a u32`);
  }
  return value;
}

function parseDerivationClientSharePublicKey33B64u(
  value: string,
): DerivationClientSharePublicKey33B64u {
  return requireBase64UrlBytes(
    value,
    'derivationClientSharePublicKey33B64u',
    33,
  ) as DerivationClientSharePublicKey33B64u;
}

function parseRelayerEcdsaDerivationPublicKey33B64u(
  value: string,
): EcdsaDerivationRelayerPublicKey33B64u {
  return requireBase64UrlBytes(
    value,
    'relayerPublicKey33B64u',
    33,
  ) as EcdsaDerivationRelayerPublicKey33B64u;
}

function parsePublicKey33B64u(value: string, field: string): string {
  return requireBase64UrlBytes(value, field, 33);
}

function parseEthereumAddress(value: string): `0x${string}` {
  const normalized = String(value || '').trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(normalized)) {
    throw new Error('[signer-core-command] ethereumAddress must be 0x-prefixed 20-byte hex');
  }
  return normalized as `0x${string}`;
}

function parseHexBytes(value: string, field: string, byteLength: number): `0x${string}` {
  const normalized = String(value || '').trim();
  const hexChars = byteLength * 2;
  if (!new RegExp(`^0x[0-9a-fA-F]{${hexChars}}$`).test(normalized)) {
    throw new Error(`[signer-core-command] ${field} must be 0x-prefixed ${byteLength}-byte hex`);
  }
  return normalized as `0x${string}`;
}

function parsePendingStateBlob(input: unknown): EcdsaRoleLocalPendingStateBlob {
  const record = requireSignerCoreCommandObject(input, 'ECDSA pending state blob');
  requireSignerCoreCommandFields(
    record,
    ['kind', 'curve', 'encoding', 'producer', 'stateBlobB64u'],
    'ECDSA pending state blob',
  );
  if (
    Reflect.get(record, 'kind') !== 'ecdsa_role_local_pending_state_blob_v1' ||
    Reflect.get(record, 'curve') !== 'secp256k1' ||
    Reflect.get(record, 'encoding') !== 'base64url' ||
    Reflect.get(record, 'producer') !== 'signer_core'
  ) {
    throw new Error('[signer-core-command] invalid ECDSA pending state blob envelope');
  }
  return {
    kind: 'ecdsa_role_local_pending_state_blob_v1',
    curve: 'secp256k1',
    encoding: 'base64url',
    producer: 'signer_core',
    stateBlobB64u: requireSignerCoreCommandString(
      Reflect.get(record, 'stateBlobB64u'),
      'pendingStateBlob.stateBlobB64u',
    ),
  };
}

function parseReadyStateBlob(
  input: RawFinalizeEcdsaClientBootstrapOutput['stateBlob'],
): EcdsaRoleLocalReadyStateBlob {
  if (
    input.kind !== 'ecdsa_role_local_state_blob_v1' ||
    input.curve !== 'secp256k1' ||
    input.encoding !== 'base64url' ||
    input.producer !== 'signer_core'
  ) {
    throw new Error('[signer-core-command] invalid ECDSA ready state blob envelope');
  }
  return input;
}

function parsePrepareEcdsaClientBootstrapParticipants(
  value: unknown,
): GeneratedPrepareEcdsaClientBootstrapCommand['participants'] {
  const record = requireSignerCoreCommandObject(value, 'ECDSA bootstrap participants');
  requireSignerCoreCommandFields(
    record,
    ['clientParticipantId', 'relayerParticipantId', 'participantIds'],
    'ECDSA bootstrap participants',
  );
  const participantIds = Reflect.get(record, 'participantIds');
  if (
    Reflect.get(record, 'clientParticipantId') !== 1 ||
    Reflect.get(record, 'relayerParticipantId') !== 2 ||
    !Array.isArray(participantIds) ||
    participantIds.length !== 2 ||
    participantIds[0] !== 1 ||
    participantIds[1] !== 2
  ) {
    throw new Error('[signer-core-command] ECDSA bootstrap participants are invalid');
  }
  return {
    clientParticipantId: 1,
    relayerParticipantId: 2,
    participantIds: [1, 2],
  };
}

function parsePrepareEcdsaClientBootstrapSecretSource(
  value: unknown,
): GeneratedPrepareEcdsaClientBootstrapCommand['secretSource'] {
  const record = requireSignerCoreCommandObject(value, 'ECDSA bootstrap secret source');
  requireSignerCoreCommandFields(
    record,
    ['kind', 'xClientBaseB64u'],
    'ECDSA bootstrap secret source',
  );
  if (Reflect.get(record, 'kind') !== 'threshold_prf_x_client_base') {
    throw new Error('[signer-core-command] ECDSA bootstrap secret source kind is invalid');
  }
  return {
    kind: 'threshold_prf_x_client_base',
    xClientBaseB64u: requireBase64UrlBytes(
      requireSignerCoreCommandString(
        Reflect.get(record, 'xClientBaseB64u'),
        'secretSource.xClientBaseB64u',
      ),
      'secretSource.xClientBaseB64u',
      32,
    ),
  };
}

function parseFinalizeEcdsaClientBootstrapRelayerIdentity(
  value: unknown,
): GeneratedFinalizeEcdsaClientBootstrapCommand['relayerPublicIdentity'] {
  const record = requireSignerCoreCommandObject(value, 'ECDSA relayer public identity');
  requireSignerCoreCommandFields(
    record,
    [
      'relayerKeyId',
      'relayerPublicKey33B64u',
      'groupPublicKey33B64u',
      'ethereumAddress',
      'relayerShareRetryCounter',
    ],
    'ECDSA relayer public identity',
  );
  return {
    relayerKeyId: requireSignerCoreCommandAsciiString(
      Reflect.get(record, 'relayerKeyId'),
      'relayerPublicIdentity.relayerKeyId',
    ),
    relayerPublicKey33B64u: requireBase64UrlBytes(
      requireSignerCoreCommandString(
        Reflect.get(record, 'relayerPublicKey33B64u'),
        'relayerPublicIdentity.relayerPublicKey33B64u',
      ),
      'relayerPublicIdentity.relayerPublicKey33B64u',
      33,
    ),
    groupPublicKey33B64u: requireBase64UrlBytes(
      requireSignerCoreCommandString(
        Reflect.get(record, 'groupPublicKey33B64u'),
        'relayerPublicIdentity.groupPublicKey33B64u',
      ),
      'relayerPublicIdentity.groupPublicKey33B64u',
      33,
    ),
    ethereumAddress: parseEthereumAddress(
      requireSignerCoreCommandString(
        Reflect.get(record, 'ethereumAddress'),
        'relayerPublicIdentity.ethereumAddress',
      ),
    ),
    relayerShareRetryCounter: requireSignerCoreCommandU32(
      Reflect.get(record, 'relayerShareRetryCounter'),
      'relayerPublicIdentity.relayerShareRetryCounter',
    ),
  };
}

export function parseGeneratedPrepareEcdsaClientBootstrapCommand(
  input: unknown,
): GeneratedPrepareEcdsaClientBootstrapCommand {
  const record = requireSignerCoreCommandObject(input, 'ECDSA prepare bootstrap command');
  requireSignerCoreCommandFields(
    record,
    ['kind', 'algorithm', 'context', 'participants', 'secretSource'],
    'ECDSA prepare bootstrap command',
  );
  if (Reflect.get(record, 'kind') !== 'prepare_ecdsa_client_bootstrap_v1') {
    throw new Error('[signer-core-command] ECDSA prepare bootstrap command kind is invalid');
  }
  if (Reflect.get(record, 'algorithm') !== 'router_ab_ecdsa_derivation_secp256k1_role_local_v1') {
    throw new Error('[signer-core-command] ECDSA prepare bootstrap algorithm is invalid');
  }

  const context = requireSignerCoreCommandObject(
    Reflect.get(record, 'context'),
    'ECDSA bootstrap context',
  );
  requireSignerCoreCommandFields(
    context,
    ['applicationBindingDigestB64u'],
    'ECDSA bootstrap context',
  );

  return {
    kind: 'prepare_ecdsa_client_bootstrap_v1',
    algorithm: 'router_ab_ecdsa_derivation_secp256k1_role_local_v1',
    context: {
      applicationBindingDigestB64u: requireBase64UrlBytes(
        requireSignerCoreCommandString(
          Reflect.get(context, 'applicationBindingDigestB64u'),
          'context.applicationBindingDigestB64u',
        ),
        'context.applicationBindingDigestB64u',
        32,
      ),
    },
    participants: parsePrepareEcdsaClientBootstrapParticipants(Reflect.get(record, 'participants')),
    secretSource: parsePrepareEcdsaClientBootstrapSecretSource(Reflect.get(record, 'secretSource')),
  };
}

export function parseGeneratedFinalizeEcdsaClientBootstrapCommand(
  input: unknown,
): GeneratedFinalizeEcdsaClientBootstrapCommand {
  const record = requireSignerCoreCommandObject(input, 'ECDSA finalize bootstrap command');
  requireSignerCoreCommandFields(
    record,
    ['kind', 'pendingStateBlob', 'relayerPublicIdentity'],
    'ECDSA finalize bootstrap command',
  );
  if (Reflect.get(record, 'kind') !== 'finalize_ecdsa_client_bootstrap_v1') {
    throw new Error('[signer-core-command] ECDSA finalize bootstrap command kind is invalid');
  }
  return {
    kind: 'finalize_ecdsa_client_bootstrap_v1',
    pendingStateBlob: parsePendingStateBlob(Reflect.get(record, 'pendingStateBlob')),
    relayerPublicIdentity: parseFinalizeEcdsaClientBootstrapRelayerIdentity(
      Reflect.get(record, 'relayerPublicIdentity'),
    ),
  };
}

export function toGeneratedPrepareEcdsaClientBootstrapCommand(
  input: PrepareEcdsaClientBootstrapInput,
): GeneratedPrepareEcdsaClientBootstrapCommand {
  return {
    kind: input.kind,
    algorithm: input.algorithm,
    context: {
      applicationBindingDigestB64u: input.context.applicationBindingDigestB64u,
    },
    participants: {
      clientParticipantId: input.participants.clientParticipantId,
      relayerParticipantId: input.participants.relayerParticipantId,
      participantIds: [...input.participants.participantIds],
    },
    secretSource: {
      kind: 'threshold_prf_x_client_base',
      xClientBaseB64u: requireBase64UrlBytes(
        input.secretSource.xClientBaseB64u,
        'secretSource.xClientBaseB64u',
        32,
      ),
    },
  };
}

export function parseGeneratedPrepareEcdsaClientBootstrapOutput(
  input: GeneratedPrepareEcdsaClientBootstrapOutput,
): PrepareEcdsaClientBootstrapOutput {
  if (input.clientBootstrap.participantId !== 1) {
    throw new Error('[signer-core-command] ECDSA client bootstrap participantId must be 1');
  }
  const derivationClientSharePublicKey33B64u = parseDerivationClientSharePublicKey33B64u(
    input.clientBootstrap.derivationClientSharePublicKey33B64u,
  );
  return {
    pendingStateBlob: parsePendingStateBlob(input.pendingStateBlob),
    clientBootstrap: {
      contextBinding32B64u: requireBase64UrlBytes(
        input.clientBootstrap.contextBinding32B64u,
        'contextBinding32B64u',
        32,
      ),
      derivationClientSharePublicKey33B64u,
      clientShareRetryCounter: input.clientBootstrap.clientShareRetryCounter,
      participantId: 1,
    },
    publicFacts: {
      derivationClientSharePublicKey33B64u: parseDerivationClientSharePublicKey33B64u(
        input.publicFacts.derivationClientSharePublicKey33B64u,
      ),
      clientVerifyingShareB64u: parsePublicKey33B64u(
        input.publicFacts.clientVerifyingShareB64u,
        'clientVerifyingShareB64u',
      ),
    },
  };
}

export function toGeneratedFinalizeEcdsaClientBootstrapCommand(
  input: FinalizeEcdsaClientBootstrapInput,
): GeneratedFinalizeEcdsaClientBootstrapCommand {
  return {
    kind: input.kind,
    pendingStateBlob: input.pendingStateBlob,
    relayerPublicIdentity: {
      relayerKeyId: input.relayerPublicIdentity.relayerKeyId,
      relayerPublicKey33B64u: input.relayerPublicIdentity.relayerPublicKey33B64u,
      groupPublicKey33B64u: input.relayerPublicIdentity.groupPublicKey33B64u,
      ethereumAddress: input.relayerPublicIdentity.ethereumAddress,
      relayerShareRetryCounter: input.relayerPublicIdentity.relayerShareRetryCounter,
    },
  };
}

export function parseGeneratedFinalizeEcdsaClientBootstrapOutput(
  input: GeneratedFinalizeEcdsaClientBootstrapOutput,
): FinalizeEcdsaClientBootstrapOutput {
  return {
    stateBlob: parseReadyStateBlob(input.stateBlob),
    publicFacts: {
      contextBinding32B64u: requireBase64UrlBytes(
        input.publicFacts.contextBinding32B64u,
        'contextBinding32B64u',
        32,
      ),
      derivationClientSharePublicKey33B64u: parseDerivationClientSharePublicKey33B64u(
        input.publicFacts.derivationClientSharePublicKey33B64u,
      ),
      clientVerifyingShareB64u: parsePublicKey33B64u(
        input.publicFacts.clientVerifyingShareB64u,
        'clientVerifyingShareB64u',
      ),
      relayerPublicKey33B64u: parseRelayerEcdsaDerivationPublicKey33B64u(
        input.publicFacts.relayerPublicKey33B64u,
      ),
      groupPublicKey33B64u: parsePublicKey33B64u(
        input.publicFacts.groupPublicKey33B64u,
        'groupPublicKey33B64u',
      ),
      ethereumAddress: parseEthereumAddress(input.publicFacts.ethereumAddress),
    },
  };
}
