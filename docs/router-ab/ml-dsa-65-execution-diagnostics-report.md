# ML-DSA execution diagnostics and deadlines — October 16, 2026

This change separates signing-dispatch outcomes, bounds the Router's key-generation service call, and waits for B's normal socket closure before A returns.
The final two hosted signatures verify without the earlier runtime shutdown error. They take 9.980 and 5.749 seconds and miss the target.
Registration remains above five seconds. Public Wallet integration remains gated.
It preserves wallet-seed recovery, canonical FIPS export, the passive model, and separate role storage.
It changes no circuit, nonce procedure, rejection bound, or admission policy. GPU work remains deferred.

## Scope

The Router now records a public operation identifier and one dispatch outcome:

- Signed, with consumed batches and evaluated candidates.
- Exhausted, with the same counts.
- Dispatch error, separated into request, HTTP status, body reading, and response decoding.
- Deadline or clock error from the existing deadline wrapper.

These events precede Router signature verification and settlement. A signed dispatch event alone does not establish a successful client request.
The collector retains these fields without response bodies, signatures, credentials, or private material.
Final operation status remains authoritative. Logging does not control admission, signing, or settlement.
An error event cannot supply candidate counts that were never returned by the executor.

The key-generation RPC now ends at the admitted claim deadline. Optional storage initialization retains its existing bound.
Dropping the caller's future does not establish cancellation of remote work.
Activation, stock installation, and final registration completion remain outside this timer.
A deadline limits a stalled request. It does not reduce healthy-request latency.

## Validation boundary

The new local E2E delays delivery of Execute until two seconds after claim expiry.
It checks the Router's deadline, rejection of late delivery, failed replay after restart, and replacement with a distinct preparation reservation.
It then runs normal registration and canonical recovery through the real Worker routes.
This scenario tests a stall before A starts. Interruption during key generation remains a separate test requirement.

The [deadline E2E](../evidence/ml-dsa-65-registration-deadline-local-20261016.json) passes.
The stalled call returns after 30.059 seconds. Late delivery returns HTTP 500, and failed replay survives restart.
Fresh creation and recovery take 1.493 and 1.483 seconds locally. The first signature verifies in 0.383 seconds.
Recovery preserves cooldown, so that request produces no second signature sample.
The [native lifecycle campaign](../evidence/ml-dsa-65-execution-lifecycle-20261016.json) also passes.

The [first fault-harness run](../evidence/ml-dsa-65-deadline-harness-failure-20261016.json) fails its follow-up probe after the Router reaches its deadline.
Classification: `valid_test_needs_update`. That probe awaited a promise tied to the cancelled request.
The correction stores request data and sends the late request from a separate invocation. Production behavior did not change for this correction.

## Hosted baseline with diagnostics

The [hosted client artifact](../evidence/ml-dsa-65-dispatch-hosted-20261016.json) passes functional checks and fails the five-second target.
Its [sanitized traces](../evidence/ml-dsa-65-dispatch-hosted-traces-20261016.json) identify both signed executor results and the runtime error class.

| Measurement | Create | Recovery |
| --- | ---: | ---: |
| Preparation: keygen plus four signing batches | 156.820 s | 193.909 s |
| Complete registration with client verification | 6.961 s | 8.809 s |
| Successful signing with settlement | 2.773 s | 2.799 s |
| Consumed signing batches | 1 | 1 |
| Evaluated candidates | 4 | 4 |

Both B signing invocations end with the `runtime_hung_response` category, despite verified client signatures.
Each invocation contains two identical exception entries. Two affected invocations produced four exception entries.
A/B Wasm hashes match the previous campaign. Only the Router binary changed in this baseline.
The hosted runner started before the local fault-probe correction. That correction changes only the disabled local fault path.

## Socket lifecycle control

B previously closed its signing and refill sockets only on error. Dropping the Rust event stream removes its listeners without closing the socket.
The control waits for existing data acknowledgments, then requests close code 1000 after success or 1011 after failure.
It adds no application frames. The existing deadlines still bound acknowledgment waits.
Public completion events record protocol completion, requested close code, and whether the close call succeeded.
These events do not establish receipt of the close frame by the peer.

[Cloudflare documents unclosed sockets as one cause of this runtime error](https://developers.cloudflare.com/workers/observability/errors/#the-script-will-never-generate-a-response-errors).
However, the deployed June 12 compatibility date enables automatic replies to peer Close frames, and A already closes its socket.
A lifecycle race remains a hypothesis. Missing an explicit B close does not prove that its socket stays open indefinitely.

| Candidate cause | Verified signatures and signed dispatch | Both B invocations report runtime hang | Assessment |
| --- | --- | --- | --- |
| Incomplete signature computation | Contradicts | Says nothing | Removed for these requests |
| Candidate exhaustion | Contradicts signed one-batch result | Says nothing | Removed for these requests |
| Runtime socket lifecycle after result delivery | Fits | Fits | Test explicit close plus acknowledgment drain |
| Unrelated unresolved runtime promise | Fits | Fits | Still possible |
| Missing peer close alone | A already requests close | Auto-reply is enabled | Insufficient explanation |
| Instrument or request attribution error | Client operation IDs match Router dispatch | Two B invocations have matching request windows | Reduced, exact runtime internals remain unseen |

Independent review found no success-path acknowledgment deadlock.
A sends its transport acknowledgment before requesting close. B never waits for acknowledgments of acknowledgments.
One existing error path can fail before B accepts the socket. The close call can then fail, which the new event records.
The successful-close control does not qualify that pre-accept error path.

The [B-only control](../evidence/ml-dsa-65-socket-close-control-20261016.json) verifies both signatures.
Creation and recovery take 7.302 and 9.793 seconds. Signing takes 3.998 and 1.835 seconds, each with four evaluated candidates.
Both signing invocations still report the runtime error, despite protocol completion and successful calls to close with code 1000.
The [control traces](../evidence/ml-dsa-65-socket-close-control-traces-20261016.json) therefore show that explicit close plus acknowledgment draining is insufficient.
The [control provenance](../evidence/ml-dsa-65-socket-close-control-provenance-20261016.json) records its source hashes and deployment versions.
Same-version preparation invocations complete normally. This is not a universal fault in B's upgraded sockets.

The [local B-only E2E](../evidence/ml-dsa-65-socket-close-durable-20261016.json) verifies three signatures, refill, replay, and a stalled peer.
That peer closes with code 1011 after 0.932 seconds under a one-second permit.

## Wait for the peer close event

The final change makes A wait for B's close event after result agreement. The existing operation deadline bounds this wait.
A requires all its sent frames to be acknowledged, no pending application data, and close code 1000.
It records `wasClean` separately. Code 1000 with `wasClean=false` is accepted by this check.
A missing or non-1000 close now fails the request even when computation finished. This is an active lifecycle change.
Failure preserves the existing consumption and settlement rules.

The [hosted continuation](../evidence/ml-dsa-65-peer-close-hosted-20261016.json) signs twice with the existing recovered disposable key.
It uses the same B and Router deployments as the B-only control and changes A.
It excludes registration and does not measure a cold wallet flow.

| Hosted continuation | Client time | Batches | Evaluated candidates | A-observed close | A/B/Router outcomes |
| --- | ---: | ---: | ---: | --- | --- |
| First request | 9.980 s | 3 | 12 | 1000, `wasClean=true` | All `ok` |
| Second request | 5.749 s | 2 | 8 | 1000, `wasClean=true` | All `ok` |

The [six matching invocations](../evidence/ml-dsa-65-peer-close-hosted-traces-20261016.json) have no exceptions.
Exact operation IDs connect client verification, Router dispatch, B completion, and A's observed close.
The trace selection excludes unrelated background invocations. It makes no service-wide absence-of-errors claim.
The [final provenance](../evidence/ml-dsa-65-peer-close-provenance-20261016.json) identifies the deployments and source files.

Review found that the continuation recorder omitted elapsed time when fetch or JSON decoding failed.
The recorder now preserves that attempt as a client error with unknown server outcome.
The [refused-connection control](../evidence/ml-dsa-65-client-error-recorder-20261016.json) checks this path with a local forbidden port and an empty credential.
It intentionally fails the campaign while retaining elapsed time and no invented server result. It is not a hosted failure-latency sample.
This recorder-only correction follows the two successful hosted requests and changes their script hash for future runs.

Measured: no runtime anomaly occurred in either observed request after A began awaiting peer Close.
Inferred: this supports a caller-lifetime problem around socket completion.
Unknown: the exact runtime mechanism and reliability under load remain unqualified.
Different candidate counts, warm state, and background work prevent attributing latency differences to the close wait alone.
The earlier one-batch samples do not bound user-visible signing time.

The [final local durable E2E](../evidence/ml-dsa-65-peer-close-durable-20261016.json) verifies three signatures in 0.267–0.310 seconds.
It also checks automatic refill, duplicate replay after restart, and stalled-peer code 1011 after 0.937 seconds.
The [final local registration E2E](../evidence/ml-dsa-65-peer-close-registration-20261016.json) verifies canonical creation and recovery in 1.510/1.590 seconds.
Its first signature verifies in 0.277 seconds. Recovery retains cooldown.
These local campaigns run concurrently and provide functional evidence, without hosted latency qualification.
Their [public lifecycle events](../evidence/ml-dsa-65-peer-close-local-events-20261016.json) retain dispatch counts and socket completion states.

The first local durable invocation stopped before execution because the supplied fixture directory lacked role records.
Classification: `environment_or_infrastructure_failure`. The correct native fixture export resolved the setup error without a production change.

## Next steps

1. Inject dispatch errors and interruption during key generation, installation, and activation. Extend deadline handling through the complete registration lifecycle.
2. Measure table evaluation and material installation separately. Test fewer copies and re-encryption steps with exact one-time key assignment.
3. Compare candidate batch sizes and online storage/network costs. Include rejected batches, exhaustion, cooldown, refill, and concurrency in every performance claim.
4. Repeat hosted registration and signing under a fixed load profile before SDK integration. Preserve all failed operations and slow samples.

## Reproduce

```sh
ML_DSA_REGISTRATION_STALL_EXECUTION=1 \
  node tests/e2e/ml-dsa-registration-worker.e2e.mjs \
  /private/tmp/ml-dsa-deadline-keys /private/tmp/ml-dsa-deadline.json
ML_DSA_WORKER_FIXTURE_DIRECTORY=/private/tmp/ml-dsa-worker-fixtures \
  cargo run --release --locked --manifest-path tools/ml-dsa-investigation/Cargo.toml -- \
  prepared-keygen /private/tmp/ml-dsa-native.json
node tests/e2e/ml-dsa-durable-worker.e2e.mjs \
  /private/tmp/ml-dsa-worker-fixtures /private/tmp/ml-dsa-durable.json
```

Build the Router and both role bundles before running these local commands.
The existing hosted-registration harness uses the temporary Router URL and its matching token-file environment variables.
The continuation harness uses those same variables and accepts a successful hosted registration artifact, a native role fixture, and an output path:

```sh
node tests/e2e/ml-dsa-existing-worker.e2e.mjs \
  /private/tmp/ml-dsa-hosted-registration.json /private/tmp/ml-dsa-worker-fixtures/a.json \
  /private/tmp/ml-dsa-continuation.json
```

Wait for the previous operation's cooldown before starting it. It sends two requests and waits 61 seconds between them.
The three temporary Workers and trace listeners were removed after the hosted campaigns.
Saved disposable credentials, role fixtures, and raw trace files were also removed. The committed evidence contains public measurements and selected events.
