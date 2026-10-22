# Japanese documentation coverage

Every English documentation source has a Japanese counterpart: 83 pages per
language, including the custom 404 page. This change adds 62 Japanese pages and
updates links in the 21 existing translations.

The sidebar, footer, page links, language switch, search, diagram controls,
code-copy controls, and accessibility labels follow the selected language.
The language switch preserves the page, query, and English heading IDs.
The release labels match the source release, 0.19.0.
Runnable examples import the shared TypeScript sources.
The partial-translation catalogue and fallback notice are removed.
Japanese table cells keep a readable minimum width on mobile.

## Verification

- The docs production build, type check, internal-link check, and code-fence
  classification passed.
- Chromium visited all 83 Japanese routes at 1440 × 1000 and 390 × 844.
  Both audits reported zero failures and zero browser exceptions.
- Every route returned Japanese HTML. Article, sidebar, and footer links stayed
  in Japanese. Code-copy labels were Japanese.
- Every English heading ID remained available in its Japanese counterpart.
  Diagrams rendered. Neither viewport produced horizontal page overflow.
- A separate journey switched English to Japanese and back while preserving a
  query and anchor. It searched Japanese content and opened a Japanese result.
- That journey copied the Japanese page and unchanged SDK code, checked Japanese
  copy feedback, changed diagram appearance, opened diagram source, used the
  mobile menu, and opened a missing Japanese route.
- The sitemap contains 164 regular pages: 82 per language. Both 404 pages are
  excluded.
- `pnpm report:bloat --check` passed.

## Repeatable local artifacts

The local artifact directory is `output/playwright/docs-ja/`. It contains the
route inventory, desktop and mobile audit scripts and JSON reports, the journey
script and report, screenshots, and `journey.zip` with browser trace snapshots.
These are local review artifacts.

Build before starting preview so its asset inventory matches the build:

```sh
pnpm -C apps/docs build
pnpm -C apps/docs exec vitepress preview src --port 4026 --host 127.0.0.1
```

In a separate terminal, run the retained scripts through Playwright CLI:

```sh
bash ~/.codex/skills/playwright/scripts/playwright_cli.sh --session seams-docs-ja open http://127.0.0.1:4026/docs/ja/
bash ~/.codex/skills/playwright/scripts/playwright_cli.sh --session seams-docs-ja --raw run-code --filename output/playwright/docs-ja/audit.js
bash ~/.codex/skills/playwright/scripts/playwright_cli.sh --session seams-docs-ja --raw run-code --filename output/playwright/docs-ja/audit-mobile.js
bash ~/.codex/skills/playwright/scripts/playwright_cli.sh --session seams-docs-ja --raw run-code --filename output/playwright/docs-ja/journey.js
```

The source changes are local to `dev`. Hosted publication uses the existing
private docs publication workflow.
