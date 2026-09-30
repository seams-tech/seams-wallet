# R151: prepared authorization and complete Gateway request inventory

Date: October 1, 2026 (Japan time)

Implementation: `a2c936ed` (SDK authorization reuse) and `dad8f5e9`
(D1 status/material projection), both on `dev`.

## Change

The canonical SDK signing path read exact Wallet Session status during lane
selection, discarded that authorization at runtime setup, and read it again
before confirmation. It then refreshed status inside the material-use queue
after confirmation. The ECDSA-only three-device workload recorded all three
requests for each of its three owner signatures.

Runtime setup now receives the prepared signing session. It reuses the selected
lane's authorization after checking the existing capability-binding validator,
expiry, and remaining allowance. The post-confirmation refresh, supersession
checks, material hydration, and Gateway admission checks remain in place.
Authorization stays within one prepared operation; no cross-operation cache or
new persisted state is introduced. Auth-neutral material still requires step-up.

The runtime input requires a prepared session for secp256k1 and forbids it for
WebAuthn P256. Type fixtures cover missing preparation, direct invalid
construction, broad spreads, and casts between incompatible branches.

The hosted inventory then exposed a second sequential read inside each status
request: the joined session/authority/method/quota read was followed by a
canonical ECDSA signer-material read. Commit `dad8f5e9` projects those ECDSA rows
into the status statement, scoped to the configured signer namespace,
organization, project, environment, and session wallet. The existing
`EcdsaMaterialRead` parser checks material identity and conflicting activations.
Validation still follows the session lifecycle checks. Ed25519 material and
installed linked-authority resolution retain their existing readers. Signing
admission continues to validate current material atomically.

## Request evidence

The three-device workload now observes Gateway POST request starts, responses,
completion/failure, D1 headers, placement, and browser timing independently for
each browser context. Request identity binds late responses to their initiating
request. Explicit refill tags distinguish background and foreground generation;
other requests remain unclassified. Artifacts contain no request credentials or
bodies.

Each signature retains its complete observed harness window, including
overlapping background work and pending requests. The existing `responses`
projection contains only the two signing requests, preserving the meaning of
the five-call prepare/finalize analysis. A request inside a timing window does
not by itself establish a foreground dependency. Initial requests sent before
the observer attaches are outside its coverage.

Local before/after measurements show **three → two session-status requests**
per owner signature. Both linked generations issue zero status requests in
this ready-material workload and retain their existing signing path. This
inventory covers an ECDSA-only wallet; mixed NEAR/EVM lifecycle work can issue
additional status requests.

The extended custom-review E2E lets NEAR registration finish while the review
is open, verifies that signing prepare has not started, confirms the wallet
prompt, and proves that a new status read completes before prepare. The returned
Arc transaction recovers to the wallet's registered address. The artifact
records confirmation and request offsets, so the freshness boundary can be
checked independently.

Local evidence: `.artifacts/r151/session-read-20261001/`. Reproduce the request
inventory with the intended-behavior runner and
`passkey.device-linking.contract.test.ts --grep 'a linked device links a third device on an ECDSA-only wallet'`.
Reproduce the freshness check with
`passkey.registration.contract.test.ts --grep 'custom review requires wallet approval'`.

## Local validation

**21 scenario/profile checks passed:** seven each on Workers D1, wallet-DO,
and VM. The matrix covers the three-device chain, material retirement during
admission, first/warm/concurrent burst signing, live policy changes, last-use
quota races, custom review, and page-refresh/step-up/export lifecycle. Local D1
headers omit served-region metadata; regional claims require hosted evidence.
The three chains verified 27 signatures, the material-race scenarios rejected
27 retired-material attempts, and policy scenarios rejected 27 denied attempts.
All three custom-review signatures verified after the fresh status read.
SDK build, 156 static assets, build freshness, intended/state type checks, and
the bloat check passed. See `verification-summary.json` and the preserved
per-profile artifacts.
Two additional Workers checks pass for session reconciliation and signing
admission across deferred NEAR authority promotion. The admission scenario's
first attempt timed out during iframe READY before registration reached the
race; a fresh isolated attempt passed. The original failure is retained as an
infrastructure failure. Total: **23 passing scenario/profile checks**.

Two Email OTP attempts were stopped by the test harness's missing Google ID
token; the saved token was expired or near expiry. These are environment
failures before the relevant Email OTP actions, and provide no Email OTP
validation. A first version of the custom-review assertion incorrectly assumed
one status request for a mixed wallet. It was corrected to assert the actual
freshness boundary while retaining all observed requests.

After the D1 status/material projection, the same 21 scenario/profile checks
and both Workers NEAR-promotion races passed again: **23 passing checks on the
final implementation**. Evidence: `.artifacts/r151/status-material-20261001/`,
including `verification.json` and `near-promotion/run.json`. Server and SDK
builds and SDK freshness passed. All 1,829 JavaScript/MJS/WASM runtime files in
the rebuilt SDK are byte-identical to the SDK frozen for the hosted comparison;
see the r17 `runtime-comparison.json`.

## Hosted SDK comparison (r16)

Three fresh-wallet London cohorts verified **27/27 signatures** without failed
attempts or retries. The Gateway remained at `78a6a4c2`; the SDK changed from
`57388d7f` to `a2c936ed`. Automatic confirmation is included in SDK timing.
Readiness waits precede each measured signature; first linked signatures consume
precompleted presigns. No foreground refill occurred.

| Public SDK time | Before (r15) | Authorization reuse (r16) |
| --- | ---: | ---: |
| Owner median, n=9 each | 3,654.6 ms | 3,123.6 ms |
| Owner range | 3,530.5–3,718.4 ms | 2,864.8–3,614.1 ms |
| Linked median, n=18 each | 2,511.9 ms | 2,494.2 ms |
| Linked range | 2,335.1–2,995.0 ms | 2,305.8–3,176.4 ms |

The owner median improved 14.5%; linked timing was essentially unchanged.
Fresh wallets and measurement times differ. The r16 request inventory exposes
**nine owner D1 calls / ten SQL statements**: two status requests with two calls
each, plus five prepare/finalize calls. Both linked generations use five calls /
six statements. Every observed SQL statement reports the APAC primary. The
earlier five-call budget describes prepare/finalize only; r15 did not capture
the complete status inventory.

The owner's material-authorization stage had a 601.7 ms median; its fresh status
request had a 520.6 ms median. Each status trace contains the sequential signer
read addressed by `dad8f5e9`. The per-signature difference between that stage
and status duration had an 83.1 ms median, covering other local/scheduling work.

Evidence: `.artifacts/r151/regional-session-read-20261001-r16/`. Gateway
version-specific analytics record 792 LHR invocations. Role-DO aggregate
invocations span LHR/AMS/KIX and do not attribute individual signing RPCs.
Original Workers/images, inactive probes, default placement, and expired access
were verified after the cohort. Observed cumulative cost was $1.0232 at
September 30 17:49 UTC, subject to accounting lag.

## Hosted status/material comparison (r17)

The next three London cohorts verified **27/27 signatures**, with no failed
attempts, retries, or foreground refill. The SDK image and role builds remained
fixed; only the Gateway changed from `78a6a4c2` to `dad8f5e9`. Each status request
now contains exactly one D1 call. All SQL metadata still reports the APAC primary.
All six first linked signatures consume IDs recorded as ready before signing;
see `prefill-verification.json`.

| Complete observed foreground budget | Owner | Either linked generation |
| --- | ---: | ---: |
| Status HTTP requests | 2 | 0 |
| Prepare/finalize HTTP requests | 2 | 2 |
| D1 calls | 7 | 5 |
| SQL statements | 8 | 6 |
| Write-bearing calls | 2 | 2 |
| Reported rows written | 14 | 14 |

The owner drops from nine to seven D1 calls and ten to eight statements.
Prepare/finalize remains five calls/six statements. This complete budget applies
to the measured ready-material ECDSA-only flow; mixed-wallet initialization,
step-up, and immediate post-link signing have additional lifecycle work.

| Metric | Before (r16) | Status/material join (r17) |
| --- | ---: | ---: |
| Owner SDK median, n=9 each | 3,123.6 ms | 2,680.5 ms |
| Owner SDK range | 2,864.8–3,614.1 ms | 2,562.6–2,751.6 ms |
| Linked SDK median, n=18 each | 2,494.2 ms | 2,487.0 ms |
| Linked SDK range | 2,305.8–3,176.4 ms | 2,209.2–2,686.5 ms |
| Owner material-authorization median | 601.7 ms | 332.0 ms |
| Owner post-confirmation status median | 520.6 ms | 272.1 ms |
| Owner summed D1 wall median | 2,160 ms | 1,761 ms |
| Owner summed SQL execution median | 10.83 ms | 11.20 ms |
| Linked summed D1 wall median | 1,593 ms | 1,590.5 ms |

The owner SDK median improves another 14.2%, or 26.7% across both changes from
r15. Linked SDK timing changes by less than 1% in either comparison. These
small sequential cohorts use fresh wallets at different times; their observed
maxima do not establish a production maximum. The result supports removing
sequential reads while preserving the post-confirmation freshness boundary.
D1 wall time includes scheduling, binding, service, and transport overhead;
the difference from SQL time is not a measured regional-D1 benefit.

Evidence: `.artifacts/r151/regional-status-material-20261001-r17/`, especially
`summary.json`, `comparison.json`, `runtime-comparison.json`, and the complete
per-signature request traces under `weur/`. Gateway version:
`f52fae95-3cab-4fa7-80f3-5662176e3205`. Both cohorts use SDK image
`sha256:a30724afbb3d47a4a41d918553e6a4e735dac9ca1d0b402c0eafbff0e5b9d302`.
The copied SDK fields in each `gateway-source.json` were corrected to those
recorded deployed identities; the correction is annotated and changes no
Gateway source or generated-input hashes.

Version-specific adaptive analytics record 744 Gateway invocations in LHR.
Role-DO aggregate invocations span LHR/AMS/KIX, without attribution of individual
signing RPCs. See `placement.json` and `placement-summary.json`.

`restoration.json` verifies original Worker versions and container images, all
three probes inactive, default Gateway placement, probe HTTP 403, and ingress
HTTP 503. Observed cumulative benchmark spend is **$1.0530** at September 30
18:09 UTC against the existing $25 cap, subject to accounting lag. The evidence
scan found no benchmark-token matches. No regional database was provisioned.

## Remaining gates

The full 1–2 second maximum remains a gate. Regional D1 placement is owned by
[R152](refactor-152-regional-D1.md), with ownership proof required before an
isolated regional-primary experiment. Production rollout remains separate.
