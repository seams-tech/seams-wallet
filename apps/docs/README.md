# Seams documentation app

The docs are a VitePress application published under
`wallet.seams.sh/docs/`. The root route is the Start here guide; Wallet
marketing and the dashboard share the parent site.

## Local checks

```bash
pnpm -C apps/docs type-check
node apps/docs/scripts/check-links.mjs
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
