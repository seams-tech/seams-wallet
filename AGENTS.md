# Shared development workflow

- Work directly in `/Users/pta/Dev/rust/seams-wallet` on `dev`.
- Create branches or worktrees only when the user explicitly requests them.
- Coordinate Git operations with concurrent agents. Preserve their edits and stage
  only your own files; never commit another agent's staged work accidentally.
- Keep completed work committed on `dev`. Report any work that remains elsewhere.
- Preserve active worktrees until their owning agent has safely integrated the work.

# Keeping the codebase lean

Run `pnpm report:bloat --check` before committing. It fails when dead exports,
files over 2,000 lines, local copies of the basic validation helpers, comments
citing refactor numbers, Rust `allow(dead_code)` or duplicated lines grow past
`scripts/bloat-baseline.json`. The plan is `docs/cleanup-1.md`.

- Use the helpers in `packages/shared-ts/src/utils/validation.ts` instead of
  defining local copies.
- Name a union's variants beside the union with `Variant`
  (`packages/shared-ts/src/utils/variant.ts`) instead of repeating `Extract`.
- Delete the code a change replaces in the same change. Add no compatibility
  shims, flags or second paths.
- Export only what another file uses, and delete exports nothing uses.
- Do not cite refactor or phase numbers in code comments; say what the code does
  and why.
- Do not grow a file past 2,000 lines; split it along a real seam first.
