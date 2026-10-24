import { IndexedDBManager } from '@/core/indexedDB';
import {
  parseMlDsaCustodyCommit,
  type MlDsaCustodyCommit,
} from '@shared/passkey-custody/mlDsaCustody';
import { exactRecord } from '@shared/utils/exactRecord';
import { requireCanonicalString } from '@shared/utils/validation';
import type { Variant } from '@shared/utils/variant';
import { normalizeRelayerBaseUrl } from '@/core/rpcClients/relayer/relayerHttp';
import { publishWalletAddSignerMlDsa } from '@/core/rpcClients/relayer/mlDsaRegistration';

const PREFIX = 'ml-dsa-publication:';
type JoinedCommit = Variant<MlDsaCustodyCommit, 'custodyAction', 'joined'>;
type PendingPublication = {
  readonly kind: 'pending_ml_dsa_publication_v1';
  readonly relayerUrl: string;
  readonly addSignerCeremonyId: string;
  readonly commit: JoinedCommit;
};

function keyOf(record: Pick<PendingPublication, 'relayerUrl' | 'commit'>): string {
  return `${PREFIX}${JSON.stringify([record.relayerUrl, record.commit.key.walletId, record.commit.key.signingKeyId, record.commit.key.operationIdB64u])}`;
}

function parsePendingPublication(raw: unknown): PendingPublication {
  const record = exactRecord(
    raw,
    ['kind', 'relayerUrl', 'addSignerCeremonyId', 'commit'],
    'pending ML-DSA publication',
  );
  if (record.kind !== 'pending_ml_dsa_publication_v1')
    throw new Error('Unknown ML-DSA publication record');
  const commit = parseMlDsaCustodyCommit(record.commit);
  if (commit.custodyAction !== 'joined')
    throw new Error('ML-DSA publication must preserve wallet custody');
  return {
    kind: 'pending_ml_dsa_publication_v1',
    relayerUrl: normalizeRelayerBaseUrl(requireCanonicalString(record.relayerUrl, 'relayerUrl')),
    addSignerCeremonyId: requireCanonicalString(record.addSignerCeremonyId, 'addSignerCeremonyId'),
    commit,
  };
}

/** Retains the verified public completion before the first publication request. */
export async function retainMlDsaPublication(input: {
  readonly relayerUrl: string;
  readonly addSignerCeremonyId: string;
  readonly commit: JoinedCommit;
}): Promise<void> {
  const record = parsePendingPublication({
    kind: 'pending_ml_dsa_publication_v1',
    relayerUrl: input.relayerUrl,
    addSignerCeremonyId: input.addSignerCeremonyId,
    commit: input.commit,
  });
  await IndexedDBManager.setAppState(keyOf(record), record);
}

export async function clearMlDsaPublication(input: {
  readonly relayerUrl: string;
  readonly commit: JoinedCommit;
}): Promise<void> {
  const key = keyOf({
    relayerUrl: normalizeRelayerBaseUrl(input.relayerUrl),
    commit: input.commit,
  });
  await IndexedDBManager.deleteAppState(key);
}

/** Startup retries only already verified completions. It never creates new material. */
export async function resumePendingMlDsaPublications(relayerUrl: string): Promise<void> {
  const expectedUrl = normalizeRelayerBaseUrl(relayerUrl);
  const entries = await IndexedDBManager.listAppStateEntriesByPrefix(PREFIX);
  for (const entry of entries) {
    try {
      const pending = parsePendingPublication(entry.value);
      if (keyOf(pending) !== entry.key || pending.relayerUrl !== expectedUrl) continue;
      const outcome = await publishWalletAddSignerMlDsa(
        {
          relayerUrl: expectedUrl,
          walletId: pending.commit.key.walletId,
          addSignerCeremonyId: pending.addSignerCeremonyId,
        },
        pending.commit,
      );
      if (outcome.ok) {
        await IndexedDBManager.adoptAddedMlDsaSignerAuthority(outcome.authority);
        await clearMlDsaPublication({ relayerUrl: expectedUrl, commit: pending.commit });
      }
    } catch (error: unknown) {
      console.warn('[ML-DSA] Verified publication remains pending locally:', error instanceof Error ? error.message : 'Unknown publication recovery failure');
      // Keep the exact completion for the next startup or unlock.
    }
  }
}
