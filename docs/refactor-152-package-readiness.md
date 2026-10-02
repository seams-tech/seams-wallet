# R152 packed Wallet Server acceptance

Date: October 2, 2026

Private commit `aa1d2ae` adds packed-candidate acceptance and the consumer fix below.
The home-verification E2E now accepts an extracted Wallet Server candidate
through `SEAMS_WALLET_SERVER_CANDIDATE`. It bundles the candidate's public JavaScript
exports into the production Console/Gateway/Runtime entrypoints, applies the
candidate's packaged signer migrations to two local D1 databases and runs the
existing challenge, activation, replay, expiry, stale-version and readiness checks.
Bundle inputs are retained and checked for accidental use of installed Wallet
Server code. Evidence identifies a packed candidate separately from the development
scenario using installed SDK code and source migrations.

The initial candidate was built from public source commit
`76c3a2e018a7b56e2f206b28508c7c4c942956d3`. A fresh Wallet Server TypeScript build and
`npm pack` succeeded. The packed E2E passed in **29.4 seconds**; the development
scenario passed separately in **21.5 seconds**. All **103 manifest file records**
matched their packaged byte counts and SHA-256 hashes. All **39 migrations from
installed 0.7.3 are byte-for-byte unchanged**; migration 0040 is the sole added
signer migration. Its migration-set fingerprint is
`ee4dce77798594d88e526ad2e9130666af26aadd1d3c41aa30c7afeed95af48d`.

The initial unpublished tarball SHA-256 is
`2535ee7d9d24728c98130594d53088ece876cd74572375c2284e13544120d9d6`.
Its package version remains 0.7.3 because this is local candidate verification;
it is not the npm 0.7.3 artifact and must not be published under that version.
This initial pack reuses existing custody Worker binaries and WASM assets, with
build stamps retained in the receipt. It therefore does not establish a complete
production release build.

Checking private Console sources against the candidate's packaged declarations
found one upgrade integration regression: `d1LocalDevWorker.ts` still constructed
the retired `nodeRole` field. It now calls the SDK's existing presign configuration
parser with explicit participant IDs 1 and 2. Type-checking passes against both
the installed SDK and the candidate, without casts or a compatibility branch.
Console-test type checking, targeted ESLint and formatting also pass. No unit
tests were added. The full public `pnpm type-check` also passes, including Wallet,
Server, docs, the Console-lite example, intended app and lifecycle type fixtures.

The npm registry identifies published Wallet Server 0.7.3 with git head
`2bc58391ddeef44eb1432ccd15be8a0d31332d55`, the merge of PR 33. The candidate includes
79 source commits beyond the authorized `7b5c95f8` revision: 377 changed files,
6,748 insertions and 40,474 deletions compared with the published merge. This is
a scope inventory, not a complete review of that range. Besides R152 migration,
projection and query changes, it includes UI changes, retired public types/config,
Rust/dependency cleanup and verification work. A release decision must review the
complete candidate and choose its version; the migration alone cannot authorize
publishing all later changes.

Private evidence: `.artifacts/r152/package-readiness-20261002/` retains the
extracted candidate, package verification receipt, npm provenance, E2E logs,
challenge/activation/readiness receipts, bundle inputs, candidate type-check
configuration and logs. The initial tarball and build/pack logs are retained at
the same relative artifact directory in `seams-wallet`. Reproduce acceptance:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/absolute/path/to/extracted/package \
  pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  relayer/tenant-home-challenge.e2e.test.ts \
  --reporter=line --output=test-results/r152-packaged-server
```

No npm publication, dependency-pin change or hosted deployment was performed.

## Full local production rebuild

The subsequent `WASM_SDK_BUILD_MODE=prod pnpm build` passed: WASM packages, all
five custody Workers, host-local tooling, Wallet Server and Wallet SDK were rebuilt.
`pnpm check:packed-wallet` passed for both packages. The build emitted Rust warnings
but no errors. The fresh Server tarball SHA-256 is
`97eefec8f3b8f9399a036b76c53c519424fae11ca161b3cb3e29b5526aef7378`.
It is retained separately from the initial candidate under
`.artifacts/r152/package-readiness-20261002/fresh-production/`.

The composed E2E passed again against this fully rebuilt package in **18.5 seconds**.
All 103 manifest file records match; the signer migration-set fingerprint remains
unchanged from the initial candidate. The fresh Worker build stamps, manifest,
tarball digest, bundle inputs and challenge/activation/readiness receipts are
retained. The normal development test also remains green. Bloat checks pass.

This completes local package preparation for the tested source revision. It does
not close release review, cross-platform release CI or the full lifecycle release
suite. The existing release workflow builds additional local-tool platforms that
were not built on this host. Choose and validate the next package version, review
the complete source range, then publish and consume the exact release before
hosted adoption. R152's deployment preflight still rejects the currently installed
npm 0.7.3 package because it lacks migration 0040.
