# Hosted early preparation: delegates and transactions

October 12, 2026. All 24 measured signatures verified across six wallets.
Three additional warm-up wallets were discarded. Each wallet signed two delegate
actions and two funded transactions. The SDK loaded only the NEAR signer.

The production-built candidate SDK ran against the activated October 12 staging
backend. The browser was in Tokyo. No request interception bypassed CORS.

| Cost | Delegate, 12 signatures | Funded transaction, 12 signatures |
| --- | ---: | ---: |
| Remaining prepare wait after confirmation | 91.8 ms median (34.3–279.7) | 0 ms (0–0) |
| Signature execution after confirmation | 541.1 ms median (383.5–834.5) | 458.0 ms median (331.1–586.9) |
| Confirmation → assembled signature | Not separately traced | 460.7 ms median (333.8–589.9) |

Delegate confirmation used the normal automated click, about 271 ms median.
Transaction confirmation deliberately waited until nonce/block context arrived
and early preparation started. This models a user who reviews the transaction
while preparation runs. Its confirmation duration was 1.1–2.1 s, including the
test's polling cadence. It is not a measured cost that a user must pay.

An immediate click can occur before the chain context arrives. That path correctly
uses ordinary preparation after confirmation. The initial test assumed early
preparation was unconditional; the hosted run disproved that assumption. No
production change was needed. The test now distinguishes the readiness condition
and closes both expanded and compact transaction receipts between operations.

Every measured signature had exactly one `prepare_sent` event before
`confirmation`, followed by consumption of the prepare result. Independent Node
Ed25519 verification accepted the signed delegate/transaction bytes against the
registered key and rejected altered digests. The local public contract separately
verified quota exhaustion and the resulting step-up path without early prepare.

There is no SDK-before/after comparison here. These numbers verify the overlap
and report the remaining cost. They do not establish a latency reduction of a
specific size. Funding and blockchain confirmation are outside the measurements.

The [JSON summary](refactor-155g-early-delegate-transaction-hosted.json) contains
medians, ranges, maxima and the inclusive automation timings. The persistent
scenario is `tests/e2e/hosted-product/near-early-prepare.test.ts` in seams-monorepo.
Raw signed bytes and timing events are in each `early-*.json` under
`.artifacts/r155g-remaining-20261012/early-{1,2}/`. The adjacent
`analyse-early.py` reproduces the summary. Frozen production assets and projection
paths are recorded in `early.py` in that artifact directory.
