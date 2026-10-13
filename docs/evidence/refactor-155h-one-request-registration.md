# NEAR-only passkey registration: the proof and the execution in one request

Recorded October 13, 2026, for [R155H](../refactor-155H.md) Phase 1 (first
item) and Phase 10. Local change. Nothing is released, no hosted resource
changed, and no hosted latency is claimed here.

## What changed

Before, a NEAR-only passkey registration sent two requests after the passkey
prompt. Respond verified the proof and returned the Yao admission. The client
then sealed its inputs and sent them to the execute route.

- **Setup mints the Yao identity.** The ids of the material activation and
  the session id of the admission receipt were minted at respond. Setup now
  mints them for a plan with a NEAR branch and stores them in the ceremony
  record. A setup retry reads the stored record back.
- **Setup describes the admission.** For a NEAR-only passkey plan the setup
  reply holds the admission request and the receipt over the minted session
  (`ed25519.status = described`). The Gateway stores nothing for it and admits
  nothing. An Email OTP plan gets `after_proof`.
- **The client prepares during the prompt.** The custody run starts when
  setup returns. It makes the seed and the execute request while the user
  answers the prompt. Its Router round waits for the proof.
- **One request carries both.** Respond gets the proof and the execute
  request (`ed25519Execution`). It verifies the proof, stores the admission
  and runs the execution with the checks of the execute route. Its reply has
  `status = executed` and the activation result. Its `Server-Timing` header
  reports the execution with the metric names of the execute route.
- **The wallet-management protocol is 4.** The setup reply has a new field,
  and the client parsers accept exact keys.

## What did not change

| Rule | How it holds |
| --- | --- |
| No admission before the proof | Setup stores the minted identity only. The Yao record of the ceremony is written by respond, after the proof. The setup scenario counts zero Yao records after setup. |
| An execution needs its admission | The execution inside respond uses the function of the execute route: the request binding must equal the stored receipt, the credential digest must equal the admitted one, and the admission must not be expired. |
| The custody seed has one owner | The custody driver begins the run and discards it on every exit that is not a finished run. A dismissed prompt fails the Router round, and the run is discarded before any factor is asked for. |
| The factor seals the seed once | The driver asks for the factor after the Router round, in the finish step. The begin step carries no factor, as before for a NEAR run. |
| Exact retry | A repeated respond replays the stored admission, and the Router answers the repeated execution from its record. |
| Other flows | Email OTP, mixed registration and add-signer keep respond and the execute route. The SDK also uses the execute route when respond admitted and did not complete the execution. |

No Rust or WASM module changed. The custody worker already ran its steps
separately; only the TypeScript driver learned to take the factor late.

## Verification

| Check | Result |
| --- | --- |
| Type checks: server package, SDK, contract tests, wallet-state tests | Pass |
| Contract suite, 134 cases on release Workers, three shards | 132 pass |
| The two cases that need the debug Router build, run on it | Pass |
| `tests/e2e/registration-setup-startup.e2e.mjs` on real local D1 | Pass |
| `unit/walletCustodyDeferredFactor.unit.test.ts`, 4 cases | Pass |
| `unit/registrationSetupTransientD1.unit.test.ts` | Pass |
| `wallet-ui/registration-setup.browser.test.ts`, three browsers | Pass |
| Bloat check | Pass |
| Private server package of October 13 against this server build, type check | Pass |

The two cases outside the 132 inject a terminal Router failure, which only
the debug Router build accepts. One of them is a NEAR-only passkey
registration: the execution inside respond burns, the registration fails
with `router_execution_burned`, and the Router sees no retry. The other is a
mixed registration, which keeps the execute route.

What the cases pin for this change:

- The setup scenario requires a described admission over the minted
  session, zero Yao records after setup, and the same description after a
  setup retry.
- The driver cases require that a run with a late factor sends no factor in
  its begin step, asks for the factor after the Router round, and is
  discarded without a factor request when the round fails.
- The commit contract replays respond and requires `executed` with the same
  activation result.
- The uncertain-transport case drops the Router's reply once for an
  execution inside respond. The exact request is replayed, the registration
  completes, and the wallet signs.
- The protocol case requires HTTP 409 for protocol 3 and for a request
  without the header, before the body is parsed.

One manual check was removed. The protocol case had an optional branch that
loaded the setup call from a published package. No 0.9 package exports that
call from its module build, so the branch could not load a client of
protocol 3. A release proves the published client on a hosted lane instead:
a test site built from 0.9.4 must show the upgrade message against the new
backend.

## Not measured

No hosted latency is measured. The local benchmark reads the execution
timing from the `Server-Timing` header of respond. The gain on staging is
expected at 60 to 130 ms from Tokyo: one round trip, one Gateway entry and
the client's input preparation leave the path after the prompt.
