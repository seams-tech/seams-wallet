# Session sealing: release build comparison

October 12, 2026. Local Node WASM measurement. The subsequent
[Cloudflare measurement](refactor-155g-final-staging.md) found about 5–6 ms per
seal and no demonstrated hosted speed gain.

The candidate changes compilation only: Rust `opt-level = 3` and `wasm-opt -O3`.
The original release configuration uses `opt-level = "z"` and default wasm-opt.
Both builds use the same source and lockfile. No group, exponent, identity binding,
expiry rule or response contract changes.

| Add one lock, 12 samples after three warmups | Median | Range |
| --- | ---: | ---: |
| Original release | 2.062 ms | 2.008–2.181 ms |
| Candidate release | 1.728 ms | 1.662–1.799 ms |

This synthetic 128-byte group element gives about **16% less local compute time**.
Both modules produced identical seals. Every seal round trip recovered its input.
The published 0.9.0 server's JavaScript glue also sealed and unsealed successfully
with the candidate module. The algorithm stays unchanged.

An initial comparison used a pre-existing 654,272-byte local artifact. That artifact
was much slower. It is excluded because its build profile was not established.
The live 0.9.0 Gateway instead contains a 92,823-byte release module. Do not report
the initial result as a deployed improvement.

The optimized module grows from about 93 KB to 119 KB. This trades a small increase
in upload size for faster arithmetic. The hosted comparison determines its effect
on registration latency. Raw samples and hashes are in
[the JSON record](refactor-155g-seal-release-local.json).

Local reproduction and logs: `.artifacts/r155g-remaining-20261012/` in seams-wallet.
`seal-profile.mjs` compares fresh release builds and verifies equal outputs.
The existing browser contracts also passed for warm signing, exhausted quota,
reload, and recovery after a failed registration seal.
