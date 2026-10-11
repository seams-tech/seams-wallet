# R155F — Combined registration optimization measurement

Date: October 11, 2026. Measurement, signature verification, and restoration
readback are complete. The [JSON record](refactor-155f-combined-registration-hosted.json)
contains exact samples, component versions, traces, and verification results.

The complete implementation removes **six completed Gateway and Console D1
calls per registration**, from **34 to 28**. Calls through the first signature
fall from **41 to 35**. Every measured candidate wallet has the same counts.
The implementation is retained. This run does not establish an end-to-end
registration speedup.

## Conditions and source versions

- Existing staging testnet; Tokyo browser; APAC wallet home; Hong Kong deployment
  placement and current database bindings held fixed. No resources were created.
- Three fresh measured wallets per group, preceded by three discarded warm-up
  wallets. Order: baseline, complete candidate, identical baseline again.
- Public baseline `5ff8576c`; public candidate `0e00b591`.
- Private baseline `67fe153`; private candidate `0a85921`, which includes the
  Console implementation in `eb235b1`.
- The SDK payload from `a3dd064f`, generated WASM, and the four custody component
  versions stay fixed. This comparison isolates the remaining R155F batch from
  concurrent R155G work. It does not measure R155G's separate custody experiment.
- The 512-file input manifest covers bundles, migrations, configuration, scripts,
  SDK files, and original deployment settings. Private artifacts are in
  `seams-monorepo/.artifacts/r155f-combined-hosted/`.

The [local evidence](refactor-155f-combined-registration-local.md) records the
implementation, exact retries, cancellation, writer retirement, directory failures,
and regional concurrency checks. Private `7ed7399` updates the deployment fixtures.
All eight composed scenarios pass with the complete implementation.

## SDK timings

Values are median **(minimum–maximum)** in seconds. Registration excludes the
WebAuthn prompt. Signing excludes confirmation interaction. The combined value is
measured per wallet; it is not the sum of the two medians. Funding, chain
confirmation, and test-harness overhead are excluded.

| Workload | Baseline | Complete candidate | Repeated baseline |
| --- | ---: | ---: | ---: |
| NEAR-only registration | 3.785 (3.225–3.895) | **3.929 (3.263–3.972)** | 3.734 (3.727–5.272) |
| First independently verified signature | 0.743 (0.736–1.483) | **0.713 (0.636–0.718)** | 0.732 (0.718–1.045) |
| Registration plus first signature | 4.528 (3.961–5.378) | **4.647 (3.899–4.685)** | 4.772 (4.466–5.990) |

The candidate registration median is **144 ms slower than the first baseline**
and **195 ms slower than the repeated baseline**. Its unchanged Router Yao span
also increases: **1.261 / 1.413 / 1.270 s** in comparison order. This is an
observed timing regression in these samples. It does not establish that the
D1 changes caused the increase. The control ranges and unchanged stages show
substantial variation, and three samples per group cannot isolate its causes.

All three candidate registrations finish below four seconds under this metric.
The complete registration-and-signature flow still exceeds the four-second
target at its median and maximum. Neither result establishes a latency guarantee.
Keep the demonstrated call reductions; this run is not a reason to restore
redundant calls or start another individual-change comparison.

For reference, interaction-inclusive candidate SDK registration is **4.448 s
median (3.784–4.745 s)**. Its interaction-inclusive SDK flow is **5.465 s
(4.721–5.757 s)**. The harness-inclusive registration-to-verification span is
**6.101 s (6.028–6.806 s)**. These are separate metrics and must not replace the
interaction-excluded SDK measurements above.

## Removed database work

Counts are completed calls visible when each response is produced. Gateway
counts include the regional entry's deployment-routing read.

| Operation | Baseline calls | Candidate calls |
| --- | ---: | ---: |
| Gateway setup | 5 | 4 |
| Gateway respond | 6 | 5 |
| Gateway Yao execute | 2 | 2 |
| Gateway finalize | 10 | 9 |
| Console active lineage | 1 | 1 |
| Console registration setup | 4 | 4 |
| Console passkey claim | 2 | 1 |
| Console route publication | 2 | 1 |
| Console completion | 2 | 1 |
| **Registration subtotal** | **34** | **28** |
| Gateway first-sign prepare and execute | 7 | 7 |
| **Through first signature** | **41** | **35** |

Prepared SQL statements during registration fall from **117 to 113**:
Gateway **100 → 96**, Console **17 → 17**. These counts describe submitted
statements; they do not separately count SQL executed inside triggers.

All three measured wallets in each group have these respective counts.
The repeated baseline restores the original counts. Console trace coverage is
complete: three observations for each of five operations in every group, with
no pending or dropped Console calls. Gateway traces report one pending call at
setup and one at finalize in every group. Those unfinished background calls and
custody-role databases are excluded from the totals. Gateway and Console D1
traces report the served region **APAC**.

The Console change puts the existing deployment, writer, tenant, and resource
checks into each required mutation transaction. It adds no cache or approval
exchange. The trigger stores no rows. The Gateway change removes a redundant
setup read and groups respond and immutable-decision reads with existing batches.

## Remaining exchanges and preparation

- Each wallet still makes six application POSTs through first signing: four for
  registration and two for signing. Each group also records 18 browser CORS
  preflights and 15 proactive OPTIONS requests across its three wallets.
  These HTTP counts are identical in all groups.
- Registration makes five Console calls per wallet. First signing makes none.
  Required passkey claims and optional route publication remain concurrent and
  retain separate failure outcomes.
- Registration and first signing make zero session-status requests.
- Each wallet starts its Router object once. That request arrives before respond
  in all nine measured cases. Candidate lead times are **544, 887, and 578 ms**.
- Router pair preparation measures **313 / 291 / 287 ms median** in comparison
  order. Preparation overlaps other work; do not add overlapping stage medians.
- Browser finalization measures **817 / 843 / 1,070 ms median**. Its server span
  measures **536 / 560 / 686 ms**. Fewer calls do not establish a repeatable
  finalization latency reduction in this sample.

Warm-up reduces deployment-start effects. It does not prove that any particular
Worker or Durable Object was warm. No controlled cold-start result is claimed.

## Verification and restoration

All **18 comparison checks** pass. The baseline and repeated baseline serve
identical versions. Only the four Gateways, four Runtimes, and Console change
between baseline and candidate. Custody versions stay fixed. All observed
invocations match their expected versions.

All **nine NEP-413 signatures** pass an independent verifier. Changed signed
fields are rejected. The original payload verifies without relying on the SDK's
success result.

Independent readback confirms the original 13 Worker versions, all bindings and
placement settings, and both Deriver schemas are restored. The Console
transaction-check table is empty. All 512 frozen input hashes remain unchanged.
Additive Gateway tables and Console
migration `0091_console_deployment_write_checks.sql` remain in the existing D1
databases. Production rollout and package publication remain separate release work.
