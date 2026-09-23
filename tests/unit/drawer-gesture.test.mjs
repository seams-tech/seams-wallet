import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drawerDragTranslate,
  shouldDismissDrawerDrag,
} from '../../packages/wallet/src/core/signingEngine/uiConfirm/ui/drawer-gesture.ts';

const rest = {
  startTranslatePx: 400,
  restTranslatePx: 400,
  sheetHeightPx: 800,
  viewportHeightPx: 800,
  minimumOverpullPx: 120,
};

test('downward drag follows the pointer while upward overpull is elastic', () => {
  assert.equal(drawerDragTranslate({ ...rest, deltaPx: 0 }), 400);
  assert.equal(drawerDragTranslate({ ...rest, deltaPx: 150 }), 550);
  assert.equal(drawerDragTranslate({ ...rest, deltaPx: -400 }), 200);
  const farther = drawerDragTranslate({ ...rest, deltaPx: -800 });
  assert.ok(farther > 0 && farther < 200);
  assert.equal(drawerDragTranslate({ ...rest, deltaPx: -600, viewportHeightPx: 1200 }), 100);
  assert.equal(drawerDragTranslate({ ...rest, deltaPx: -600, minimumOverpullPx: 600 }), 100);
});

test('drag starts from the current transform, including a zero rest position', () => {
  assert.equal(drawerDragTranslate({ ...rest, startTranslatePx: 500, deltaPx: -100 }), 400);
  assert.equal(
    drawerDragTranslate({ ...rest, startTranslatePx: 0, restTranslatePx: 0, deltaPx: 10 }),
    10,
  );
});

const slowDrag = {
  velocityPxPerMs: 0,
  totalDeltaPx: 0,
  durationMs: 1000,
  translatePx: 400,
  sheetHeightPx: 800,
};

test('flick thresholds include both directions and instantaneous or average speed', () => {
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, velocityPxPerMs: -0.599 }), false);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, velocityPxPerMs: -0.6 }), true);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, velocityPxPerMs: 0.699 }), false);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, velocityPxPerMs: 0.7 }), true);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, totalDeltaPx: -600 }), true);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, totalDeltaPx: 700 }), true);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, totalDeltaPx: 100, durationMs: 0 }), true);
});

test('slow release returns to rest unless within 50 pixels of fully closed', () => {
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, translatePx: 749 }), false);
  assert.equal(shouldDismissDrawerDrag({ ...slowDrag, translatePx: 750 }), true);
});
