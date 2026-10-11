# SeamsWeb

`SeamsWeb` is the application client. It owns configuration, public state,
transaction review, and the wallet iframe connection.

```text
application origin
  SeamsWeb -> public API -> WalletIframeCoordinator -> WalletIframeRouter
                                                           |
                                                      MessagePort
                                                           |
wallet origin
  host handlers -> WalletHostRuntime -> operations -> BrowserSigningSurface
                                                          |
                                               stores, workers, and WASM
```

The application does not construct the signing surface or wallet stores.
`WalletHostRuntime` constructs those components inside the wallet iframe.
Public RPC and broadcast helpers can run in the application.

See the [client and worker inventory](../../../../docs/refactor-170-inventory.md)
for current dispatch ownership and reproducible consumer bundle measurements.

## Boundary

This directory may import browser platform adapters, wallet iframe modules, DOM
UI helpers, and web asset helpers. `core/**` must not import this directory.
Move shared result types, config types, and browser bridge constants into core
when core logic needs them.

The embedded SDK implementation lives outside this TypeScript package as a Rust
crate. Keep native signing-surface scaffolds out of `packages/wallet/src`.

## Layout

- `index.ts` is the public barrel.
- `SeamsWeb.ts` owns `new SeamsWeb(...)`, config normalization, and lifecycle
  wiring. `publicApi/createPublicApi.ts` assembles the user-facing API objects.
  `index.ts` remains a barrel.
- `publicApi/` owns the concrete user-facing task API objects exposed as
  `seams.auth`, `seams.registration`, `seams.near`, `seams.evm`, `seams.tempo`,
  `seams.recovery`, `seams.devices`, `seams.keys`, and `seams.preferences`.
  The client also exposes `seams.config`, `seams.connection`, `seams.events`,
  and `seams.authMenu`.
  The name describes the product boundary; `namespaces` only describes the
  TypeScript shape.
- `operations/` owns wallet-host operation implementations grouped by user
  task. Application adapters dispatch wallet execution through the iframe.
- `signingSurface/` owns the browser signing surface implementation and its
  internal signing-surface slice types.
- `assembly/` owns browser runtime construction, store construction, worker
  warmup, preconnect, and browser-only dependency wiring.
- `walletIframe/` owns the browser wallet iframe implementation.
- `core/browser/walletIframe/` owns shared browser-platform primitives used by
  core and web, such as DOM event names, CSP stylesheet helpers, host-mode
  state, and host variant config. It must not grow into wallet iframe routing,
  host runtime, overlay, or facade code.

## Assembly

Browser assembly lives under `SeamsWeb/assembly/`:

- browser `RuntimePorts` construction;
- browser store adapter construction;
- worker warmup policy;
- wallet iframe router and overlay state construction;
- wallet asset preconnect and SDK-base handling.

Keep runtime construction in assembly modules and operation behavior under
`operations/`. The application router and host runtime have separate construction
paths. Do not import host execution into the application client.

## Loading and persistence ownership

- `walletIframe/client/inboundMessages.ts` validates host responses before the
  router changes request or session state.
- `core/indexedDB/seamsWalletDB/repositories.ts` owns database transactions.
  `accountSignerRows.ts`, `nonceLeaseRows.ts`, and `signerOutboxRows.ts` convert
  stored rows at that boundary. They do not own transactions.
- `core/signingEngine/flows/recovery/public.ts` loads key-export operations when
  requested. The export module dispatches to the requested curve. Its JavaScript
  stays in one shared operation module because separate curve chunks increased
  startup requests and erased the measured byte saving.
- Registration and recovery ceremonies need the shared custody module.
  EVM-only unlock still uses `near_signer` to open the custody envelope.
  A signer label alone does not define its complete dependency set.

Use the production asset scenarios in
`tests/e2e/intended-behaviours/passkey.registration.assets.contract.test.ts` to
measure startup, signing, and export. Keep transfer bytes, request counts, and
package inventory separate. More chunks can increase requests and compression
overhead even when code moves out of startup.
