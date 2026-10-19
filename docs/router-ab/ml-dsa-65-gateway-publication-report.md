# ML-DSA existing-wallet admission and publication

The first public flow adds an ML-DSA signer to an existing passkey wallet.
The local E2E passes 17 Gateway checks, canonical FIPS key comparison, and standard signature verification.
[Generated evidence](../evidence/ml-dsa-65-gateway-publication-20261019.json) records source hashes, Worker builds, and results.

## Implemented boundary

The SDK uses the existing add-signer intent and fresh WebAuthn approval.
The Gateway selects the operation, signer slot, initial epoch, and participant recipient keys.
It pins the active owner authority, auth method, custody-envelope version, and wallet execution generation.
It persists the exact encrypted inputs before contacting the private Router.
An empty pool returns an explicit retry time. Retries retain the operation and input pair.

Both participants must confirm installation with matching key, manifest, and schedule metadata.
The client authenticates both encrypted results through the existing custody driver.
The Gateway then checks the joined-custody completion against its retained installation result.
Publication and the current-owner checks commit in one D1 transaction.
The publication journal is the authoritative key record for the next public signing integration.
It does not create a reusable signing session.

The flow preserves the existing seed envelope and recovery set byte for byte.
It keeps wallet-seed derivation, canonical FIPS export, four-candidate preparation,
two-at-once consumption, the 32-candidate pool, and the 16-candidate admission minimum.

## Lifecycle safeguards

Lost publication acknowledgements can be retried after Gateway restart.
Changed encrypted inputs, wrong wallets, changed slots, wrong origins, and revoked owners fail.
Existing admitted work can settle while relocation drains. New admissions cannot start then.

Unused admissions expire into retained, versioned records. Their slots can be admitted again.
A delayed transaction from the earlier admission cannot overwrite the replacement.
Dispatched operations retain their slots after interruption because participant outcomes can be uncertain.
Public recovery must reconcile those outcomes before reuse.

Participant relocation is not implemented for ML-DSA. The Gateway refuses relocation after
execution starts, and a database trigger enforces this boundary during concurrent writes.
This prevents relocation from silently omitting installed or uncertain ML-DSA state.

## Validation and limits

Run the existing Worker registration E2E with a private fixture directory and an evidence path:

```sh
node tests/e2e/ml-dsa-registration-worker.e2e.mjs <private-fixture-directory> <evidence.json>
```

The runner uses real local Worker key generation, D1 migrations, Gateway HTTP routes,
P-256 WebAuthn signatures, and a native client that opens the existing custody envelope.
The fixture seeds existing owner records through shared builders. It allocates the intent
through the trusted service API, so publishable-key HTTP admission is outside this campaign.
The prior Chromium campaign covers the custody driver. This campaign does not drive the
complete public SDK through a browser.

The Gateway checks cover invalid authentication, wallet/origin binding, exact admission replay,
slot substitution, premature publication, empty pools, input pinning, installation replay,
relocation refusal, lost acknowledgements, D1 restart, draining settlement, unchanged recovery
records, standard signing, expiry replacement, a delayed execute race, and owner revocation.
The expiry race uses the production expiry cutoff with a simulated future time.

Wallet and server TypeScript checks and lifecycle type fixtures pass.
The Rust investigation binary builds in release mode.
The bloat check reports the inherited Rust duplicate count: 13,984 lines against 13,754.
The baseline is unchanged. No new bloat category fails.

These are functional local results. The campaign does not establish hosted latency or a
consistent five-second target. No production deployment was performed.

## Remaining integration

1. Load this publication record in public signing admission and durable operation claims.
2. Connect SDK transaction approval, verification, and submission.
3. Connect public recovery and export, including interrupted registration reconciliation.
4. Connect device enrollment and revocation without transferring owner seed material.
5. Implement participant relocation before enabling it for ML-DSA wallets.
6. Run the complete browser SDK lifecycle against matching hosted Gateway and Worker builds.

## Review record

| Observation | Classification | Resolution |
| --- | --- | --- |
| The initial test bundle lacked the Wasm loader and Wallet alias. | Test infrastructure failure | Use the Wallet tsconfig and Wasm file loader. |
| The freeze fixture bypassed the required retirement sequence. | Invalid test fixture | Exercise the production relocation boundary. |
| The initial guard blocked admitted work during draining. | Production regression in this change | Permit existing work to settle. |
| Expired admissions retained unsettled activity indefinitely. | Production regression in this change | Expire unused admissions and settle activity atomically. |
| Deleting expired records could reset the version and admit stale writes. | Production regression in this change | Retain the record and increment its version. |
| Relocation would omit ML-DSA participant state. | Unsupported integration boundary | Refuse relocation explicitly and atomically. |

An independent read-only review found no remaining concrete race in this scope.
The E2E then reproduced the delayed-transaction scenario and verified rejection.
