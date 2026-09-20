# Refactor 128: Five durable presignatures with session-authorized refill

Status: implemented in draft PR #11, unreleased, 2026-09-20. Supersedes the session-independent
preprocessing credential proposal in optimization-10 section 4.5.

## Objective

Keep up to five unused ECDSA presignatures available per existing exact client
pool identity. Retain completed reusable material for 90 days. Whenever the
client can execute and has an unexpired, unrevoked session authorized for the
pool's wallet and active material, restore inventory and replenish any deficit.
After consuming an entry, schedule another refill to five.

Presignature generation must neither require nor consume remaining transaction
signing uses. A session with zero signing uses may still authorize preprocessing
until its expiry or revocation. Actual transaction signing keeps its current
quota, authentication, operation binding, and one-use admission rules.

The expected result is a fast first signature after weeks away when valid unused
material remains in this browser profile. Registration, unlock, and completed
signing must return without awaiting a full pool or NEAR activation.

## Baseline before implementation

- `workerManager/ecdsaPresignLifecycle.ts` caps durable client inventory at three.
- `config/defaultConfigs.ts` has target three and low-water mark two in the
  retention-only draft. Login prefill separately uses target three, trigger one, and a
  minimum of two remaining signing uses.
- `session/warmCapabilities/ecdsaLoginPrefill.ts` skips prefill below that minimum
  and accepts a signing-authorized capability. Post-sign refill in
  `flows/signEvmFamily/signers/secp256k1.ts` also depends on reusable signing
  authorization. Removing the login guard alone cannot complete this change.
- Server `router/transport/fetch/routes/thresholdEcdsa.ts`,
  `authorizeEcdsaPoolFill`, calls transaction admission with
  `operationKind: 'evm.sign_transaction'`. Its credential reader rejects an
  exhausted signing quota before preprocessing can proceed.
- Device-management authorization already distinguishes an exhausted signing
  allowance from an otherwise valid session. Its exhausted-session reader is a
  useful existing boundary; its result is a candidate requiring authorization
  checks, never a sufficient preprocessing grant by itself.
- `routerAb/ecdsaDerivation/presignaturePool.ts` restores encrypted IndexedDB
  entries, coalesces refill, and permits signing to consume the first ready entry.
  Pool identity includes wallet, relayer, scope, material activation and key
  epochs; it does not contain a session ID.
- `indexedDB/seamsWalletDB/ecdsaCapabilityManifestStore.ts` owns encrypted persistence,
  atomic capacity enforcement, and one-use claims. Reuse these mechanisms.

Paths above are relative to `packages/wallet/src/core/signingEngine`, except
`config/defaultConfigs.ts` and `indexedDB/...` under `packages/wallet/src/core`, and explicitly
identified server paths under `packages/wallet-server/src`.

Draft PR #11 already changes client, TypeScript server, and Rust reusable-material
retention to 90 days. That change has passed 200 Wallet unit tests, Wallet/server
type checks, state type fixtures, SDK build, and five focused Rust expiry tests.
Its IndexedDB test reopens a connection with a 30-day-old encrypted entry. The
implementation below adds five-entry inventory and quota-independent refill.
Both changes remain unreleased.

## 1. Separate preprocessing admission from signing admission

- Introduce the smallest precise preprocessing admission type for the existing
  live session. Reuse credential lookup and current authority/material validation.
  Preserve tenant, wallet, principal, applicable ECDSA capability/scope, session
  expiry, session retirement, factor/authority revocation, and material epoch
  checks. Validate these on pool initialization and continuation.
- Allow a zero transaction-use balance for this admission. Do not debit signing
  uses when generating material. Keep signing quota checks and atomic consumption
  in actual signing admission unchanged.
- Inspect the existing exhausted-session candidate reader and reuse its boundary
  where appropriate. Resolve the candidate into a validated preprocessing state;
  never pass a raw candidate directly to pool-fill execution.
- Separate preprocessing eligibility from signing readiness on the client. A
  zero-use transition must retain the still-valid session credential and access
  needed for preprocessing. Audit runtime teardown, post-sign scheduling, and
  capability resolution for implicit positive-quota requirements.
- Require the narrow preprocessing state in refill functions. Use discriminated
  states and exhaustive handling; reject passing it as signing/export authority
  through type fixtures. Keep exact-operation step-up preparation scoped to its
  existing single operation and short lifetime.
- Remove the obsolete minimum-remaining-uses option, result branch and associated
  constants/fixtures. Do not add an `ignoreQuota` flag to general signing admission.

No new long-lived token, credential persistence store, or session-expiry extension
is needed. Refill uses the existing authenticated session. Expired or revoked
sessions stop generation, including when they still have positive signing quota.

## 2. Use one five-entry inventory policy

- Set durable capacity and the default target depth to five. Align login and
  post-consumption triggers to refill any deficit (depth zero through four),
  sharing the existing policy instead of maintaining conflicting constants.
- Hydrate eligible durable entries before calculating the deficit. Count only
  available, unexpired entries for the exact pool. Keep atomic durable admission
  as the cross-tab capacity boundary; safely discard an excess completed entry.
- Generate one entry at a time using current concurrency controls. Coalesce
  duplicate requests; preserve foreground priority when signing awaits material.
  Other users' presignatures remain bound to their own pools.
- Capacity means five available client entries per exact pool and browser
  profile. It does not establish a global five-entry inventory across devices or
  cap orphaned server halves. Preserve server cleanup and existing resource limits.

## 3. Refill throughout the live session

- Schedule hydration/refill after registration or unlock makes material available,
  after session restoration/renewal, on online/resume while eligible, and after
  each consumption. Use existing lifecycle hooks where possible.
- Schedule refill after the last permitted reusable signature as well: zero
  remaining transaction uses is still eligible for preprocessing.
- Run refill outside registration, unlock, and signature completion. The first
  available entry is usable immediately while later entries are generated.
- Keep each ceremony bounded by session expiry and its existing short timeout.
  If the refill time budget ends below five, arrange a bounded follow-up while
  the session remains eligible. Reaching an attempt deadline must not silently
  strand a partial pool until another transaction occurs.
- Retry transient failures with bounded backoff using existing scheduling
  facilities; coalesce retries. Stop on expiry, revocation, or retired material.
  Resume after a newly valid session is established. Avoid repeated network work
  for a full pool or perpetual retries of authentication failures.
- Browser shutdown/suspension can stop execution. Retain completed entries and
  reconcile on return. Preserve explicit logout/reset cleanup and activation
  retirement semantics; ordinary session expiry alone should not invalidate
  reusable completed material.

## 4. Retain material safely for 90 days

- Keep the coordinated client/server/Rust retention changes from PR #11. Maintain
  separate short ceremony deadlines and exact-operation expiry limits.
- Preserve encrypted role-local storage and active-binding verification. Never
  upload the client share to support background work.
- Keep existing entries' authenticated expiration unchanged. Apply 90 days to
  newly generated reusable material; discard expired or incompatible entries.
- Preserve atomic one-use claiming and failure handling: consumed, reserved, or
  ambiguously used material must never return to the available pool.

## 5. Verification and contract updates

Update `docs/intended-behaviours.md`, refactor-126, and optimization-10 alongside
implementation. Add focused behavioral and type coverage for:

- Zero remaining signing uses plus a live scoped session permits pool init/step
  and leaves signing quota unchanged; actual signing still rejects exhaustion.
- Expired, revoked, wrong-wallet/tenant/scope, and retired-material requests fail
  preprocessing admission, including continuation of an existing ceremony.
- Preprocessing-only admission cannot enter signing/export flows; exact-operation
  authorization cannot become reusable background-fill authority.
- Five-entry capacity, sixth-entry rejection, concurrent tab admission and one-use
  claims, and refill after every consumption including the last signing use.
- Partial fill plus timeout/transient failure resumes without duplicate work;
  full pools cause no generation, and session expiry stops retry scheduling.
- Renewed sessions restore existing material before generation; a 30-day-old valid
  persisted entry decrypts and is claimed once. Keep old-expiry and tamper checks.
- Registration and unlock success remain independent of NEAR activation and pool
  fill. Session expiry, explicit logout, and material replacement exercise their
  distinct existing cleanup rules.

Run focused tests first, then relevant authorization/type fixtures, Wallet
lifecycle contracts and broader suites warranted by shared auth changes. Keep
the existing isolated browser-test server to avoid another checkout's Vite process.

## 6. Release and measure

1. Complete the code and contract changes in the Wallet repository; update draft
   PR #11 to describe the final five-entry, live-session behavior.
2. Publish coordinated exact Wallet/server versions after validation, then update
   monorepo pins and deploy through the existing release process. Respect the
   existing mainnet billing blocker; do not bypass it for performance validation.
3. On hosted testnet, verify inventory reaches five without blocking registration
   or unlock. Reload the same browser profile and verify restoration precedes
   generation. Exhaust signing quota and verify refill still completes while the
   session is live; verify signing still requests fresh authorization.
4. Measure Tempo and Arc separately: immediate use, restored hits, paced and burst
   signing beyond five uses, empty/expired pools, and session expiry during fill.
   Record cache depth, generation requests, refill duration, errors and signing
   latency using metadata only. Do not log presignatures or credentials.
5. Target 1–3 seconds from completed authorization to signature for cache hits,
   with zero presignature-generation rounds on those hits. Report authentication,
   registration/unlock, and chain submission separately. Use sufficient samples
   to report distributions; small smoke samples establish behavior only.

## Limits of this approach

Background generation requires executable client code, access to client material,
and a live authorized session. A closed browser cannot replenish. A user returning
after weeks benefits from retained unused entries and obtains fresh signing
authorization. Storage loss, a new device, retired keys, expiry, or consuming all
entries faster than refill can finish still produces a cache miss. A five-entry
pool reduces these misses; it does not increase generation throughput or remove
the separate work to shorten the measured roughly five-second generation path.


## Implementation checkpoint

- Implemented distinct client preprocessing capabilities and server preprocessing
  admission using the existing live identity reader. No new credential or token
  persistence was introduced. Signing admission still requires remaining uses.
- Aligned default depth, refill trigger, and atomic durable capacity through one
  five-entry constant; removed the minimum-signing-uses API option and login-only
  depth constants. Reconciled sealed runtime quota facts with current server status.
- Added session-bounded maintenance using the existing coordinator: serial refill,
  online/visibility resume, post-consumption wakeup, bounded transient backoff,
  continuation after an attempt budget ends, and expiry/invalidation cancellation.
- Added exhausted-session init/step, expiry, material/key rejection, restore,
  concurrent sixth-entry rejection, one-use, retry, and type-boundary coverage.
- Final local validation: all 208 Wallet unit tests pass, including real encrypted
  IndexedDB capacity/restore coverage. SDK build, Wallet/server type checks,
  Wallet-state type fixtures, intended-contract type checks, and the full workspace
  type-check pass. The local registration lifecycle
  contract is building its isolated full Worker stack; it is not yet a passed check.
- Release, hosted latency measurements, and production rollout remain pending.
