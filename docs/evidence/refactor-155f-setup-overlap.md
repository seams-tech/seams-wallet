# Console setup authentication and environment overlap

Date: October 11, 2026.
Private implementation: `ba2aa5d` on `seams-monorepo` `dev`.
Public change: export the existing `walletRegistrationContext` boundary builder
from `@seams/wallet-server/cloud-host` for the Console setup handler.

## Change

Console setup previously awaited credential lookup, validation, and the usage
update before loading the environment. It now starts environment loading with
authentication. The read uses the tenant scope from the verified deployment
binding. Browser fields cannot change that scope.

The handler awaits both results before reserving a wallet. Authentication failure
takes precedence over an environment-read failure. A valid credential must match
the deployment's organization and environment. The existing context builder checks
the exact active environment, and setup checks its project and environment key.

The API-key service still validates the credential and awaits its usage update.
The update records `last_used_at_ms` and `updated_at_ms`. Publishable-key
authentication consumes no signing budget or endpoint quota. No write moves to
background execution. No cache, schema, or infrastructure was added.

The Gateway still makes one setup call to Console. The two Console operations
dispatch through the existing handler inside that invocation. They add no
Gateway-to-Console network exchange.

## Results and limits

The [generated E2E artifact](refactor-155f-setup-overlap.json) records:

- Environment loading starts before authentication finishes. The test holds
  authentication's reply until the environment request starts.
- A failed environment read rejects setup. An invalid key keeps its authentication
  error when the environment read also fails. Neither failure reserves a wallet.
- An APAC reservation retains its home when retried through WEUR.
- Key rotation rejects the old secret and permits a fresh registration with the
  replacement. Revocation, invalid origin, environment mismatch, another
  deployment's credential, and environment archival reject setup.
- API-key usage persists. Eight concurrent secret-key authentications still
  record eight uses. No external service request occurs in this local test.

Three composed browser scenarios also pass: registration followed by signing from
another region, recovery after a lost completion reply, and mixed NEAR/ECDSA
registration with a lost provisioning reply and a foreign-region retry during
a Console outage. These reuse the existing signature-verification scenarios.

The server build, candidate Console type check, touched-file lint, public bloat
check, and private script checks pass. The script suite reports 151 passed and
one existing skip.

**No hosted latency measurement was run for this change.** The source keeps the
same five D1 calls in Console setup: deployment admission, key lookup, usage
update, environment read, and reservation. It removes one serial dependency.
The earlier hosted environment read took about 13 ms in its control sample.
That observation is a scale estimate, not a measured saving from this change.

The latest hosted registration result remains **4.102 s median** with a
**3.597–5.593 s range**. The repeated control measured **4.094 s median**.
The [hosted record](refactor-155f-home-publication-hosted.md) reports 38 completed
Gateway/Console D1 calls for registration. The new overlap does not reduce that
count. Custody D1 calls and unfinished background work remain outside that count.

## Reproduction

Build the public server from its checkout:

```sh
pnpm -C packages/wallet-server build
```

From the private checkout, run the production Console E2E against that build.
The existing candidate tsconfig selects the local server and private source aliases.

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  --tsconfig /Users/pta/Dev/rust/seams-monorepo/.artifacts/r155f-lineage-batch/playwright.tsconfig.json \
  --output /Users/pta/Dev/rust/seams-monorepo/.artifacts/r155f-setup-overlap/console-e2e \
  relayer/console-service-auth.e2e.test.ts --reporter=line
```

The test writes `console-service-auth-evidence.json` under its output directory.
The committed artifact is an unchanged copy of that generated file. It includes
the production Console bundle hash, migration hashes, and observed outcomes.

Run the composed scenarios from the private checkout:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 SEAMS_LOCAL_PORT_OFFSET=1000 \
node tests/scripts/run-regional-real.mjs passkey.registration.contract.test.ts \
  --grep 'NEAR registration combines|NEAR registration recovers a lost|mixed NEAR provisioning reply loss'
```

## Next work

Examine Console's deployment-admission read alongside the operation it protects.
Combine them only where the transaction can enforce the same writer and retirement
checks. Then evaluate combining finalization's passkey claim and route publication,
with their existing distinct failure policies. Measure a group of accepted changes
together on staging. Preserve the repeated control and independently verified
signatures. A small local ordering improvement does not establish the registration
latency target.
