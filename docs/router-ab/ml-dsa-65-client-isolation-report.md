# ML-DSA independent wallet clients

The Cloudflare screen now uses one persistent HTTP client per wallet.
It verifies forty-five load signatures; thirty-nine final HTTP requests finish below five seconds.
The median is 2.982 seconds. The maximum is 15.505 seconds, so the consistent five-second target remains unmet.
The [evidence](../evidence/ml-dsa-65-client-isolation-20261023.json) retains controls, failures, complete demand waits, and source hashes.

## Implemented change

Each simulated wallet owns a Node worker thread and its HTTP connections.
The parent keeps operation IDs, retries, signature verification, and capacity policy.
No private signing share enters these client threads.
Main-thread request duration includes serialization, dispatch, and result delivery.
Thread startup takes 43.339 ms before load and is recorded separately. First HTTP connection setup remains in request duration.

Timing records bind socket and session IDs to their client ID.
The collector keeps fetch-thread loop observations separate from the load driver's loop observations.
Client exit, timeout, synchronous dispatch failure, and closure preserve request identity and parent elapsed time.
Missing worker measurements remain unknown. They never become invented sends or successful server outcomes.

The TLS E2E exercises concurrent requests, invalid JSON, timeout recovery, closure during a request, repeated closure, and a request after closure.
Server intervals prove overlap between the independent clients. Both can report socket ID one without creating a false cross-client join.
The final closed-client refusal guard has a separate local check. The evidence includes the exact earlier client source used for the hosted run.

All three server Wasm binaries match the preceding campaign byte for byte.
Wallet-seed recovery, standard FIPS export, private commitments, and participant separation remain unchanged.
Preparation makes four candidates; signing consumes two at a time.
Capacity stays at thirty-two candidates per wallet, with sixteen required for admission.
One signing operation and one preparation producer can run at a time.
The saturation test uses a one-second cooldown. The production default remains sixty seconds.

## Hosted results

The signing load lasts twelve minutes. Both reserves return to their original capacity afterward.

| Measurement | Result |
| --- | ---: |
| Verified load signatures | 45 |
| Successful final HTTP requests below five seconds | 39/45 |
| Successful final HTTP median | 2.982 s |
| Successful final HTTP range | 1.139–15.505 s |
| Complete demand median | 22.017 s |
| Complete demand maximum | 120.883 s |
| Four-candidate producer invocation median | 9.323 s |
| Four-candidate producer invocation range | 7.938–14.028 s |
| Signatures after starting stock is consumed | 37 in 593.751 s |
| Observed rate in that window | 3.739 signatures/minute |

One demand remains unfinished after 95.361 seconds at cutoff.
Four admitted operations exhaust eight pairs each. Their material cost and elapsed time remain in the totals.
The driver retries those logical demands with fresh operation IDs. It does not retry unknown server outcomes.
The screen receives 430 empty-pool replies, twenty-seven service-capacity replies, and one cooldown reply.

Creation takes 8.947 and 7.995 seconds. Recovery takes 6.315 and 10.276 seconds.
All four ceremonies preserve the canonical key. Those times exclude 75.510–115.277 seconds of initial preparation.
Independent review verifies all forty-nine signatures, including four initial-stock signatures.
Altered messages and altered signatures fail verification.

The identity ledger balances thirty-two initial groups plus 146 fresh groups against 146 consumed and thirty-two final groups.
Every consumed group ID is unique. This includes 292 candidates across successful and exhausted operations.
Reserve restoration takes another 97.008 seconds.

All thirty-seven successful operations in the post-stock window use fresh groups.
One logical demand previously exhausted initial material. The rate therefore describes completed signatures in the window, not thirty-seven entirely fresh logical demands.
It is a two-wallet saturation observation. Browser behavior, production-cooldown behavior, and larger-service capacity remain unqualified.

Captured preparer-A invocation time is 15.672 seconds per verified load signature, including failed work and reserve restoration.
This is one role's captured wall time; full service-cost accounting remains incomplete.
Sixty-nine unidentified invocations are canceled. Sixty-five report zero CPU; four report one millisecond.
Their 2.325 seconds of wall time is included in the captured total.
The lower preparation duration cannot be attributed to the client change: server binaries are identical, while runtime conditions differ.

## Remaining latency

Median pre-send time among successful requests is 0.534 ms, compared with 156.532 ms in the preceding shared-client screen.
The maximum is 1.441 seconds. All eight successful requests above 100 ms pre-send use new connections.
There are no retained socket-queue joins. This is partly structural because each client permits one request at a time.
The calibrated TLS control and the measured pre-send times provide the stronger evidence.

Complete paired traces cover forty-three of forty-five load successes:

| Participant A signing use | Successes | Below five seconds | Median | Maximum |
| --- | ---: | ---: | ---: | ---: |
| First signing call in the module | 16 | 10 | 4.055 s | 15.505 s |
| Reused module | 27 | 27 | 2.239 s | 4.555 s |

All six slow successes are first signing calls on both roles and build four or five public execution topologies.
An execution topology maps public circuit instructions to evaluation layers and memory locations.
The schedule-cache flag only reports loaded schedules at trace creation. It does not classify prior signing use.

First use is a hypothesis, not an isolated cause. Ten first-use successes already finish below five seconds.
Every slow success also consumes at least four pairs. The longest successful retry sequence consumes fourteen pairs.
Two exhausted operations take 5.133 and 6.034 seconds on reused modules, with zero topology builds.
Thus, first-use work and long retry sequences need separate controls.

The 15.505-second success consumes five committed pairs. Participant A's invocation lasts 12.784 seconds and reports 2.565 seconds of CPU.
The client pre-send interval is only 0.224 seconds. Client queuing cannot explain that tail.
Service-clock marks place 10.934 seconds between activation and checked results across those pairs.
These boundaries include all intervening work and cannot isolate computation, transport, or scheduling.

All ninety-five preparer-B invocations report `ok`. The prior `loadShed` outcome does not recur.
This absence does not establish a fix or explain the earlier failures.

## Facts and remaining causes

| Fact | Instrument and check |
| --- | --- |
| Independent clients overlap | Local TLS server intervals, including timeout and closure controls |
| Failed clients retain evidence | Actual closure timings pass through the summary with missing send fields preserved |
| Server implementation is unchanged | Three frozen Wasm hashes match the preceding campaign |
| All signatures verify | Independent OpenSSL pass: forty-nine valid signatures; altered inputs fail |
| Stock is restored without reuse | Exact public identity sets and unique consumed IDs |
| First-use and retry effects remain | Exact module counters, topology counters, pair counts, and complete peer traces |

| Candidate cause | Assessment |
| --- | --- |
| Shared Node connections caused part of the previous delay | Supported by the TLS control and new pre-send observations |
| Client queuing explains the remaining long tail | Contradicted by participant invocations above five seconds |
| Public topology construction explains first-use tails | Plausible; initialization, runtime state, and retry count remain confounded |
| Reusing a module guarantees the deadline | Contradicted by two reused-module exhausted operations above five seconds |
| Runtime placement, scheduling, or CPU variation contributes | Unresolved; identical binaries do not control these conditions |
| Measurement behavior changes the workload | Retained as a limit; independent clients change contention and the campaign is longer |

## Next implementation work

1. Prototype precomputed public GMW topologies and compare fixed-work first-use and reused executions. Keep private material consumption unchanged.
2. Reduce the per-pair cost for long rejection sequences. Compare the existing half-gate engine for the private challenge hash while keeping bounds in GMW. Retain a change only if its preparation, bandwidth, and memory costs improve the complete design.
3. Reduce registration execution and initial-stock delivery costs separately. Then repeat the public browser SDK flow with the production cooldown.

These are bounded implementation targets. This screen changes client measurement, without claiming a new cryptographic speedup.
GPU work and UI changes remain deferred.
All five temporary Workers were deleted. The inherited bloat failure remains 14,030 duplicated Rust lines against a 13,754-line baseline.

## Repeat the client control

Run these commands from the Wallet repository with Node 26. The certificate is trusted only by this test process.

```sh
probe_dir=$(mktemp -d /private/tmp/ml-dsa-http-control.XXXXXX)
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes \
  -keyout "$probe_dir/control-key.pem" -out "$probe_dir/control-cert.pem" \
  -days 1 -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1'
NODE_EXTRA_CA_CERTS="$probe_dir/control-cert.pem" \
  node tests/e2e/ml-dsa-http-client.e2e.mjs "$probe_dir" "$probe_dir/evidence.json"
```

The evidence bundles retain the hosted driver, analysis scripts, exact client sources, public signature inputs, and file hashes.
Credentials, TLS private keys, and raw Worker tails are excluded.
