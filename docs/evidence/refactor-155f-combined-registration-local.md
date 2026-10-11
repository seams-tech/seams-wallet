# R155F combined registration changes — local verification

Date: October 11, 2026. Hosted latency is **not measured yet** for this batch.

Public `0e00b591` removes three Gateway calls. Private `eb235b1` removes three
Console calls. Private `0a85921` verifies the Console changes in production
composition. The [JSON record](refactor-155f-combined-registration-local.json)
contains call counts, replay outcomes, and artifact hashes.

## Removed work

| Operation | Change | Local D1 calls |
| --- | --- | ---: |
| NEAR setup | The deterministic reservation uses its insert/read batch for exact retry. The earlier ceremony lookup is removed. | 4 → 3 |
| Respond | Verify setup once, then batch home admission and the ceremony snapshot. Pass the admitted ownership generation to the mixed branch. | 5 → 4 |
| Finalize | Load the immutable lifecycle decision with home, journal, and ceremony. Retain the atomic decision guard. | 9 → 8 |
| Console passkey claim | Check deployment, writer, tenant, and configured resources inside the claim transaction. | 2 → 1 |
| Console route publication | Use the same transaction check before inserting or verifying routes. | 2 → 1 |
| Console completion | Use the same transaction check before session publication, home completion, and display projection. | 2 → 1 |

Gateway counts exclude the production entry's separate regional routing read.
They exclude pending cleanup and custody-role databases. The projection for
hosted registration is **34 → 28 calls**, and **41 → 35 through first signing**.
These totals must still be checked in the combined hosted comparison.

The Console change adds migration `0091_console_deployment_write_checks.sql`.
It uses the existing deployment-fence pattern. A trigger checks the current
deployment in the mutation transaction and stores no rows. Rejected writers
cannot make companion writes. Missing deployment remains retryable HTTP 503.
No Worker, database instance, secret, configuration flag, or cache was added.

## Remaining dependency budget

Fresh NEAR finalization uses eight local calls:

1. Home, relocation fence, operation journal, ceremony, and immutable decision read.
2. Durable operation preparation before external effects.
3. Yao lifecycle authority read before Router consumption.
4. Existing founding authority and authentication-method read.
5. Shared capability snapshot read, concurrent with step 4.
6. Atomic wallet, capability, lifecycle decision, and initial-session commit.
7. Custody-record commit, with its separate failure outcome.
8. Atomic local home activation and operation receipt after Console completion.

Calls 3 and 5 read different state: ceremony authority and shared capabilities.
The capability version check protects concurrent changes by other wallets.
The custody commit stays separate because its failure must not roll back the
successful wallet commit. Console completion requires the durable initial session.
Local activation follows successful Console completion. Moving those writes
after the response would change recoverability and visibility.

Exact completed replay still uses **one local batch**, even after ceremony
cleanup. It returns the original session and no new operation credential.
Relocation fences and a retired home reject replay.

## Conditional proposals resolved

- **Combine Console requests:** passkey claims and route publication already run
  concurrently. Both now use one D1 batch. Combining their HTTP requests would
  require coordinating distinct required and optional outcomes without removing
  a serial exchange. Their existing handlers remain used by other lifecycle flows.
- **Claim the passkey during respond:** a claim prevents terminal cancellation.
  Moving it earlier would extend that restriction to Yao failures. Keep the claim
  beside Router consumption, where exact retry already recovers a lost response.
- **Combine execute and finalize:** the client needs Yao's result to build the
  activation reference and encrypted custody commit. These inputs do not exist
  when execute starts. Keep the existing four registration requests.
- **Regional deployment read:** it selects the binding, configuration, and wallet
  route before Gateway execution. Its writes already enforce the deployment
  inside their transactions. Removing the routing read requires a different
  configuration contract.
- **Further custody and browser overlap:** preserve the measured Deriver-B
  prewarm work and the separate R155G ownership. Do not duplicate its placement,
  browser preparation, protocol, or sealing work.

## Correctness evidence

- All **14 public registration contracts** pass. They include mixed registration,
  lost Router replies, immediate signing, and deferred provisioning races.
- **Eight composed scenarios** pass with the complete implementation and updated
  deployment fixtures. They cover concurrent setup, setup and provisioning reply
  loss across regions, normal completion, lost completion reply, and credential
  claim failure after Router consumption. They verify NEP-413 signatures
  independently. Call counts match the earlier local trace exactly.
- The **production Console E2E** passes. Each changed mutation and its exact replay
  use one D1 call. A retired writer leaves claims, routes, sessions, and home state
  unchanged. The transaction-check table remains empty.
- Both **wallet-home and relocation directory E2Es** pass. Regional session
  routing also passes across four databases. This includes concurrent exchange,
  lost replies, cancellation, revoked credentials, and directory outages.
  Private `7ed7399` gives these fixtures active Console writer records through
  the shared deployment builder and uses valid deployment environment IDs.
- Server build, candidate Console type check, wallet-state type fixtures,
  touched-file lint, and the public bloat check pass.

The new Console scenario establishes a second wallet. Its display assertion was
updated accordingly. The regional and directory harnesses now create a real
Console deployment through the existing fixture builders. No production behavior was changed to
accommodate an old fixture. Initial port collisions and the default private
check's 0.8.0 dependency mismatch were test-environment failures.

The combined hosted candidate is frozen in
`seams-monorepo/.artifacts/r155f-combined-hosted/`. Its 512-file manifest includes
the database migrations, compiled components, benchmark SDK, scripts, and original
deployment settings. It waits for the active custody experiment to restore staging,
then checks all 13 original versions and their settings before making any change.

Repeat from `seams-monorepo` with the built public candidate:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 SEAMS_LOCAL_PORT_OFFSET=1000 \
node tests/scripts/run-regional-real.mjs passkey.registration.contract.test.ts \
  --grep 'NEAR registration|concurrent NEAR-only setup|setup reply loss|NEAR provisioning reply loss'
```

Console reproduction uses `tests/relayer/console-service-auth.e2e.test.ts` with
the existing candidate Playwright config. Saved artifacts are under
`seams-monorepo/.artifacts/r155f-combined-local/`. The public registration suite
used a separate port range and `playwright.wallet-intended.ci.config.ts`.
