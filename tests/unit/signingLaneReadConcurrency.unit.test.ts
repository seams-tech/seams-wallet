import { expect, test } from '@playwright/test';
import {
  readAvailableSigningLanes,
  type ReadAvailableSigningLanesPorts,
} from '@/core/signingEngine/session/availability/availableSigningLanes';

class GatedLaneReads {
  readonly started = new Set<string>();
  private readonly gate = Promise.withResolvers<void>();

  async readEd25519(): Promise<
    Awaited<ReturnType<NonNullable<ReadAvailableSigningLanesPorts['readActiveWalletSessionAuthorization']>>>
  > {
    this.started.add('ed25519');
    await this.gate.promise;
    return { kind: 'missing' };
  }

  async readEcdsa(): Promise<
    Awaited<ReturnType<NonNullable<ReadAvailableSigningLanesPorts['listCanonicalEcdsaLanesForWallet']>>>
  > {
    this.started.add('ecdsa');
    await this.gate.promise;
    return [];
  }

  release(): void {
    this.gate.resolve();
  }
}

async function emptySealedRecords(): Promise<
  Awaited<ReturnType<ReadAvailableSigningLanesPorts['listSealedRecordsForWallet']>>
> {
  return [];
}

test('lane discovery starts both curve authorization reads before either completes', async () => {
  const reads = new GatedLaneReads();
  const pending = readAvailableSigningLanes(
    {
      walletId: 'login-latency-test',
      ecdsaChainTargets: [{ kind: 'tempo', chainId: 42431 }],
    },
    {
      listSealedRecordsForWallet: emptySealedRecords,
      readActiveWalletSessionAuthorization: reads.readEd25519.bind(reads),
      listCanonicalEcdsaLanesForWallet: reads.readEcdsa.bind(reads),
    },
  );
  try {
    expect([...reads.started].sort()).toEqual(['ecdsa', 'ed25519']);
  } finally {
    reads.release();
    await pending;
  }
});
