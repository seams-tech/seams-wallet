# Seams documentation app

The docs are a VitePress application published at
`docs.wallet.seams.sh/`. The root route is the Start here guide. Wallet
marketing and the dashboard link to this site.

## Local checks

```bash
pnpm -C apps/docs type-check
pnpm -C apps/docs check:links
node apps/docs/scripts/check-code-fences.mjs
pnpm -C apps/docs build
```

Runnable examples live under `src/examples` and are rendered into Markdown with
VitePress code imports. The docs type check compiles those source files against
the workspace SDK declarations.

## Keep docs and the public SDK together

Update the docs in the same change whenever a public SDK signature, result
union, configuration branch, package export, or public route changes. Add or
update a compiled example for runnable TypeScript and TSX. Label partial,
protocol, and application-specific examples so readers do not mistake them for
copyable SDK code.

Keep product language and the checked-in VitePress theme aligned with the
Wallet site when either surface changes.

## Release checklist

1. Check npm publication, release Git revisions, iframe protocol, and CLI separately.
   Replace the section in `src/releases.md` and `src/ja/releases.md` with the new
   release. The page shows only the current release; Git history keeps older notes.
   Label prepared changes explicitly.
2. Update installation, package READMEs, examples, affected API reference, and
   deployment instructions. Preserve historical evidence and migration conditions.
   Search `src` outside `releases.md` for the previous SDK, CLI, and iframe protocol
   versions. The sidebar and footer labels read the version from `packages/wallet`.
3. Reconcile concepts and diagrams with the numbered specifications and
   `docs/intended-behaviours.md`. Proposed capabilities need explicit availability.
4. Run the checks above. Compile examples against the exact published packages
   in an isolated consumer without workspace source aliases.
5. Preview the built root site. Check search, deep links, keyboard/mobile
   navigation, dark mode, diagrams, and copyable examples. Retain screenshots.
6. Run an existing substantial lifecycle E2E and retain sanitized proof artifacts.
   Document any infrastructure limit without changing behavior to satisfy a fixture.
7. Commit on `dev`. The private publication workflow builds that exact committed
   public revision and writes `seams-wallet-docs-artifact.json`. Verify its receipt
   on staging and production. Keep staging unindexed and retain the prior artifact.

The production canonical origin is `https://docs.wallet.seams.sh`. The base
path is `/`. Local preview uses VitePress at the root path. The private
repository deploys a staged static copy; it does not own another documentation
source tree.

## Languages

English lives at `/`. Japanese lives at `/ja/`.
Every English page has a Japanese counterpart. Navigation, search, footer,
diagram controls, and internal links follow the selected language.

Use the language selector in the sidebar or footer to switch editions. It keeps
the current page, query, and heading anchor.

Keep translated Markdown in `src/ja/`. Translate the title, description, prose,
tables, diagram labels, and code-fence titles. Import the same runnable examples
from `src/examples`; do not duplicate example code. Preserve the English heading
IDs with explicit `{#heading-id}` anchors. Add or update both editions together.
