import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
const artifacts = '.artifacts/recovery-code-slots';
const origin = process.env.SEAMS_RECOVERY_INPUT_ORIGIN || 'http://127.0.0.1:4017';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({
  viewport: { width: 440, height: 800 },
  reducedMotion: 'reduce',
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
await context.tracing.start({ screenshots: true, snapshots: true });
try {
  const page = await context.newPage();
  await page.goto(`${origin}/recovery-slots.html`);
  const input = page.getByLabel('Recovery code', { exact: true });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(page.locator('.seams-recovery-code-slots .seams-otp-slot')).toHaveCount(32);
  await expect(continueButton).toBeDisabled();
  await page.screenshot({ path: `${artifacts}/empty.png` });

  // A printed code pasted with dashes, lowercase, and the letters Crockford reads as digits.
  await page.evaluate(copyToClipboard, 'o123–4567–89ab–cdef–ghjk–mnpq–rstv–wxyz');
  await input.focus();
  await input.press(`${modifier}+V`);
  await expect(input).toHaveValue('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  await expect(input).toHaveAttribute('inputmode', 'text');
  await expect(page.locator('.seams-recovery-code-count')).toHaveText('32/32');
  await expect(continueButton).toBeEnabled();
  await page.screenshot({ path: `${artifacts}/complete.png` });

  await input.press('ArrowLeft');
  await input.press('Backspace');
  await expect(input).toHaveValue('0123456789ABCDEFGHJKMNPQRSTVWXZ');
  await expect(continueButton).toBeDisabled();
  await expect(page.locator('.seams-otp-slot.is-caret')).toHaveCount(1);
  await page.screenshot({ path: `${artifacts}/editing.png` });
  await input.press('Y');
  await expect(input).toHaveValue('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  await input.press('Tab');
  await expect(continueButton).toBeFocused();
  await input.focus();
  await input.press('Enter');

  const passkeyChoice = page.getByRole('button', { name: 'Create a passkey', exact: true });
  await expect(passkeyChoice).toBeFocused();
  await expect(
    page.getByRole('button', { name: 'Continue with Google', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${artifacts}/method-choice.png` });
  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('0123456789ABCDEFGHJKMNPQRSTVWXYZ');

  await page.setViewportSize({ width: 320, height: 800 });
  await input.focus();
  const groups = page.locator('.seams-recovery-code-group');
  await expect(groups).toHaveCount(8);
  const tops = await groups.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().top)),
  );
  if (new Set(tops).size !== 2) throw new Error('Recovery groups must form two rows of four');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  // The menu animates its height to the wrapped copy; Continue must end inside it.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const switcher = document.querySelector('.seams-content-switcher');
        const button = document.querySelector('[data-recovery-continue]');
        if (!switcher || !button) return false;
        return button.getBoundingClientRect().bottom <= switcher.getBoundingClientRect().bottom;
      }),
    )
    .toBe(true);
  await page.screenshot({ path: `${artifacts}/mobile.png` });
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        slots: 32,
        formattedPaste: true,
        crockfordReadings: true,
        caretEditing: true,
        keyboardNavigation: true,
        methodChoice: true,
        mobile: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed the 32-character recovery input: paste, Crockford readings, caret editing, keyboard navigation, method choice, and mobile layout.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
