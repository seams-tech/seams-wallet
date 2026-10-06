# NEAR-only baseline and signing-read reduction

Measured 2026-10-06. Primary target: a wallet that selects only the NEAR signer.
Local Workers, Chromium, virtual WebAuthn, stubbed chain RPC, no broadcast. Each
complete arm contains 20 NEAR-only wallets and 20 mixed wallets, alternating order,
with first and warm signatures per wallet. Each arm passed 40 wallets and verified
80 signatures without automatic retries.

| NEAR-only measurement | Baseline median | Candidate median | Candidate p95 | Candidate maximum |
| --- | ---: | ---: | ---: | ---: |
| Registration to public SDK ready | 947.4ms | 912.8ms | 1039.0ms | 1169.7ms |
| First signing, public SDK | 383.1ms | 377.6ms | 390.9ms | 425.4ms |
| Warm signing, public SDK | 365.8ms | 361.1ms | 366.5ms | 368.1ms |
| First lane preparation | 42.1ms | 32.3ms | 47.7ms | 48.4ms |
| Warm lane preparation | 38.1ms | 28.8ms | 30.9ms | 46.6ms |
| First core signing exchange | 45.7ms | 43.3ms | 57.7ms | 87.9ms |
| Warm core signing exchange | 42.2ms | 38.9ms | 44.9ms | 53.7ms |

The candidate shares one available-lane read between the authorization probe and
transaction-session preparation within one signing attempt. It retains the reread
when material restoration changes the exact session, and fresh server admission.
No cross-operation cache is added. SDK type-check and the bloat check pass.

Full-flow median changes are small: 5.5ms first and 4.7ms warm. Lane preparation
falls by about 9–10ms. This is one complete baseline/candidate pair. Shared-machine
variation affects the comparison. Do not attribute registration or all tail-latency
changes to this signing-only edit. Baseline signing includes approximately
194–202ms of automated confirmation handling. These are local timings, not hosted
latency or human decision time.

The first candidate attempt passed 39 wallets and failed during the final iframe
startup. SDK artifacts changed during that attempt. It remains excluded. The
complete replacement candidate used a copied SDK dist through the existing
`SEAMS_INTENDED_WALLET_DIST_ROOT` setting. Initial pilot attempts also remain
excluded: one used an incorrect app URL; another omitted timing diagnostics.

Evidence: [complete cohort summaries](./optimization-12-NEAR-only-20261006.json).
Private raw reports and runner scripts: `.artifacts/near-signing-20261006/`.
Use `tests/scripts/analyze-near-local-latency.mjs` to regenerate summaries from the
Playwright JSON reports. The benchmark is
`tests/e2e/intended-behaviours/near-latency/passkey.registration.benchmark.test.ts`.

## Next NEAR-only work

- Verify production asset loads across registration, unlock, reload signing, and export.
  The existing custody ceremony WASM links both protocol crates; NEAR-only signer
  selection does not establish that the downloaded WASM contains no ECDSA code.
- Measure cold loading separately from registration. Current cohorts use the existing
  harness and do not claim cold download performance.
- Reduce registration's exposed session hydration: baseline median 143.3ms.
  Reuse the mixed path's existing prepared-seal machinery where lifecycle permits.
  Custody work is 326.9ms median and remains another profiling target.
- Verify reload, revocation, expiry, final-use step-up, and authority replacement
  before treating the signing candidate as fully accepted.
- Measure three-signature sessions and repeat matched hosted NEAR-only cohorts.

## Production asset acceptance

The existing `production NEAR-only wallet records unlock and restored signing assets`
E2E passed (37.6 seconds including service setup). It registers a NEAR-only wallet,
locks/reloads, unlocks, signs, reloads/signs again, and exports the Ed25519 key.
No ECDSA Worker or EVM operation module was loaded. The shared custody ceremony
WASM was loaded during registration. Its build still links both protocol crates.

[Asset evidence](./optimization-12-NEAR-only-assets.json) records phases, Worker
URLs, accounting, and transfer totals. These one-sample phase durations include
harness actions and disabled caching. They are not substitutes for SDK latency
cohorts. This verifies reload signing for the candidate; the other lifecycle cases
listed above remain pending.

## Early NEAR-only session preparation

NEAR-only passkey registration now starts the existing client-seal preparation
after respond supplies its admitted threshold session identity. Preparation runs
alongside custody. Finalization applies the server seal in its existing response,
and session hydration consumes that prepared result. Registration still awaits
durable session storage and material installation before reporting ready. Cleanup
settles and discards temporary seal preparation on success or failure.

| NEAR-only measurement | Previous candidate median | Early-seal median | Early-seal p95 | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Public registration to ready | 912.8ms | 834.6ms | 914.0ms | 1049.2ms |
| Exposed session hydration | 139.1ms | 41.3ms | 43.8ms | 44.0ms |
| First signing | 377.6ms | 378.8ms | 387.6ms | 417.8ms |
| Warm signing | 361.1ms | 360.2ms | 365.6ms | 370.4ms |

The complete 40-wallet cohort verified 80 signatures. Registration median fell
78.2ms (8.6%) in this local comparison. A repeated matched hosted comparison is
still required before projecting a production gain. Evidence:
[early-seal cohort](./optimization-12-NEAR-registration-seal.json).

Four focused lifecycle cases pass: immediate NEAR signing and reload, another-tab
lock during late completion, lock during overlapping hydration, and exact Router
transport retry followed by signing. The latter three use the existing contract
scenarios; the lock cases cover shared hydration behavior through mixed registration.
SDK type-check, build, and bloat checks pass. Private reproduction scripts and raw
reports are in `.artifacts/near-registration-seal/`.

## R155/R155B applicability audit

- Regional routing, bounded discovery, owner/linked Console-outage signing, and
  Gateway/role restart recovery have NEAR acceptance evidence in R155B.
- Reusing the initial lane read now applies to NEAR transaction signing.
- Early prepared-session sealing now applies to NEAR-only passkey registration.
- Prepare-based session-status reconciliation remains an ECDSA-only optimization.
  `prepareRouterAbNormalSigningV2` still returns the Ed25519 protocol response alone.
  Its required follow-up must carry fresh session facts and reconcile exact authority
  before removing redundant status reads. Preserve expiry, revocation, quota, and
  material checks for transaction and signature-only paths.
- ECDSA's presignature pool and reusable presignature DO are protocol-specific.
  NEAR nonce/material preparation needs its own measured audit, including immediate
  registration-to-sign and consecutive signatures. Do not claim pool optimization parity.
