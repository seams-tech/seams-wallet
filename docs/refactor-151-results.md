# R151 empirical results

Recorded October 1, 2026 (Japan time), for the Wallet 0.7.3 release preparation.

R151's supported read reductions and demonstrated refill fixes are implemented
and verified. At R151 closure, the complete 1–2 second maximum remained unmet;
regional D1 had not been provisioned or measured. The subsequent
[R152 experiment results](refactor-152-results.md) record the new regional
placement evidence separately. Production deployment is separate from package
publication.

## Measurement scope

Count prepare and finalize together within each signature. Their shared
`ecdsa_sign_total` label must never be treated as one complete signature when
responses are pooled. Public SDK timing includes automatic confirmation and
orchestration; human decision time and network transaction finality are outside
the target. Overlapping stage medians cannot be added into an end-to-end total.

Ready-material cohorts wait for background readiness before starting the signing
timer. Their results establish ready-pool behavior. Immediate-first and burst
workloads remain separate. All numbers below are bounded diagnostic observations;
different dates, wallets, builds, and sample sizes are identified in the linked
evidence. They establish neither production percentiles nor a universal maximum.

## Database calls and writes

| Successful ECDSA prepare/finalize path | Original D1 calls | Final D1 calls | Reduction |
| --- | ---: | ---: | ---: |
| Owner | 18 | 5 | 72% |
| Direct linked device | 20 | 5 | 75% |
| Third-generation linked device | 24 | 5 | 79% |

The final signing pair uses six SQL statements, two write-bearing calls, and
14 D1-reported row writes. Admission and durable completion remain necessary.
Batching and joins reduce calls without demonstrating fewer durable writes.
The five calls enforce live credential/material/policy resolution, atomic
claim/readback, fresh finalize resolution, existing operation/source validation,
and durable completion. See [the policy-read inventory](refactor-151-policy-read.md).

The wider SDK inventory additionally found three owner session-status requests.
Prepared authorization reuse reduced these to two; joining material into status
reduced each from two D1 calls to one. The final ready-material owner path thus
has **four HTTP requests, seven D1 calls, eight SQL statements**. Both linked
generations have **two HTTP requests, five D1 calls, six statements**. Mixed-wallet
initialization and step-up can add lifecycle work. Earlier five-call reports
cover prepare/finalize only.

## London ready-material progression

| Cohort / implementation | Owner SDK median | Linked SDK median | Sample size |
| --- | ---: | ---: | --- |
| r13: linked prefill, previous Gateway | 4,318.8 ms | 3,517.5 ms | 3 owner / 6 linked |
| r14: joined linked custody (`09608843`) | 4,243.8 ms | 3,061.5 ms | 9 owner / 18 linked |
| r15: joined policy (`78a6a4c2`) | 3,654.6 ms | 2,511.8 ms | 9 owner / 18 linked |
| r16: prepared SDK authorization (`a2c936ed`) | 3,123.6 ms | 2,494.2 ms | 9 owner / 18 linked |
| r17: status/material join (`dad8f5e9`) | 2,680.5 ms | 2,487.0 ms | 9 owner / 18 linked |

The r14→r15 Gateway comparison held SDK/role builds fixed: owner median improved
14%, linked 18%. The two status changes improve owner median 26.7% from r15 to
r17. Linked r13→r17 improves about 29% across several sequential cohorts; that
is a historical progression, not one paired experiment.

In r16→r17, SDK/role builds are identical. Owner material authorization falls
601.7→332.0 ms; the post-confirmation status request falls 520.6→272.1 ms.
Owner summed D1 wall time falls 2,160→1,761 ms while SQL execution is
10.83→11.20 ms. Linked summed D1 wall time remains about 1,591 ms. The remaining
non-SQL overhead includes scheduling, binding, service, and transport.

Final observed ranges: owner **2,562.6–2,751.6 ms**; linked
**2,209.2–2,686.5 ms**. Every statement reports APAC primary service. Each of
r16 and r17 verifies 27/27 signatures without retries or failed attempts.
Raw cohort locations, build/image identities, per-signature traces, placement,
and reproduction instructions are in [the session-read evidence](refactor-151-session-read.md).

## Refill and lifecycle fixes

- **Canceled background refill:** a module-global Gateway gate could retain an
  occupied ticket after request cancellation. Later background requests then
  reached their five-second deadline. Removing that gate retained client pool
  scheduling and live authorization. In matched-build hosted cohorts of 20
  verified signatures each, failed-refill/fallback signatures fell **6→0**,
  SDK median **2,746→2,335 ms**, and observed maximum **7,771→3,060 ms**.
  The controlled local fault scenario also passes on all three backend profiles.
- **Stale linked authority channel:** inventory could query a closed canonical
  peer, wait 20 seconds, and reset the worker holding linked material. One
  explicitly typed active authority channel replaces that stale path. Repeated
  three-device signing verifies 27 signatures across Workers D1, wallet-DO, and VM.
- **Linked activation prefill:** first linked signatures previously spent about
  **6.2–13.4 seconds** generating material in the foreground across regional
  diagnostics. Activation now schedules existing background preparation and
  inventory uses the same authority. All six first linked signatures in r17 use
  presigns recorded ready before signing. Preprocessing cost still exists;
  readiness-gated timing does not measure immediate post-link latency.
- **Redundant SDK work:** removed a duplicate preparation inventory lookup,
  reused initiating-caller NEAR material verification, shared restore status
  reads across prefills, and removed duplicate preference reconciliation.
  Per-change lifecycle evidence is retained; no isolated latency percentage is
  claimed for every cleanup.
- **Unlock failure handling:** an intentionally failed network verification
  produces a visible error; explicit retry succeeds and NEAR/ECDSA signatures
  verify. The historical Tokyo timeout remains unexplained after five fresh
  successful attempts and 25 signatures. It is not reclassified as a proven
  network failure or silently erased.

Detailed causes, failed attempts, fixes, and artifacts:
[chronological evidence](refactor-151-evidence.md) and
[implementation checkpoints](refactor-151.md).

## Placement result and the R152 handoff

Three same-wallet London pairs compared default and Tokyo Gateway placement
while retaining the APAC database and persistent custody ownership. D1 wall
median fell **2,007→584 ms (71%)**, custody proxy stages rose **160→2,239 ms**,
and complete SDK time rose **4,650→6,627 ms (43%)**. Every pair became slower.
Fixed arm order and the small sample limit inference, but the result shows why
shorter D1 calls alone cannot establish a signing improvement.

Regional first/warm/burst diagnostics cover Tokyo, London, and the US. The r7
cohort verified 35 signatures, with warm SDK medians 1.97/4.04/4.14 seconds and
burst-call medians 4.36/8.91/9.52 seconds respectively. Those builds precede the
final reductions. Keep these results separate from r17. Gateway execution is
supported by version-specific analytics; DO locations are aggregate evidence,
without per-signature RPC attribution.

R152 will compare a regional primary near the existing compute path against a
fresh APAC control. The [ownership review](refactor-152-ownership-review.md)
identifies shared project policy/rate limits and namespace/organization replay
keys. Its first experiment retains whole deployment namespaces and one writable
database per owner; production routing and migration proofs remain open.

## Verification, evidence retention, and operational state

The policy change passed 30 scenario/profile checks; the final status/material
implementation passed 23. Coverage includes quota contention, missing prepare,
revocation, material retirement, live policy, exact/lost-response replay,
three-device signing, custom-review freshness, and NEAR promotion across the
documented backend matrix. These counts belong to separate checkpoints and
must not be added as unique scenarios. The subsequent ownership review passed
three focused Workers E2Es, including 18 policy denials and exact replay.

Email OTP validation at the final checkpoint remains blocked by the unavailable
valid Google test credential. Earlier infrastructure failures and the historical
unlock timeout are preserved separately from successful cohorts.

Original benchmark Workers/images and default placement were restored; all
three probes were inactive and benchmark access closed. Latest observed
cumulative spend was **$1.0530/$25** at October 1, 2026, 03:09 JST, subject to
accounting lag. No staging/production rollout or new regional database occurred.

The Markdown summaries and source identifiers are committed. Raw `.artifacts/`
and private `.runtime/` inputs remain local/ignored; Git alone does not preserve
them. Retain both Wallet checkouts, including the old R150 worktree, and back up
redacted evidence before cleanup. Private runtime configuration contains
credentials and must never be published. The linked checkpoint documents name
the exact artifact directories and analyses needed for later comparison.

## Wallet 0.7.3 release verification

On October 1, PR [#33](https://github.com/seams-tech/seams-wallet/pull/33) merged
the frozen release candidate `7b5c95f8557f5398ae0103dd0aeb8e84afe0cf8d` after
both validation workflows passed. The resulting main commit is
`2bc58391ddeef44eb1432ccd15be8a0d31332d55`; subsequent R152 work on `dev` is
outside that release.

[Release run 36808399655](https://github.com/seams-tech/seams-wallet/actions/runs/36808399655)
succeeded at 03:45:49 UTC. It passed all three native-tool builds, the production
Wallet build, packed-package checks, and versioned documentation build, then
published [@seams/wallet 0.7.3](https://www.npmjs.com/package/@seams/wallet/v/0.7.3)
and [@seams/wallet-server 0.7.3](https://www.npmjs.com/package/@seams/wallet-server/v/0.7.3).

Initial registry reads returned 404 after the publishing steps succeeded; these
observations are retained. Subsequent verification fetched both package tarballs,
matched their SHA-512 hashes against registry integrity and published provenance
subjects, and matched provenance source/workflow identity to the exact commit and
run above. Both package metadata records report that same `gitHead`.
Evidence is `.artifacts/release-0.7.3/verified-release.json`, alongside registry,
attestation, workflow-completion, and artifact-inventory receipts. The versioned
documentation artifact is `wallet-docs-0.7.3-2bc58391ddeef44eb1432ccd15be8a0d31332d55`
(artifact `11139995851`, retained until December 30). This workflow publishes
packages and retains documentation; it does not deploy application Workers.
