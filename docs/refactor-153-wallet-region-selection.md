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
- Existing presignatures may be invalidated and regenerated after relocation.
  Preserve durable signing material and identities, consumed-material history,
  and operation results. Uninterrupted access to a ready presignature pool is
  not required.
- Shared tenant policy, identity uniqueness, and shared custody authorities retain
  their ownership boundaries. Determine which wallet-owned resources move.
- Automatic movement detection and placement decisions belong to R154.

## Assumptions to resolve and validate

- What relocation Cloudflare Durable Objects actually support, whether new
  destination objects are required, and how placement can be measured.
- Which D1, Router, Deriver, and SigningWorker state must follow the wallet, and
  whether the resulting topology materially improves end-to-end latency.
- Verify the binding-preserving transfer described below with actual signing,
  sealed-session restoration, and an offline device reconnecting after cutover.
- Who may change placement, how that action is authenticated, and which supported
  regions and custody configurations are eligible.
- What interruption is acceptable and how concurrent requests, conflicting moves,
  failed moves, and retries should appear to the owner.
- Validate pool invalidation without key or activation retirement, delayed refill
  completion, offline cache reconciliation, and regeneration cost. Confirm the
  cooldown and its treatment of failed attempts before implementation.

## Binding validation: paused server-side transfer

Question: can a paused, role-preserving server-side transfer keep every wallet
and device identity intact?

**The current binding contracts permit this, provided the destination remains
the same logical custody and authorization deployment.** Geography, D1 database
ID, and Cloudflare physical DO ID are absent from the material bindings examined.
The production authorization service accepted existing credentials against copied
records in an independent local D1 database. Complete signing and browser
continuity after a move still need an assembled E2E demonstration.

Adopt these constraints for the relocation design:

- Preserve wallet IDs, keys/addresses, authority and device IDs, factors,
  credential digests, session IDs, permissions, quota, and replay history.
- Preserve material activation references, activation epochs, signing-root
  metadata, revocation epochs, logical role/server IDs, signer-set identity, and
  the logical object names authenticated by stored ciphertext. A new placement
  generation is separate metadata; moving home does not rotate those identities.
- Preserve each role's encryption keys and versions, recipient/peer identity,
  and authenticated environment labels. Preserve the Gateway's server-seal
  secret and required key versions for Email OTP and sealed-session continuity.
  Provision each destination only with its own role's material and keys.
- Keep the public relayer URL, wallet/app origins, and passkey RP identity stable.
  Regional routing happens behind them. Client presign storage includes the
  relayer URL, and hosted credentials enforce the wallet origin.
- Change physical D1/DO locators independently from these stable identities.
  Current deployment tooling derives some protocol IDs from Worker names and
  encryption environment labels from deployment lanes. A regional deployment
  must not accidentally change those values or generate replacement keys.

No inspected binding requires an owner seed, device re-enrollment, new wallet
keys, or a new custody ceremony solely for this physical move. An offline
device should retain its durable signing material and credentials, subject to
their existing expiry and revocation rules, discard invalidated presignatures,
and resume through the stable endpoint.

The local probe copied two devices' authority/session records and a hosted
credential. Both devices retained exact authorization state; wrong scope and
origin were rejected, expiry still applied, and retiring one device's session
left the other active. It also reproduced a concrete import restriction:
inserting an already-consumed hosted exchange is rejected by the current schema.
Historical-state restoration needs an explicit path without reissuing identities
or replaying authorization transitions.

See the [binding evidence and probe](refactor-153-backend-relocation-validation.md#material-and-authorization-binding-validation)
for exact source references, reproducible checks, and limitations. Remaining
work is the transfer/import and fencing operation, role/key provisioning, shared
authority reconciliation, and an E2E move with both signing curves and an
offline device. The current code does not yet implement that handover.

## Presignature invalidation and relocation frequency

The owner accepts discarding existing presignatures and regenerating them after
a move. This lets the paused transfer resume with empty usable pools. Account
for in-flight operations first; preserve claimed/consumed identities, terminal
failures, replay records, quotas, and completed results. A lost signing response
must still return its original result on an exact retry.

Fence both signing and presignature admission at the source. A delayed refill
must not publish old material after invalidation or into the destination.
Reject stale cached presignatures at the server even if an offline device has
not yet learned about the move. On reconnect, each device reconciles placement,
discards obsolete cache entries, and obtains fresh paired material through the
normal client/server protocol. The transfer does not wait for every device to
refill; measure the extra latency of the first subsequent signature.

Current pool retirement only accepts key/activation retirement reasons, and
client pool generations are local memory. Add an explicit pool invalidation
boundary tied to authoritative placement without rotating wallet keys, material
activation references, or device identities. Preserve one-use tombstones so
deleting pool secrets cannot make the same presignature identity admissible again.
See the [follow-up source validation](refactor-153-backend-relocation-validation.md#presignature-invalidation-and-compute-limits).

Use a **proposed five-minute minimum between wallet relocation admissions** to
limit repeated regeneration. Enforce it server-side across all owner devices and
both manual and automatic requests, alongside one move in progress per wallet.
Keep this limit with the authoritative placement state so a move cannot reset it.
Selecting the current home is a no-op for transfer; retrying the same move resumes
its recorded outcome without scheduling another regeneration. Failed attempts
that incur work also need bounded retries; counting only successful moves would
leave a way to bypass the cost limit. Exact failure/backoff semantics and the
adequacy of five minutes remain validation questions. Refill should use bounded
normal demand rather than eagerly warming every offline device.

After those assumptions are resolved, add the implementation stages and focused
E2E scenarios with repeatable evidence. Storage schemas, APIs, transfer protocols,
and exact UI behavior remain open.
