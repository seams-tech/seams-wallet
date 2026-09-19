import { expect, test } from '@playwright/test';
import { parseEcdsaServerTiming } from '../../packages/shared-ts/src/utils/ecdsaServerTiming';

test('ECDSA diagnostics retain only known finite durations and omit descriptions', () => {
  const timing = parseEcdsaServerTiming(
    [
      'ecdsa_presign_material;dur=12.5;desc="private material metadata"',
      'ecdsa_presign_sw_session;dur=75',
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
    ['ecdsa_sign_total', 200],
  ]);
  expect([...parseEcdsaServerTiming(null)]).toEqual([]);
});
