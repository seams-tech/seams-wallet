import { expect, test } from '@playwright/test';
import { WarmSessionPrfHandles } from '../../packages/wallet/src/core/signingEngine/workerManager/workers/passkeyMpcSession/warmSessionPrfHandles';

const sessionId = 'threshold-session-1';
const prfFirst = Buffer.alloc(32, 7).toString('base64url');
const newerPrfFirst = Buffer.alloc(32, 8).toString('base64url');

function storeSession(handles: WarmSessionPrfHandles, prfFirstB64u: string, remainingUses = 3) {
  handles.store({
    thresholdSessionId: sessionId,
    prfFirstB64u,
    remainingUses,
    expiresAtMs: Date.now() + 60_000,
  });
  const read = handles.read(sessionId);
  if (!read.ok) throw new Error(`stored session is not readable: ${read.code}`);
  return read.entry;
}

const serverPolicy = { ok: true, remainingUses: 9, expiresAtMs: Date.now() + 120_000 } as const;

test('a seal policy updates the entry that is still current', () => {
  const handles = new WarmSessionPrfHandles();
  const entry = storeSession(handles, prfFirst);

  expect(handles.applyPolicy(sessionId, entry, serverPolicy)).toEqual(serverPolicy);

  expect(handles.read(sessionId)).toMatchObject({
    ok: true,
    remainingUses: 9,
    expiresAtMs: serverPolicy.expiresAtMs,
    secret: { prfFirstB64u: prfFirst, expiresAtMs: serverPolicy.expiresAtMs },
  });
});

test('a seal that finishes after a clear does not put the session back', () => {
  const handles = new WarmSessionPrfHandles();
  const entry = storeSession(handles, prfFirst);

  handles.delete(sessionId);

  expect(handles.applyPolicy(sessionId, entry, serverPolicy)).toMatchObject({
    ok: false,
    code: 'not_found',
  });
  expect(handles.read(sessionId)).toMatchObject({ ok: false, code: 'not_found' });
});

test('a seal that finishes after a clear-all does not put the session back', () => {
  const handles = new WarmSessionPrfHandles();
  const entry = storeSession(handles, prfFirst);

  handles.clear();

  expect(handles.applyPolicy(sessionId, entry, serverPolicy).ok).toBe(false);
  expect(handles.read(sessionId)).toMatchObject({ ok: false, code: 'not_found' });
});

test('an older seal does not overwrite or delete a newer entry for the same session', () => {
  const handles = new WarmSessionPrfHandles();
  const olderEntry = storeSession(handles, prfFirst);
  const newerEntry = storeSession(handles, newerPrfFirst, 2);

  expect(handles.applyPolicy(sessionId, olderEntry, serverPolicy).ok).toBe(false);
  handles.deleteEntry(sessionId, olderEntry);

  expect(handles.read(sessionId)).toMatchObject({
    ok: true,
    remainingUses: 2,
    entry: { prfFirstHandle: newerEntry.prfFirstHandle },
    secret: { prfFirstB64u: newerPrfFirst },
  });
});

test('a seal policy failure deletes the entry that is still current', () => {
  const handles = new WarmSessionPrfHandles();
  const entry = storeSession(handles, prfFirst);

  handles.deleteEntry(sessionId, entry);

  expect(handles.read(sessionId)).toMatchObject({ ok: false, code: 'not_found' });
});

test('a seal policy still applies after uses were spent during the seal', () => {
  const handles = new WarmSessionPrfHandles();
  const entry = storeSession(handles, prfFirst);

  expect(handles.consume(sessionId, 1)).toMatchObject({ ok: true, remainingUses: 2 });

  expect(handles.applyPolicy(sessionId, entry, serverPolicy).ok).toBe(true);
  expect(handles.consume(sessionId, 2)).toMatchObject({ ok: true, remainingUses: 7 });
  expect(entry.remainingUses).toBe(7);
});

test('a rehydrate stores material only if the session was not cleared or replaced in flight', () => {
  const handles = new WarmSessionPrfHandles();
  const expiresAtMs = Date.now() + 60_000;

  const expectedInitial = handles.revision(sessionId);
  expect(
    handles.rehydrate({
      thresholdSessionId: sessionId,
      expected: expectedInitial,
      prfFirstB64u: prfFirst,
      remainingUses: 3,
      expiresAtMs,
    }),
  ).toEqual({ ok: true, remainingUses: 3, expiresAtMs });

  const expectedBeforeClear = handles.revision(sessionId);
  handles.delete(sessionId);
  expect(
    handles.rehydrate({
      thresholdSessionId: sessionId,
      expected: expectedBeforeClear,
      prfFirstB64u: prfFirst,
      remainingUses: 3,
      expiresAtMs,
    }),
  ).toMatchObject({ ok: false, code: 'not_found' });
  expect(handles.read(sessionId)).toMatchObject({ ok: false, code: 'not_found' });

  const expectedBeforeClearAll = handles.revision(sessionId);
  handles.clear();
  expect(
    handles.rehydrate({
      thresholdSessionId: sessionId,
      expected: expectedBeforeClearAll,
      prfFirstB64u: prfFirst,
      remainingUses: 3,
      expiresAtMs,
    }),
  ).toMatchObject({ ok: false, code: 'not_found' });

  const expectedBeforeStore = handles.revision(sessionId);
  storeSession(handles, newerPrfFirst, 4);
  expect(
    handles.rehydrate({
      thresholdSessionId: sessionId,
      expected: expectedBeforeStore,
      prfFirstB64u: prfFirst,
      remainingUses: 3,
      expiresAtMs,
    }),
  ).toMatchObject({ ok: false, code: 'not_found' });
  expect(handles.read(sessionId)).toMatchObject({
    ok: true,
    remainingUses: 4,
    secret: { prfFirstB64u: newerPrfFirst },
  });
});

test('claim returns the secret and spends uses only when asked', () => {
  const handles = new WarmSessionPrfHandles();
  storeSession(handles, prfFirst, 2);

  expect(handles.claim(sessionId, 1, false)).toMatchObject({
    ok: true,
    remainingUses: 2,
    prfFirstB64u: prfFirst,
  });
  expect(handles.claim(sessionId, 3, true)).toMatchObject({ ok: false, code: 'exhausted' });
  expect(handles.claim(sessionId, 2, true)).toMatchObject({ ok: true, remainingUses: 0 });
  expect(handles.readClaim(sessionId)).toMatchObject({ ok: false, code: 'not_found' });
});

test('an invalid PRF secret does not remove the stored session', () => {
  const handles = new WarmSessionPrfHandles();
  storeSession(handles, prfFirst);

  expect(() =>
    handles.store({
      thresholdSessionId: sessionId,
      prfFirstB64u: '  ',
      remainingUses: 1,
      expiresAtMs: Date.now() + 60_000,
    }),
  ).toThrow('Invalid passkey PRF material handle input');
  expect(handles.read(sessionId).ok).toBe(true);
});
