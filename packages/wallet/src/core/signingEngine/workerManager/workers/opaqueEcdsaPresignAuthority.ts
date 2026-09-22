import type { EcdsaClientPresignPoolIdentity } from '../ecdsaPresignPoolIdentity';
import { base64UrlDecode } from '@shared/utils/base64';
import type { EcdsaRoleLocalPersistedMaterialRef } from '../../session/keyMaterialBrands';
import type {
  DurableClientPresignatureAdmissionInput,
  DurableClientPresignatureAdmissionResult,
  DurableClientPresignatureMetadata,
  DurableClientPresignatureTakeResult,
} from '../../../indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore';
import type { OpaqueEcdsaPresignMaterialAuthorityIdentityV1 } from '../ecdsaClientWorkerChannels';
import type {
  ThresholdEcdsaPresignAbortResult,
  ThresholdEcdsaPresignProgressResult,
} from '../workerTypes';
import type {
  EcdsaClientPresignAdmissionStorage,
  EcdsaClientPresignUnavailableReason,
} from '../ecdsaPresignLifecycle';

export type OpaqueEcdsaPresignSessionV1 = {
  stage(): string;
  poll(): unknown;
  message(message: Uint8Array): void;
  start_presign(): void;
  presignature_big_r_33(): Uint8Array;
  copy_presignature_bytes_97(destination: Uint8Array): void;
  compute_signature_share(
    groupPublicKey33: Uint8Array,
    expectedPresignBigR33: Uint8Array,
    digest32: Uint8Array,
    clientRerandomizationContribution32: Uint8Array,
    signingWorkerRerandomizationContribution32: Uint8Array,
  ): Uint8Array;
  free(): void;
};

type OpaqueEcdsaPresignSessionBindingV1 = {
  readonly groupPublicKey33: Uint8Array;
  readonly ceremonyExpiresAtMs: number;
  readonly materialExpiresAtMs: number;
  readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  readonly durableMaterialRef: EcdsaRoleLocalPersistedMaterialRef | null;
  readonly authority: OpaqueEcdsaPresignMaterialAuthorityIdentityV1;
};

type OpaqueEcdsaPresignSessionEntryV1 = {
  readonly session: OpaqueEcdsaPresignSessionV1;
  readonly binding: OpaqueEcdsaPresignSessionBindingV1;
};

export type OpaqueEcdsaPresignSessionInitV1 = OpaqueEcdsaPresignSessionBindingV1 & {
  readonly presignSessionId: string;
  readonly session: OpaqueEcdsaPresignSessionV1;
};

export type OpaqueEcdsaDurablePresignatureStoreV1 = {
  admitClientPresignature(
    input: DurableClientPresignatureAdmissionInput,
  ): Promise<DurableClientPresignatureAdmissionResult>;
  listAvailableClientPresignatures(
    poolIdentity: EcdsaClientPresignPoolIdentity,
  ): Promise<readonly DurableClientPresignatureMetadata[]>;
  takeClientPresignature(input: {
    readonly recordId: string;
    readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  }): Promise<DurableClientPresignatureTakeResult>;
  deleteClientPresignature(input: {
    readonly recordId: string;
    readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  }): Promise<void>;
};

type OpaqueEcdsaCompletedSessionFactoryV1 = (
  bytes: Uint8Array,
) => OpaqueEcdsaPresignSessionV1;

export type OpaqueEcdsaPresignSessionStepV1 = {
  readonly presignSessionId: string;
  readonly stage: 'triples' | 'presign';
  readonly incomingMessages: readonly ArrayBuffer[];
};

export type OpaqueEcdsaOnlineComputeV1 = {
  readonly materialHandle: string;
  readonly groupPublicKey33: ArrayBuffer;
  readonly expectedPresignBigR33: ArrayBuffer;
  readonly digest32: ArrayBuffer;
  readonly clientRerandomizationContribution32: ArrayBuffer;
  readonly signingWorkerRerandomizationContribution32: ArrayBuffer;
};

export type OpaqueEcdsaPresignRestoreResultV1 =
  | {
      readonly kind: 'restored';
      readonly materialHandle: string;
    }
  | {
      readonly kind: EcdsaClientPresignUnavailableReason;
    };

type ParsedPresignPollV1 = {
  readonly stage: 'triples' | 'triples_done' | 'presign' | 'done';
  readonly event: 'none' | 'triples_done' | 'final_batch_ready' | 'presign_done';
  readonly outgoing: readonly Uint8Array[];
};

export class OpaqueEcdsaPresignAuthorityV1 {
  private readonly sessions = new Map<string, OpaqueEcdsaPresignSessionEntryV1>();
  private readonly materials = new Map<string, OpaqueEcdsaPresignSessionEntryV1>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private generation = 0;

  constructor(
    private readonly durableStore: OpaqueEcdsaDurablePresignatureStoreV1 | null = null,
    private readonly completedSessionFactory: OpaqueEcdsaCompletedSessionFactoryV1 | null = null,
  ) {}

  async initialize(
    input: OpaqueEcdsaPresignSessionInitV1,
  ): Promise<ThresholdEcdsaPresignProgressResult> {
    const generation = this.generation;
    return await this.serialize(input.presignSessionId, () => {
      if (generation !== this.generation) {
        input.session.free();
        throw new Error('Opaque ECDSA presign authority was closed');
      }
      if (Date.now() >= input.ceremonyExpiresAtMs) {
        input.session.free();
        throw new Error('Opaque ECDSA presign session expired');
      }
      this.abortNow(input.presignSessionId);
      if (generation !== this.generation) {
        input.session.free();
        throw new Error('Opaque ECDSA presign authority was closed');
      }
      this.sessions.set(input.presignSessionId, {
        session: input.session,
        binding: {
          groupPublicKey33: input.groupPublicKey33.slice(),
          ceremonyExpiresAtMs: input.ceremonyExpiresAtMs,
          materialExpiresAtMs: input.materialExpiresAtMs,
          poolIdentity: input.poolIdentity,
          durableMaterialRef: input.durableMaterialRef,
          authority: input.authority,
        },
      });
      try {
        return this.poll(input.presignSessionId, generation);
      } catch (error) {
        this.abortNow(input.presignSessionId);
        throw error;
      }
    });
  }

  async step(input: OpaqueEcdsaPresignSessionStepV1): Promise<ThresholdEcdsaPresignProgressResult> {
    return await this.serialize(input.presignSessionId, () => {
      const generation = this.generation;
      const entry = this.requireSession(input.presignSessionId);
      try {
        if (entry.session.stage() !== input.stage) {
          throw new Error('Opaque ECDSA presign stage mismatch');
        }
        this.requireCurrentGeneration(generation);
        for (const incoming of input.incomingMessages) {
          this.requireCurrentGeneration(generation);
          entry.session.message(new Uint8Array(incoming));
          this.requireCurrentGeneration(generation);
          if (entry.session.stage() === 'triples_done') entry.session.start_presign();
          this.requireCurrentGeneration(generation);
        }
        return this.poll(input.presignSessionId, generation);
      } catch (error) {
        this.abortNow(input.presignSessionId);
        throw error;
      }
    });
  }

  async abort(sessionId: string): Promise<ThresholdEcdsaPresignAbortResult> {
    return await this.serialize(sessionId, () => this.abortNow(sessionId));
  }

  async computeSignatureShare(input: OpaqueEcdsaOnlineComputeV1): Promise<ArrayBuffer> {
    return await this.serialize(input.materialHandle, () => {
      const entry = this.materials.get(input.materialHandle);
      this.materials.delete(input.materialHandle);
      if (!entry) throw new Error('Opaque ECDSA presign material is unknown');
      try {
        if (Date.now() >= entry.binding.materialExpiresAtMs) {
          throw new Error('Opaque ECDSA presign material expired');
        }
        if (
          !equalPublicBytes(entry.binding.groupPublicKey33, new Uint8Array(input.groupPublicKey33))
        ) {
          throw new Error('Opaque ECDSA presign group public key binding mismatch');
        }
        return copyToArrayBuffer(
          entry.session.compute_signature_share(
            new Uint8Array(input.groupPublicKey33),
            new Uint8Array(input.expectedPresignBigR33),
            new Uint8Array(input.digest32),
            new Uint8Array(input.clientRerandomizationContribution32),
            new Uint8Array(input.signingWorkerRerandomizationContribution32),
          ),
        );
      } finally {
        entry.session.free();
      }
    });
  }

  async destroyMaterial(materialHandle: string): Promise<boolean> {
    return await this.serialize(materialHandle, () => {
      const entry = this.materials.get(materialHandle);
      this.materials.delete(materialHandle);
      entry?.session.free();
      return Boolean(entry);
    });
  }

  async admitMaterial(input: {
    readonly materialHandle: string;
    readonly expectedPresignatureId: string;
    readonly admissionMode: 'durable' | 'resident';
  }): Promise<EcdsaClientPresignAdmissionStorage> {
    return await this.serialize(input.materialHandle, async () => {
      const entry = this.materials.get(input.materialHandle);
      if (!entry) throw new Error('Opaque ECDSA presign material is unknown');
      if (Date.now() >= entry.binding.materialExpiresAtMs) {
        this.materials.delete(input.materialHandle);
        entry.session.free();
        throw new Error('Opaque ECDSA presign material expired');
      }
      if (
        input.admissionMode === 'resident' ||
        !this.durableStore ||
        entry.binding.durableMaterialRef === null
      ) {
        return { kind: 'resident' };
      }
      const plaintext97 = new Uint8Array(97);
      entry.session.copy_presignature_bytes_97(plaintext97);
      const bigR33 = new Uint8Array(entry.session.presignature_big_r_33());
      try {
        const result = await this.durableStore.admitClientPresignature({
          poolIdentity: entry.binding.poolIdentity,
          durableMaterialRef: entry.binding.durableMaterialRef,
          presignatureId: input.expectedPresignatureId,
          groupPublicKey33: entry.binding.groupPublicKey33.slice(),
          bigR33,
          plaintext97,
          createdAtMs: Date.now(),
          expiresAtMs: entry.binding.materialExpiresAtMs,
        });
        if (result.kind === 'stored') {
          this.materials.delete(input.materialHandle);
          entry.session.free();
          return {
            kind: 'sealed_indexed_db',
            durableRecordId: result.metadata.recordId,
          };
        }
        if (result.kind === 'capacity_full') {
          this.materials.delete(input.materialHandle);
          entry.session.free();
          return { kind: 'discarded_capacity' };
        }
        if (result.kind === 'persistence_ambiguous') {
          this.materials.delete(input.materialHandle);
          entry.session.free();
          return { kind: 'discarded_ambiguous' };
        }
        return { kind: 'resident' };
      } finally {
        plaintext97.fill(0);
        bigR33.fill(0);
      }
    });
  }

  async listDurablePresignatures(
    poolIdentity: EcdsaClientPresignPoolIdentity,
  ): Promise<readonly DurableClientPresignatureMetadata[]> {
    if (!this.durableStore) return [];
    return await this.durableStore.listAvailableClientPresignatures(poolIdentity);
  }

  async restoreDurablePresignature(input: {
    readonly recordId: string;
    readonly expectedPresignatureId: string;
    readonly poolIdentity: EcdsaClientPresignPoolIdentity;
    readonly groupPublicKey33: Uint8Array;
    readonly bigR33: Uint8Array;
  }): Promise<OpaqueEcdsaPresignRestoreResultV1> {
    if (!this.durableStore) return { kind: 'persistence_unavailable' };
    const result = await this.durableStore.takeClientPresignature({
      recordId: input.recordId,
      poolIdentity: input.poolIdentity,
    });
    if (result.kind !== 'opened') return { kind: result.kind };
    if (result.metadata.presignatureId !== input.expectedPresignatureId) {
      result.plaintext97.fill(0);
      return { kind: 'binding_rejected' };
    }
    const plaintext97 = result.plaintext97;
    let metadataGroupPublicKey33: Uint8Array | null = null;
    let metadataBigR33: Uint8Array | null = null;
    try {
      metadataGroupPublicKey33 = base64UrlDecode(result.metadata.groupPublicKey33B64u);
      metadataBigR33 = base64UrlDecode(result.metadata.bigR33B64u);
      if (
        !equalPublicBytes(input.groupPublicKey33, metadataGroupPublicKey33) ||
        !equalPublicBytes(input.bigR33, metadataBigR33)
      ) {
        return { kind: 'binding_rejected' };
      }
      const session = this.createCompletedSession(plaintext97);
      const materialHandle = randomHandle('ecdsa-presign-restored');
      this.materials.set(materialHandle, {
        session,
        binding: {
          groupPublicKey33: input.groupPublicKey33.slice(),
          ceremonyExpiresAtMs: result.metadata.expiresAtMs,
          materialExpiresAtMs: result.metadata.expiresAtMs,
          poolIdentity: result.metadata.poolIdentity,
          durableMaterialRef: result.metadata.durableMaterialRef,
          authority: {
            kind: 'role_local_derivation_handle',
            materialHandle,
          },
        },
      });
      return { kind: 'restored', materialHandle };
    } finally {
      plaintext97.fill(0);
      metadataGroupPublicKey33?.fill(0);
      metadataBigR33?.fill(0);
    }
  }

  async deleteDurablePresignature(input: {
    readonly recordId: string;
    readonly poolIdentity: EcdsaClientPresignPoolIdentity;
  }): Promise<void> {
    await this.durableStore?.deleteClientPresignature(input);
  }

  private createCompletedSession(bytes: Uint8Array): OpaqueEcdsaPresignSessionV1 {
    if (!this.completedSessionFactory) {
      throw new Error('ECDSA completed presignature WASM constructor is unavailable');
    }
    return this.completedSessionFactory(bytes);
  }

  private abortNow(sessionId: string): ThresholdEcdsaPresignAbortResult {
    const entry = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (entry) entry.session.free();
    return { kind: 'threshold_ecdsa_presign_session_aborted', sessionId };
  }

  private requireCurrentGeneration(expectedGeneration: number): void {
    if (expectedGeneration !== this.generation) {
      throw new Error('Opaque ECDSA presign authority was closed');
    }
  }

  close(): void {
    this.generation += 1;
    for (const sessionId of this.sessions.keys()) this.abortNow(sessionId);
    for (const entry of this.materials.values()) entry.session.free();
    this.materials.clear();
  }

  disposeLinkedHolderMaterials(
    scope:
      | { readonly kind: 'all'; readonly holderHandleId?: never }
      | { readonly kind: 'one'; readonly holderHandleId: string },
  ): void {
    for (const [sessionId, entry] of this.sessions) {
      const authority = entry.binding.authority;
      if (authority.kind !== 'linked_holder_signing_material') continue;
      if (scope.kind === 'one' && authority.holderHandleId !== scope.holderHandleId) continue;
      this.abortNow(sessionId);
    }
    for (const [materialHandle, entry] of this.materials) {
      const authority = entry.binding.authority;
      if (authority.kind !== 'linked_holder_signing_material') continue;
      if (scope.kind === 'one' && authority.holderHandleId !== scope.holderHandleId) continue;
      this.materials.delete(materialHandle);
      entry.session.free();
    }
  }

  private requireSession(sessionId: string): OpaqueEcdsaPresignSessionEntryV1 {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error('Opaque ECDSA presign session is unknown');
    if (Date.now() >= entry.binding.ceremonyExpiresAtMs) {
      this.abortNow(sessionId);
      throw new Error('Opaque ECDSA presign session expired');
    }
    return entry;
  }

  private poll(sessionId: string, expectedGeneration: number): ThresholdEcdsaPresignProgressResult {
    const entry = this.requireSession(sessionId);
    const result = parsePollResult(entry.session.poll());
    this.requireCurrentGeneration(expectedGeneration);
    const outgoingMessages = result.outgoing.map(copyToArrayBuffer);
    if (result.event !== 'presign_done') {
      return { stage: result.stage, event: result.event, outgoingMessages };
    }
    const bigR33 = entry.session.presignature_big_r_33();
    this.requireCurrentGeneration(expectedGeneration);
    if (bigR33.length !== 33) throw new Error('Client presignature R must contain 33 bytes');
    const materialHandle = randomHandle(`ecdsa-presign-${sessionId}`);
    this.sessions.delete(sessionId);
    this.materials.set(materialHandle, entry);
    return {
      stage: 'done',
      event: 'presign_done',
      outgoingMessages,
      presignatureHandle: materialHandle,
      presignatureBigR33: copyToArrayBuffer(bigR33),
    };
  }

  private async serialize<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.operationTails.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.operationTails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.operationTails.get(key) === tail) this.operationTails.delete(key);
    }
  }
}

function equalPublicBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function parsePollResult(raw: unknown): ParsedPresignPollV1 {
  const record = (raw ?? {}) as Record<string, unknown>;
  const stage = parseStage(record.stage);
  const event = parseEvent(record.event);
  const outgoing = Array.isArray(record.outgoing) ? record.outgoing.map(parseOutgoingMessage) : [];
  return { stage, event, outgoing };
}

function parseStage(value: unknown): ParsedPresignPollV1['stage'] {
  switch (value) {
    case 'triples':
    case 'triples_done':
    case 'presign':
    case 'done':
      return value;
    default:
      throw new Error('Opaque ECDSA presign session returned an invalid stage');
  }
}

function parseEvent(value: unknown): ParsedPresignPollV1['event'] {
  switch (value) {
    case 'none':
    case 'triples_done':
    case 'final_batch_ready':
    case 'presign_done':
      return value;
    default:
      throw new Error('Opaque ECDSA presign session returned an invalid event');
  }
}

function parseOutgoingMessage(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error('Opaque ECDSA presign session returned an invalid outgoing message');
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function randomHandle(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let suffix = '';
  for (const byte of bytes) suffix += byte.toString(16).padStart(2, '0');
  return `${prefix}-${suffix}`;
}
