# ML-DSA durable activation barrier — October 15, 2026

The Router now separates permission to install a share from permission to sign.
A key remains Installing until both participants report the exact durable installation.

## Lifecycle

1. The authenticated Gateway supplies the verified custody activation identity.
2. The Router records Installing and permits each participant to install its own share.
3. Each participant checks the authorized ceremony, wallet, key, epoch, public key, role, and wrapping-key version.
4. Each participant authenticates its encrypted material and commits it to its own durable store.
5. The Router reads a boolean installation result from each participant. Neither result contains a secret share.
6. The Router commits Active only after both checks succeed. It rechecks the exact activation identity inside the commit transaction.
7. The Router requests signing-pool refill after activation.

`POST /router-ab/ml-dsa/activate` returns a tagged Installing or Active record.
Callers repeat the same request after role installation or a lost response.
The exact retry preserves completed installations and does not reset the epoch.
The endpoint remains private and requires the dedicated Gateway credential.

Signing and key-bound refill require Active. An Installing key cannot obtain a signing claim.
Recovery advances the epoch, fences older active operations, and returns to Installing.
An old activation commit cannot reactivate the previous ceremony or epoch.

## Security boundary

The Gateway must still establish custody authority before it calls activation.
This change does not convert client-proposed commit data into verified authority.
The generic internal role credential cannot call the activation endpoint or the admission commit command.
The coordinator calls commit only after both authenticated participant reads succeed.

Material authentication and secret-buffer handling use the existing implementation.
This change adds public lifecycle state and installation checks. It adds no secret-dependent arithmetic.
Wallet-seed derivation, canonical FIPS export, and protocol disclosures remain unchanged.

Active means that the key is installed. Signing readiness also requires paired prepared capacity.
The five-second registration target still needs durable generic registration and signing preparation before the request arrives.
The complete public registration flow remains unfinished.

## Persistence and deployment

The experimental activation record now stores a tagged lifecycle state.
Old untagged experimental records fail deserialization and cannot authorize signing.
Recreate disposable test deployments or perform an explicitly reviewed persistence migration before upgrading retained experimental state.
Deploy Router and both participants from the same revision.
There is no compatibility path that treats an old authorization record as a completed installation.

## Validation

The native SQLite lifecycle E2E passed pending-state restart, admission refusal, changed-ceremony rejection, and stale commit rejection during recovery.
It also retained the existing cooldown, capacity, single-use, concurrent claim, and epoch-retirement checks.
The native protocol campaign passed canonical key generation, stored threshold signing, and wallet-seed recovery after the activation change.

The Worker E2E uses real Router and participant bundles with synthetic canonical role records.
Its new installation scenario covers no installed share, one installed share, exact duplicate delivery, wrong-role delivery, and final activation.
It then exercises real signing, automatic refill, result replay, Worker restart, and stalled-peer expiry.
Public authentication and real Worker key generation remain outside this campaign.


## Recorded results

The [Worker artifact](../evidence/ml-dsa-65-activation-worker-e2e-20261015.json) passed all activation assertions and the existing signing lifecycle checks.
The [native lifecycle artifact](../evidence/ml-dsa-65-activation-lifecycle-e2e-20261015.json) records restart and recovery fencing checks.

Three successful private signing dispatches took 472, 310, and 296 milliseconds.
Node's OpenSSL verifier accepted all three signatures and rejected modified messages.
One additional admitted operation failed after 759 milliseconds. The saved artifact does not retain the failure cause.
This campaign therefore does not qualify consistent successful signing availability.

Initial preparation of four signing batches took 39.13 seconds.
The installation fault-injection sequence took 159 milliseconds. It uses pre-generated material and is not a key-generation measurement.
The stalled peer closed after 939 milliseconds with a one-second deadline. The independent timer returned after 1,008 milliseconds.
Exact result replay survived Worker restart.
These measurements use local workerd. They exclude public authentication and hosted network/storage qualification.

Reproduce the campaign from the Wallet repository:

```sh
ML_DSA_E2E_REPORT=/private/tmp/ml-dsa-activation-lifecycle.json cargo test --locked --offline --manifest-path crates/router-ab-cloudflare/Cargo.toml --test ml_dsa_durable_pool_e2e
ML_DSA_WORKER_FIXTURE_DIRECTORY=/private/tmp/ml-dsa-activation-fixtures cargo run --release --locked --offline --manifest-path tools/ml-dsa-investigation/Cargo.toml -- prepared-keygen /private/tmp/ml-dsa-activation-native-evidence.json
pnpm -C crates/router-ab-cloudflare build:router
pnpm -C crates/router-ab-cloudflare build:deriver-a
pnpm -C crates/router-ab-cloudflare build:deriver-b
node tests/e2e/ml-dsa-durable-worker.e2e.mjs /private/tmp/ml-dsa-activation-fixtures /private/tmp/ml-dsa-activation-worker.json
```

Remove the disposable role records and wrapping keys after the campaign.
The next integration work is admitted Worker key generation and generic preparation, followed by authoritative Gateway custody persistence.
