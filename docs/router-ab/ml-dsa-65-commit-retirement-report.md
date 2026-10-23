# ML-DSA commit measurements and failed preparation retirement

Failed preparation now retires its exact unclaimed job before the Router returns the observed failure.
The local Worker test proves that replacement can start before the old lease expires.
The hosted probe exposes non-zero intervals after transaction return, but does not establish pure disk latency or a production speedup.

## Production change

The Admission Durable Object compares the complete job identity before retiring live `Preparing` or `Ready` stock.
It writes the tombstone and removes that exact stock ID in one transaction.
It preserves a `Claimed` job and its operation. Existing tombstones are idempotent by ID because they do not retain the complete job.
Late readiness messages cannot publish retired stock. Replacement uses a fresh job and fresh derived material identities.

The Router invokes retirement with Gateway authority when preparation dispatch fails or reports incomplete preparation.
Participant credentials cannot invoke this transition through either control route.
A public diagnostic record distinguishes retirement, an existing tombstone, a preserved claim, and retirement failure.
If retirement fails, that error reaches the caller. The log retains the fact that preparation also failed, without its raw error text.
The existing lease remains the fallback when the Router cannot finish retirement or disappears before observing a failure.

Retirement fences publication and admission. It does not prove immediate cancellation or physical deletion of remote material.
Existing role cleanup alarms remain. An old remote operation can overlap replacement work until it stops or reaches a stale-state check.

Wallet-seed recovery, canonical FIPS export, four-candidate preparation, two-at-once consumption, and thirty-two-candidate capacity remain unchanged.
Admission still requires sixteen ready candidates. The wallet cooldown remains sixty seconds, and service signing capacity remains one operation.
Production adds no `storage.sync()` barrier. Successful preparation adds no new protocol messages.

## Measurement method

A test-only JavaScript wrapper surrounds the actual registration storage transactions.
It records transaction return, then explicitly awaits `storage.sync()` and records completion.
Cloudflare documents this API as waiting for pending writes to reach disk. [Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#sync)

The wrapper changes scheduling and can wait for earlier writes on the same object.
Worker clocks can also include preceding CPU work when they advance at an I/O boundary.
The measured post-transaction intervals therefore include more than pure disk service time. They cannot partition total request time.
The wrapper is absent from production entry points.

Separate Rust observations identify the prepared acknowledgement, readiness publication, readiness acknowledgement, and final result exchange.
Their intervals include peer work, delivery, durability gates, and scheduling.
Report each interval under its protocol completion boundary.

Calibration uses an authenticated route with a fixed, non-secret write in a separate test object.
Its requested 400 ms timer occurs before `sync()`. These records validate visible clocks and request timing and are excluded from commit statistics.
The local client records 405.607 and 404.101 ms. Hosted requests through the authenticated front record 1.763 and 1.618 seconds.
Those hosted durations include forwarding and other request overhead.

A separate local fixture delays B's readiness publication by 400 ms.
A's readiness acknowledgement and B's publication intervals measure 401–405 ms, with 399–402 ms overlapping the known delay.
This checks local completion observations. It does not establish synchronized clocks across hosted Workers.

## Retirement validation

The durable SQLite E2E covers changed identity, partial readiness, completed readiness, restart, unrelated stock, fresh replacement, and the claim race.

The real-Worker test lets A return the successful value `true`, then replaces that reply with HTTP 503.
The Router's matching event records retirement. After restart:

- A retirement retry returns `already_retired`.
- Both late readiness messages are rejected.
- Participant retirement requests return HTTP 403.
- Replacement allocation takes 9.140 ms locally and occurs 277.495 seconds before the old lease expires.
- Replacement has a different job ID. The subsequent creation and recovery reproduce the canonical key.

The retirement and calibration campaigns each verify one creation signature. Recovery signing preserves the wallet cooldown.
These tests exercise the real Worker protocol. They do not repeat browser recovery, QR linking, or a testnet transaction.
The hosted successful campaign has no retirement event, so hosted failure retirement remains untested in this screen.

## Hosted observations

The probe uses the six previously approved temporary Worker names and exact credential payloads.
Only the forwarding front is public. Test calibration passes through authenticated front and Router wrappers to private A/B.
Capture of the calibration request is confirmed on those four roles before workload begins.
The final dataset includes all six roles and 463 provider invocations.

| Captured post-transaction barriers | Count | Median | Maximum |
| --- | ---: | ---: | ---: |
| A execution | 8 | 29 ms | 311 ms |
| B execution | 54 | 54 ms | 210 ms |
| B preparation, partial capture | 356 | 20 ms | 666 ms |

Execution transaction-return intervals all report zero milliseconds.
The explicit barrier makes later elapsed intervals visible. This does not establish zero transaction cost or quantify production commit cost.
The dataset contains 617 commit records, including two timer-calibration records, with no repeated observation identities.

A's prepared acknowledgements measure 75 and 58 ms. Its readiness acknowledgements measure 10 and 0 ms.
B's result exchanges measure 562 and 160 ms. These are separate intervals on each role's clock; do not add them across roles.
Both B preparation invocations report log truncation. Their commit distributions and missing completion records are incomplete.
Thirteen invocations report cancellation without an exception category. Both client lifecycle operations complete.

| Hosted probe | Creation | Recovery |
| --- | ---: | ---: |
| Full registration preparation | 105.321 s | 85.586 s |
| Registration with client verification | 8.512 s | 6.000 s |
| Verified initial-stock signing | 9.729 s | 3.869 s |

Full preparation includes generic key-generation material and sixteen initial signing candidates.
The five-second target remains unmet. There is no paired successful production control in this screen.
Do not compare this probe directly with earlier runs to claim a speedup or select production sync barriers.

## Facts and causes

| Fact | Instrument and check | Limit |
| --- | --- | --- |
| Retirement precedes lease expiry and survives restart. | Durable E2E and exact lost-success Worker scenario. | Local timing only; remote work can remain active. |
| Claimed and unrelated stock survive retirement. | Transactional SQLite lifecycle E2E. | No full deployment concurrency qualification. |
| Commit and completion clocks show known delays. | Local fixtures and externally timed authenticated hosted calibration. | The timer does not calibrate disk latency. |
| Explicit post-transaction barriers have non-zero intervals. | Actual hosted `storage.sync()` wrapper. | Earlier writes, CPU clock effects, and scheduling can contribute. |
| Both hosted signatures verify and recovery preserves the key. | Native client verification against actual Workers. | Two operations do not qualify latency or reliability. |
| Two B preparation traces are truncated. | Provider truncation flags. | Their timing distribution is partial. |

| Possible explanation | Evidence | Status |
| --- | --- | --- |
| Natural lease expiry enabled replacement. | Replacement precedes expiry by 277.495 seconds; an existing tombstone is checked. | Contradicted for the local test. |
| Transaction return includes all durability cost. | Later explicit barriers record additional elapsed intervals. | Unsupported as a timing assumption. |
| Storage alone explains slow registration. | Other intervals include connection, peer work, CPU, installation, and scheduling. | Unresolved. |
| Explicit sync improves production performance. | The probe changes scheduling; no paired control exists. | Unproven. |
| The probe fixes storage resets. | No storage reset occurs in this hosted campaign. | Unproven. |

The first local probe exhausted sixteen candidates and failed an overly strict delay-containment assertion. Both outcomes remain in the archive.
The corrected overlap assertion still requires at least 350 ms of the known delay.
A direct Durable Object test assertion also required correction because Miniflare rejects the call instead of returning an HTTP error response.
The first hosted runner assumed public role URLs. The corrected runner preserves private roles.
Python HTTP calibration then received Cloudflare error 1010 and produced no captured Worker invocation. The existing Node benchmark client reached the authenticated route.
No production behavior changed to accommodate those fixture or infrastructure failures.

An independent reviewer reproduced the retirement, calibration, hosted measurements, and coverage limits.
All six temporary Workers were deleted. The bloat check retains the inherited 13,972 versus 13,754 Rust duplication failure; its baseline is unchanged.

## Next work

1. Reduce diagnostic log volume and obtain complete B preparation and completion records.
2. Compare explicit commit checkpoints against an unwrapped control with matched workload and unchanged capacity.
3. Exercise failed preparation retirement on hosted Workers, including an uncertain reply and a concurrent claim.
4. Select an optimization only after that comparison, then repeat registration, signing, and sustained refill qualification.

The [evidence summary](../evidence/ml-dsa-65-commit-retirement-20261024.json) links the source patch, probes, public artifacts, analysis scripts, hashes, and cleanup receipts.
To repeat local checks, run the existing durable-pool E2E and registration Worker E2E with fresh preparation material.
Set `ML_DSA_REGISTRATION_LOSE_PREPARATION_REPLY=1` for retirement, or `ML_DSA_REGISTRATION_COMMIT_PROBE=1` for commit and peer calibration.
Those fixture modes are local-only. Hosted wrappers are separate temporary deployment entry points.
