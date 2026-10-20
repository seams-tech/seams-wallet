# Independent NEAR provisioning during mixed registration

Status: implementation and local acceptance completed before Wallet 0.6.0.

## Why

Mixed registration held an otherwise usable ECDSA wallet behind NEAR provisioning.
The two capabilities needed distinct readiness states without creating another wallet.

## What changed

- Let mixed registration return its usable ECDSA capability while NEAR provisioning continues.
- Kept one stable wallet identity and explicit pending/retryable NEAR state.
- Persisted decisions and replayable outcomes so retries did not duplicate committed work.
- Required NEAR-only registration to commit custody and become usable before reporting success.

The change preserved authentication, session, custody, and replay checks. ECDSA-ready
success did not claim that the NEAR signer was ready. Callers must observe the matching capability state.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/archive/plan-independent-near-registration.md).
