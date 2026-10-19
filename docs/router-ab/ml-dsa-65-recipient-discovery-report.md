# ML-DSA recipient discovery — October 19, 2026

Authenticated private recipient discovery now connects the Gateway transport to the actual
participant keys. Public Wallet registration admission and custody publication remain open.
The branch was rebased onto local `dev` at `6eb2ee3d` before this change.

## Implemented boundary

The Gateway adapter calls the private Router with its Gateway credential. The Router calls
each participant with the separate internal service credential. Each participant derives its
X25519 public key from the same configured private key that decrypts registration inputs.
Responses contain only the role, key version, and public key, with `Cache-Control: no-store`.

The Router rejects swapped participant roles, zero public keys, and identical A/B public keys.
The Gateway adapter validates the response once and returns an exclusive `ready` or
`unavailable` result. Type fixtures reject partial ready results and mixed failure/key fields.
Discovery grants no wallet, registration, or signing authority.

The existing pinned `curve25519-dalek` dependency moved from test dependencies to production
dependencies. Cargo regenerated the dependent workspace lockfiles. No package version changed.

The native registration test client now requires discovered public keys as input. Its fixture
keys serve only as an independent comparison. Encryption uses the values returned through
the actual Gateway adapter and Worker discovery route.

## Local Worker evidence

The [registration artifact](../evidence/ml-dsa-65-recipient-discovery-20261019.json) records
a passing functional run against release Router, A, and B builds in local workerd.

| Check | Result |
| --- | --- |
| Internal credential used at the Gateway route | Refused, HTTP 403 |
| Gateway credential used directly at either participant | Refused, HTTP 403 |
| Swapped A/B service bindings | Refused, HTTP 500; Gateway returns unavailable |
| Both participants configured with one private key | Refused, HTTP 409; Gateway returns unavailable |
| Normal discovery | Returned keys match independent fixture public keys; response is not cached |
| Registration and restart | Canonical key and manifest verified; exact replay survives restart |
| Recovery | Configured recipient keys discovered again; same canonical key restored |
| Signing | Creation signature verifies; recovery preserves the existing sixty-second cooldown |

The run retains four-candidate preparation, two-candidate consumption, sixteen ready candidates
for admission, and thirty-two candidates per wallet. Preparation, wallet-seed derivation,
canonical FIPS export, and signing algorithms remain unchanged.

Local prepared creation and recovery take 1.771 and 1.224 seconds. Initial preparation takes
21.933 and 21.706 seconds. The creation signature takes 0.395 seconds. The recovery signing
request is correctly deferred by cooldown, so the artifact does not qualify both latency targets.
These observations are local functional evidence. They establish no hosted latency improvement.

The [first run](../evidence/ml-dsa-65-recipient-discovery-proxy-failure-20261019.json) stopped
before registration because the new test proxy passed a Node Request directly to Miniflare.
The direct request returned the expected 403, while the proxy reported a transport error.
This was an `environment_or_infrastructure_failure`. The proxy now uses the existing harness
pattern: explicit URL, method, headers, and body. Production authentication was unchanged by that repair.
After checking evidence source and Worker hashes, this campaign removed its disposable private fixture directory.

Strict release builds, Gateway TypeScript checking, wallet-state type fixtures, Rust formatting,
JavaScript syntax, whitespace checks, and all thirty-eight Cargo lockfile checks pass.
The inherited bloat failure remains Rust 13,984 duplicated lines against 13,754. No baseline changed.

Repeat with the release Worker builds and native harness, then run:

```sh
node tests/e2e/ml-dsa-registration-worker.e2e.mjs \
  /private/tmp/ml-dsa-discovery-fixtures \
  /private/tmp/ml-dsa-recipient-discovery.json
```

Use a fresh private fixture directory and remove it after the run. It contains disposable
participant private keys. Evidence records public keys, signatures, source hashes, and Worker hashes.

## Next integration boundary

Persist the discovered recipient pair in the admitted ceremony, then connect authoritative
operation, key, and epoch allocation with custody publication. Exact retries must retain
the same encrypted inputs and pinned recipients. Public signing and device authorization
must load this active identity from trusted storage. The public Wallet routes remain gated.
