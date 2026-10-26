# ML-DSA signing waits and retained preparation

The October 27 campaign passes the hosted browser lifecycle, waiting UI checks, and exact package checks.
Failed signing operations can now preserve candidate pairs that both participants prove remain unopened.
The [retained evidence](../evidence/ml-dsa-65-waits-retained-stock-20261027.json) includes source hashes, public signatures, deployment versions, and cleanup records.

## Signing UI

The Gateway and SDK preserve four retry reasons: `empty_pool`, `service_capacity`, `wallet_cooldown`, and `running`.
The receipt shows preparation, capacity, or cooldown status. Cooldown uses the server's retry time. Preparation and capacity messages promise no completion time.
A running operation keeps its processing state.

The existing retry loop preserves the request, approval, operation ID, and deadline.
Users can cancel from a waiting receipt. Cancellation stops later retries and automatic submission.
A late signature still updates nonce state before the SDK suppresses its return.
A receipt from an old iframe generation cannot cancel a new request.

The existing server policy remains configurable. This campaign keeps the default sixty-second wallet cooldown.
Four-candidate preparation, two-at-once consumption, thirty-two candidates per wallet, and sixteen-candidate admission remain unchanged.
Wallet-seed recovery and canonical FIPS seed/key export remain unchanged.

## Preserve unused preparation after failure

Both participants first commit a fence that prevents further takes for the operation.
Each participant records its observation for the exact request and batch scope.
The coordinator retains only the intersection of their unopened sets. It excludes the union of their consumed sets.
Missing, changed, consumed, or uncertain records cannot return to the pool.
A delayed release cannot change a newer reservation.

Expiry cleanup sees only remaining reservations. It closes the operation and releases conservatively without creating a partial paired observation.
This avoids a conflict between expiry cleanup and the full operation scope.
The coordinator uses the existing settlement exchanges. This change adds no network round trip.

The local Worker campaign injects HTTP 503 after participant B commits material consumption.
Fifteen unopened pairs remain available, equal to thirty candidates.
A fresh signing operation consumes four retained pairs. Matching committed take records on A and B prove those specific uses.
Node/OpenSSL verifies the resulting standard signature and rejects a changed message.
The campaign also verifies three routine signatures separately.

This fault represents one lost reply after a committed take.
It does not reproduce every hosted `loadShed` failure or interruption inside the cryptographic protocol.
The retained count establishes reduced waste for this scenario. It establishes no new preparation CPU time or maximum throughput.

## Hosted results

All twelve temporary Workers use the approved synthetic credentials and separate participant storage keys.
The ordinary ECDSA module check, full ML-DSA lifecycle, and linked-owner parity campaign pass.

The lifecycle covers signer setup, enrollment, default selection, passkey and email authentication, recovery, linking, export, and participant restoration.
An independent implementation imports the exported canonical seed. The restored signer submits a transaction that reaches NEAR testnet finality.
Revoked access fails as expected.

| SDK signing path | Seconds |
| --- | ---: |
| Original owner | 4.612 |
| Warm owner | 2.780 |
| Fresh email approval | 4.870 |
| Email grant | 2.738 |
| Warm email session | 4.276 |
| Recovered owner | 4.984 |
| Linked owner | 6.365 |
| Restored participant material | 2.937 |

Seven of eight samples are below five seconds. All are below eight seconds.
These measurements exclude preparation, deliberate cooldown sleeps, human response time, and NEAR finality.
The fresh email probe also checks wrong-operation and replay rejection. It is not an ordinary latency sample.
This small lifecycle campaign establishes no percentile, consistent five-second guarantee, or sustained capacity.

## Validation and review

- Nine browser cancellation and waiting scenarios pass. They retain status evidence and screenshots.
- Nineteen receipt and confirmation browser scenarios pass.
- Native durable-pool scenarios pass for restart, repeated settlement, expiry ordering, delayed release, and exact single use.
- The real local Worker campaign verifies the retained-material signature and three routine signatures.
- SDK, server, intended-test, and wallet-state type checks pass.
- Production SDK and eight Worker builds pass. Browser and Worker module boundaries pass.
- The final package boundary check passes against the rebuilt artifacts.
- The bloat check still reports the inherited Rust duplicate count: 13,972 lines against a 13,754-line baseline. The baseline is unchanged.

The bounded source review finds no concrete blocker under passive, honest execution.
It covers cancellation, durable settlement, canonical recovery, disclosure, and correlation freshness.
It assumes independent randomness, noncolluding participants, authenticated admission, trusted schedules, and durable storage without rollback.
Gateway custody assertions remain trusted authorization.

Release claims must preserve these limits:

- Direct random signing nonces differ from FIPS Algorithm 7.
- Silent preparation adds Learning Parity with Noise (LPN) assumptions.
- Classical oblivious transfer provides no post-quantum transcript-confidentiality claim.
- This review establishes neither a complete composition proof nor full compiled/JIT side-channel qualification.

The exported seed and public signatures retain standard formats. This evidence does not claim FIPS validation or category-3 security for the complete threshold system.

## Reproduce and cleanup

Run the native durable-pool campaign from the public repository:

```sh
ML_DSA_E2E_REPORT=/tmp/ml-dsa-unopened-failure-e2e.json \
  cargo test --manifest-path crates/router-ab-cloudflare/Cargo.toml \
  --features ml-dsa --test ml_dsa_durable_pool_e2e
```

Run the real Worker campaign with disposable role fixtures:

```sh
node tests/e2e/ml-dsa-durable-worker.e2e.mjs \
  /path/to/disposable-worker-role-fixtures /tmp/ml-dsa-durable-worker.json
```

The hosted campaign initially encountered an unsupported future compatibility date and an exhausted historical testnet sponsor.
It retained the previously tested October 25 compatibility date and used the harness's existing fresh-faucet sponsor path.
These were infrastructure failures. The final hosted campaigns pass.

Cleanup removes twelve Workers, four D1 databases, and two R2 buckets.
Independent deployment queries confirm that all twelve Workers are absent.
The public evidence excludes credentials, seed exports, private keys, and raw request headers.
A scan against the generated private credential values finds zero matches.

The next performance test should measure sustained refill after failed operations, with the current pool capacity.
Registry publication and merging into `dev` remain outside this campaign.
