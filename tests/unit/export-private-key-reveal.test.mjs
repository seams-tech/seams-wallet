import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceRevealState,
  createSpinningState,
  maskedPrivateKey,
  settlingState,
} from '../../packages/wallet/dist/esm/core/signingEngine/uiConfirm/ui/export-private-key-reveal.js';

for (const [scheme, syntheticKey] of [
  ['secp256k1', `0x${'0123456789abcdef'.repeat(4)}`],
  ['ed25519', `ed25519:${'123456789ABCDEFGHJKLMNP'.repeat(4)}`],
]) {
  test(`${scheme} reveal settles into masked text without storing the full key`, () => {
    const spinning = createSpinningState('fixture', scheme, false, 0);
    const masked = maskedPrivateKey(syntheticKey);
    assert.notEqual(masked, syntheticKey);
    assert.ok(masked.includes('xxxxxx'));
    assert.equal(masked.length, syntheticKey.length);
    assert.equal(masked.slice(-6), syntheticKey.slice(-6));
    const settling = settlingState(spinning, masked, 100);
    assert.equal(settling.prefix + settling.targetSlots.join(''), masked);
    assert.ok(!JSON.stringify(settling).includes(syntheticKey));
    const progressing = advanceRevealState(settling, 650);
    assert.equal(progressing.kind, 'settling');
    assert.ok(progressing.lockedSlots > 0);
    assert.ok(progressing.lockedSlots < progressing.targetSlots.length);
    assert.equal(
      progressing.slots.slice(0, progressing.lockedSlots).map(slot => slot.glyph).join(''),
      progressing.targetSlots.slice(0, progressing.lockedSlots).join(''),
    );
    assert.deepEqual(advanceRevealState(progressing, 1100), {
      kind: 'settled',
      entryKey: 'fixture',
    });
  });
}

test('reduced-motion loading uses stable placeholder glyphs', () => {
  const spinning = createSpinningState('fixture', 'secp256k1', true, 0);
  assert.equal(spinning.prefix, '0x');
  assert.equal(spinning.slots.length, 64);
  assert.ok(spinning.slots.every(slot => slot.glyph === 'x'));
  assert.equal(advanceRevealState(spinning, 100_000), spinning);
});
