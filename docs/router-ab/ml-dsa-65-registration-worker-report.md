# ML-DSA registration on Workers

The private Worker registration flow creates and recovers a canonical ML-DSA-65 key.
The first hosted campaign passed its functional checks and missed the five-second target.
Public Wallet authentication, custody persistence, and SDK integration remain open.

## Implemented flow

1. The authenticated Gateway requests generic preparation within its tenant and environment scope.
2. Both participants prepare key-generation circuits, private OT state, and four initial signing batches.
3. The allocator marks the reservation Ready after both participants confirm completion.
4. Registration claims that reservation for an exact operation and encrypted client input pair.
5. Each participant consumes its private preparation before selecting private inputs.
6. Participant B authenticates and consumes each stored table frame during evaluation.
7. Both participants independently derive the public key and manifest, then seal their own private share.
8. The Router authorizes installation. Both roles install their share and initial signing stock.
9. The Router activates the exact key after both installations pass its checks.
10. The client authenticates both encrypted results and verifies the canonical key and manifest.

Recovery uses fresh preparation and advances the epoch. It must preserve the public key and manifest.
The test client uses a disposable wallet seed and an ordinary ML-DSA implementation as its canonical-key oracle.
Server participants receive encrypted shares. The test does not send the complete seed to either Worker.

The allocator permits four ready reservations and one active registration.
Generic replenishment currently uses the explicit private preparation route. Automatic generic-pool refill remains open.
Key-bound signing refill uses the existing durable alarm flow.

## Hosted baseline

[Client evidence](../evidence/ml-dsa-65-registration-hosted-baseline-20261016.json)
and [sanitized traces](../evidence/ml-dsa-65-registration-hosted-baseline-traces-20261016.json)
pin the build hashes and invocation versions.
The run started on October 15 UTC, October 16 in the working timezone.

| Measurement | Create | Recover |
| --- | ---: | ---: |
| Preparation, including four initial signing batches | 226.503 s | 204.887 s |
| Complete registration with client verification | 16.173 s | 11.913 s |
| Complete successful signing request | 30.171 s | 20.973 s |

These are two observations, not a latency distribution.
Preparation includes encrypted durable table writes and signing-stock production.
It differs from the earlier local signing-only preparation benchmark.
Both signatures verified. Recovery reproduced the canonical key and manifest.
Both B signing WebSocket invocations reported runtime exceptions despite the verified signatures.
These terminal trace errors remain unresolved.
Exact retries returned cached results. Changed requests and wrong credentials were refused.

## Diagnosis record

| Fact | Instrument | Scope | Checked |
| --- | --- | --- | --- |
| Both complete signing requests exceed 20 s | Client monotonic timer | Hosted baseline | Artifact and Router wall time agree |
| Signing execution takes 1.624 s and 1.330 s | Router service-call logs | Same two requests | Sanitized traces retain exact timings |
| A later role call takes 26.973 s and 19.194 s | Router service-call logs and call order | Settlement fences | Matches long producer intervals |
| B uses 7.471 s CPU during create and 7.330 s during recovery | Cloudflare invocation trace | Registration Execute | Independent reviewer checked both records |
| No long refill overlaps those registration Execute windows | Participant traces | Hosted baseline | Independent reviewer checked intervals |
| Local control calls fail even on a read-only admission probe | Miniflare forwarding probe | Local instrumentation only | No isolation measurement obtained |

| Candidate cause | Signing evidence | Registration evidence | Status |
| --- | --- | --- | --- |
| Background producer blocks settlement | Long refill overlaps both fence waits | No matching overlap during Execute | Supported by changed-build fence timings below |
| Circuit execution alone explains total signing delay | Execute takes less than 2 s | Does not explain registration | Contradicted for signing |
| Registration storage, restoration, or evaluation costs | Says nothing | B CPU exceeds target | Remaining alternatives need phase measurements |
| Network overhead alone | Cannot explain B CPU | B CPU already exceeds 5 s | Insufficient explanation |
| Measurement fault | Client and Router timings agree | Local isolation probe fails | Hosted totals supported; isolation probe withdrawn |

The private hosted routes match the implementation under investigation.
Parity with public Wallet registration is not established because public authority and SDK steps are absent.

## Scheduling correction

Signing completion retains its service-capacity slot until both pools finish settlement or the original deadline expires, whichever occurs first.
Only the authenticated coordinator can release that slot for the exact terminal operation.
Exact settlement retries are idempotent. The original deadline releases capacity after an interrupted coordinator.
A recovery transition preserves an already completed signature result.

New key-bound refill waits while a signing slot or registration claim is active.
This change does not interrupt a producer that already holds a lease.
It also does not serialize generic registration preparation against all foreground work.
Those load cases still need qualification.

Registration cleanup now schedules material expiry before preparation starts.
Execution can move the alarm earlier. Preparation completion cannot replace that earlier cleanup alarm.

The [durable lifecycle E2E](../evidence/ml-dsa-65-settlement-scheduling-e2e-20261016.json)
checks refill exclusion, exact settlement, changed-request refusal, cooldown, restart, and single-use storage.
The phase counters are unqualified for hosted attribution. They return zero restoration and table-load time despite loading 643 frames.
Cloudflare invocation CPU/wall time and the client timer remain the qualified measurements.
The local phase counters provide local observations only. Table-load time is part of protocol time, so these values must not be added.

## Changed-build local campaign

[Local evidence](../evidence/ml-dsa-65-registration-scheduling-local-20261016.json) records the complete Worker routes after the scheduling change.
Create took 2.728 seconds. Recovery took 2.716 seconds. The first verified signature took 0.325 seconds.
Preparation took 41.36 and 40.78 seconds, including four initial signing batches each time.
The campaign restarted Workers between the two ceremonies and recovered the same canonical key.
Recovery preserved the wallet cooldown, so it did not produce a second signature sample.
The artifact therefore leaves the combined registration-and-signing qualification false.

Participant B loaded 643 frames and 41,701,400 bytes during the first ceremony.
Its diagnostic run timer measured 1.835 seconds, including 1.251 seconds in table-load transactions.
This identifies table access as substantial local work. It does not separate decryption, serialization, storage, and circuit CPU costs.

## Changed-build hosted campaign

[Client evidence](../evidence/ml-dsa-65-registration-scheduling-hosted-20261016.json)
and [sanitized traces](../evidence/ml-dsa-65-registration-scheduling-hosted-traces-20261016.json)
record two fresh preparations on the same temporary Workers with the updated scheduler.

| Measurement | Create | Recover |
| --- | ---: | ---: |
| Preparation, including four initial signing batches | 177.292 s | 180.816 s |
| Complete registration with client verification | 11.728 s | 10.923 s |
| Complete successful signing request, client timer | 5.098 s | 4.036 s |
| Router signing invocation | 4.667 s | 3.333 s |
| Slower of the two settlement fence calls | 0.065 s | 0.064 s |

Both signatures and canonical recovery passed. The five-second target remains unmet.
The first signature misses the target even though its Router invocation finishes within five seconds.
Only two signing samples exist. This campaign cannot establish consistent latency or tail percentiles.

The fence results support the scheduling correction. The previous 19–27 second waits are absent in these two cases.
Fresh randomness, candidate counts, warm state, and provider scheduling also vary between campaigns.
The lower preparation and registration totals cannot be attributed to the settlement change alone.
The two B signing WebSocket invocations still report runtime exceptions.

B's registration invocations consume 5.318 and 6.076 seconds CPU, with 7.684 and 7.472 seconds wall time.
Registration therefore still needs a CPU reduction before complete registration can meet five seconds.
Hosted phase counters cannot distinguish table authentication, serialization, restoration, and circuit evaluation.
A calibrated CPU experiment is the next measurement. Zero phase-clock values do not establish zero work.

The independent review corrected three reporting risks: Router time differs from client latency, hosted phase clocks are unqualified, and foreground exclusion expires at the original deadline.
No claim of public SDK readiness or consistent five-second performance follows from this campaign.

## Reproduction

From the `ml-dsa` worktree:

```sh
cargo build --release --manifest-path tools/ml-dsa-investigation/Cargo.toml
pnpm -C crates/router-ab-cloudflare build:router
pnpm -C crates/router-ab-cloudflare build:deriver-a
pnpm -C crates/router-ab-cloudflare build:deriver-b
node tests/e2e/ml-dsa-registration-worker.e2e.mjs /private/tmp/ml-dsa-test-keys /private/tmp/ml-dsa-registration.json
```

The local campaign creates separate role keys and persistent stores, then restarts the Workers between create and recovery.
For hosted runs, set `ML_DSA_REGISTRATION_ROUTER_URL` and `ML_DSA_GATEWAY_TOKEN_FILE`.
Use the matching private key directory for the separately deployed role keys.
The benchmark never prints these private credentials.
Keep raw Worker tails private. Use `tools/ml-dsa-investigation/research/collect_worker_traces.py` to retain only selected public fields.

## Remaining qualification

- Calibrate a hosted CPU experiment that separates table authentication, serialization, restoration, and circuit evaluation.
- Reduce the measured registration bottleneck without weakening canonical recovery or single-use storage.
- Qualify requests that arrive during an existing producer, simultaneous wallets, and generic refill overlap.
- Test concurrent duplicate registration completion, lost installation replies, and epoch replacement.
- Add automatic generic registration replenishment with explicit service-wide capacity.
- Connect authoritative Gateway custody and session state, then the SDK and NEAR transaction path.

The three temporary test Workers were deleted after the hosted campaign.
