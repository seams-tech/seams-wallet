---
title: Host and CLI
description: Supported @seams/host entry points, packaged runtime commands, and recovery CLI ownership.
---

# Host and CLI

`@seams/host@0.77.0` is the package of the services that an operator deploys: reusable Wallet
services, storage adapters, Cloudflare Workers, migrations, signer WASM bindings, the wallet
origin document, and the VoiceID host plugin. It replaces `@seams/wallet-server`.
The current recovery CLI launcher is `@seams/cli@0.29.0`.
See [release status](/releases) before selecting deployment artifacts.

```sh
pnpm add @seams/host@0.77.0
npm install --global @seams/cli@0.29.0
```

## Server entry points

| Import path | Scope |
| --- | --- |
| `@seams/host/server-types` | Shared server services and contracts |
| `@seams/host/router/cloudflare` | Cloudflare Router adapter |
| `@seams/host/router/ror` | Router-of-Routers adapter |
| `@seams/host/storage/tenant-route` | Tenant route storage |
| `@seams/host/wasm/signer` | Signer WASM bindings |
| `@seams/host/cloud-host` | Hosted registration and authority services |
| `@seams/host/hosted-wallet-gateway` | Gateway composition |
| `@seams/host/hosted-wallet-gateway-worker` | Hosted Gateway Worker |
| `@seams/host/local-hosted-wallet-gateway-worker` | Local Gateway Worker |
| `@seams/host/tenant-root` | Tenant-root lifecycle and recovery contracts |
| `@seams/host/local-runtime` | Local runtime configuration script |
| `@seams/host/local-runtime/*` | Packaged local runtime scripts |
| `@seams/host/artifact-manifest.json` | Packaged runtime identity |
| `@seams/host/migrations/d1-signer/*` | Signer migration files |
| `@seams/host/wallet-origin-html` | The HTML document of the wallet origin (`getWalletServiceHtml`) |
| `@seams/host/voiceid` | The VoiceID host plugin, its models and `composeVoiceIdWalletAssets` |
| `@seams/host/package.json` | Package metadata |

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
- `seams-voiceid-host <new-directory>`: compose the Wallet assets of `@seams/mpc-wallet` and
  the VoiceID host plugin into a new static directory.

In the public source checkout, use `pnpm router` and `pnpm site` in separate
terminals. In the private Console checkout, use that repository's commands
and exact npm dependencies. Do not copy public Wallet implementation sources
into the Console repository.

## Hosted registration

A custom registration authority must schedule
`resumeRegistrationDirectoryPublicationsV1` from
`@seams/host/cloud-host`. It retries completions committed locally
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
