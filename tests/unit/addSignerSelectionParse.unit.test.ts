import { expect, test } from '@playwright/test';
import { normalizeAddSignerSelection } from '../../packages/shared-ts/src/utils/registrationSignerPlan';

const options = {
  normalizeEcdsaChainTarget: () => null,
};

function ed25519Selection(overrides: Record<string, unknown>): unknown {
  return {
    mode: 'ed25519',
    ed25519: {
      mode: 'create_implicit_near_account',
      signerSlot: 2,
      participantIds: [2, 1],
      keyPurpose: 'near',
      keyVersion: 'v1',
      derivationVersion: 1,
      ...overrides,
    },
  };
}

test.describe('add-signer selection parse', () => {
  test('accepts a valid Ed25519 selection with sorted participant ids', () => {
    const parsed = normalizeAddSignerSelection(ed25519Selection({}), options);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.mode !== 'ed25519') throw new Error('expected Ed25519');
    expect(parsed.value.ed25519.signerSlot).toBe(2);
    expect(parsed.value.ed25519.participantIds).toEqual([1, 2]);
  });

  test('refuses a missing or bad signer slot instead of using slot 1', () => {
    for (const signerSlot of [undefined, 0, 1.5, '2', Number.NaN]) {
      expect(normalizeAddSignerSelection(ed25519Selection({ signerSlot }), options).ok).toBe(
        false,
      );
    }
  });

  test('refuses a participant list with one bad entry instead of dropping it', () => {
    for (const participantIds of [[1, 'x', 2], [1, 0], [1.5, 2], []]) {
      expect(normalizeAddSignerSelection(ed25519Selection({ participantIds }), options).ok).toBe(
        false,
      );
    }
  });

  test('refuses a bad derivation version instead of rounding it', () => {
    for (const derivationVersion of [0, 1.5, '1']) {
      expect(
        normalizeAddSignerSelection(ed25519Selection({ derivationVersion }), options).ok,
      ).toBe(false);
    }
  });
});
