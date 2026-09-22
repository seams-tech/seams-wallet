# Passkey client-seal preparation

The NEAR continuation starts client-seal preparation after custody join supplies
its exact threshold-session identity. Preparation runs alongside finalization and
local publication. Hydration then consumes the prepared key/ciphertext and makes
the authorized server-seal request. Server sealing still follows finalization;
client unsealing still follows the server response. Local signer installation
continues to overlap hydration, and durable readiness waits for both.

## Ownership and failure behavior

- Preparation is volatile worker state. It creates no signing capability, quota,
  session authority, or persistent record.
- Each preparation belongs to an exact threshold session and a unique preparation
  ID. Consumption checks the SHA-256 digest of the normalized factor secret. The
  digest comparison visits all 64 hexadecimal positions without early exit.
- Consumption transfers ownership of the temporary key to sealing, whose `finally`
  block destroys it. Discard, lock, or the 30-second abandonment timeout destroys
  unconsumed keys, including keys that finish computation after discard.
- Cleanup uses the preparation ID so an older operation cannot remove a newer
  preparation for the same session. The worker bounds pending preparations at 32.
- Finalization and server sealing retain the current Wallet Session authorization
  checks. A lock prevents late readiness. Failures retain the joined repair journal
  for ordinary unlock; reload creates a fresh preparation from that saved attempt.
- Zero-quota completion skips warm hydration. Any speculative preparation is
  discarded. No quota or session expiry is renewed by preparation.

Preparation begins after custody join in this implementation. Moving it further
back into admission/Yao would require carrying its ownership across those stages;
that is outside this change. The same worker preparation helper serves ordinary
inline sealing so there is one client-seal implementation.

## Verification and measurement method

Fifteen browser continuation contracts and five focused ownership tests passed.
These include a held finalization response, failure and unlock repair, same-tab
and cross-tab locking, reload/exact replay, exhausted quota, leading-zero factors,
and NEAR signing after refresh. Ownership tests cover consumption, factor mismatch,
discard during computation, stale cleanup, lock, seal failure, and abandonment.
The SDK build and intended/state type checks passed.

An initial browser run was discarded after local Worker discovery failed. The
successful run used the stack-specific Worker registry provided by the local
launcher. No production behavior was changed to accommodate that failure.

The standalone timing analyzer could not compile repository TypeScript aliases.
On transpiled JavaScript it reported slashes in three import paths and one comment
as division operators, with zero bytecode instructions analyzed. Those flags are
source-text false positives. Manual review found no division, lookup indexed by
secret bytes, or early-exit digest comparison in the new preparation code. This
is not a proof of JavaScript/JIT or underlying WASM constant-time behavior; the
cryptographic primitives are unchanged.

A benchmark attempt was discarded when shared app edits triggered repeated Vite
hot reloads during confirmation. The measurement run uses a copied app and built
SDK with file watching and HMR disabled; the snapshot also includes the inherited
TypeScript configuration. The copied app and SDK remain fixed during measurement.

The controlled benchmark selects 20 alternating-order pairs using:

```text
playwright test -c playwright.wallet-intended.benchmark.ci.config.ts \
  e2e/intended-behaviours/passkey.registration.benchmark.test.ts \
  --grep '(prepared|serial_preparation) pair'
```

Both cohorts use the same SDK and backend. The serial control gates the
finalization request until preparation completes, ordering preparation before
finalization. It isolates overlap; it is not an old-release comparison. The gate
adds browser interception overhead. Each fresh wallet verifies NEAR signatures
before and after refresh. Public chain RPC responses are stubbed and passkeys use
a virtual authenticator. Local timing excludes real human interaction, deployed
network conditions, and NEAR transaction inclusion. p95 uses nearest rank; each
cohort has only 20 observations.

`session_seal_preparation_wait` measures the remaining preparation delay at the
join before hydration. Crypto setup/client-seal diagnostic buckets report their
original computation durations even when that work completed earlier in
preparation; do not add them to hydration wall time. `session_install` measures
local installation after preparation has joined.

Release, deployment, Console adoption, and deployed-network profiling remain
behind the existing release hold.
