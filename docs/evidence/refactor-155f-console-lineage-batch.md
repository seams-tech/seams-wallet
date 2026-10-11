# Console lineage lookup batch — October 11, 2026

Console now reads created and restored root records in **one D1 batch**.
The previous implementation used two serial calls. Both SQL statements remain.
The batch reads them from one database snapshot.

This removes one round trip from the active-lineage request during registration.
It introduces no cache, schema change, configuration, or infrastructure.
The existing persistence parsers still check the records.
The obsolete creation lookup method, its input type, and the standalone restore
query are removed.

## Local comparison

The comparison uses real local D1 with the production Console migrations.
It compares private baseline `3e47ba2` with candidate `3272020` on the same database.
Both use the public SDK build from `ab6b1c9a`.
The existing D1 observer records completed calls and SQL statements.

| Database state | Baseline calls | Candidate calls | Result |
| --- | ---: | ---: | --- |
| No active root | 2 | **1** | Both return no lineage |
| Active created root | 2 | **1** | Both return the same lineage |
| Created root has different canonical identity fields | 1 | **1** | Both reject |
| Two active restore records | 2 | **1** | Both reject |

The baseline rejects a mismatched created identity before its second query.
The candidate reads both records before it rejects the mismatch.
Neither implementation returns a lineage from these invalid records.

[Raw call traces and outcomes](refactor-155f-console-lineage-batch.json) contain
synthetic test identities and query hashes. Local elapsed times in those traces
are diagnostic data. They do not establish a hosted latency saving.

## Product verification

The existing Console service E2E now also verifies an active created root and
rejection of a stored identity mismatch. It exercises the production Console
Worker through a consumer Worker and the normal service client.
It uses actual D1 migrations and the existing grant-creation fixture.
It restores the canonical identity and verifies that lookup works again.

The E2E passes. Its other checks cover credential rotation, revocation,
environment admission, concurrent authenticated use, and usage-event replay.
Candidate type checking, targeted lint, and the whitespace check pass.

The separate deployment-renewal E2E fails with `"undefined" is not valid JSON`
on both the frozen private baseline and this candidate. It fails before the
expected lost-activation-reply check. This existing failure is not evidence
against the lineage batch. Its cause remains unresolved. No production behavior
was changed to satisfy that test.

The private local artifacts are in `.artifacts/r155f-lineage-batch/`:

- `measure.mjs` repeats the baseline/candidate D1 comparison.
- `comparison.json` records the four outcomes and their D1 calls.
- `console-service-auth-evidence.json` records the production Console E2E.
- `playwright.tsconfig.json` resolves matching private sources and the current SDK.

Run the E2E from the private repository with the current SDK build:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
  pnpm -C tests exec playwright test -c playwright.relayer.config.ts \
  --tsconfig /Users/pta/Dev/rust/seams-monorepo/.artifacts/r155f-lineage-batch/playwright.tsconfig.json \
  relayer/console-service-auth.e2e.test.ts --reporter=line
```

The repository's release pins remain at 0.8.0. Candidate checks must resolve the
current local SDK build. An unchanged package-level check against 0.8.0 reports
missing exports from later work.

## What this establishes

At implementation time, the last hosted comparison counted **40 registration
D1 calls** across Gateway and Console. No live resources changed in that step.
The later [home-publication comparison](refactor-155f-home-publication-hosted.md)
confirms **39 calls in its control** and one lineage batch in all nine requests.
Both groups include this batch, so that run cannot isolate its latency saving.
Its candidate removes another Gateway read and uses **38 registration calls**.
Gateway behavior, application requests, SQL statements, and signature work are
unchanged by the lineage batch itself.

## Next work

The follow-up removes publication's extra home read and overlaps the initial home
and journal reads. The composed test verifies that Console completion starts
before sealing. Hosted evidence verifies the reduced call count and read ordering.
Full initial-read batching remains open. The next Console target is setup's
credential lookup, usage-timestamp update, and environment lookup.
