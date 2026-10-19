# Hosted NEAR registration latency — October 19, 2026

## Result

One hosted request spent **2,698 ms waiting for Deriver B's preparation reply
 after Deriver A returned its completed protocol result**. The Router joined
both futures, although A's response already contains B's sealed completion.
The local fix stops that extra wait. It preserves validation, durable completion,
exact replay, and B's typed refusal when A fails. Hosted savings remain unmeasured.

The investigation also found a network-path change. The first 12 post-passkey
requests entered Cloudflare through Portland or Seattle. The historical cohort
used Tokyo for 122 of 132 requests. Later requests returned to Tokyo with both
HTTP/2 and default HTTP/3. HTTP/3 alone is therefore not an established cause.

The earlier recommendation to move optional pair preparation after the setup
response was incorrect. The hosted Gateway already schedules it with `waitUntil`.
The user selected the existing hosted menu and an unchanged public SDK API.
The [integration guide](../../apps/docs/src/deploy-and-operate/hosted-integration.md)
now explains that flow. `authMenu.prepare()` downloads code; opening the registration
view prepares the challenge. Direct `registerWallet()` still starts setup within its call.

## Comparable measurements

The after-passkey interval uses the recorded completion timestamps of the
passkey stage and SDK registration. This matches the historical analyzer and
excludes setup. Earlier chat estimates subtracted stage durations from the SDK
total, which included about 80–113 ms of earlier client work. Use the values below.
Browser console delivery can add small measurement overhead.

Twenty-one registrations and independently verified Ed25519 signatures passed.
The browser used local SDK assets under staging origins, virtual passkeys,
real network requests, and no request interception. All 14 recorded serving
Worker versions stayed unchanged during this investigation.

| Sequential arm | Wallets | After-passkey median | Post-passkey entry |
| --- | ---: | ---: | --- |
| Initial SDK 0.14 sample | 3 | 3.932 s | Portland / Seattle |
| Repeat SDK 0.14 sample | 3 | 3.328 s | Portland |
| SDK 0.14, HTTP/2 forced | 3 | 3.007 s | Tokyo |
| SDK 0.14, default transport restored | 6 | 2.511 s | Tokyo |
| Frozen SDK 0.13 assets | 3 | 1.580 s | Unknown: Gateway tail missing |
| SDK 0.14 assets restored | 3 | 2.493 s | Tokyo |

The six-wallet arm includes a **10.019 s** outlier; it was not discarded.
Its other five samples took 1.715–3.011 s. The final three SDK 0.14 samples took
1.914–2.687 s. Thus the expected 1.6–2.5 s range remains reachable, while slower
requests and a substantial tail remain.

The historical October 17 median was **1.618 s** across 66 wallets. That cohort
excluded its first three warm-up wallets, whose median was **3.567 s**.
Comparing today's initial sample directly with the historical steady-state
median overstated the difference. The frozen SDK comparison also does not
isolate a frontend regression: the arms ran sequentially and its ingress is unknown.

The [JSON record](near-registration-followup-20261019.json) retains per-sample
results, proof checks, version IDs, and raw-artifact hashes. Its initial sample
section includes full SDK totals; `hostedInvestigation` contains comparable
after-passkey measurements for all six arms.

## Facts and causes

| Fact | Instrument | Verification |
| --- | --- | --- |
| F1: 21 registrations produce valid signatures | Browser journeys and Node crypto with independent NEP-413 encoding | Changed message, recipient, nonce, and callback each fail verification |
| F2: initial 12 post-passkey requests enter at PDX or SEA; later default requests enter at NRT | Gateway request metadata in Wrangler tails | Counted from POST events; historical count is 122 NRT and 10 PDX |
| F3: slow request's A response completes at 3,790 ms; B preparation replies at 6,488 ms | Same Router invocation's spans and log timestamps | Trace-linked to `default-return/group-02/registration-3.json`; exact post-A interval is 2,698 ms |
| F4: B's outer object-call span is 6,005 ms; its object invocation is 590 ms with 281 ms CPU | B Worker and object tails joined by object ID | Object was already active; its admission batch is 36 ms |
| F5: B waits 2,425 ms for preparation during the same request | B's `await_preparation` span | A's protocol span is 256 ms and B's is 110 ms; these clocks do not measure CPU |
| F6: Router completion dispatch takes 835 ms in that request | Router's own transport span | Separate from the extra post-A wait |
| F7: role entries have CPU costs but no entry-isolate identity | Wrangler tails | Role-object counters exist and show prewarm completion; they do not identify entry isolates |
| F8: the existing Router fails when a real completed B preparation reply is withheld | Real-Worker E2E against the unchanged release binaries | Five-second watchdog fails; no protocol response is fabricated |
| F9: deployed Gateway and custody versions match October 17; Console differs | Serving-version snapshots | All versions remain unchanged during today's arms |

| Possible cause | Evidence | Conclusion |
| --- | --- | --- |
| Router waits for a reply it no longer needs | F3 and source `futures::join!` | Confirmed, fix implemented locally |
| US ingress adds request latency | F2 and slower first arms | Plausible contributor; sequential arms cannot quantify its causal cost |
| QUIC alone causes US ingress | Default HTTP/3 later enters Tokyo | Rejected as a sufficient explanation |
| The slow B request is entirely a cryptographic CPU delay | F4: measured object CPU is 281 ms, with a large outer-call gap | Rejected as a complete explanation |
| The slow B request is a fresh wallet-object start | F4: object handled setup earlier and reports a later command | Rejected for this request |
| Entry-isolate startup contributes | F7 cannot distinguish startup from first-use work | Unresolved |
| B's admission database batch alone explains the six-second call | F4: measured batch is 36 ms | Rejected for this request |
| Platform dispatch, reply, or storage-confirmation waits contribute | F4/F6 | Remains; available traces do not separate these waits |
| SDK 0.14 causes the whole slowdown | Frozen SDK arm is faster but lacks ingress evidence | Unresolved; not established by this comparison |
| Initial three samples represent steady-state latency | Historical excluded warm-up and today's later samples are faster | Rejected |

The two measured waits within B's call are not additive savings. B preparation
must finish before the protocol can use its input. The fix removes only the
extra reply wait after A has returned the completed A/B result. It does not
remove B's earlier preparation wait or Router's later durable completion.

## Local changes and checks

The Router polls B preparation and A execution concurrently. If A succeeds first,
it drops the pending preparation-response future and validates both protocol
outputs. If A fails, it awaits B to retain the same typed failure and retry rules.
`yao_router_role_execution` now ends when A returns and validation finishes.
Previously it also included the join wait. If B's response was not observed,
`yao_router_prepare_pair` is omitted; it is not reported as zero.

The new `preparation-reply-held` E2E forwards B's real request and reads its real
response, then withholds that response until the Router finishes. It also checks
completed role state, durable replay after Router eviction, no repeated protocol,
and an independent wallet. The control fails the watchdog as expected.
The candidate completes in 330 ms while that reply remains held. All five release
Worker builds pass. Twelve other ordering/fault scenarios pass, including both
arrival orders, lost replies, missing preparation, duplicate execution, cancellation,
and burned retries. Four regional journeys pass with eight independently verified
Ed25519/ECDSA signatures. These local journeys do not prove physical placement.
The JSON record includes the held-reply result, scenario list, signatures, and
candidate WASM hashes.

Gateway admission also has five new diagnostic spans: `yao_admission_state_read`,
`yao_admission_authorization`, `yao_admission_root_wait`, `yao_admission_backend`,
and `yao_admission_commit`. They separate a previously combined delay without
changing authority or retry behavior. The root span measures its remaining wait.
Completed attempts nest them inside `yao_admission_bind`; do not add parent and
child durations. A thrown attempt can lack the parent span. Failed awaited
operations retain their child span, and retries can repeat names.

The real D1 E2E verifies those diagnostics with an injected 25 ms commit delay,
lost requests, lost replies, exhausted retries, exact replay, and cancellation.
Server build, server type checks, wallet-state type fixtures, that E2E, and bloat
checks passed. Menu behavior was inspected; no new menu browser journey ran.

## Reproduction and limits

From `seams-wallet`:

```sh
pnpm -C packages/wallet-server type-check
pnpm -C tests type-check:wallet-state
pnpm -C packages/wallet-server build
node tests/e2e/registration-setup-startup.e2e.mjs
ROUTER_AB_WORKER_BUILD_PROFILE=release pnpm build:workers
ROUTER_AB_WORKER_BUILD_PROFILE=release node crates/router-ab-cloudflare/scripts/yao-peer-disconnect-evidence.mjs preparation-reply-held
pnpm report:bloat --check
git diff --check
```

Hosted artifacts are in the private repository under
`.artifacts/near-registration-followup-20261019/`. Run `summarize.py`, then
`investigate.py`, to reproduce the JSON record. Each arm's `verify-proofs.mjs`
independently checks its saved signatures. The existing hosted test and the
HTTP/2-only artifact harness use the same request flow and browser assets.
The HTTP/2 switch is an experiment, not a product configuration change.

These samples do not measure the previous three optimizations or the new Router
fix on hosted infrastructure. No package was published, no code was pushed, and
no service was deployed. A coordinated staging release and matched hosted run
remain necessary to measure the resulting latency distribution.

Entry-isolate startup needs an isolate identifier or provider trace. The remaining
Worker-to-object gap needs provider dispatch and reply timings. Current logs
locate that gap but do not prove its internal cause. No maintainer was contacted.
