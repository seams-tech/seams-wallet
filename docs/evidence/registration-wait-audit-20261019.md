# Registration wait audit — October 19, 2026

## Result

ECDSA and mixed activation waited for obsolete ceremony deletion after their
terminal receipt committed. The hosted response now schedules that deletion
through the existing `waitUntil` hook. Hosts without that hook retain the awaited
cleanup behavior. NEAR already follows this pattern.

The change does not skip a custody write, session write, proof check, or terminal
commit. Exact replay uses the durable receipt before and after ceremony deletion.
The public API is unchanged. Hosted latency savings remain unmeasured.

## Reviewed waits

| Path | Finding |
| --- | --- |
| Setup reservation, object addresses, and ceremony record | Both persistent results are needed before setup can return its exact wallet and route. |
| Optional hosted pair preparation | Already scheduled after the response through `waitUntil`. |
| Router A/B execution | The previous fix removes the delayed B reply after A's completed result. |
| Signing Worker package delivery | The receipt is required; the existing channel overlaps delivery with execution. |
| Deriver A target preparation and B connection | Both establish the protocol inputs and connection ownership. |
| Replay reconciliation of A/B status | Both role records supply separate completion evidence. |
| NEAR consume and authority reservation | Both protect the exact activation and founding authority before completion. |
| Custody reservation and session issuance | Both feed the transaction that commits custody and its terminal receipt. |
| ECDSA/mixed respond | Both branches supply admitted data used by the response; dropping either needs a protocol change. |
| NEAR ceremony cleanup and Console publication | Already scheduled after the response on the hosted path. |
| ECDSA/mixed ceremony cleanup | Removed from the hosted response wait in this change. |
| Browser warm-up and NEAR RPC prefetch | Already observational/background work. |
| Browser recovery backup, publication, session hydration, and signer activation | Required before the SDK reports a usable wallet. Successful seal consumption already skips discard cleanup. |

No additional safe wait removal was identified in the reviewed NEAR-only path.
This audit does not claim that every operation is optimal or that a larger
protocol redesign cannot reduce latency.

## Verification

The private regional E2E holds the real ceremony DELETE after activation starts.
It checks registration, credential-free replay, and a verified Tempo signature
before releasing deletion. The mixed case also checks NEAR readiness while
cleanup remains held. It checks that the ceremony exists before release and is
absent afterward, then verifies replay and lock.

The unchanged implementation reached the expected assertion after its ten-second
watchdog released deletion. That first negative run also had a teardown timeout.
A second control attempt was interrupted after a package rebuild invalidated its
local development server. Neither attempt is a latency benchmark.

Both final ECDSA-only and mixed journeys pass. Each observes one ceremony record
while cleanup is held and zero after cleanup. The mixed wallet also reaches NEAR
readiness before release. The [JSON evidence](registration-wait-audit-20261019.json)
retains both results and proof hashes. An intermediate parameterized test failed
fixture discovery; explicit fixture functions corrected that test-only error.
Server build, server type check, bloat check, and diff check pass.

Reproduce from the private `seams-monorepo` checkout:

```sh
SEAMS_WALLET_SERVER_CANDIDATE=/Users/pta/Dev/rust/seams-wallet/packages/wallet-server \
SEAMS_INTENDED_SKIP_BUILD=1 ROUTER_AB_WORKER_BUILD_PROFILE=release \
SEAMS_LOCAL_PORT_OFFSET=920 \
node tests/scripts/run-regional-real.mjs passkey.registration.contract.test.ts \
  --grep 'ceremony cleanup waits' \
  --output .artifacts/registration-wait-audit/verified-final
```

Build the public server package before the browser run. Keep that build unchanged
until the development server stops. Existing release custody Workers are required.
Proof artifacts are under private `.artifacts/registration-wait-audit/cleanup/`.
The test is in `tests/e2e/regional-real/registration-completion.scenario.ts`.
No unit test was added. No package, service, or frontend was published or deployed.
