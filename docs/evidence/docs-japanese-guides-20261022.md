# Japanese guides and overview pages — 2026-10-22

Added 16 Japanese pages: the complete guides section and the Concepts, SDK
reference, Examples, Use cases, and Deploy and operate overview pages. The
Japanese edition now has 21 pages. Detailed reference, concept, example,
deployment, and use-case pages retain their English links until translated.

The translations preserve API names, release availability, and the English
heading IDs. The external EVM example is shared between both languages and
compiled with the other runnable examples. Release labels match Wallet 0.18.0.

## Verification

- All 16 new routes and their English equivalents returned HTTP 200.
- Each new Japanese page emitted `lang="ja"`, alternate links, and the tentative
  translation notice.
- Every translated page retained the same heading IDs as its English source.
- The Japanese sidebar opened translated guides and retained English links to
  untranslated reference pages.
- Searching for `ポリシー` returned the new policy guide and other Japanese pages.
- Switching languages on the transaction-review guide preserved
  `?source=translation#choose-validity-explicitly`. The destination survived reload.
- The 390px transaction-review layout had no horizontal page overflow.
- Light and dark appearances rendered the new content and code examples.
- The delegated-agent guide still states that no public agent-lane issuance API
  is available. Proposed features remain described as proposed.
- Chrome reported no page exceptions or failed resource requests in the inspected flow.

Passed commands:

- `pnpm -C apps/docs type-check`
- `pnpm -C apps/docs check:links`
- `node apps/docs/scripts/check-code-fences.mjs`
- `pnpm -C apps/docs build`
- `pnpm report:bloat --check`
- Formatter checks for edited files

The link check initially detected a documentation regression during the concurrent
0.18 release update: references to a retired release-specific heading. The links
now use the existing deployment article directly. The complete link check passed.

Screenshots:

- [Japanese guides](docs-japanese-guides-20261022/guides.png)
- [Transaction-review guide on a phone](docs-japanese-guides-20261022/review-mobile.png)

To repeat the language-switching flow, build the docs and run
`vitepress preview src --port 4019` from `apps/docs`. Open
`http://localhost:4019/docs/guides/transaction-review?source=translation#choose-validity-explicitly`
and choose Japanese in the sidebar menu. Restart the static preview after rebuilding.

No unit or UI test files were added. No publication was performed.
