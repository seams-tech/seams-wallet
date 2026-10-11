# R170 / R171 completion receipt

The four approved essential tasks are complete. The implementation is committed
on `dev`. The final source revision is `8ecbea72`, with protocol `14.0.0`.
Publication, deployment, and private exact-release adoption remain separate tasks.

## Result

- Custom email unlock uses `auth.requestEmailCode` and `auth.unlockWithEmailCode`.
  The host owns exact method selection, signer execution, routing, and activation.
  Google registration and hosted authentication retain `auth.startGoogleSignIn`.
- Replaced public methods, two specialized RPC routes, their payloads, and
  duplicate application adapters are removed. The public caller audit is complete.
- Five production email scenarios pass: hosted expiry/resend, custom mixed signing,
  NEAR-only signing, added email unlock, and pending ECDSA activation after reload.
- The final passkey lifecycle, cold/warm signed-out scenario, and durable
  presignature retention scenario pass. Five protocol-handshake checks pass.
- Relevant types, production build, packed declarations, runtime entry checks,
  build freshness, application dependency graphs, and bloat checks pass for the
  recorded build.

The durable pool had one record before lock, while locked, and after fresh unlock.
The original record survived. The wallet then signed a Tempo transaction.
The additional month-later clock simulation remains deferred. The product
requirement to retain otherwise-valid durable material remains unchanged.

## Measurements

Gzip sizes below sum each file in the stated application closure. React peers,
CSS, the wallet host, workers, and WASM are separate costs.

| Application closure | Baseline | Final | Reduction |
| --- | ---: | ---: | ---: |
| Root client, static imports | 739,640 B | 61,223 B | 91.72% |
| Root client, including lazy router | 793,388 B | 87,975 B | 88.91% |
| React provider, static imports | 747,087 B | 67,605 B | 90.95% |
| React provider, including lazy router | 803,630 B | 96,987 B | 87.93% |

Root and React provider application graphs contain no host execution or worker
managers. Those modules execute in the wallet origin.

| Observed static response bodies | Baseline | Final | Reduction |
| --- | ---: | ---: | ---: |
| Registration, signing, lock, unlock, signing | 11,031,734 B | 7,867,916 B | 28.68% |
| Cold signed-out mount and menu | 3,398,239 B | 987,550 B | 70.94% |
| Warm signed-out mount and menu | 0 B | 0 B | — |

The authenticated final total consists of 413,006 application bytes and
7,454,910 wallet-origin bytes. Wallet costs include 1,535,306 JavaScript bytes,
42,750 CSS bytes, 225,272 worker-script bytes, and 5,651,582 WASM bytes.
WASM used identity encoding in this local environment. Cold signed-out loading
started no cryptographic workers and downloaded no WASM.

Observed first/repeat signing durations were 706/693 ms for NEAR and 785/735 ms
for EVM. These are scenario observations. No paired latency improvement is claimed.
Authenticated HTTP caching was disabled by routing. Signed-out warm requests
could revalidate with zero response-body bytes. The scenario includes test-app
code, so its totals do not predict every application's download size.

## Source reduction and release handoff

Task-owned production patches since `0d45cb34^` added 10,477 lines and removed
12,934 lines: **2,457 fewer lines net**. Gross counts include code movement and
iteration. Counts exclude tests, type fixtures, documentation, generated output,
scripts, and identified concurrent work. The receipt lists the counted commits.

Use the [R171 migration map](refactor-171.md#complete-operation-migration-map)
and [final caller inventory](refactor-170-inventory.md#final-public-api-audit--2026-10-05)
for adoption. Six private demo-hook callers await the new exact release.
Deploy matching client and wallet-host assets. Protocol 14.0.0 rejects older peers.
The package manifests still say 0.8.0; these changes are unpublished.

Commands, build hashes, artifact hashes, source accounting, detailed timings,
collector limitations, and baseline comparisons are recorded in
[the machine-readable receipt](evidence/refactor-170-completion-20261005.json).
The [final flow evidence](evidence/refactor-170-final-flows-20261005.json) links
current verification and retained evidence for unchanged behavior.

A concurrent uncommitted edit to `packages/wallet-server/src/storage/tenantRoute.ts`
made the checkout freshness check stale after verification. That edit was preserved
and excluded from these commits. The build evidence applies to revision `8ecbea72`
and the recorded hashes, before the concurrent edit.
