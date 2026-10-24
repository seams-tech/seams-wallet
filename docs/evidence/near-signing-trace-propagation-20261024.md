# NEAR signing trace propagation — October 24, 2026

NEAR signing now retains one request trace through Gateway, Router, SigningWorker, and the SigningWorker wallet object.
Responses carry the nested timing fields through Gateway completion readback.
This change supplies diagnostic evidence. It does not establish a latency improvement.
PostgreSQL integration and provisioning remain deferred.
The [generated evidence](near-signing-trace-propagation-20261024.json) retains the verified joins, public signatures, source hashes, and replay results.
This record describes the ten-field candidate at `9493c3a1`.
The later cleanup below removes seven fields after the hosted capture.

## Local verification

All four selected lifecycle contracts passed with zero retries:

- Delegates prepared during review and required step-up after quota exhaustion.
- An added ECDSA signer signed NEAR, Tempo, and Arc before and after unlock, across a lost finalize response.
- Two NEP-413 signatures verified across reload, followed by a verified transaction signature.
- Finalize rejected changed operation evidence, replayed a discarded reply at exhausted quota, and rejected retirement.

The exact finalize retry retained zero remaining uses, one operation claim, and one audit event.
Its replay assertion compares parsed response JSON. It does not require equal response headers or raw bytes.
Independent Node crypto verification passed both saved message signatures and rejected changes to each signed field.
A separate repeat of the message/reload case matched all six browser trace IDs to one object command each.
All six replies retained the ten downstream timing fields.
An independent review reproduced every join, duration, source hash, and frozen SDK hash from the raw artifacts.
The first four-case run and an initial repeat omitted object logs because the local runner used warning-only logging.
The final repeat enabled normal Wrangler logging. Earlier runs remain in the artifact directory.

| Local diagnostic median, ms | Prepare, 3 requests | Finalize, 3 requests |
| --- | ---: | ---: |
| Router service exchange | 4 | 7 |
| SigningWorker object call | 3 | 4 |
| Object execution | 2 | 3 |

These local values check the instrument, including nonzero service waits.
They are not a controlled performance comparison and do not explain the hosted outliers.
The run used release Workers, local D1, wallet objects, automated passkeys, and stubbed chain RPC.
The run froze browser assets because separate UI work changed the shared SDK output.
The saved source hashes and frozen asset hashes matched after collection.

All five Worker builds, the native library build, intended-test type checking, and 38 Cargo lockfiles passed.

The earlier claim that the committed change passed the bloat check is withdrawn.
That check omitted newly added files before staging.
A later check of the complete `9493c3a1` commit found 13,779 duplicated Rust lines against the 13,754 baseline.
Its parent passed at 13,740 lines.
This is a maintainability regression in the diagnostic change.
The follow-up removes unhelpful timing code, without changing the baseline threshold.

## Follow-up cleanup after hosted capture

The [hosted capture](https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-hosted-trace-20261024.md) matched 44 requests through the wallet object.
Seven detailed fields read zero throughout that capture and could not establish their hosted costs.
The cleanup removes those fields and the temporary `timing` parameter from `fetch_wallet_request`.
It also removes their header plumbing, parser entries, and obsolete diagnostic assertions.
Validation, schema initialization, signing, persistence, response mapping, and trace forwarding keep their existing behavior.

Three measured call spans remain: `near_router_service`, `near_sw_wallet_call`, and `near_sw_handler`.
The existing object command log still carries the trace ID.
The [optimization plan](../optimization-11-NEAR.md#p2-reduce-measured-work-in-signing-dispatch-and-finalization) tracks the remaining diagnostic cleanup after the comparison.

All four lifecycle cases above passed again with zero retries.
All six message/reload/transaction requests matched one object command each and retained the three call spans.
Independent Node crypto verification passed both message proofs and rejected changes to each signed field.
All five release Worker builds, the server build, intended-test type checking, and 38 Cargo lockfiles passed.
The complete bloat check passed at 13,737 duplicated Rust lines, below the unchanged 13,754 threshold.

The cleanup artifacts live under `.artifacts/optimization-11-near/20261024-trace-cleanup/`.
Their analyzer verifies source hashes, build hashes, frozen SDK assets, trace joins, replay evidence, and test results.
The private hosted report retains this [separate cleanup evidence](https://github.com/seams-tech/seams-monorepo/blob/dev/docs/evidence/near-hosted-trace-20261024.json).
These checks establish local behavior and diagnostic preservation.
The cleanup was not deployed and establishes no hosted latency gain.

```sh
node .artifacts/optimization-11-near/20261024-trace-cleanup/verify-proofs.mjs
python3 .artifacts/optimization-11-near/20261024-trace-cleanup/analyze.py
```

## Implementation and measurement boundaries

Gateway creates each trace with the existing trace-context builder.
The proxy returns that identifier in `x-seams-trace-id`, including transport failures it catches.
Router and SigningWorker pass the identifier through their existing service and object transports.
The object includes it in `wallet_do_command_timing` beside the object identity and command ordinal.
Trace identifiers carry no authorization or routing authority.

The existing timing collector and parser now support both signing curves.
The parser accepts a fixed metric list and finite, nonnegative durations.
The Rust collector retains its limit of 12 peer metrics per merge.
The code moves HTTP transport and timing code out of oversized modules without duplicating their behavior.

| Response field | Observed boundary |
| --- | --- |
| `near_router_admission` | Router admission and request checks before the service call. |
| `near_router_service` | Router service request through response parsing, including the downstream work. |
| `near_sw_dispatch_setup` | SigningWorker dispatch setup, including runtime construction. |
| `near_sw_decode_validate` | SigningWorker request decoding and validation. |
| `near_sw_wallet_call` | SigningWorker call to its wallet object. |
| `near_sw_do_decode_validate` | Object command decoding and validation. |
| `near_sw_do_schema` | Object schema initialization calls. |
| `near_sw_do_execute` | Object execution, including signing and its existing transaction. |
| `near_sw_do_handler` | Object handler through its response construction. |
| `near_sw_handler` | SigningWorker handler through its returned response. |

Gateway retains its existing authorization, admission, proxy, completion, and total timing fields.
Completion readback remains the authority for the response body and status.
The Gateway adds current-request diagnostic headers afterwards.
Stored replay records contain no trace identifiers or timing headers.
An exact retry answered entirely by Gateway has no downstream timing from the original request.

## Correctness and evidence limits

The existing message-signing contract exercises two NEP-413 signatures across reload, then a transaction signature.
It retains public proofs and Gateway evidence even if an action fails.
Its response assertions check unique trace IDs and all ten downstream fields.
The final diagnostic repeat matched those IDs against the saved object logs.

The independent review identified four diagnostic failure paths during implementation:

- Fetched Worker responses can have immutable headers. SigningWorker copies them before adding timings.
- Gateway transport errors previously lost their trace. The error response now retains it.
- Router peer errors previously discarded peer timings. The collector now reads them before checking status.
- Gateway completion readback previously discarded upstream headers. The response now receives fresh diagnostics after readback.

Signing calculations, authorization decisions, transaction order, and stored terminal responses retain their existing behavior.
No deployment or hosted benchmark accompanies this change.
An exception that escapes the Gateway handler can still bypass diagnostic response headers.
Keep those failures in the ledger and retain their available platform request IDs.

Worker clocks advance across I/O and can omit synchronous CPU work.
A zero schema or admission duration cannot establish that its work costs nothing.
Object execution includes cryptography and storage. It does not isolate SQL duration or durable commit acknowledgement.
Nested spans overlap. Do not add them or subtract observations from different Workers to assign network or storage cost.

| Candidate explanation for hosted delays | Current evidence | Decision |
| --- | --- | --- |
| Missing request correlation | All six local requests matched their object commands. | Use the trace in the next hosted capture. |
| Gateway completion dominates | Earlier hosted completion medians were small beside the slow proxy spans. | Preserve durable completion and investigate the measured proxy work first. |
| Object schema calls or duplicate reads dominate | Source inspection alone cannot establish their hosted cost. | Retain the calls until correlated measurements identify a removable dependency. |
| D1, dispatch, or response delivery dominates | The existing hosted record cannot separate those causes. | No routing or storage change follows from this instrumentation. |

## Next measurement

Capture a bounded cohort on the current D1 deployment after the diagnostic build reaches that environment.
Join each browser request, Router event, SigningWorker event, and object command by trace ID.
Keep first, warm, reload, step-up, and failed requests separate.
Compare slow and typical requests within the same workload and deployment.
Use the measured boundary to choose one optimization and verify it against interleaved controls.

## Reproduction

The task artifacts live under `.artifacts/optimization-11-near/20261024-p2-implementation/`.
The local runner records its exact commands and rejects an existing output directory.
Use a fresh artifact directory for a new run.
The raw logs stay local. The committed JSON contains allowlisted diagnostics and public signature material.

```sh
node .artifacts/optimization-11-near/20261024-p2-implementation/verify-proofs.mjs
python3 .artifacts/optimization-11-near/20261024-p2-implementation/analyze.py
```

The E2E uses `passkey.ed25519-yao-local.contract.test.ts` with the existing Workers configuration.
The correlation repeat selects `public NEAR message signatures` and sets `WRANGLER_LOG=log`.
The generated evidence records the initial build failures and their corrections.
One server build overlapped SDK WASM regeneration. The subsequent sequential builds passed.
