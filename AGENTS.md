# Shared development workflow

- Work directly in `/Users/pta/Dev/rust/seams-wallet` on `dev`.
- Create branches or worktrees only when the user explicitly requests them.
- Coordinate Git operations with concurrent agents. Preserve their edits and stage
  only your own files; never commit another agent's staged work accidentally.
- Keep completed work committed on `dev`. Report any work that remains elsewhere.
- Preserve active worktrees until their owning agent has safely integrated the work.
