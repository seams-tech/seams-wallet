# Seams Wallet Server

This package owns the reusable signer server surface: route adapters,
WebAuthn verification policy, threshold signing services, signer storage
adapters, and server wasm bindings.

The current release is `@seams/wallet-server@0.33.0`. Pair it with
`@seams/wallet@0.33.0` and matching hosted assets. Use `@seams/wallet-cli@0.29.0`.
The wallet iframe protocol is **21.0.0**.

```sh
pnpm add @seams/wallet-server@0.33.0
```

## Google BYO authentication

Version 0.33.0 verifies a configured application's signed session assertion or the app's Google ID token or exchanges it for a browser-bound handoff.
An environment-specific Google client configuration and an owner-approved wallet association are required.
Apply the packaged signer migrations before enabling the feature.
External sessions grant settings reads and remain separate from owner and signing credentials.
See the [Google SSO guide](https://wallet.seams.sh/docs/guides/google-sso) for configuration, backend exchange, and revocation.

## Supported runtime and entry points

The packaged Wallet backend runs on Cloudflare Workers with Durable Objects,
D1, role-private backup storage, and Rust/WASM protocol workers. The package
does not provide a Node Gateway or an Express adapter.

| Entry point | Purpose |
| --- | --- |
| `@seams/wallet-server` | Shared server services, contracts, and storage adapters |
| `@seams/wallet-server/router/cloudflare` | Cloudflare Router adapter |
| `@seams/wallet-server/router/ror` | Router-of-Routers adapter |
| `@seams/wallet-server/storage/tenant-route` | Tenant route storage |
| `@seams/wallet-server/wasm/signer` | Signer WASM bindings |
| `@seams/wallet-server/cloud-host` | Hosted registration and authority services |
| `@seams/wallet-server/hosted-wallet-gateway` | Hosted Gateway composition |
| `@seams/wallet-server/hosted-wallet-gateway-worker` | Gateway Worker entry point |
| `@seams/wallet-server/local-hosted-wallet-gateway-worker` | Local Gateway Worker entry point |
| `@seams/wallet-server/tenant-root` | Tenant-root lifecycle and recovery contracts |
| `@seams/wallet-server/local-runtime` | Packaged local runtime configuration |

The package also includes `artifact-manifest.json`, signer D1 migrations, local
runtime scripts, and prebuilt custody Workers. Use the repository root's
`pnpm router` for source development. Installed consumers use
`seams-wallet-server-local` or the role and initialization commands described in
the [repository README](../../README.md#packaged-local-runtime).

## Deployment requirements

- Apply Gateway migration `0081_registration_directory_publications.sql` before
  serving registration. A custom Gateway must schedule
  `resumeRegistrationDirectoryPublicationsV1` from the `cloud-host` entry point.
- Deploy Router, Deriver A, Deriver B, and Signing Worker together. Their private
  object-address allocation contract uses batches.
- Renew an expired initial tenant authorization only before its creation journal
  starts. Retain the original authorization for an already-started ceremony.
- Verify APAC object hosts and database primaries. The `apac-se` hint requests
  Southeast Asia placement and does not prove physical co-location.

See the [server reference](https://wallet.seams.sh/docs/reference/server),
[hosted integration](https://wallet.seams.sh/docs/deploy-and-operate/hosted-integration),
and [release notes](https://wallet.seams.sh/docs/releases).

Hosted product services and their operational tooling live in the private
`seams-monorepo` repository.


Use `createApplicationAuthAssertion` from `@seams/wallet-server/application-auth` on the authenticated application backend.
Configure the issuer and public key through the existing environment trust setting.
The assertion binds the stable subject, environment, wallet, Seams attempt, purpose, and expiry.
Fresh wallet-origin owner proof remains required for identity changes and NEAR transactions.
See the [application-session guide](https://wallet.seams.sh/docs/guides/application-auth).
