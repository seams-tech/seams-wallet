import { expect, test } from '@playwright/test';
import { parseEcdsaServerTiming } from '../../packages/shared-ts/src/utils/ecdsaServerTiming';
import { parseYaoServerTimingBuckets } from '../../packages/wallet/src/SeamsWeb/operations/registration/registrationTiming';

test('ECDSA diagnostics retain only known finite durations and omit descriptions', () => {
  const timing = parseEcdsaServerTiming(
    [
      'ecdsa_presign_material;dur=12.5;desc="private material metadata"',
      'ecdsa_presign_sw_session;dur=75',
      'ecdsa_presign_sw_do_total;dur=42',
      'ecdsa_presign_sw_session;dur=999',
      'ecdsa_sign_total;dur=200',
      'unknown_metric;dur=1',
      'ecdsa_presign_admit;dur=NaN',
      'ecdsa_presign_proxy;dur=-1',
      'ecdsa_presign_total;dur=Infinity',
      'ecdsa_presign_queue;dur=',
    ].join(', '),
  );

  expect([...timing]).toEqual([
    ['ecdsa_presign_material', 12.5],
    ['ecdsa_presign_sw_session', 75],
    ['ecdsa_presign_sw_do_total', 42],
    ['ecdsa_sign_total', 200],
  ]);
  expect([...parseEcdsaServerTiming(null)]).toEqual([]);
});

test('registration diagnostics retain each NEAR finalization phase', () => {
  expect(
    parseYaoServerTimingBuckets(
      [
        'near_finalize_authority;dur=101',
        'near_finalize_fingerprint;dur=2',
        'near_finalize_side_effect;dur=704',
        'near_finalize_cleanup;dur=95',
        'near_finalize_session_projection;dur=92',
        'near_finalize_session_seal;dur=87',
        'near_finalize_total;dur=904',
      ].join(', '),
    ),
  ).toEqual([
    ['nearFinalizeAuthorityMs', 101],
    ['nearFinalizeFingerprintMs', 2],
    ['nearFinalizeSideEffectMs', 704],
    ['nearFinalizeCleanupMs', 95],
    ['nearFinalizeSessionProjectionMs', 92],
    ['nearFinalizeSessionSealMs', 87],
    ['nearFinalizeTotalMs', 904],
  ]);
});
