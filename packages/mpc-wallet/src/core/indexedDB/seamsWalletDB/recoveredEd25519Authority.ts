import type { ActiveWalletSessionV1 } from '@shared/device-linking/contracts';
import {
  replaceActiveWalletAuthorityEd25519MaterialActivationV1,
  type ActiveWalletAuthorityV1,
} from '@shared/authorization/walletAuthority';
import { SEAMS_WALLET_STORES } from '../schemaNames';
import { seamsWalletDB } from '../singletons';
import type { SeamsWalletTransactionContext } from './manager';
import { parseWalletAuthorityStorageRow, walletAuthorityStorageRow } from './repositories';
import { mpcMaterialActivationRefsEqual } from '@shared/utils/domainIds';
import {
  classifyRawSealedSessionRecord,
  storagePayloadFromSealedStoreRow,
} from '@/core/signingEngine/session/persistence/sealedSessionRecords';

/** Adopt only an Ed25519 activation change proved by the authenticated session's digest. */
export async function reconcileRecoveredEd25519Authority(input: {
  readonly session: ActiveWalletSessionV1;
  readonly previous: ActiveWalletAuthorityV1;
}): Promise<void> {
  const { session, previous } = input;
  if (
    previous.walletId !== session.walletId ||
    previous.authorityId !== session.authorityId ||
    previous.revocationEpoch !== session.authorityRevocationEpoch ||
    previous.authorityDigestB64u === session.authorityDigestB64u ||
    !previous.signerActivations.ed25519
  )
    return;
  const subject = session.capabilitySubjects.find(isEd25519SigningSubject);
  if (!subject || subject.kind !== 'sign') return;
  const replacement = await replaceActiveWalletAuthorityEd25519MaterialActivationV1({
    authority: previous,
    materialActivation: subject.materialActivation,
    updatedAtMs: Date.now(),
  });
  // Every other field, including permissions, principal and epoch, must still match.
  if (replacement.authorityDigestB64u !== session.authorityDigestB64u) return;
  await seamsWalletDB.runTransaction(
    [SEAMS_WALLET_STORES.walletAuthorities, SEAMS_WALLET_STORES.signingSessionSeals],
    'readwrite',
    adoptRecoveredAuthority.bind(null, previous, replacement),
  );
}

function isEd25519SigningSubject(
  subject: ActiveWalletSessionV1['capabilitySubjects'][number],
): boolean {
  return subject.kind === 'sign' && subject.keyFamily === 'ed25519';
}

async function adoptRecoveredAuthority(
  previous: ActiveWalletAuthorityV1,
  replacement: ActiveWalletAuthorityV1,
  context: SeamsWalletTransactionContext,
): Promise<void> {
  const store = context.store(SEAMS_WALLET_STORES.walletAuthorities);
  const current = parseWalletAuthorityStorageRow(await store.get(previous.authorityId));
  if (
    !current ||
    current.record.state !== 'active' ||
    current.record.walletId !== previous.walletId ||
    current.record.revocationEpoch !== previous.revocationEpoch ||
    (current.record.authorityDigestB64u !== previous.authorityDigestB64u &&
      current.record.authorityDigestB64u !== replacement.authorityDigestB64u)
  )
    throw new Error('Recovered Ed25519 authority changed before local adoption');
  if (current.record.authorityDigestB64u !== replacement.authorityDigestB64u) {
    await store.put(walletAuthorityStorageRow(replacement));
  }
  const previousActivation = previous.signerActivations.ed25519;
  if (!previousActivation) return;
  const seals = context.store(SEAMS_WALLET_STORES.signingSessionSeals);
  let cursor = await seals.index('wallet_id').openCursor(previous.walletId);
  while (cursor) {
    const parsed = classifyRawSealedSessionRecord(storagePayloadFromSealedStoreRow(cursor.value));
    if (
      parsed.kind === 'current' &&
      parsed.record.curve === 'ed25519' &&
      parsed.record.walletId === previous.walletId &&
      mpcMaterialActivationRefsEqual(
        parsed.record.ed25519Restore.materialActivation,
        previousActivation.materialActivation,
      )
    ) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
}
