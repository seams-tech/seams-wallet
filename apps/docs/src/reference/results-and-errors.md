---
title: Results and recoverable errors
description: Handle Seams registration, login, signing, recovery, and device outcomes as exhaustive discriminated unions.
---

# Results and recoverable errors

Public operations return several types of results. Check `success` or `ok` first when
present. Then check the branch-specific `kind`, `status`, or error code. Some signing
methods reject their promise for cancellation or failure, so catch errors as well as
checking returned results.

## Registration

`RegistrationResult` separates failure from successful wallet creation. A successful
result then identifies its capability branch or pending provisioning state. `walletId`
is the stable wallet identity. Chain-specific account data belongs to the relevant
capability or provisioning branch.

Read fields from the matching result branch. A successful registration does not
guarantee that every requested signer is ready. When NEAR provisioning is pending,
observe the provisioning state and continue only from its ready branch.

## Login and sessions

`LoginResult` uses `success: false` with an error string, or `success: true` with
`near_wallet_unlocked` or `ecdsa_wallet_unlocked`. Only the NEAR branch carries
`nearAccountId`. `LoginAndCreateSessionResult` can also include a `signingSession`.
Check its `status` before treating the reusable allowance as active. Keep the exact
wallet identity when signing.

## Signing and actions

NEAR `signAndSendTransaction` and `sendTransaction` return `ActionResult` for
recoverable outcomes. Successful results require `transactionId` and `result`.
For `success: false`, handle `kind`:

| Kind | Meaning | Application action |
| --- | --- | --- |
| `not_submitted` | This attempt did not submit a transaction. | Clear the attempt's pending state. Offer a fresh review. |
| `unresolved` | Submission started. The result retains `transactionId`. | Check that hash. Do not create another send while its outcome remains unresolved. |
| `submission_unknown` | A dispatched wallet command lost its terminal response. | Reconcile wallet activity before another send. |

Await the result and use its branch for application state. Progress events are
for display. Missing events and generic cancellation errors cannot establish
whether submission occurred. Completion-hook errors cannot change a settled
transaction result. `try`/`catch` still handles unexpected programming faults.

NEP-413 message signing and EVM-family methods retain their own result and error
contracts. A message signature does not submit a transaction.

## External NEAR connector

The [development-preview connector](/guides/external-near-wallets#outcomes-and-retry-rules)
returns `ExternalNearResult<T>` from connection and submission calls. Check `ok`
before reading `value`. Keep a successful submission for `checkOutcome`.
`unresolved` permits a status recheck. `submission_unknown` requires wallet or
chain-history review before another send. Neither result permits automatic resend.
External connection results do not establish a Seams Wallet Session.

## Key export

`seams.keys.exportKey()` returns `{ kind: 'exported' }` after the wallet-origin
viewer opens. It never returns a private key to the application. Missing exact
lane, missing material, and full-login requirements reject the promise. Catch
that rejection in custom UI.

Device-link activation exposes typed refusal and integrity-error branches.
Handle each branch in the result type.

## Error handling rule

1. Handle every branch of the result union.
2. Log the stable code and operation identity, excluding secrets.
3. Retry only branches documented as retryable.
4. Request fresh user presence when the session or policy branch requires it.
5. Reconcile chain status before replaying an operation whose broadcast state
   is uncertain.

Use [events and progress](/reference/events-and-progress) for user-facing
progress and [troubleshooting](/deploy-and-operate/troubleshooting) for common
recovery paths.
