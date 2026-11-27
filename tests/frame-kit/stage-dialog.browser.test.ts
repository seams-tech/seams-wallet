import { expect, test, type Page } from '@playwright/test';
import type { Stage, StageDialog } from '../../packages/frame-kit/src/index';
import { FRAME_ORIGIN, openFrameKitApp } from './harness';

declare global {
  // The objects of one test, kept in the app page between evaluate calls.
  var stageTest: {
    host: StageDialog;
    stages: Stage[];
    dismissals: string[];
    loads: number;
  };
}

type Box = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

const BLANK_FRAME = '<!doctype html><html><body style="margin:0">Account</body></html>';

async function openStageApp(page: Page, reducedMotion: 'reduce' | 'no-preference'): Promise<void> {
  await page.emulateMedia({ reducedMotion });
  await openFrameKitApp(page, { blank: BLANK_FRAME });
  await page.evaluate(() => {
    globalThis.stageTest = {
      host: globalThis.frameKit.createStageDialog(),
      stages: [],
      dismissals: [],
      loads: 0,
    };
  });
}

/** Shows an element stage with a card of class `className`, and keeps its dismissals. */
async function showCard(
  page: Page,
  options: { className?: string; presentation?: 'modal' | 'drawer' } = {},
): Promise<void> {
  await page.evaluate(({ className, presentation }) => {
    const card = document.createElement('section');
    card.className = className;
    card.textContent = 'Review';
    const stage = globalThis.stageTest.host.show({
      content: { kind: 'element', element: card },
      title: 'Review',
      presentation,
      onDismiss: (reason) => globalThis.stageTest.dismissals.push(reason),
    });
    globalThis.stageTest.stages.push(stage);
  }, { className: options.className ?? 'card', presentation: options.presentation ?? 'modal' });
}

async function waitForModal(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.querySelector('dialog.seams-stage-dialog')?.matches(':modal'),
  );
}

async function dialogBox(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const rect = document.querySelector('dialog.seams-stage-dialog')!.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
}

function centred(width: number, height: number, viewport: { width: number; height: number }): Box {
  return {
    left: Math.round((viewport.width - width) / 2),
    top: Math.round((viewport.height - height) / 2),
    width,
    height,
  };
}

test.describe('stage dialog', () => {
  test('an element stage opens as a modal at its own size, in the centre', async ({ page }) => {
    await openStageApp(page, 'reduce');
    await showCard(page);
    await waitForModal(page);
    expect(await dialogBox(page)).toEqual(centred(360, 200, page.viewportSize()!));
    const state = await page.evaluate(() => {
      const dialog = document.querySelector('dialog.seams-stage-dialog')!;
      const [stage] = globalThis.stageTest.stages;
      return {
        label: dialog.getAttribute('aria-label'),
        filter: getComputedStyle(dialog).filter,
        current: stage!.isCurrent(),
        unobstructed: stage!.isUnobstructed(),
      };
    });
    expect(state).toEqual({
      label: 'Review',
      filter: 'drop-shadow(rgba(0, 0, 0, 0.22) 0px 12px 24px)',
      current: true,
      unobstructed: true,
    });
  });

  test('a frame stage is invisible and inert until its first size, and the page keeps its focus', async ({
    page,
  }) => {
    await openStageApp(page, 'reduce');
    await page.evaluate((url) => {
      document.getElementById('opener')!.focus();
      const { host, stages } = globalThis.stageTest;
      const frame = host.createFrame({ url, title: 'Account', permissions: ['passkeys'] });
      stages.push(host.show({ content: { kind: 'frame', frame }, title: 'Sign in', presentation: 'modal' }));
    }, `${FRAME_ORIGIN}/blank`);
    const preparing = await page.evaluate(() => {
      const dialog = document.querySelector('dialog.seams-stage-dialog')!;
      return {
        state: dialog.dataset.state,
        opacity: getComputedStyle(dialog).opacity,
        inert: dialog.inert,
        modal: dialog.matches(':modal'),
        focus: document.activeElement?.id,
        unobstructed: globalThis.stageTest.stages[0]!.isUnobstructed(),
      };
    });
    expect(preparing).toEqual({
      state: 'preparing',
      opacity: '0',
      inert: true,
      modal: false,
      focus: 'opener',
      unobstructed: false,
    });

    await page.evaluate(() => globalThis.stageTest.stages[0]!.resize({ widthCssPx: 400, heightCssPx: 300 }));
    await waitForModal(page);
    expect(await dialogBox(page)).toEqual(centred(400, 300, page.viewportSize()!));
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('IFRAME');

    await page.evaluate(() => globalThis.stageTest.stages[0]!.close());
    const closed = await page.evaluate(() => {
      const dialog = document.querySelector('dialog.seams-stage-dialog')!;
      return {
        open: dialog.open,
        state: dialog.dataset.state,
        frame: dialog.querySelector('iframe')?.dataset.layer,
      };
    });
    expect(closed).toEqual({ open: false, state: 'hidden', frame: 'idle' });
    // Firefox moves the focus out of a cross-origin frame through its parent process, so the
    // focus can arrive a moment after the close.
    await page.waitForFunction(() => document.activeElement?.id === 'opener', undefined, {
      timeout: 2000,
    });
  });

  test("the card radius is the app's --seams-shape-card value, with no cap", async ({ page }) => {
    await openStageApp(page, 'reduce');
    await showCard(page);
    await waitForModal(page);
    const radius = () =>
      page.evaluate(() => getComputedStyle(document.querySelector('.seams-stage-clip')!).borderRadius);
    expect(await radius()).toBe('16px');
    await page.evaluate(() => document.documentElement.style.setProperty('--seams-shape-card', '48px'));
    expect(await radius()).toBe('48px');
  });

  test('Escape and a press outside the box dismiss the current stage, and nothing else does', async ({
    page,
  }) => {
    await openStageApp(page, 'reduce');
    await showCard(page);
    await waitForModal(page);
    const dismissals = () => page.evaluate(() => [...globalThis.stageTest.dismissals]);

    await page.keyboard.press('Escape');
    expect(await dismissals()).toEqual(['escape']);
    expect(await page.evaluate(() => document.querySelector('dialog')!.open)).toBe(true);

    await page.mouse.click(5, 5);
    expect(await dismissals()).toEqual(['escape', 'backdrop']);

    const box = await dialogBox(page);
    const inside = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    await page.mouse.click(inside.x, inside.y);
    await page.mouse.move(inside.x, inside.y);
    await page.mouse.down();
    await page.mouse.move(5, 5);
    await page.mouse.up();
    expect(await dismissals()).toEqual(['escape', 'backdrop']);
  });

  test('a move keeps one dialog and one frame load, and only the new stage is current', async ({
    page,
  }) => {
    await openStageApp(page, 'no-preference');
    await page.evaluate((url) => {
      const frame = globalThis.stageTest.host.createFrame({ url, title: 'Account', permissions: [] });
      frame.addEventListener('load', () => (globalThis.stageTest.loads += 1));
    }, `${FRAME_ORIGIN}/blank`);
    await page.waitForFunction(() => globalThis.stageTest.loads === 1);
    await showCard(page);
    await waitForModal(page);

    const waiting = await page.evaluate(() => {
      const { host, stages } = globalThis.stageTest;
      const frame = document.querySelector('dialog iframe') as HTMLIFrameElement;
      const next = host.show({ content: { kind: 'frame', frame }, title: 'Confirm', presentation: 'modal' });
      stages.push(next);
      const [first] = stages;
      first!.resize({ widthCssPx: 800, heightCssPx: 600 });
      const { isCurrentStageMessage } = globalThis.frameKit;
      return {
        dialogs: document.querySelectorAll('dialog').length,
        firstCurrent: first!.isCurrent(),
        firstMessage: isCurrentStageMessage(first!, first!.instance),
        nextMessage: isCurrentStageMessage(next, next.instance),
        otherInstance: isCurrentStageMessage(next, first!.instance),
        unobstructed: next.isUnobstructed(),
      };
    });
    expect(waiting).toEqual({
      dialogs: 1,
      firstCurrent: false,
      firstMessage: false,
      nextMessage: true,
      otherInstance: false,
      unobstructed: false,
    });
    // The old stage stays on screen at its own size until the new stage has one.
    expect(await dialogBox(page)).toEqual(centred(360, 200, page.viewportSize()!));

    const moving = await page.evaluate(() => {
      const next = globalThis.stageTest.stages[1]!;
      next.resize({ widthCssPx: 400, heightCssPx: 300 });
      return next.isUnobstructed();
    });
    expect(moving).toBe(false);
    await page.waitForFunction(() => globalThis.stageTest.stages[1]!.isUnobstructed());
    expect(await dialogBox(page)).toEqual(centred(400, 300, page.viewportSize()!));
    const after = await page.evaluate(() => ({
      loads: globalThis.stageTest.loads,
      label: document.querySelector('dialog')!.getAttribute('aria-label'),
      card: (document.querySelector('dialog section')?.parentElement as HTMLElement).dataset.layer,
    }));
    expect(after).toEqual({ loads: 1, label: 'Confirm', card: 'idle' });
  });

  test('a stage is obstructed under a popover or a modal dialog that opens later', async ({
    page,
  }) => {
    await openStageApp(page, 'reduce');
    await showCard(page);
    await waitForModal(page);
    const unobstructed = () => page.evaluate(() => globalThis.stageTest.stages[0]!.isUnobstructed());
    expect(await unobstructed()).toBe(true);

    await page.evaluate(() => {
      const popover = document.createElement('div');
      popover.id = 'later-popover';
      popover.popover = 'manual';
      popover.textContent = 'Later';
      document.body.appendChild(popover);
      popover.showPopover();
    });
    expect(await unobstructed()).toBe(false);
    await page.evaluate(() => (document.getElementById('later-popover') as HTMLElement).hidePopover());
    expect(await unobstructed()).toBe(true);

    await page.evaluate(() => {
      const other = document.createElement('dialog');
      other.id = 'later-dialog';
      other.textContent = 'Later';
      document.body.appendChild(other);
      other.showModal();
    });
    expect(await unobstructed()).toBe(false);
    await page.evaluate(() => (document.getElementById('later-dialog') as HTMLDialogElement).close());
    expect(await unobstructed()).toBe(true);
  });

  test('a stage is clamped to the viewport, fills a small viewport, and a drawer fills it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openStageApp(page, 'reduce');
    await showCard(page, { className: 'card large' });
    await waitForModal(page);
    expect(await dialogBox(page)).toEqual({ left: 190, top: 16, width: 900, height: 688 });

    await page.setViewportSize({ width: 300, height: 560 });
    await page.waitForFunction(() => document.querySelector('dialog')!.dataset.box === 'fill');
    expect(await dialogBox(page)).toEqual({ left: 0, top: 0, width: 300, height: 560 });

    await page.evaluate(() => globalThis.stageTest.stages[0]!.close());
    await page.setViewportSize({ width: 1280, height: 720 });
    await showCard(page, { presentation: 'drawer' });
    await waitForModal(page);
    expect(await dialogBox(page)).toEqual({ left: 0, top: 0, width: 1280, height: 720 });
    const drawer = await page.evaluate(() => ({
      filter: getComputedStyle(document.querySelector('dialog')!).filter,
      radius: getComputedStyle(document.querySelector('.seams-stage-clip')!).borderRadius,
    }));
    expect(drawer).toEqual({ filter: 'none', radius: '0px' });
  });

  test('isStageHost accepts each host of version 1, and show refuses a foreign frame', async ({
    page,
  }) => {
    await openStageApp(page, 'reduce');
    const result = await page.evaluate(() => {
      const { isStageHost } = globalThis.frameKit;
      const show = () => {
        throw new Error('not used');
      };
      const foreign = document.createElement('iframe');
      document.body.appendChild(foreign);
      let refused = '';
      try {
        globalThis.stageTest.host.show({
          content: { kind: 'frame', frame: foreign },
          title: 'Foreign',
          presentation: 'modal',
        });
      } catch (error) {
        refused = error instanceof Error ? error.message : String(error);
      }
      return {
        own: isStageHost(globalThis.stageTest.host),
        copy: isStageHost({ stageHostVersion: 1, createFrame: show, show }),
        otherVersion: isStageHost({ stageHostVersion: 2, createFrame: show, show }),
        partial: isStageHost({ stageHostVersion: 1, show }),
        refused,
      };
    });
    expect(result).toEqual({
      own: true,
      copy: true,
      otherVersion: false,
      partial: false,
      refused: 'A frame stage needs a frame that this stage dialog made',
    });
  });
});
