# Console setup deployment and environment batch

Date: October 11, 2026.
Private implementation: `3db9b5d` on `seams-monorepo` `dev`.
Test module-root repair: `d67bbdd`.

**Hosted follow-up:** the [staging comparison](refactor-155f-console-setup-hosted.md)
confirms four setup calls and **37 completed Gateway/Console calls** per registration.
The candidate registered in **3.950 s median** against **4.171 s** in the repeated
control. That run does not isolate a repeatable latency saving from the batch.
All nine signatures and the independent restoration checks passed.

## Result

Fresh Console setup uses **four D1 API calls and five SQL statements**.
The previous implementation used five calls and five statements.
The [generated production-Worker artifact](refactor-155f-setup-batch.json)
records the new count, bundle hash, migration hashes, and observed outcomes.

| Setup work | Before: D1 calls | After: D1 calls | After: SQL statements |
| --- | ---: | ---: | ---: |
| Deployment admission and exact environment | 2 | 1 | 2 |
| Credential lookup | 1 | 1 | 1 |
| Credential usage update | 1 | 1 | 1 |
| Wallet-home reservation | 1 | 1 | 1 |
| **Total** | **5** | **4** | **5** |

No hosted latency measurement was run during this local verification. The latest
hosted registration result at that commit was **4.102 s median**, with a **3.597–5.593 s range**.
The repeated control measured **4.094 s median**. That run counted **38 completed
Gateway/Console D1 calls** for registration. It predates this batch and excludes
custody-role D1 calls and unfinished background work. See the
[hosted record](refactor-155f-home-publication-hosted.md).

## Implementation

The first batch reads the active deployment binding and its exact environment.
The environment query joins the binding's namespace, organization, project,
and environment. Browser fields cannot select a different scope.

The existing decoder checks the current writer version and resource identity.
The handler checks the regional resource catalog, then authenticates the key.
It still awaits the credential usage update. The context builder checks the
credential scope and active environment before a wallet reservation.

The code reuses the existing binding decoder, environment parser, and context
builder. It removes setup's separate environment-service operation and the
previous overlap helper. Other Console operations retain their existing reads.
The Gateway still makes one setup request to Console. No schema, cache,
background write, or infrastructure change is required.

This replaces the [setup overlap](refactor-155f-setup-overlap.md). Its expected
benefit cannot be added to this batch as a second independent saving.

## Verification

The production Console E2E passes. It runs the real Worker with local D1 and
a test wrapper that counts calls and injects a database failure. It verifies:

- Fresh setup makes four calls and executes five statements.
- An APAC reservation retains its home on a retry through WEUR.
- Batch failure and a retired writer create no wallet reservation.
- A retired writer stops after one batch, before credential usage or reservation.
- Invalid credentials, origins, and scopes fail. A foreign tenant key fails.
- Rotation permits the new key and rejects the old key. Revocation and archival fail.
- A changed environment version appears in the setup response.
- Missing deployment returns 503 after one batch.
- Credential usage persists. No external service request occurs.

Three composed browser cases pass. They cover NEAR registration with signing
from another region, lost completion replies, and mixed NEAR/ECDSA registration
with provisioning reply loss and a foreign-region retry during a Console outage.
The binding-freshness E2E also passes. Candidate type checking, touched-file lint,
and the Console-core import boundary check pass.

The broader deployment-renewal E2E remains unverified. Miniflare's proxy throws
`"undefined" is not valid JSON` before its intended activation-reply-loss check.
The same failure occurs on an isolated copy of unchanged parent `98a1b3e`, using
the same public candidate and module-root repair. This is a pre-existing test-run
failure; its cause remains unresolved. The initial module-root startup failure
was classified as `environment_or_infrastructure_failure` and fixed in `d67bbdd`.
No production behavior was changed to satisfy the renewal test.

## Reproduction

Build the public wallet-server package, then run from the private checkout.
The existing candidate tsconfig maps public imports to that build.

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  --tsconfig /Users/pta/Dev/rust/seams-monorepo/.artifacts/r155f-lineage-batch/playwright.tsconfig.json \
  --output /Users/pta/Dev/rust/seams-monorepo/.artifacts/r155f-setup-batch/console-e2e \
  relayer/console-service-auth.e2e.test.ts --reporter=line
```

The committed JSON is an unchanged copy of the generated
`console-service-auth-evidence.json`. This local Console test does not run signing
or measure regional latency. The composed browser command is recorded in the
[previous evidence](refactor-155f-setup-overlap.md#reproduction).

## Next work

Inspect the remaining serial Console completion and Gateway commit dependencies.
Passkey claiming and route publication already overlap. Combining their requests
would save a repeated deployment read, with an unmeasured effect on elapsed time.
Preserve their distinct failure policies before changing that boundary.

Measure the accepted changes together on staging with a repeated control.
Report registration and first signing separately, retain independently verified
signatures, and restore the original serving versions after the comparison.
