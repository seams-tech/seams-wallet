# Seams Wallet Server

This package owns the reusable signer server surface: route adapters,
WebAuthn verification policy, threshold signing services, signer storage
adapters, and server wasm bindings.

The current published package is `@seams/wallet-server@0.15.4`, checked
October 20, 2026. Pair it with `@seams/wallet@0.15.4` and matching hosted assets.
The CLI remains `@seams/wallet-cli@0.15.0`.

```sh
pnpm add @seams/wallet-server@0.15.4
```

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
- Deploy Router, Deriver A, Deriver B, and Signing Worker together when upgrading
  to the batched object-address allocation contract introduced in 0.15.0.
- Renew an expired initial tenant authorization only before its creation journal
  starts. Retain the original authorization for an already-started ceremony.
- Verify APAC object hosts and database primaries. The `apac-se` hint requests
  Southeast Asia placement and does not prove physical co-location.

See the [server reference](https://wallet.seams.sh/docs/reference/server),
[hosted integration](https://wallet.seams.sh/docs/deploy-and-operate/hosted-integration),
and [release notes](https://wallet.seams.sh/docs/releases).

Hosted product services and their operational tooling live in the private
`seams-monorepo` repository.
