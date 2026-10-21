# Seams documentation app

The docs are a VitePress application published under
`wallet.seams.sh/docs/`. The root route is the Start here guide; Wallet
marketing and the dashboard share the parent site.

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
   Update `src/releases.md` with a dated baseline. Label prepared changes explicitly.
2. Update installation, package READMEs, examples, affected API reference, and
   deployment instructions. Preserve historical evidence and migration conditions.
3. Reconcile concepts and diagrams with the numbered specifications and
   `docs/intended-behaviours.md`. Proposed capabilities need explicit availability.
4. Run the checks above. Compile examples against the exact published packages
   in an isolated consumer without workspace source aliases.
5. Preview the built `/docs/` site. Check search, deep links, keyboard/mobile
   navigation, dark mode, diagrams, and copyable examples. Retain screenshots.
6. Run an existing substantial lifecycle E2E and retain sanitized proof artifacts.
   Document any infrastructure limit without changing behavior to satisfy a fixture.
7. Commit on `dev`. The private publication workflow builds that exact committed
   public revision and writes `seams-wallet-docs-artifact.json`. Verify its receipt
   on staging and production. Keep staging unindexed and retain the prior artifact.

The production canonical origin is `https://wallet.seams.sh/docs`. The default
base path is `/docs/`. Local preview uses VitePress with that base path.
The private repository serves a staged static copy; it does not own another
documentation source tree.

## Languages

English lives at `/docs/`. Tentative Japanese support lives at `/docs/ja/`.
The Japanese edition currently covers installation and the four getting-started
guides. The sidebar and footer link to the English edition for other topics.
A notice on each Japanese page states that translation is in progress.

Use the language selector in the sidebar or footer to switch editions. It keeps
the current page, query, and heading anchor when a Japanese translation exists.
For untranslated pages, selecting Japanese opens the Japanese start page.

Keep translated Markdown in `src/ja/`. Import the same runnable examples from
`src/examples`; do not duplicate example code. Preserve the English heading IDs
with explicit `{#heading-id}` anchors. Add each translated route to `japanesePages`
in `src/.vitepress/i18n.ts` so the sidebar, switcher, and alternate metadata agree.
