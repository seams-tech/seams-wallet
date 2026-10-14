# Registration completion and finalization — October 14, 2026

The SDK no longer waits for an informational startup diagnostic when it publishes
the registered session. Finalization reads the immutable Yao admission in its
initial D1 batch. This removes one later database round trip.

## Implementation

- `7caae2fa`: session observation starts the existing parity check without awaiting
  it. Previously, observation awaited the check, caught every error, and continued.
  The check can wait eight seconds for `/.well-known/webauthn`. Operations that
  require sealed-refresh parity still await and enforce it.
- `8b4dcf5f`: finalization batches the exact Yao ceremony record with its existing
  admission reads. The existing parser checks the lifecycle and reconstructs the
  admitted authority. The Router still owns execution consumption, rejects a
  different consumer binding, and replays the same binding. Add-signer continues
  to load its admission because it does not use this finalization batch.
- `e97be4be`: the browser contract distinguishes a pending diagnostic from one
  that already timed out. Cleanup leaves failed requests to browser-context
  disposal instead of trying to resume an aborted request.

The database change removes a round trip. It does not remove a SQL statement.
Completed retries retain lazy ceremony decoding. The change adds no schema,
configuration flag, cache, or infrastructure resource.

Material activation and export-capability creation remain sequential. Their
possible overlap was about five milliseconds in the cited sample. Overlap would
need capability cleanup if material activation failed. Required persistence,
lock checks, revocation checks, and session-before-result ordering remain intact.

## Facts and diagnosis

| Fact | Instrument | Evidence |
| --- | --- | --- |
| One of 99 earlier registrations had a 5,513 ms gap after `wallet_ready` | Browser console events received by the Node harness | Private `now0101-a/group-31/registration-2.json` |
| The other gaps had a 12.6 ms median; the second largest was about 19.9 ms | Same event stream | Review of all 99 samples |
| The session reader awaited an eight-second network diagnostic whose errors it ignored | Source review | `getWalletSession` and `sealedRefreshCapabilities.ts` |
| The candidate returns a registered session while that GET remains pending | Browser contract with a held GET | `candidate-proof/near-session-observation.json` attachment |
| Signing succeeds after the GET is released; explicit queries remain fresh and lock wins during a delayed status response | Same contract | Independent NEP-413 verification and lock assertions |
| Finalization previously loaded the same immutable admission through a separate D1 request | Source review | Request-scoped consumption runtime |

The historical event timestamps are receipt times in Node. They do not identify
which browser operation occupied the entire gap. The saved trace lacks the
well-known GET duration for that wallet.

| Candidate cause of the historical gap | Evidence | Conclusion |
| --- | --- | --- |
| Unnecessary parity wait | Eight-second timeout and an awaited diagnostic after wallet readiness | Demonstrated removable dependency; compatible with this outlier |
| Unconsumed seal cleanup | Successful hydration marks the preparation consumed before readiness | Excluded on the recorded success path |
| React refresh callback | No awaited refresh on this success path | Excluded as a direct awaited dependency |
| Browser scheduling, storage, or MessagePort delay | No complete browser trace for the outlier | Unresolved |

The old SDK failed the held-GET contract after reporting a parity timeout.
That negative run also exposed test cleanup waiting on the aborted request.
Its duration is not a latency benchmark. The production candidate passed the
corrected contract.

Do not attribute the historical 5.5 seconds entirely to the diagnostic. The fix
removes that known dependency without weakening any acceptance check.

## Correctness

Seven distinct browser contracts passed:

- Four NEAR contracts cover session publication, fresh status reads, lock races,
  admitted-work replay, lost finalization replies, failed server sealing, reload,
  exact-method unlock, and independently verified signing.
- Three mixed NEAR/ECDSA contracts cover finalization timing, overlapping admission,
  and reconciliation after rejected refill.

The held-GET contract also passed with the frozen production SDK build. SDK and
server builds, server type-check, intended-test type-check, wallet-state type
fixtures, and the bloat check passed. A separate read-only review found no scope,
replay, or snapshot defect.

The initial local test attempt failed because a test port was occupied. Tests ran
on separate ports afterwards. No production code changed for that failure.

## Measurement method

The comparison uses fresh NEAR-only implicit wallets, a Tokyo browser, and the
existing Singapore staging lane. Each completed wallet produces an independently
verified NEP-413 signature. It includes setup and excludes passkey interaction
where explicitly labelled. Blockchain funding and confirmation are outside this
workload.

Control source: `9f57952c`. Combined candidate: `8b4dcf5f`. Private host source:
`7e0b2fac`. Both SDKs use the same published 0.10.1 WASM binaries and production
JavaScript bundling. Concurrent ML-DSA source edits were excluded.

Only the APAC Gateway changes during the comparison. Its original version is
`007f559b-17c7-4b31-b71e-41ff3197346f`; the candidate is
`af416b4f-4828-4ac3-993c-b3c4179e4eee`. Database bindings, placement, Console, Runtime,
and custody Worker versions stay fixed. Protected activation follows each switch.

The first control arm overlapped a local negative browser test. Treat that arm as
supporting evidence. The candidate and repeat control run without that local test.
The repeat control checks time drift. A small comparison cannot establish p99.

Private raw records and scripts are under
`.artifacts/registration-completion-20261014/` in `seams-monorepo`.
`report.py` regenerates the comparison. The existing Singapore benchmark verifier
checks the saved signatures independently.

## Results

All 42 attempted wallets registered and produced a valid signature. Independent
verification rejected altered message, recipient, nonce, and callback data.
There were no registration or signing failures. Every observed post-passkey
Gateway request entered at NRT.

| Median, milliseconds | Initial control (12) | Combined candidate (18) | Repeat control (12) |
| --- | ---: | ---: | ---: |
| Registration after passkey | 1738 | 1752 | 1771 |
| Registration including setup, excluding passkey | 2676 | 2597 | 2456 |
| Registration plus first signature, excluding interaction | 3097 | 2922 | 2980 |
| Browser finalization | 571 | 480 | 566 |
| First signature | 512 | 347 | 414 |
| Server activation consumption | 87.5 | 38.5 | 53.0 |
| Session publication and return | 13.46 | 13.12 | 13.87 |

The consumption median fell from 53 ms in the repeat control to 38.5 ms in the
candidate. The removed D1 round trip is consistent with this difference. Browser
finalization also fell, but the data cannot attribute its entire reduction to the
batch change. The full-registration median did not improve consistently.

Normal SDK completion was already fast. The change removes its dependency on a
slow diagnostic; it is not expected to reduce normal completion by seconds.
Candidate publication and return ranged from 11.94 to 15.64 ms. The injected
network stall, rather than the ordinary median, verifies this change's benefit.

| Candidate workload | Median | Range |
| --- | ---: | ---: |
| After passkey | 1.752 s | 1.124–3.549 s |
| Registration including setup, excluding passkey | 2.597 s | 1.751–4.765 s |
| Registration plus first signature, excluding interaction | 2.922 s | 2.063–5.877 s |

Two candidate registrations exceeded four seconds with setup included. Four
combined registration-and-signature flows exceeded four seconds. No candidate
post-passkey registration exceeded four seconds. These are observed counts,
not a p99 estimate or a guarantee.

The slowest candidate took 4.765 s for registration and 5.877 s through its first
signature. Setup occupied 2.355 s; respond occupied 1.310 s; finalization occupied
0.957 s. Work after the finalization response occupied about 48 ms. Another slow
registration spent 3.242 s in respond. Neither sample showed the prior SDK
completion stall. These timings identify the slow stages, not their underlying
platform cause.

Both changes remain accepted because they remove unnecessary serialized work and
pass the ownership, retry, failure-recovery, and lock checks. No additional latency
claim is made from this small, time-separated comparison.

## Restoration

The first attempt to reactivate the original Gateway returned HTTP 409
`readiness_invalid`. It reported only a semantic readiness failure. A fresh check
found zero unfinished registrations in all four regional databases. The same
protected activation succeeded on attempt two, without database edits or other
Worker changes. The exact failed predicate remains unknown.

Candidate activation: GitHub Actions run `38517492323`. Original-version
reactivation: run `38518245449`, attempt 2. The repeat control verifies registration
and signing after restoration.

All 14 original Worker versions were restored. Twelve further registrations and
signatures passed on the restored lane. The candidate is committed locally and
has not been published. No additional Cloudflare resource was created.
