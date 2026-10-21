# Tentative Japanese documentation — 2026-10-22

The Japanese edition covers installation and the four getting-started guides.
Each translated page displays a tentative-release notice. Other sidebar and
footer links open the English documentation.

## Routes

| English route                              | Japanese route                                |
| ------------------------------------------ | --------------------------------------------- |
| `/docs/`                                   | `/docs/ja/`                                   |
| `/docs/getting-started/create-wallet`      | `/docs/ja/getting-started/create-wallet`      |
| `/docs/getting-started/sign-with-policy`   | `/docs/ja/getting-started/sign-with-policy`   |
| `/docs/getting-started/delegate-or-rotate` | `/docs/ja/getting-started/delegate-or-rotate` |
| `/docs/getting-started/theming`            | `/docs/ja/getting-started/theming`            |

## Browser inspection

Inspected the production build with Chrome at `http://localhost:4019/docs/`.
No browser exceptions or failed resource requests occurred in the final docs flow.

- All five Japanese pages returned HTTP 200 with `lang="ja"`, translated titles,
  shared code examples, and the tentative-release notice.
- Switching from English to Japanese on
  `/docs/getting-started/create-wallet?source=language#read-the-result`
  preserved the page, query, and heading anchor. Refreshing the Japanese route
  loaded the page directly.
- English and Japanese selections displayed the current language in both selectors.
  The sidebar selector completed a round trip between the two editions.
- Selecting Japanese from the untranslated `/docs/reference/core` opened
  `/docs/ja/`. The Japanese sidebar retained a working English link to the reference.
- Searching for `署名` returned seven results, all in the Japanese edition.
- Japanese pages emitted their own canonical URL and reciprocal English,
  Japanese, and default alternate links.
- The 390px layout had no horizontal page overflow. The mobile menu exposed
  the Japanese search button, navigation, and language selector.
- Light and dark appearances displayed the Japanese notice and navigation.
- The Japanese Wallet and company marketing pages linked to `/docs/ja/`.
  Their English equivalents linked to `/docs/`.

Screenshots:

- [Desktop](docs-japanese-20261022/desktop.png)
- [Mobile menu](docs-japanese-20261022/mobile-menu.png)
- [Japanese search](docs-japanese-20261022/search.png)

To repeat the flow, build the docs, start `vitepress preview src --port 4019`
from `apps/docs`, and open the URLs above. Restart the static preview after a rebuild.

## Command checks

Passed:

- `pnpm -C apps/docs type-check`
- `pnpm -C apps/docs check:links`
- `node apps/docs/scripts/check-code-fences.mjs`
- `pnpm -C apps/docs build`
- `pnpm report:bloat --check`
- Formatter checks for the edited documentation and theme files
- `pnpm -C apps/seams-site typecheck` in the private repository

The private Wallet marketing typecheck reported an
`environment_or_infrastructure_failure`: concurrent SDK integration changes
require `WalletLocale`, `AppearanceConfig.locale`, and
`AccountMenuButtonMockProps.locale`, which are absent from its installed Wallet
package. This docs change does not alter those SDK integration files.

No unit or UI test files were added. No publication was performed.
