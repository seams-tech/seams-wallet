# R155G final staging comparison — October 12, 2026

The remaining code changes work. This comparison does **not** establish an
end-to-end latency gain for the smaller Deriver modules and faster local seal
build. The repeat control improved more than the candidate's difference.

All groups used the same production-built NEAR-only SDK assets. The control was
the verified October 12 coordinated staging deployment. The candidate replaced
only the Gateway's Shamir WASM and removed Deriver debug metadata. The Gateway
JavaScript, bindings, regional placement, databases and keys stayed identical.
R155F and the previous R155G changes were already present in the control.
This measures the remaining batch; it does not measure the total historical gain.

The client ran in Tokyo. Staging used its Hong Kong APAC layout. Each group had
three discarded warm-up wallets and six measured wallets. Worker and Durable
Object cold state is unproven. Real CORS preflights remained enabled.

| Metric | Control median (range) | Candidate median (range) | Repeat control median (range) |
| --- | ---: | ---: | ---: |
| SDK registration, including authentication | 4.149 s (3.727–4.349) | 4.111 s (3.590–4.469) | 3.930 s (3.426–4.075) |
| Registration, excluding authentication | 3.640 s (3.312–3.804) | 3.556 s (3.190–4.182) | 3.473 s (2.937–3.873) |
| First signature, including confirmation | 0.711 s (0.683–0.885) | 0.692 s (0.628–1.160) | See JSON record |
| First signature, excluding confirmation | 0.440 s (0.409–0.616) | 0.429 s (0.363–0.896) | 0.517 s (0.392–0.645) |
| Registration → verified signature, excluding interaction | 4.070 s (3.736–4.316) | 3.978 s (3.755–5.018) | 3.967 s (3.525–4.319) |

Each range's upper endpoint is the observed maximum. Medians of separate stages
must not be summed. The four-second maximum remains unmet. Harness automation,
funding and blockchain confirmation are excluded from the SDK metrics.

| Browser POST stage | Control median | Candidate median |
| --- | ---: | ---: |
| Setup | 513 ms | 635 ms |
| Respond | 235 ms | 210 ms |
| Yao execute | 1,887 ms | 1,739 ms |
| Finalization | 806 ms | 842 ms |
| Sign prepare | 341 ms | 345 ms |
| Sign execute | 344 ms | 318 ms |

Every measured wallet used six Gateway POSTs: setup, respond, Yao execute,
finalization, sign prepare and sign execute. No session-status POST was present.
The production responses did not expose D1 or internal Console call counts.
Those counts remain unknown for this run; missing telemetry is not zero work.
Gateway finalization CPU medians were 104.5 ms, 107.5 ms and 78 ms across the
control, candidate and repeat. These are POST events only, excluding OPTIONS.

## Sealing CPU

A protected temporary version of the existing staging Gateway ran synthetic seal
operations. It used the published 0.9.0 JavaScript glue with both release modules.
All 800 seals matched the same expected bytes. The probe used no wallet secrets.
It ran a discarded 100-call warm-up for each module, then three alternating
zero-call/100-call pairs per module. Zero-call requests estimate wrapper overhead.

| Cloudflare CPU | Published release | Optimized release |
| --- | ---: | ---: |
| 100-call batch median (range) | 551 ms (540–698) | 588 ms (510–643) |
| Zero-call median | 7 ms | 2 ms |
| Estimated CPU per seal | 5.44 ms | 5.86 ms |

This small sample establishes the scale, with no demonstrated hosted speed gain.
The earlier estimate of 160 ms per seal came from a development build and a local
CPU-share extrapolation. It does not apply to release sealing. Moving a roughly
6 ms operation out of the finalization response would add lifecycle complexity
and change the reply contract. Keep it synchronous.

Commit `a4bba328` retains the same arithmetic and output, builds for speed, and
increases the module by about 26 KB. The independent
[local release comparison](refactor-155g-seal-release-local.md) measured a 16%
compute reduction. Hosted variance prevents a stronger latency claim.

## Deriver module size

Commit `3f3800a4` strips only custom `name` and `.debug_*` sections after
worker-build. Worker-build appended a debug flag after Cargo's configured flags,
so setting strip flags there did not remove the metadata.

The exact staging modules lost 1,300,897 bytes for A and 1,346,077 bytes for B.
Their runtime sections remained unchanged. Cloudflare's upload-time startup
metric changed from 7 to 8 ms for A and stayed at 6 ms for B. This is smaller
packaging, with no demonstrated isolate startup gain. It is not a measurement
of a cold wallet request. The 6.2 MB runtime data section remains intact.

## Verification and restoration

All 27 registration/message signatures passed, including discarded warm-ups.
An independent Node Ed25519 verifier reconstructed the NEP-413 encoding. It
rejected changed messages, recipients, nonces and callback URLs.

The first candidate browser attempt stopped at tenant readiness before creating
wallets. Activation then passed. After measurement, all original Worker versions
were restored. Reactivation initially rejected two unexpired registration records
in the US regional database. Their natural expiry allowed activation to pass in
GitHub run `38210795747`. No records were deleted. Health returned HTTP 200.
The temporary seal probe was also removed from service.

The [sanitized JSON record](refactor-155g-final-staging.json) contains stage
statistics, CPU observations and module startup measurements. Frozen assets,
raw proofs, version snapshots, tails, drivers and logs are in the private
`.artifacts/r155g-remaining-20261012/` directory. `analyse.py` and
`verify-proofs.mjs` reproduce the analysis and independent verification.
