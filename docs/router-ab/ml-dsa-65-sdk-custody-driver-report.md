# ML-DSA SDK custody driver — October 19, 2026

The SDK now drives ML-DSA establishment, existing-custody joining, and recovery through
the actual custody worker. Public Wallet lifecycle integration remains incomplete.

The [MVP plan](ml-dsa-65-mvp-plan.md#sdk-lifecycle-implementation--october-19-2026) prioritizes public
registration, signing, recovery/export, and device authorization before further latency work.

## Implementation

`runMlDsaCustodyKeySetCeremony` uses the existing custody driver and worker operation map.
Its exclusive input branches require creation continuity for establishment and recorded
manifest continuity plus a replacement factor for recovery. Joining cannot issue recovery codes.
The type fixtures reject incompatible inputs, including broad object spreads.

The driver sends encrypted role inputs to the supplied Router round. Native completion
authenticates both role replies before the driver finishes the ceremony. A failed Router
round discards the live worker handle and preserves the original error.

The returned record proposes a custody commit. It grants no signing authority and does
not claim durable publication. Existing public route gates remain in place.

Device linking remains separate. A linked device must receive authority for the existing
server-held signer. The wallet custody seed and server signing shares must stay outside
that transfer. This campaign's owner-envelope join cannot qualify device enrollment.

## Evidence

The [browser artifact](../evidence/ml-dsa-65-sdk-custody-driver-20261019.json) records
twenty-four passing checks. Chromium runs the real SDK driver, worker, and rebuilt browser
Wasm. Separate native participant processes generate keys and produce threshold signatures.
The existing ordinary-key recipient verifies canonical export after signing.

| Scenario | Result |
| --- | --- |
| Establish custody | Public key, threshold signature, and canonical export verified |
| Recover through a recovery code | Replacement factor created; key, manifest, and exported seed preserved |
| Join an existing owner envelope | Key and exported seed preserved; no replacement envelope or recovery set emitted |
| Router transport failure | Original error preserved; private Wasm handle explicitly freed |
| Boundary failures | Secret input fields, missing manifests, unsafe epochs, stale replies, invalid types, and wrong steps rejected |
| Handle lifecycle | Completed handles cannot repeat; the existing concurrency limit and capacity after discard pass |

The artifact records the native signing candidate count for each successful scenario. This
does not measure the prepared Worker consumption policy, hosted latency, or pool capacity.
The implementation changes no preparation, pool, signing, recovery derivation, or export algorithm.

Sources, bundles, Wasm, native executable, and circuit schedules have recorded hashes.
The test removes temporary role files. Its factors and exported seeds are disposable test data.
Repeat the campaign with the [browser E2E commands](../../tools/ml-dsa-investigation/README.md#browser-custody-e2e).

SDK TypeScript checking, wallet-state type fixtures, JavaScript syntax, and whitespace checks pass.
The bloat gate still fails on inherited Rust duplication: 13,984 lines against 13,754.
This change modifies no Rust source and does not update the baseline.

## Remaining public integration

The next boundary is authenticated registration with authoritative key, operation, and epoch
allocation. It must discover participant keys securely and publish custody only after durable
installation and persistence. Then connect the existing owner-approval gate to authoritative
signing records, public SDK transaction submission, recovery, and device revocation.

This campaign uses native participants and fixture authentication. It supplies no public
Gateway, Cloudflare lifecycle, deployed NEAR transaction, or device-linking completion claim.
