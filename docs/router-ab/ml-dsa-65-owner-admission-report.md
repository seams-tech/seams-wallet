# ML-DSA exact owner admission — October 15, 2026

The Gateway now has an internal admission gate for an exact ML-DSA transaction approval.
The public route remains disabled. Custody registry integration and public authentication remain required.

## Implemented boundary

The shared authorization types distinguish ML-DSA-65 from Ed25519 and ECDSA.
A parsed ML-DSA key record requires a 1,952-byte public key, a positive safe-integer material epoch, and a manifest digest.
The key record also carries the wallet identity, signing key ID, key version, and lifecycle.
Existing signing-lane admission and generic D1 admission explicitly refuse ML-DSA until their dedicated integration exists.

The gate consumes a trusted signing target, a claimed operation, verified factor evidence, and an operation-specific owner proof.
Its caller must obtain these values from authoritative stores and the existing factor verifier.
Parsing target metadata alone grants no authority.

The gate checks:

- An active key and a claimed transaction operation with the ML-DSA capability.
- The tenant, principal, wallet, capability, owner authority, request origin, and audience.
- The factor and owner-proof validity windows, including the claim time.
- The exact operation fingerprint and the approved display digest.
- The organization, project, environment, wallet ownership generation, key version, public key, material epoch, manifest, and circuit schedule.
- The 32-byte NEAR transaction hash and the fixed empty ML-DSA context.

The prepared operation holds an immutable serialized request.
The private transport accepts only this prepared type and checks its expiry before dispatch.
It constructs fresh headers with the dedicated Gateway credential.
Reusable sessions and export approvals cannot enter this signing path.
Recognition of the export capability does not enable export execution.

The Router operation ID derives from the tenant, capability, and logical operation ID.
A replacement internal claim for the same logical operation produces the same request.
Changing the logical operation ID requires a new owner approval.
Durable Router admission remains responsible for cooldown, capacity, reservation, replay, and settlement.

## Validation and limits

The Worker E2E uses the actual Router and A/B Wasm bundles in local workerd.
It composes the TypeScript admission gate and private transport with durable reservation, signing, refill, and result replay.
It injects synthetic verified factor inputs, claimed-operation persistence, and custody activation.
It does not establish parity with public login, session issuance, registration, or hosted performance.

The E2E rejects changes to wallet scope, ownership generation, key metadata, origin, transaction, and operation ID.
It also rejects expired evidence, an inactive key, an Ed25519 approval, and an export approval.
Type fixtures reject forged prepared operations and mixed key-family records.

A test adapter converts Node Request objects into Miniflare's URL and request-init interface.
The initial run failed at this interface before signing. Production transport did not need a change.

## Remaining integration

1. Load the target from the authoritative custody registry. Revalidate current owner authority and persist the exact operation claim before dispatch.
2. Add the ML-DSA authority activation and session projection. Mount the public route only after those checks exist.
3. Complete admitted Worker registration, role installation, and generic preparation for new wallets.
4. Exercise recovery, epoch replacement, interruption, and concurrent refill through Worker HTTP.
5. Measure hosted registration and successful signing against the five-second target. Record empty-pool refusals and refill time separately.
6. Connect SDK/NEAR signing and verify a threshold-signed transaction through the public path.

Wallet-seed recovery, canonical FIPS export, and the default 60-second wallet cooldown remain required.
This change does not alter preparation performance or add GPU services.


## Recorded local results

The [saved evidence](../evidence/ml-dsa-65-owner-admission-e2e-20261015.json) contains public keys, signatures, request hashes, and Worker binary hashes.
Three successful private dispatches took 514, 453, and 299 milliseconds. No operation failed in this run.
These times start after the typed approval gate prepares the request. They exclude login, owner verification, and preparation.
OpenSSL 3.6.3 independently verified all three signatures and rejected all three changed messages.

The initial four-batch refill took 39.17 seconds. Replacement preparation started 993 milliseconds after the first signing request.
Exact result replay survived Worker restart. The stalled peer closed after 941 milliseconds with a one-second operation deadline.
The separate one-second timer returned after 1,007 milliseconds.

The server TypeScript check, Wallet TypeScript check, and admission type fixtures passed.
Run the existing native fixture generator, then run:

```sh
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /private/tmp/ml-dsa-worker-fixtures /private/tmp/ml-dsa-owner-worker.json
```

The Worker E2E uses a one-second wallet cooldown to shorten the campaign. Deployment defaults remain 60 seconds.
The initial phase uses a 30-second operation deadline. The stalled-peer phase changes it to one second after restart.
Three local signatures do not establish a latency percentile or a hosted service guarantee.
