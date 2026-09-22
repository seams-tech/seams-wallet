# Registration deployment build audit

Read-only audit on 2026-09-23. No packages were published and no deployments or
Cloudflare settings were changed.

## Backend signing worker

The latest successful production-testnet backend workflow inspected was
[35735576885](https://github.com/seams-tech/seams-monorepo/actions/runs/35735576885),
at commit `f91abd800ce7989196d1b70f5d7d14943b461feb`. Its exact Wallet Server
dependency was `0.5.33`.

The [package release workflow](https://github.com/seams-tech/seams-wallet/actions/runs/35728966509)
at `79170a72e457bc01f734368cdab3776997192193` records the signing-worker build
starting at 13:04:07 UTC on September 22 and finishing with `release [optimized]`
at 13:06:55 UTC. All five backend role builds use the release profile.

The installed published package's signing-worker WASM is 6,728,484 bytes, with
SHA-256 `32cc582a3306fb7d9bfe4dd70241bac09c4ff731168eee94cc21a827dd72f0ad`,
matching its artifact manifest. The successful signing-worker deployment job
reports a total upload of 6620.57 KiB, consistent with that release package, and
version `16fe65d1-7ac2-4200-8c01-b1f4274d14f9`.

The last successful mainnet backend workflow inspected was
[35443614586](https://github.com/seams-tech/seams-monorepo/actions/runs/35443614586),
September 19, using Wallet Server `0.5.24`. Its signing-worker upload was
6549.56 KiB, version `759eff7a-755d-4a21-bbfe-3f955760d684`. This size is
consistent with release artifacts; the historical mainnet binary was not hashed.
The most recent staging workflow inspected failed, so it does not establish a
current staging artifact.

Hosted deployment installs frozen dependencies, stages the package's role
artifacts, and uses a per-run build cache. Packaging removes source build hooks
from the Wrangler configurations. This path does not consume the developer's
local role build directory. The local 373-to-7-ms signing-worker improvement
must not be counted as an additional production gain.

These conclusions concern recorded CI deployments. A direct live Cloudflare
version/binary readback was not performed; later manual deployment drift remains
unverified.

## SDK release profile issue

The same successful 0.5.33 release log explicitly records development-profile
builds for `shamir3pass_runtime`, `evm_crypto`, `tempo_signer`, and
`email_otp_runtime`. The Shamir runtime reports `dev [unoptimized + debuginfo]`
at 13:03:18 UTC. This is independent of the backend artifact overwrite problem.

The release workflow calls `pnpm build` without setting `WASM_SDK_BUILD_MODE`.
`packages/wallet/scripts/build/build-wasm.sh` defaults that setting to `dev`:
it forces release mode for the main signing/custody modules, but passes
`--dev --no-opt` to the four runtimes above. `prod` already selects `--release`
for all modules. Shamir3Pass is used by client session seal/unseal, so this is a
plausible contributor to the remaining hydration latency. No speedup is claimed
without measuring it.

Next implementation: set the existing production mode explicitly in the package
release workflow; build Shamir3Pass release artifacts in isolation; compare seal,
unseal, and full registration on fixed inputs; rerun preparation ownership and
registration lifecycle contracts. Publish and deployed regional/cold-start
profiling remain subject to the existing release hold.
