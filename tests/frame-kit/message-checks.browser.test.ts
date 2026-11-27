import { expect, test } from '@playwright/test';
import { FRAME_ORIGIN, openFrameKitApp } from './harness';

test.describe('frame kit message checks', () => {
  test('the request ledger settles each open request once', async ({ page }) => {
    await openFrameKitApp(page);
    const result = await page.evaluate(() => {
      const ledger = globalThis.frameKit.createRequestLedger();
      const requestId = ledger.open();
      return [
        ledger.isOpen(requestId),
        ledger.settle(requestId),
        ledger.settle(requestId),
        ledger.isOpen(requestId),
        ledger.settle('request-unknown'),
        ledger.settle(42),
        ledger.open() !== ledger.open(),
      ];
    });
    expect(result).toEqual([true, true, false, false, false, false, true]);
  });

  test('a window message counts only from the expected window at the expected origin', async ({
    page,
  }) => {
    await openFrameKitApp(page, { blank: '<!doctype html><body></body>' });
    const result = await page.evaluate((origin) => {
      const { createFrame, isMessageFrom } = globalThis.frameKit;
      const frame = createFrame(document.body, { url: `${origin}/blank`, title: 'Frame', permissions: [] });
      const source = frame.contentWindow;
      const expected = { origin, source };
      return {
        match: isMessageFrom({ origin, source }, expected),
        otherOrigin: isMessageFrom({ origin: 'http://other.frame-kit.test', source }, expected),
        otherWindow: isMessageFrom({ origin, source: window }, expected),
        opaque: isMessageFrom({ origin: 'null', source }, { origin: 'null', source }),
        noWindow: isMessageFrom({ origin, source: null }, { origin, source: null }),
      };
    }, FRAME_ORIGIN);
    expect(result).toEqual({
      match: true,
      otherOrigin: false,
      otherWindow: false,
      opaque: false,
      noWindow: false,
    });
  });
});
