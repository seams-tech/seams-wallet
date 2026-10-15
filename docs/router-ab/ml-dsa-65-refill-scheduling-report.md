# ML-DSA refill scheduling investigation — October 15, 2026

Reserved material must count toward preparation stock. It must remain unavailable to another signing operation.
The former inventory counted only Ready material. Reserving a full pool therefore requested unnecessary preprocessing.

## Measured baseline

The control uses the actual Router, A, and B bundles in local workerd.
An independent Worker waits for one second. Node measures elapsed time outside workerd.
The same timer first runs without ML-DSA work, then beside the stalled signing operation.

| Fact | Measurement | Instrument |
| --- | --- | --- |
| The independent timer works while idle. | 1,017 ms | External Node clock around the timer Worker request. |
| Connection setup is short. | 10 ms | External Node clock around the signing WebSocket upgrade. |
| The stalled socket waits much longer than its configured deadline. | 10,305 ms | Socket close event after the upgrade. |
| The independent timer is delayed at the same time. | 10,315 ms | Separate timer Worker during the stalled operation. |
| Each role holds all four batches. | Four Reserved batches, zero Ready batches | Authenticated role inspection and inventory routes. |
| Both roles request refill without consumption. | `refill_due=true` | The same inventory responses. |
| The storage behavior reproduces without Worker timing. | Full Reserved stock requests refill | Native SQLite lifecycle E2E before the correction. |

| Candidate cause | Assessment |
| --- | --- |
| Slow WebSocket establishment. | Contradicted by the 10 ms handshake. |
| A socket-only timeout defect. | Contradicted by the independent timer delay. |
| A broken timer measurement. | Contradicted by the nonzero idle control near one second. |
| Unnecessary refill competes with signing and timer delivery. | Fits the stock and timing observations. The corrected control removes the delay, which confirms its contribution in this case. |

## Changes

- Inventory reports Ready and valid Reserved batches separately.
- Refill counts both groups. Admission still selects only paired Ready batches.
- Consuming a batch reduces stock and requests replacement preparation.
- Expired reservations still burn before inventory reports them. Consumed material never returns to either group.
- Every refill path preserves an existing earlier alarm. The SDK receives an explicit date because integer alarm inputs represent relative delays. A producer cannot overwrite newer demand with a later maintenance timer.
- A full pool uses a 30-second maintenance wake. Busy or failed production advances it to five seconds. Consumption advances it to one second.

An independent review found no admission bypass or prepared-material reuse in these changes.
The native lifecycle E2E verifies reservation, consumption, replay, and the existing recovery and cooldown constraints.

## Runtime qualification

The [recorded Worker E2E](../evidence/ml-dsa-65-refill-scheduling-e2e-20261015.json) passed after the correction.

| Measurement | Before | After |
| --- | ---: | ---: |
| Stalled-peer close, including handshake | 10,315 ms | 946 ms |
| Independent timer during the stalled operation | 10,315 ms | 1,008 ms |
| Idle independent timer | 1,017 ms | 1,018 ms |
| Reserved batches at each participant | 4 | 4 |
| Refill requested for those untouched reservations | Yes | No |

Replacement preparation started at both roles 1,024 ms after the first signing request.
That check ran after a full pool became quiet. The existing maintenance alarm did not delay new consumption demand.
Three complete signing requests took 488, 305, and 293 ms. No operation exhausted its pool in this run.
OpenSSL independently verified all three saved signatures and rejected changed messages.
Exact result replay across Worker restart also passed.

The native lifecycle E2E passed reservation, consumption, cooldown, recovery, and single-use checks.
Both the earlier and corrected idle timer controls were near one second. The timing result concerns this specific unnecessary-refill case.


The Worker E2E checks the reserved-stock response and both one-second timers with a two-second tolerance.
The report's `policy` field describes the initial signing phase. The stalled-peer phase uses a one-second operation deadline after restart.
It also lets a full pool become quiet, signs, and reads both roles' durable preprocessing-start markers.
Those read-only marker checks do not send Worker requests that could trigger refill.
The test requires replacement preparation to start within three seconds of the signing request.

This correction cannot preempt synchronous computation already running in an isolate.
Deadline behavior during legitimate concurrent preprocessing remains a separate hosted-load qualification task.
Wallet-seed recovery, canonical FIPS export, and the default 60-second wallet cooldown remain unchanged.
GPU work and preparation-speed optimization remain deferred.

## Next integration tasks

1. Add an explicit ML-DSA capability and wallet-key variant to Gateway authorization. Bind the private request to the authenticated wallet, registered key, epoch, message, and context.
   The existing capability definitions and owner execution path cover Ed25519 and ECDSA. They cannot yet authorize an ML-DSA request.
   Build custody activation from the verified ceremony result. Do not treat a client-supplied manifest as sufficient activation authority.
2. Complete Worker registration and role-material installation, with durable generic preparation for new wallets.
3. Test hosted signing, recovery, expiry, interruptions, and capacity under concurrent refill.
4. Complete the SDK/NEAR path and verify a threshold-signed transaction through it.

The private inventory response now requires a `reserved` field. Deploy Router, A, and B from the same revision.
Stored pool records retain their existing format.
