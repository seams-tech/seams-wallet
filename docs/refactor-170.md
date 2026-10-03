# Separate the application SDK client from wallet execution

Status: implementation plan, 2026-10-03.

## Objective

Make the default browser SDK a small, typed client to the wallet iframe. Keep
wallet execution, durable signing state, and worker orchestration in the wallet
origin. Preserve supported wallet behavior and make the standard integration
easier to understand.

The browser still downloads the wallet runtime when it needs the wallet. Success
means removing overlapping application dependencies and improving measured
startup and interaction costs across the application and iframe together.

## Evidence and baseline limits

Local measurements of `@seams/wallet` 0.8.0 during this investigation:

| Payload | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `SeamsWeb` + `defineSeamsConfig`, static application JS closure | 3.08 MiB | 723 KiB | 589 KiB |
| Same integration, including reachable lazy JS | 3.25 MiB | 776 KiB | 635 KiB |
| Hosted iframe static boot JS | 42.3 KiB | 14.8 KiB | 12.9 KiB |
| Hosted wallet reachable JS union | 3.66 MiB | 884 KiB | 740 KiB |
| Reported worker/WASM inventory, including aliases | 7.41 MiB | 2.09 MiB | 1.67 MiB |

The application measurement used Bun, minification, ESM splitting, production
NODE_ENV, and per-file gzip level 9 / Brotli quality 11. It retained the exported
client class and config builder. Existing build outputs passed asset graph
verification; freshness checking flagged newer wallet-server files. These are
investigation measurements, not a fresh production-app network baseline. Rows
overlap and must not be added together. Worker inventory includes aliases and
does not represent one operation's downloads.

Confirmed source-level causes:

- `packages/wallet/src/SeamsWeb/SeamsWeb.ts` constructs signing stores,
  `BrowserSigningSurface`, runtime factories, and `WalletIframeCoordinator`.
  It statically imports registration, recovery, auth-method, and device flows.
- `SeamsWeb/walletIframe/host/context.ts` imports that same public class and
  constructs it in `wallet_host` mode. `host/runtimeContext.ts` also imports it.
- `SeamsWeb/assembly/createBrowserSigningRuntime.ts` connects the browser
  platform, IndexedDB, signing dependencies, and core runtime.
- Host `runtimeLoader.ts` already has lazy feature dispatch. Its shared runtime
  composition can still pull broad execution dependencies into a feature load.

These findings establish code and setup overlap. They do not establish that
workers execute twice or that secret material exists in both origins. Capture
browser evidence before claiming an exact duplicate-download saving.

## Ownership after the refactor

```text
Application
  SeamsWeb client + optional React integration
    config, public state, typed commands, events, iframe lifecycle
                       |
           existing validated message protocol
                       |
Wallet origin
  host composition + feature handlers
    authentication, session authority, custody, signing, recovery, export
                       |
                 workers and WASM
```

| Concern | Owner |
| --- | --- |
| Application config, iframe mount/dispose, request correlation, public state subscriptions | Application client |
| Application transaction review and display preferences | Application UI, with existing host admission checks |
| Authoritative session state, authorization, signing persistence, worker lifecycle | Wallet host |
| Custody ceremonies, signer setup, signing, recovery, key-export execution | Wallet host and its workers |
| Wire contracts and pure public value types | Dependency-light shared boundary modules |
| Explicit server/runtime integrations | Existing runtime entry and its supported platform composition |

The application can retain display state and public session projections. It must
not construct a second signing engine or inspect signing persistence to answer
wallet state queries. Preserve existing transaction-review, confirmation,
external-auth broker, and result delivery contracts, including explicit export
behavior; do not expand the data crossing the iframe boundary.

## Scope and constraints

- Reuse the existing coordinator, router, request envelopes, host handlers,
  lifecycle events, and runtime entry where they fit.
- Keep `SeamsWeb` as the default application client where existing methods can
  retain their supported semantics. Update consumers for necessary signature
  changes in the same change set.
- Give the host a distinct internal composition. Delete the shared client/host
  mode branches and obsolete fallback paths once their callers move.
- Keep one implementation of each execution flow. Both hosted and self-hosted
  wallet origins use that implementation.
- Preserve the explicit runtime entry for supported non-iframe integrations;
  inventory its callers before changing ownership. No silent fallback to direct
  signing when iframe startup fails.
- No new package family, plugin framework, feature flags, or compatibility API.
  Keep any unavoidable persisted-data conversion at its existing storage boundary.
- No cryptographic, custody derivation, protocol, or authorization-policy redesign.
- This document authorizes no publication or deployment. Release operations remain
  separate from implementation and local verification.

## Implementation sequence

### 1. Establish reproducible consumer and browser baselines

- Build current production assets from a recorded revision and dependency lock.
  Record build mode, tooling versions, and any working-tree differences.
- Extend the existing size reports under `packages/wallet/scripts/` to measure
  realistic root-client and React-provider consumers, including static and lazy
  import closures. The size of `dist/esm/index.js` alone is insufficient.
- Use the existing intended app or example app for a production-browser baseline
  with distinct application and wallet origins. Record cold and warm runs with
  fixed compression/cache settings and identical scenarios.
- Attribute requests to application, iframe, and workers. Record URLs, initiators,
  transferred and decoded bytes, caching, and operation timing. Capture boot,
  first authentication, first signing, and subsequent signing separately.
- Inventory `SeamsWeb` methods and callers: client-only, host execution,
  existing protocol coverage, and explicit runtime usage. Include examples,
  React hooks, public docs, tests, and private Console consumers.

Deliverable: a reproducible baseline report with bundle graphs and browser
artifacts. Reuse existing reports and harnesses; add only missing instrumentation.

### 2. Separate host composition from the public client

- Extract the host's execution composition from `SeamsWeb.ts` into focused
  internal host modules, reusing the signing surface and runtime factories.
- Change `host/context.ts`, `host/runtimeContext.ts`, handler dependencies, and
  lifecycle subscription wiring to consume the host composition directly.
- Convert the public `SeamsWeb` into the iframe client. Replace eager construction
  of signing stores, `BrowserSigningSurface`, and runtime factories with the
  existing transport and public state subscriptions.
- Remove the coordinator's dependence on the signing surface and host-owned
  preference managers. Give it the narrow client configuration and state it uses.
- Route supported operations through existing messages. Add a typed message only
  for a demonstrated protocol gap, with its parser and handler in the same patch.
- Preserve initialization, cancellation, timeout, disposal, reconnect, origin
  checks, request binding, and event ordering. An unavailable iframe produces the
  supported explicit failure outcome.
- Audit persisted state ownership before moving storage access. Keep existing
  wallet-origin schemas and keys where possible. Document any supported
  application-origin records requiring a one-time boundary migration.

Deliverable: the application dependency graph has no wallet execution
implementation, signing stores, worker managers, or host composition, including
through dynamic imports. Remove the obsolete mixed-mode implementation.

### 3. Make the boundary precise and keep the public API approachable

- Keep shared message contracts and public value helpers free of execution
  imports. Use type-only imports for domain types; move pure boundary helpers
  only when their current module introduces runtime dependencies.
- Parse raw configuration, messages, and responses once at their boundaries.
  Use existing discriminated lifecycle and Result-style types, exhaustive
  handling, and branch-specific construction.
- Require valid identity/session fields for each operation. Preserve exact
  wallet/session binding through account changes and asynchronous responses.
- Keep `defineSeamsConfig`, the provider, `useWallet`, and existing bound signer
  calls as the standard integration path. Avoid another public facade or a
  parallel set of hooks.
- Update hooks that currently read execution internals to use public client
  state and events. Keep advanced runtime concepts in their existing explicit
  entry points when supported consumers need them.
- Preserve React as an optional integration. Verify narrow provider and hosted
  auth-menu imports; ensure unrelated QR/profile/theme features can be omitted
  or loaded with the UI that needs them.
- Add compile-time fixtures for changed domain boundaries: invalid lifecycle
  combinations, broad spreads, direct construction, and known cast escapes.
  Do not claim TypeScript prevents arbitrary deliberate assertions; eliminate
  unsafe production casts and cover enforceable constraints.

Deliverable: examples and public declarations demonstrate one clear setup and
operation path without exposing host construction to application callers.

### 4. Tighten host feature loading and packaging

- Use `host/runtimeLoader.ts` as the existing feature dispatch point. Trace the
  auth closure and remove shared imports that unnecessarily retain signing,
  export, recovery, or device-link execution.
- Load chain-specific execution and worker/WASM assets when the selected
  operation requires them. Preserve intentional prewarming and measure its
  latency/transfer tradeoff explicitly.
- Verify Rolldown output and package export paths for root, React, runtime, and
  hosted static assets. A dynamically imported module must have no other eager
  path into the same consumer graph.
- Review repeated WASM/static assets separately. Delete a copy only after
  updating all loaders, emitted URLs, and hosting contracts that depend on it.
  Package-size reduction is a secondary result, measured separately from traffic.

Deliverable: smaller observed wallet operation payloads with valid static asset
paths and unchanged supported runtime behavior.

### 5. Update consumers, documentation, and release inputs

- Update Wallet examples, intended app, and public docs alongside the implementation.
  Change `docs/intended-behaviours.md` and its contracts for any intentional
  externally observable behavior change.
- Verify the packed package in the existing external-consumer checks, including
  declarations, optional React usage, runtime entry, and hosted asset delivery.
- Update private Console composition in `seams-monorepo` using exact released
  Wallet versions when the release is available. Use packed artifacts for local
  pre-release verification; do not commit workspace/source shortcuts across repos.
- Remove replaced tests, fixtures, mocks, and documentation that solely describe
  retired mixed-mode behavior. Classify failures against current contracts
  before repairing them.

## Verification and acceptance

Use the existing E2E and intended-behavior infrastructure. Add no unit tests.
Extend an existing scenario where it covers the boundary; add an E2E scenario
only for a genuine gap. Keep compile-time checks for domain-state guarantees.

The representative production-browser scenario should register/authenticate a
wallet, sign on NEAR and an EVM-family chain where configured, reload and restore,
lock and unlock, exercise recovery, and sign again. Reuse existing isolated
contracts for destructive recovery and device-linking steps. Cover cancellation,
iframe disconnect/reconnect, and an account/session change during a pending
request using the existing applicable browser tests. An explicit runtime
consumer must continue to pass its existing runtime checks.

Each measured E2E run produces a Playwright trace, sanitized request/timing
evidence, and a machine-readable byte summary with reproduction commands and
revision/build identifiers. Exclude OTPs, tokens, seeds, shares, and export
secrets from persisted artifacts. Save before/after evidence under the existing
test-artifact/evidence conventions.

Acceptance criteria:

1. Root and narrow React consumer graphs contain no host execution, signing
   persistence, custody implementation, or worker orchestration modules.
2. The application uses authoritative wallet state through the existing protocol;
   session identity, authorization, review, and cancellation semantics survive
   the split. No direct-signing fallback remains in the client.
3. Cold total JavaScript transfer across application and iframe decreases for
   the same completed scenario. Report WASM, CSS, and warm-cache behavior
   separately, together with first-auth/sign latency and repeat-run variation.
4. Target less than 100 KiB gzip for the minimal hosted client static closure,
   excluding optional React/UI and wallet-origin assets. This is a design target
   to validate, not an established saving. Explain remaining contributors if the
   target is missed; do not hide them behind an immediately fetched lazy chunk.
5. Fresh production size reports, relevant intended contracts, browser E2E,
   type fixtures, packed-package boundaries, and runtime checks pass. Record
   concrete environment blockers without weakening supported invariants.
6. Obsolete composition, mode switches, and dead helpers are deleted. The client
   and host each have a single understandable construction path.

Relevant existing commands, run from `seams-wallet`:

```sh
pnpm -C packages/wallet build:prod
pnpm -C packages/wallet check:bundle-size --json
pnpm -C packages/wallet type-check
pnpm -C tests type-check:wallet-state
pnpm test:intended
pnpm test:wallet-browser
pnpm check:packed-wallet
pnpm -C packages/wallet check:runtime-entry-bundles
pnpm -C packages/wallet smoke:evm-crypto:runtimes
pnpm report:bloat --check
```

Start with focused scenarios during implementation, then run the relevant wider
contracts for the shared API/session boundary before completion. Keep work on
`dev` in the main checkout, preserve concurrent edits, and commit only the files
owned by this refactor. Publication, deployment, and private dependency updates
must be reported distinctly from implementation completion.
