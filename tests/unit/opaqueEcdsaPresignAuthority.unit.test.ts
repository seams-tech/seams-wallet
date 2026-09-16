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
  poolKey: 'pool-1',
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

  presignature_big_r_33(): Uint8Array {
    return new Uint8Array(33).fill(this.signatureByte);
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
    expiresAtMs: Date.now() + 30_000,
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
