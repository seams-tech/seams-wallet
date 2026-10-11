# Console registration batches — 10 October 2026

Registration now uses fewer Console D1 round trips. The [later hosted comparison](refactor-155d-allocation-hosted.md)
measures these batches with the other registration changes.

## Implementation

Console publishes the session locator, completes the wallet home, and creates
the display row in one D1 transaction. An exact retry preserves the original
session expiry, completion time, and later display changes. A conflicting
session cannot activate the home. If the display write fails, all three writes
roll back. Relocation and ownership checks remain in place.

Console also batches recovery-route publication with its verification read.
The early route claim from `b6d9f2a7` still overlaps Router consumption and the
credential claim. Moving it into the later completion request could lose that
overlap. The public API, schemas, and number of Console HTTP requests stay the
same.

| Console operation | Previous D1 round trips | New D1 round trips |
| --- | ---: | ---: |
| Recovery-route publication and verification | 2 | 1 |
| Fresh registration completion | 2 | 1 |
| Exact completion retry after a lost reply | 5 | 1 |

The two fresh operations retain five SQL statements in total. Batching removes
two network waits. It does not remove the persistence or verification work.

## Verification

The local comparison used the production Console handlers and real local D1.
It compared private parent `5fc3ede` with implementation `535af1b`.
[Machine-readable evidence](refactor-155d-console-batches.json) records the
counts, commands, and artifact hashes.

The directory scenario passed atomic rollback, session-owner conflicts,
changed-expiry rejection, exact retries, cancellation, and restart. The
four-region routing scenario and three browser scenarios passed. The browser
cases cover normal registration, a lost completion reply, and a failed
credential claim after Router consumption. Signing through another region
works while Console is unavailable. Type checks and the bloat check passed.

The composed registration assertion now expects zero continuation home reads,
consistent with setup persisting the home. This fixture correction is `4fc9977`.
The browser runs used preserved Worker binaries after the current local build
failed readiness. A separate custody-relocation check stopped at its build
freshness check before execution. No new custody-relocation acceptance is claimed.

## Benchmark scope and next steps

The last hosted registration-only cohort predates this change and several
earlier finalization improvements. It measured **4.847 s median**, excluding
WebAuthn interaction, with a **4.034–6.428 s** range across three wallets.
[Hosted evidence](refactor-155d-completion-console-hosted.json) preserves the
samples. The controlled 6 October local run measured **834.6 ms median** across
20 NEAR-only registrations with virtual WebAuthn and stub chain RPC.
[Local benchmark](../optimization-12-NEAR-only-20261006.md) defines that scope.
Neither number measures this change.

The subsequent hosted comparison verifies two fewer Console D1 calls from
these batches. It combines them with home persistence, identity reuse, and
allocation overlap. It does not isolate their latency saving or establish an
overall latency improvement. Its evidence preserves both baseline groups.
