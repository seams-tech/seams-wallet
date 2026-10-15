# R155J — Follow-ups of October 15, 2026

Plan: [R155J](../refactor-R155J-p99.md). Method:
[debugging method](../debugging-method.md). The acceptance record that
started these items: [refactor-155j-acceptance-0102.md](refactor-155j-acceptance-0102.md).

## Result

- **The execution-before-preparation race reproduces inside both Derivers.**
  With `bc2328c3` the execution binds to the setup preparation and the
  registration passes. Without its second look, the Deriver fails with the
  staging error, and the registration fails about 11 s later; `e311a6f6`
  alone does not save it.
- **The Gateway now reports the steps that the tail cases could not
  attribute** (`b948567b`): setup, respond before the Yao execution, and
  each stage of Ed25519 signing. No staging data exists yet.
- **The hosted menu shows the delay notice live.** The check found that the
  notice kept the passkey prompt line; `ce5729fb` removes it. A mixed
  registration (ECDSA and NEAR) sends no delay notice at all.

## The race inside the Derivers

### Method

A temporary hook in `durable_object/registration_preparation.rs`, which both
Derivers use, forced one order that agrees with the failed staging attempt.
It was never committed; the patch is kept in the ignored folder
`.artifacts/r155d/race-evidence/race-hook.patch`, and the control in `race-control.patch`.

- The setup preparation waits, at the start of `admit`, until an execution
  of the same object has checked its access (at most 20 s).
- An execution that finds no preparation and so admits fresh waits until the
  preparation is admitted (at most 20 s). Then it makes its own admission.

So the preparation's root-use admission ends before the execution's own
admission starts. The staging record shows only that the preparation
admitted first; it does not show whether the two admissions overlapped. In
an overlap, the second look finds the preparation not yet admitted and
waits in `access_for_execution`; this run did not exercise that wait.

The case was the contract case "NEAR registration and signing expose
gateway step timings": one Ed25519-only passkey registration and one
signature. The tree was `dev` at `774cc1d7` with the uncommitted changes
that became `b948567b`, `efd1a3cc` and `ce5729fb`; the Worker sources were
`774cc1d7` plus the hook. Release Worker builds
(`ROUTER_AB_WORKER_BUILD_PROFILE=release`), local stack, Worker logs in the
case log. For the control run, the guard of the second look in
`load_for_execution` became `if admitted_fresh && false`.

### Facts

| Run | Deriver logs, A and B | Gateway requests | Outcome |
| --- | --- | --- | --- |
| With the second look (`bc2328c3`) | Execution fresh; preparation held 174 and 183 ms; execution conflicted, looked again, bound to the preparation, loaded the share | setup 200, respond 200 with the execution inside it, near-provisioning 200, sign/prepare 200, sign 200 | Passed |
| Second look disabled | Execution fresh; preparation held 163 and 170 ms; both loads failed with `ConflictingPair: this tenant-root operation was admitted here under a different binding` | setup 200, respond 200 (`admitted`, in the browser trace), execute 409 `execution_in_progress` 12 times over 10 s, then execute 503 `execution_failed`, "Router Yao execution is retryable", 11 s after respond | Failed |

Inside Deriver A, the control run fails as the staging attempt did: a
fresh admission loses to the setup preparation, respond answers
`admitted`, and the Router holds its claim. Both Derivers raced here
because the hook is shared; on staging only Deriver A started late. Deriver
B's failure in the control run took another path (an uncaught exception,
then a Signing Worker 400, "Yao ceremony ended without packages").

The client sees a different end than on staging. With `e311a6f6` the SDK
waits out the claim instead of failing on the first 409. The run that then
takes over the lapsed claim reads Deriver A's pair state. Deriver A failed
before it wrote a pair record, and a missing or running record gives a
recoverable `ServiceUnavailable`, which the Gateway answers as 503
`execution_failed` (`router_coordinator.rs`, the takeover read). The SDK
retries only `execution_in_progress`, so it stops. The takeover runs the
execution again only when Deriver A holds a prepared record, so a longer
SDK wait would also fail. Only the Deriver change keeps the registration
alive.

### What this does not show

The hook decides the order; it does not show how often a late object start
produces this order on staging. The staging rate stays 1 failure in 204
attempts on 0.10.2.

### Review

An independent reviewer received this record, the two case logs, the
browser trace and the patch, and tried to contradict it. Each objection was
checked against the data before the record changed:

- The first version counted 13 answers of 409; the logs and the trace show
  12, then the 503.
- The first version said the Router answered with the failed run's
  recorded failure. The Router records none; the takeover read of Deriver
  A's missing pair record gives the answer.
- The first version said the hook forced the staging order and that the
  control run followed the staging attempt step by step. The hook forces
  one order that agrees with it, both Derivers raced, and Deriver B failed
  on another path.
- The first version named the tree as `774cc1d7` only and did not record
  the control change.

## Gateway step timing

`b948567b` adds these `Server-Timing` entries. The Gateway request evidence
of the hosted test now keeps the raw header, so a staging run records them.

| Route | New entries |
| --- | --- |
| `/wallets/register/setup` | `setup_context`, `setup_route_policy`, `setup_rate_limit`, `setup_dispatch`, `setup_reserve`, `setup_ceremony`, `setup_wallet_objects`, `setup_pair_describe` |
| `/wallets/register/respond` (Ed25519-only) | `respond_authority_verify`, `yao_admission_request`, `yao_admission_bind`, `respond_ceremony_commit` (only when respond writes the ceremony) |
| `/router-ab/ed25519/sign/prepare` and `/router-ab/ed25519/sign` | `ed25519_sign_authorize`, `ed25519_sign_admit`, `ed25519_sign_proxy`, `ed25519_sign_complete`, `ed25519_sign_total` |

One local run of the contract case, without the race hook, for scale only
(milliseconds):

| Route | Values |
| --- | --- |
| setup | context 0, route policy 1, rate limit 1, dispatch 0, reserve 3, ceremony 3, wallet objects 9, pair describe 0 |
| respond | load 2, passkey verification 3, admission request 0, admission binding 3, Router execution 180 |
| sign/prepare | authorize 4, admit 11, proxy 28, total 44 |
| sign | authorize 1, admit 1, proxy 19, complete 1, total 22 |

Worker clocks do not move during CPU work, so each entry is a wait, not a
CPU cost. A staging setup that is forwarded to another region's Gateway
returns that Gateway's entries only.

## Hosted menu delay notice

### Method

A temporary case opened the hosted menu of the intended test app, chose
"Create a wallet" and "Create wallet with passkey", and held the browser's
`respond` request for 6.5 s. The test app lists Tempo and Arc, so its menu
registers a mixed wallet; for this check only, its chain list was reduced to
NEAR.

### Facts

- The headline "Taking longer than usual... waiting on the network…"
  appeared 5,858 ms after the hold started. The menu closed when the
  registration completed, 7,766 ms after.
- Before `ce5729fb`, the busy view kept its passkey picture and the line
  "Complete the prompt on your device." under the headline, although the
  prompt had finished before respond was sent. After the change, the view
  shows the headline and a spinner.
- With the full chain list, the same menu registered a mixed wallet, and no
  notice appeared during the same hold. The SDK sends the delay event only
  from the Ed25519-only registration path.
- In this case, the harness's virtual authenticator refused the menu's
  passkey creation with "Resident credentials or empty 'allowCredentials'
  lists are not supported at this time." A second authenticator added on a
  new browser session accepted it. The SDK registration path, with the same
  creation options, passes on the harness's authenticator. The cause is not
  investigated.

## Account-menu contract case

The case "account menu removes an added passkey through the wallet email
prompt and preserves signing" failed after `38a01fec`, which moved linked
devices to an embedded screen. Classification: valid test needing an update.
`efd1a3cc` follows the new screens and passes. The same commit removes an
unused import of `38a01fec` that failed the intended type check.
