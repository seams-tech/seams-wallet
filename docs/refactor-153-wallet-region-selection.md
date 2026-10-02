# Refactor 153: owner-controlled wallet region selection

Status: intent draft, October 2, 2026. Assumptions and platform capabilities need
validation before implementation details are added.

[Initial backend relocation validation](refactor-153-backend-relocation-validation.md)
records the Cloudflare capabilities, current storage hazards, local probe
results, and remaining hosted checks.

## Intent

Add a Wallet region setting so an owner who expects to spend time in another
region can explicitly choose a supported home for their wallet. Build on
[R152's per-wallet homes](refactor-152-regional-D1.md), extending the fixed-home
rule through a controlled relocation operation.

The setting applies to the whole wallet and all of the owner's devices. Show the
current home separately from a requested move and its progress. A selected region
remains the wallet's preference until the owner changes it.

This phase establishes the relocation operation that
[R154's automatic placement policy](refactor-154-automatic-wallet-relocation.md)
will later invoke.

## Working assumptions and boundaries

- One wallet has one owner using multiple devices. An eligible owner device can
  initiate a move for the wallet; other devices should not need to approve it or
  be online. Full-owner authority is the proposed eligibility boundary; exact
  permissions and fresh authentication requirements remain to be defined.
- Existing wallets will be deleted before rollout. Exclude existing-wallet
  migration, backfills, legacy formats, and compatibility paths. Relocation must
  still preserve wallets created after that reset.
- Preserve wallet keys and addresses, device permissions and revocations, quotas,
  and operation identities/results across a move. Offline devices should resume
  through the new home when they reconnect.
- At most one home may authorize wallet writes, including during crashes, stale
  routing, and retries. One-use signing material must remain single-use.
- Shared tenant policy, identity uniqueness, and shared custody authorities retain
  their ownership boundaries. Determine which wallet-owned resources move.
- Automatic movement detection and placement decisions belong to R154.

## Assumptions to resolve and validate

- What relocation Cloudflare Durable Objects actually support, whether new
  destination objects are required, and how placement can be measured.
- Which D1, Router, Deriver, and SigningWorker state must follow the wallet, and
  whether the resulting topology materially improves end-to-end latency.
- How custody and every device's material can be preserved, which owner
  participation is required, and whether offline-device continuity is feasible.
- Who may change placement, how that action is authenticated, and which supported
  regions and custody configurations are eligible.
- What interruption is acceptable and how concurrent requests, conflicting moves,
  failed moves, and retries should appear to the owner.

After those assumptions are resolved, add the implementation stages and focused
E2E scenarios with repeatable evidence. Storage schemas, APIs, transfer protocols,
and exact UI behavior remain open.
