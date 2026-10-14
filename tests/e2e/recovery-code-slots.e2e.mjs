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
  await expect(page.locator('.seams-recovery-code-slots .seams-otp-slot')).toHaveCount(32);
  await page.evaluate(copyToClipboard, '0123-4567-89AB-CDEF-GHJK-MNPQ-RSTV-WXYZ');
  await input.focus();
  await input.press(`${modifier}+V`);
  await expect(input).toHaveValue('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
  await expect(input).toHaveAttribute('inputmode', 'text');
  await page.screenshot({ path: `${artifacts}/live-32-characters.png` });

  await page.goto(`${origin}/recovery-slots.html?slots=16`);
  await expect(page.locator('.seams-recovery-code-slots .seams-otp-slot')).toHaveCount(16);
  await page.evaluate(copyToClipboard, '4821–7396–2058–1643');
  await input.focus();
  await input.press(`${modifier}+V`);
  await expect(input).toHaveValue('4821739620581643');
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await input.press('ArrowLeft');
  await input.press('Backspace');
  await expect(input).toHaveValue('482173962058163');
  await input.press('4');
  await expect(input).toHaveValue('4821739620581643');
  await input.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Recover with Passkey', exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: `${artifacts}/preview-16-digits-mobile.png` });
  await writeFile(
    `${artifacts}/result.json`,
    JSON.stringify(
      {
        passed: true,
        previewSlots: 16,
        liveSlots: 32,
        formattedPaste: true,
        caretEditing: true,
        keyboardNavigation: true,
        mobile: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Passed 16-slot preview and 32-character live input: paste, caret editing, keyboard navigation, and mobile layout.',
  );
} finally {
  await context.tracing.stop({ path: `${artifacts}/trace.zip` });
  await browser.close();
}
