import { expect, test } from '@playwright/test';
import {
  nearEd25519CapabilityRehydrationKey,
  nearEd25519LaneMatchesCapabilityRehydrationSubject,
  type NearEd25519CapabilityRehydrationSubject,
} from '@/core/signingEngine/session/warmCapabilities/nearEd25519CapabilityRehydration';
import { SigningSessionIds } from '@/core/signingEngine/session/operationState/types';
import { nearEd25519SignerBindingFromBoundaryFields } from '@/core/signingEngine/session/identity/exactSigningLaneIdentity';
import {
  buildDeferredNearEd25519AvailableLaneFixture,
  buildNearEd25519PasskeyAuthFixture,
} from './helpers/nearEd25519AvailableLane.fixtures';

test('rehydration selects the exact material authority from unscoped persisted lanes', () => {
  const thresholdSessionId = SigningSessionIds.thresholdEd25519Session(
    'threshold:near-rehydration',
  );
  const passkeyAuth = buildNearEd25519PasskeyAuthFixture();
  const passkeyLane = buildDeferredNearEd25519AvailableLaneFixture({
    label: 'near-rehydration-passkey',
    auth: passkeyAuth,
    thresholdSessionId,
  });
  const emailOtpLane = buildDeferredNearEd25519AvailableLaneFixture({
    label: 'near-rehydration-email',
    auth: {
      kind: 'email_otp',
      providerSubjectId: 'email-owner:near-rehydration',
    },
    thresholdSessionId,
  });
  const subject: NearEd25519CapabilityRehydrationSubject = {
    kind: 'material_identity',
    materialIdentity: {
      kind: 'near_ed25519_material_identity',
      signer: nearEd25519SignerBindingFromBoundaryFields({
        walletId: passkeyLane.walletId,
        nearAccountId: passkeyLane.nearAccountId,
        nearEd25519SigningKeyId: passkeyLane.nearEd25519SigningKeyId,
        signerSlot: passkeyLane.signerSlot,
      }),
      auth: passkeyAuth,
      thresholdSessionId,
    },
  };

  expect(nearEd25519LaneMatchesCapabilityRehydrationSubject(passkeyLane, subject)).toBe(true);
  expect(nearEd25519LaneMatchesCapabilityRehydrationSubject(emailOtpLane, subject)).toBe(false);

  const emailOtpSubject: NearEd25519CapabilityRehydrationSubject = {
    kind: 'material_identity',
    materialIdentity: {
      kind: 'near_ed25519_material_identity',
      signer: nearEd25519SignerBindingFromBoundaryFields({
        walletId: emailOtpLane.walletId,
        nearAccountId: emailOtpLane.nearAccountId,
        nearEd25519SigningKeyId: emailOtpLane.nearEd25519SigningKeyId,
        signerSlot: emailOtpLane.signerSlot,
      }),
      auth: emailOtpLane.auth,
      thresholdSessionId,
    },
  };
  expect(nearEd25519CapabilityRehydrationKey(subject)).not.toBe(
    nearEd25519CapabilityRehydrationKey(emailOtpSubject),
  );
});
