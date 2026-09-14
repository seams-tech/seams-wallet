# Spec 9: Behaviour and test authority

When changing Wallet, start with the behaviour the user should see and the
architecture rule that supports it. Choose tests that demonstrate those
properties.

## Finding the expected behaviour

[Intended Behaviours](intended-behaviours.md) defines supported user journeys.
The [numbered specs](README.md#choose-a-topic) define architecture requirements,
and the [Router protocol](router-ab/protocol.md) defines the detailed
cryptographic protocol.

Tests provide evidence for these contracts. A failing test can expose a
regression or an outdated expectation, so identify what it is checking before
changing code. Resolve contradictions in the affected documents and tests.

Historical refactor plans explain how a design arose. Current specs and
behaviour contracts determine the intended result.

## Choosing a test

Use a behaviour contract to check a complete journey, such as unlocking and
signing. Use a focused unit or integration test for a specific boundary or
failure that the journey does not exercise.

Cryptographic vectors check exact encodings and results. Type fixtures check
that invalid domain states are rejected at compile time. Formal proofs cover
the properties in their stated models. Each kind of evidence answers a
different question; a passing signing journey cannot establish all of them.

TypeScript tests live in the top-level `tests` workspace. Build complex
session, authentication, and signing records through shared factories.
Raw objects belong in boundary-parser tests.

For example, this [passkey contract](../tests/e2e/intended-behaviours/passkey.unlock.contract.test.ts)
checks that a user can restore signing after local browser storage is cleared:

```ts
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';

async function verifyPasskeyColdSyncFromEmptyStorage({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.syncPasskeyWalletFromEmptyStorage();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoAndArcEvmConcurrently('post_unlock');
}

test(
  'synced passkey cold unlock restores mixed-wallet signing from empty browser storage',
  verifyPasskeyColdSyncFromEmptyStorage,
);
```

The harness handles setup and checks the outcomes. The test reads as a user
journey, so you can see which behaviour it protects without reading those details.

## Understanding a failure

Classify the failure before repairing it:

- **Production regression:** current behaviour or an architecture requirement is
  broken. Fix the implementation.
- **Valid test needing an update:** the rule still holds, but the test uses an old
  representation. Update its fixture or assertion.
- **Obsolete test:** its only purpose was retired behaviour. Remove it and any
  unused supporting code.
- **Environment failure:** a required browser, provider, credential, or service
  is unavailable. Report the missing dependency.

A stale fixture is no reason to widen a production type. If one fixture repair
fails, reassess the expectation before continuing.

Source-text guards cover only precise boundaries that other tests cannot
express well. Remove them when the boundary they protect is retired.

## Checking a change

A user-visible behaviour change updates Intended Behaviours and its contract
test together. Run the nearest relevant test first. Broaden verification when
the change affects shared APIs, state, persistence, authorization, or cryptography.

The main starting commands are `pnpm test:intended`,
`pnpm test:wallet-browser`, and `pnpm type-check`.
Package changes also use `pnpm check:packed-wallet`.

Regenerate cryptographic vectors and wire fixtures with their owning tools;
never edit generated output by hand. Asynchronous tests should observe actual
readiness and completion, and failures should report useful state without
logging secrets.

Start with the [behaviour contracts](../tests/e2e/intended-behaviours),
[unit tests](../tests/unit), or [type fixtures](../tests/typecheck), according
to the change.
