import { registrationIntentGrantFromString } from '@shared/utils/registrationIntent';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import { buildMpcMaterialActivationRefFixture } from './helpers/ecdsaMaterialRef.fixtures';
import { expect, test } from '@playwright/test';
import { parseRouterAbEd25519YaoRegistrationAdmissionRequestV1 } from '@shared/utils/routerAbEd25519Yao';
import { buildNearRegistrationAuthorityFixture } from './helpers/nearRegistration.fixtures';

function bearer(credential: string): Request {
  return new Request('https://wallet.test/registration/admit', {
    headers: { Authorization: `Bearer ${credential}` },
  });
}

function fixedClock(time: number): number {
  return time;
}

test('fresh verified authority resumes an expired grant without changing the admission request', async () => {
  const fixture = await buildNearRegistrationAuthorityFixture('resume');
  const originalNow = Date.now;
  const later = originalNow() + 120_000;
  Date.now = fixedClock.bind(undefined, later);
  try {
    expect(
      await fixture.adapter.authorize({
        kind: 'admit',
        request: bearer(fixture.credential),
        body: fixture.admission,
      }),
    ).toMatchObject({ ok: false, code: 'registration_intent_credential_expired' });
    const credential = 'wst_current-session';
    expect(
      await fixture.adapter.bindVerifiedContinuation({
        credential,
        admissionRequest: fixture.admission,
        expiresAtMs: later + 60_000,
      }),
    ).toMatchObject({ ok: true, admissionRequest: fixture.admission });
    expect(
      await fixture.adapter.authorize({
        kind: 'admit',
        request: bearer(credential),
        body: fixture.admission,
      }),
    ).toEqual({ ok: true });
    expect(
      await fixture.adapter.authorize({
        kind: 'admit',
        request: bearer(fixture.credential),
        body: fixture.admission,
      }),
    ).toMatchObject({ ok: false });
  } finally {
    Date.now = originalNow;
  }
});

test('fresh authority cannot replace the original wallet, key or activation attempt', async () => {
  const original = await buildNearRegistrationAuthorityFixture('original');
  const other = await buildNearRegistrationAuthorityFixture('other');
  expect(
    await original.adapter.bindVerifiedContinuation({
      credential: 'wst_current-session',
      admissionRequest: other.admission,
      expiresAtMs: Date.now() + 60_000,
    }),
  ).toMatchObject({ ok: false, code: 'registration_intent_conflict' });
  const changedKey = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1({
    scope: original.admission.scope,
    application_binding: {
      wallet_id: original.admission.application_binding.wallet_id,
      near_ed25519_signing_key_id: 'different-key',
      signing_root_id: original.admission.application_binding.signing_root_id,
      key_creation_signer_slot: original.admission.application_binding.key_creation_signer_slot,
    },
    participant_ids: original.admission.participant_ids,
  });
  if (!changedKey.ok) throw new Error(changedKey.message);
  expect(
    await original.adapter.bindVerifiedContinuation({
      credential: 'wst_current-session',
      admissionRequest: changedKey.value,
      expiresAtMs: Date.now() + 60_000,
    }),
  ).toMatchObject({ ok: false, code: 'registration_intent_conflict' });
  expect(
    await original.adapter.bindVerifiedContinuation({
      credential: 'wst_current-session',
      admissionRequest: original.admission,
      expiresAtMs: Number.NaN,
    }),
  ).toMatchObject({ ok: false });
  expect(
    await original.adapter.authorize({
      kind: 'admit',
      request: bearer(original.credential),
      body: original.admission,
    }),
  ).toEqual({ ok: true });
});

test('respond retry retains the first random activation after its authorization committed', async () => {
  const fixture = await buildNearRegistrationAuthorityFixture('respond-retry');
  const candidate = parseRouterAbEd25519YaoRegistrationAdmissionRequestV1({
    scope: {
      ...fixture.admission.scope,
      material_activation: routerAbMpcMaterialActivationRefToWire(
        buildMpcMaterialActivationRefFixture('new-proposal', fixture.intent.walletId, 'worker'),
      ),
    },
    application_binding: fixture.admission.application_binding,
    participant_ids: fixture.admission.participant_ids,
  });
  if (!candidate.ok) throw new Error(candidate.message);
  const rebound = await fixture.adapter.bindVerifiedIntent({
    kind: 'verified_registration_intent',
    registrationIntentGrant: registrationIntentGrantFromString(fixture.credential),
    intent: fixture.intent,
    admissionRequest: candidate.value,
    expiresAtMs: fixture.expiresAtMs,
  });
  expect(rebound).toEqual({ ok: true, admissionRequest: fixture.admission });
  expect(
    await fixture.adapter.authorize({
      kind: 'admit',
      request: bearer(fixture.credential),
      body: candidate.value,
    }),
  ).toMatchObject({ ok: false, code: 'registration_intent_subject_mismatch' });
});
