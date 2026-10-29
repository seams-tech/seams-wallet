---
title: Server SDK and CLI
description: Supported Wallet Server entry points, packaged runtime commands, and recovery CLI ownership.
---

# Server SDK and CLI

`@seams/wallet-server@0.28.0` supplies reusable Wallet services, storage
adapters, Cloudflare Workers, migrations, and signer WASM bindings.
The current recovery CLI launcher is `@seams/wallet-cli@0.28.0`.
See [release status](/releases) before selecting deployment artifacts.

```sh
pnpm add @seams/wallet-server@0.28.0
npm install --global @seams/wallet-cli@0.28.0
```

## Server entry points

| Import path | Scope |
| --- | --- |
| `@seams/wallet-server` | Shared server services and contracts |
| `@seams/wallet-server/router/cloudflare` | Cloudflare Router adapter |
| `@seams/wallet-server/router/ror` | Router-of-Routers adapter |
| `@seams/wallet-server/storage/tenant-route` | Tenant route storage |
| `@seams/wallet-server/wasm/signer` | Signer WASM bindings |
| `@seams/wallet-server/cloud-host` | Hosted registration and authority services |
| `@seams/wallet-server/hosted-wallet-gateway` | Gateway composition |
| `@seams/wallet-server/hosted-wallet-gateway-worker` | Hosted Gateway Worker |
| `@seams/wallet-server/local-hosted-wallet-gateway-worker` | Local Gateway Worker |
| `@seams/wallet-server/tenant-root` | Tenant-root lifecycle and recovery contracts |
| `@seams/wallet-server/local-runtime` | Local runtime configuration script |
| `@seams/wallet-server/local-runtime/*` | Packaged local runtime scripts |
| `@seams/wallet-server/artifact-manifest.json` | Packaged runtime identity |
| `@seams/wallet-server/migrations/d1-signer/*` | Signer migration files |
| `@seams/wallet-server/package.json` | Package metadata |

These entry points expose different boundaries. Import through the documented
package paths. Internal source files do not form a supported API.
The Wallet backend uses Workers, Durable Objects, D1, and Rust/WASM.
The former Node Gateway, Express adapter, and native VM role hosts are removed.

## Local commands

Installed server packages provide:

- `seams-wallet-server-local`: start the complete local Wallet system.
- `seams-wallet-server-local-roles`: start the isolated protocol roles.
- `seams-wallet-server-local-init --root <directory>`: initialize local identity.
- `seams-wallet-server-d1-migrate`: apply packaged local signer migrations.

In the public source checkout, use `pnpm router` and `pnpm site` in separate
terminals. In the private Console checkout, use that repository's commands
and exact npm dependencies. Do not copy public Wallet implementation sources
into the Console repository.

## Hosted registration

A custom registration authority must schedule
`resumeRegistrationDirectoryPublicationsV1` from
`@seams/wallet-server/cloud-host`. It retries completions committed locally
but not yet acknowledged by the directory. The bundled local Gateway schedules it.
See [hosted integration](/deploy-and-operate/hosted-integration#registration-completion)
for migration and timing requirements.

Deploy the matching backend roles when the private role protocol changes.
Application-to-iframe protocol compatibility alone does not establish
compatibility between custody Workers.

## Recovery CLI

The npm launcher verifies its signed native manifest and binary before execution.
It supports macOS Apple Silicon, macOS Intel, and Linux x86-64. Node.js 22 or
later is required by the launcher.

Use the [recovery CLI guide](/deploy-and-operate/recovery-cli) for dashboard
approval, holder keys, backup verification, interrupted restore, and activation.
The CLI never grants an unconfigured destination or replaces owner approval
for a wallet-region move. Tenant-root recovery and wallet portability have
different scopes. See [recovery availability](/deploy-and-operate/recovery-and-portability#availability).
