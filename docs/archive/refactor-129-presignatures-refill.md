# Refactor 129: session-authorized ECDSA preprocessing and refill

Status: released in Wallet 0.5.27; durable restoration was corrected in 0.5.28.

## Why

A small volatile pool forced foreground signatures to wait for preprocessing.
Exhausted transaction allowance also prevented otherwise authorized background refill.

## What changed

- Raised the durable pool target to five valid entries per exact pool identity.
- Reused encrypted unused material after unlock and refill only for the deficit.
- Allowed preprocessing under a live, unrevoked session with zero transaction uses.
- Kept actual signing quota checks, operation binding, and one-use consumption separate.
- Refilled after consumption without delaying registration, unlock, or completed signing.

The restoration follow-up corrected durable inventory discovery and lifecycle handling
across reload. Signing authority remained distinct from stored preprocessing material.

## Scope limits

The intended fast-return behavior depended on valid unused material in the same browser
profile. It did not guarantee a latency ceiling or renew expired signing authority.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/archive/refactor-129-presignatures-refill.md).
