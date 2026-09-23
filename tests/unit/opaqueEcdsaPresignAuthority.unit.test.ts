import type { ThresholdEcdsaPresignProgressResult } from '@/core/signingEngine/workerManager/workerTypes';
import { expect, test } from '@playwright/test';
import { parseRootShareEpoch } from '@shared/utils/domainIds';
import {
  FIXED_ECDSA_PRESIGN_PROTOCOL_ID,
  type EcdsaClientPresignPoolIdentity,
} from '@/core/signingEngine/workerManager/ecdsaPresignPoolIdentity';
import type { OpaqueEcdsaPresignMaterialAuthorityIdentityV1 } from '@/core/signingEngine/workerManager/ecdsaClientWorkerChannels';
import {
  OpaqueEcdsaPresignAuthorityV1,
  type OpaqueEcdsaPresignSessionV1,
} from '@/core/signingEngine/workerManager/workers/opaqueEcdsaPresignAuthority';

function testActivationEpoch() {
  const parsed = parseRootShareEpoch('root-share-epoch-1');
  if (!parsed.ok) throw new Error('test activation epoch is invalid');
  return parsed.value;
}

const poolIdentity: EcdsaClientPresignPoolIdentity = {
  relayerUrl: 'https://signing.example.test',
  materialActivationB64u: 'activation-wire-1',
  materialActivationId: 'activation-1',
  capability: 'capability-1',
  keyBinding: 'key-binding-1',
  walletId: 'wallet-1',
  signingScopeB64u: 'signing-scope-1',
  pairRole: 'client',
  keyEpoch: 'key-epoch-1',
  activationEpoch: testActivationEpoch(),
  protocolId: FIXED_ECDSA_PRESIGN_PROTOCOL_ID,
};

class CompletedOpaqueSession implements OpaqueEcdsaPresignSessionV1 {
  private freed = false;

  constructor(private readonly signatureByte: number) {}

  stage(): string {
    return 'done';
  }

  poll(): unknown {
    return { stage: 'done', event: 'presign_done', outgoing: [] };
  }

  message(): void {}

  start_presign(): void {}

  candidate_big_r_33(): Uint8Array {
    throw new Error('Completed material has no pending final batch');
  }

  presignature_big_r_33(): Uint8Array {
    return new Uint8Array(33).fill(this.signatureByte);
  }

  copy_presignature_bytes_97(): void {
    throw new Error('Resident fixture must not export presignature material');
  }

  compute_signature_share(): Uint8Array {
    return new Uint8Array(32).fill(this.signatureByte);
  }

  free(): void {
    this.freed = true;
  }

  wasFreed(): boolean {
    return this.freed;
  }
}

async function initializeCompletedMaterial(args: {
  authority: OpaqueEcdsaPresignAuthorityV1;
  sessionId: string;
  session: CompletedOpaqueSession;
  materialAuthority: OpaqueEcdsaPresignMaterialAuthorityIdentityV1;
}): Promise<string> {
  const result = await args.authority.initialize({
    presignSessionId: args.sessionId,
    session: args.session,
    groupPublicKey33: new Uint8Array(33).fill(2),
    ceremonyExpiresAtMs: Date.now() + 30_000,
    materialExpiresAtMs: Date.now() + 60_000,
    durableMaterialRef: null,
    poolIdentity,
    authority: args.materialAuthority,
  });
  if (result.event !== 'presign_done' || !result.presignatureHandle) {
    throw new Error('test presignature did not complete');
  }
  return result.presignatureHandle;
}

function computeInput(materialHandle: string) {
  return {
    materialHandle,
    groupPublicKey33: new Uint8Array(33).fill(2).buffer,
    expectedPresignBigR33: new Uint8Array(33).fill(7).buffer,
    digest32: new Uint8Array(32).buffer,
    clientRerandomizationContribution32: new Uint8Array(32).buffer,
    signingWorkerRerandomizationContribution32: new Uint8Array(32).buffer,
  };
}

test('linked-holder cleanup preserves role-local opaque presign material', async () => {
  const authority = new OpaqueEcdsaPresignAuthorityV1();
  const roleLocal = new CompletedOpaqueSession(7);
  const linkedHolder = new CompletedOpaqueSession(9);
  const roleLocalHandle = await initializeCompletedMaterial({
    authority,
    sessionId: 'role-local-session',
    session: roleLocal,
    materialAuthority: {
      kind: 'role_local_derivation_handle',
      materialHandle: 'role-local-material',
    },
  });
  const linkedHolderHandle = await initializeCompletedMaterial({
    authority,
    sessionId: 'linked-holder-session',
    session: linkedHolder,
    materialAuthority: {
      kind: 'linked_holder_signing_material',
      holderHandleId: 'linked-holder-1',
    },
  });

  authority.disposeLinkedHolderMaterials({ kind: 'all' });

  expect(linkedHolder.wasFreed()).toBe(true);
  await expect(authority.computeSignatureShare(computeInput(linkedHolderHandle))).rejects.toThrow(
    'Opaque ECDSA presign material is unknown',
  );
  await expect(authority.computeSignatureShare(computeInput(roleLocalHandle))).resolves.toEqual(
    new Uint8Array(32).fill(7).buffer,
  );
  expect(roleLocal.wasFreed()).toBe(true);
});

class FinalBatchOpaqueSession extends CompletedOpaqueSession {
  private complete = false;

  override stage(): string {
    return this.complete ? 'done' : 'presign';
  }

  override poll(): unknown {
    if (this.complete) return super.poll();
    return {
      stage: 'presign',
      event: 'final_batch_ready',
      outgoing: [new Uint8Array([1]), new Uint8Array([2])],
    };
  }

  override message(): void {
    this.complete = true;
  }

  override candidate_big_r_33(): Uint8Array {
    return super.presignature_big_r_33();
  }

  override presignature_big_r_33(): Uint8Array {
    if (!this.complete) throw new Error('Material is unavailable before the final response');
    return super.presignature_big_r_33();
  }
}

test('the opaque worker forwards the terminal batch signal before material is available', async () => {
  const authority = new OpaqueEcdsaPresignAuthorityV1();
  const session = new FinalBatchOpaqueSession(7);
  const ready = await authority.initialize({
    presignSessionId: 'terminal-batch-session',
    session,
    groupPublicKey33: new Uint8Array(33).fill(2),
    ceremonyExpiresAtMs: Date.now() + 30_000,
    materialExpiresAtMs: Date.now() + 60_000,
    poolIdentity,
    durableMaterialRef: null,
    authority: { kind: 'role_local_derivation_handle', materialHandle: 'role-local-material' },
  });
  expect(ready.event).toBe('final_batch_ready');
  if (ready.event !== 'final_batch_ready') throw new Error('Missing terminal batch');
  expect(new Uint8Array(ready.candidateBigR33)).toEqual(new Uint8Array(33).fill(7));
  expect(ready.outgoingMessages).toHaveLength(2);
  expect(ready.presignatureHandle).toBeUndefined();
  expect(ready.presignatureBigR33).toBeUndefined();
  const completed = await authority.step({
    presignSessionId: 'terminal-batch-session',
    stage: 'presign',
    incomingMessages: [new Uint8Array([3]).buffer],
  });
  expect(completed.event).toBe('presign_done');
  if (!completed.presignatureHandle) throw new Error('Completed material handle is missing');
  expect(await authority.destroyMaterial(completed.presignatureHandle)).toBe(true);
  expect(session.wasFreed()).toBe(true);
});

function rejectIncompleteTerminalProgress(): void {
  // @ts-expect-error A final batch requires the public candidate point.
  const missingCandidate: ThresholdEcdsaPresignProgressResult = {
    stage: 'presign',
    event: 'final_batch_ready',
    outgoingMessages: [],
  };
  const terminal = {
    stage: 'presign',
    event: 'final_batch_ready',
    outgoingMessages: [],
    candidateBigR33: new ArrayBuffer(33),
  } as const;
  // @ts-expect-error A spread cannot smuggle completed material into a terminal batch.
  const prematureMaterial: ThresholdEcdsaPresignProgressResult = {
    ...terminal,
    outgoingMessages: [],
    presignatureHandle: 'unverified',
  };
  void missingCandidate;
  void prematureMaterial;
}
void rejectIncompleteTerminalProgress;
