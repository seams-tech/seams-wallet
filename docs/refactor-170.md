# Separate the application SDK client from wallet execution

Status: reviewed implementation plan, 2026-10-03. Pre-implementation gates below
must be closed before replacing the shared composition.

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
- `core/config/configBuilder.ts` already requires a wallet origin for public
  browser construction; direct mode is admitted through the internal
  `allowDirectWalletMode: 'wallet_host'` option. This refactor removes shared
  implementation dependencies without introducing a new public iframe mandate.
- `assembly/configureBrowserIndexedDB.ts` already selects `disabled` persistence
  for the application in iframe mode. Constructing signing-store adapters in the
  application does not establish a second durable signing database there.

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
| Public RPC reads and existing application-side transaction broadcast/finality handling | Application client, loaded with the operation that uses it |
| Required parent WebAuthn bridge and external-provider callbacks | Application browser adapter, preserving existing origin and activation contracts |
| Wallet session projection, signing persistence, worker lifecycle | Wallet host; authorization, quota, expiry, and revocation remain server-authoritative |
| Custody ceremonies, signer setup, signing, recovery, key-export execution | Wallet host and its workers |
| Wire contracts and pure public value types | Dependency-light shared boundary modules |
| Explicit server/runtime integrations | Existing runtime entry and its supported platform composition |

The application can retain display state and public session projections. It must
not construct a second signing engine or inspect signing persistence to answer
wallet state queries. Preserve existing transaction-review, confirmation,
external-auth broker, and result delivery contracts, including explicit export
behavior; do not expand the data crossing the iframe boundary.

The host must never import or instantiate the public application client after the
split. The client must never construct the host execution composition. Pure value
helpers, supported browser adapters, transaction broadcast logic, and type-only
contracts may be shared or application-owned. File location under `core/` alone
does not determine execution ownership.

## Review findings and decisions required upfront

The original plan described the direction but left several behavioral contracts
implicit. The following decisions and evidence close those gaps. P1 items block
the client/host cutover; P2 items block declaring the refactor complete. These are
plan findings, not claims of newly demonstrated production vulnerabilities.

| Priority | Gap and source evidence | Required resolution |
| --- | --- | --- |
| P1 | Parent WebAuthn execution is real: `client/transport/webauthn-bridge.ts` calls `navigator.credentials.create/get` and serializes PRF outputs. A blanket rule that all auth code belongs in the iframe would delete a browser adapter or make an unsupported secret-isolation claim. | Preserve the existing supported bridge while extracting its minimal serialization/constants from execution modules. Establish which current browser/RP configurations use it and test those. Hosted auth-menu ceremonies must retain the wallet-origin CTA required by `docs/intended-behaviours.md`. Any bridge retirement or change to PRF exposure is a separate explicit behavior/security decision. |
| P1 | `SeamsWeb.getContext()` exposes the signing engine and `nearClient`; `useAccountInput` uses its RPC client. Host surface binding and restored-session prefill are also methods on the public class. | Split by actual caller: give host callers internal host methods, update application RPC callers to the existing narrow public/client API, and remove the execution-bearing context from the application surface. Preserve supported custom `NearClient` behavior for application reads; a function-bearing object cannot be sent through postMessage. Record declaration changes and every affected consumer before deletion. |
| P1 | Preference getters/setters are synchronous, setters optimistically update a local mirror, and writes are queued to the host in `publicApi/preferences.ts`. `setCurrentWallet` is display selection rather than authentication. | Keep a small client preference projection with the existing synchronous contract for this refactor. Specify defaults before connection, ordered writes, wallet-bound updates, host snapshot/event reconciliation, and disposal. Preserve existing error semantics unless deliberately changing the spec and callers. Never use this projection to authorize or implicitly select a signing subject. |
| P1 | `publicApi/tempo.ts` runs `operations/tempo/executeEvmFamilyTransaction.ts` in the caller, including broadcast, receipt checks, and nonce-lifecycle reports. Transaction review spans the parent and host. | Preserve existing broadcast ownership and return/error semantics. Keep its execution-independent client helper lazy with the operation, while signing and nonce authority remain at their existing enforcement points. Audit NEAR send/delegate paths separately. Preserve review reservation, payload binding, expiration, cancellation, and host admission; moving broadcast into the iframe would require its own protocol and behavior change. |
| P1 | Host config is currently made from broad client config, with empty origin strings and a mode option suppressing nested iframes. Global host-mode and IndexedDB configuration participate in ownership. | Define separate internal client-config and host-config branches at the existing config boundary, with required identities and no invalid combined branch. Preserve all supported settings and their precedence. Construct host dependencies directly; remove empty-string and mode-switch construction tricks once their callers move. Verify the explicit runtime entry independently. |
| P1 | Removing the shared constructor moves startup work as well as imports: pending registration/recovery replay, linked-device acknowledgements, restored-session prefill, preferences, and lifecycle subscriptions. | Assign each startup effect to exactly one host lifecycle trigger. Specify readiness and failure/retry behavior, including concurrent initialization, React remount, iframe reconnect, and disposal. Subscribe/reconcile without losing a state change between snapshot and subscription. A stale result must never restore a previous wallet/session into the current client. |
| P1 | Package and wallet assets deploy independently. `messages.ts` uses protocol `2.0.0`; handshake code rejects mismatches, and the asset manifest declares that contract. | Prefer preserving the wire protocol. If messages or semantics change incompatibly, update the existing version and manifest together, test typed mismatch failures, and document a matching client/host release and rollback pair. Do not ship a new request behind an unchanged handshake version to an old host. No compatibility fallback is added. |
| P2 | The storage-migration step could imply moving secrets between origins even though iframe-mode application persistence is already disabled. | Inventory actual supported stored records first. Preserve wallet origin, RP identity, database names, and schemas by default. No secret-copy migration through the parent. If supported historical state genuinely needs relocation, specify the boundary migration and recovery implications separately before deleting access paths. |
| P2 | Several iframe tests use `tests/wallet-iframe/harness.ts`, which generates a stub host. Passing these cannot demonstrate removal of the real duplicate runtime. | Keep those tests for transport behavior; use packed production client assets and the real emitted wallet host for the bundle/network acceptance scenario. Verify application execution contexts create no signing workers. Include the existing real auth/recovery/device/export contracts. |
| P2 | A 100 KiB static entry target can hide a large router fetched immediately. A long scenario can also obscure a worse first signing experience. | Report root import, mounted provider, idle/prewarm, auth, first sign, and repeat sign separately, with cumulative app+iframe+worker totals. Report the complete client closure as well as static bytes. Set measured per-phase latency and transfer acceptance limits after the baseline, before implementation; a missed target remains an explicit deviation. |

Before implementation step 2, complete a member-level dispatch audit against
`publicApi/types.ts`, the public `SeamsWeb` methods, and package exports. For each
member record its client owner, existing message or local helper, host handler,
result/error/event semantics, current consumer, and applicable contract. The
family inventory below is the starting coverage list; it is not evidence that
every member is already safe to move. Mark unused methods for deletion only after
checking documented public support as well as repository callers.

## Refactor and consumer inventory

Paths below are relative to `packages/wallet/src/` unless a repository-root path
is named. These are required audit/update areas, not a request to rewrite every
listed module. Keep the inventory here; do not add a second manifest or generator.

| Area | Current files or directories | Required disposition |
| --- | --- | --- |
| Public facade and construction | `SeamsWeb/SeamsWeb.ts`, `SeamsWeb/index.ts`, `SeamsWeb/README.md` | Retain client API, extract host construction, delete mixed-mode paths and execution context exposure; update architecture docs. |
| Capability factories and public contracts | `SeamsWeb/publicApi/{createPublicApi,auth,near,evm,tempo,recovery,devices,keyExport,preferences,currentWallet,awaitNearReady,capabilitySelection,types}.ts` | Replace execution dependencies with exact client dispatch; preserve supported API semantics and narrow pure helpers. |
| Host execution composition | `SeamsWeb/signingSurface/{BrowserSigningSurface,types}.ts`, `SeamsWeb/assembly/{createBrowserSigningRuntime,createBrowserSigningStores,initializeBrowserSigningRuntime,runtimeConfig}.ts`, `core/runtime/`, `core/platform/` | Keep execution implementation host/runtime-owned. Adapt dependency contracts and startup effects without copying the engine. |
| Host construction and handler graph | `SeamsWeb/walletIframe/host/{context,runtimeContext,config-guards,index,bootstrap,requestRouter,wallet-iframe-handlers}.ts`, `host/handlers/` | Replace every dependency on application `SeamsWeb`; retain origin admission, cancellation, and response/error routing. |
| Lazy host entry points | `host/runtimeLoader.ts`, `host/runtime-*.ts`, `host/entry-{near,ecdsa,full}.ts`, `host/registrationPreparationPreload.ts`, `host/recovery-{entrypoint,port}.ts` | Audit shared imports, preparation triggers, all emitted entry variants, and independent recovery startup. |
| Config and mode ownership | `core/config/{defineConfig,defaultConfigs,configBuilder,configHelpers}.ts`, `core/types/seams.ts`, `core/browser/walletIframe/host-mode.ts`, `assembly/configureBrowserIndexedDB.ts` | Normalize once per boundary; separate client/host internal state and retire construction switches. Preserve supported public config. |
| Transport and iframe lifecycle | `walletIframe/coordinator.ts`, `assembly/createWalletIframeRouter.ts`, `walletIframe/client/router.ts`, `client/transport/` | Remove signing surface dependency; preserve connection, handshake, request queue, timeout, reconnect, disposal, and errors. |
| Shared wire/value boundary | `walletIframe/shared/{messages,exactSessionState,exactSessionReconciliation,transactionReview,unlockOptions}.ts`, `walletIframe/sanitization.ts`, `boundary/walletRefs.ts`, relevant shared-ts value helpers | Audit actual runtime closure and parsers. Keep serialization and identities lightweight; update both protocol ends together. |
| WebAuthn bridge | `client/transport/webauthn-bridge.ts`, `core/signingEngine/webauthnAuth/{credentials/helpers,fallbacks/safari-fallbacks}.ts` | Retain supported browser behavior; isolate bridge dependencies and verify credential origin/RP and cancellation behavior. |
| Hosted handoff and external auth | `client/router.ts`, `host/hostedWalletSeamsSession.ts`, `host/auth-menu/`, `host/handlers/authMenu.ts`, React `HostedSeamsAuthMenu/` | Preserve origin-bound single-use handoff, wallet-host primary credential, hosted credential redemption, callback correlation, and host-owned OTP/continuation. |
| Restore and startup work | `SeamsWeb.ts` startup methods, `operations/registration/pendingRegistrationRecovery.ts`, `operations/recovery/walletRecoveryCommit.ts`, `host/restoredSessionPresignaturePrefill.ts`, `operations/devices/` | Move orchestration to one host owner; preserve restart replay, exact-session prefill, acknowledgements, and idempotency. |
| Durable stores and preferences | `core/indexedDB/`, `core/signingEngine/session/userPreferences.ts`, `publicApi/preferences.ts`, `host/handlers/preferences.ts` | Keep durable signing state at wallet origin; retain only supported display projection at application origin; inventory storage before migrations. |
| Transaction review and surfaces | `publicApi/transactionReview.ts`, `walletIframe/client/transactionReviewReservation.ts`, `walletIframe/client/{surface,overlay}/`, `walletIframe/shared/transactionReview.ts`, `react/transactionReview/`, `core/signingEngine/uiConfirm/transactionReviewAdmission.ts` | Preserve review reservation/admission, operation binding, parent UI, host confirmation, and surface completion on cancel/error. |
| Broadcast, receipts, and public RPC | `operations/tempo/{executeEvmFamilyTransaction,feeTokenPreference}.ts`, `publicApi/{near,tempo,evm}.ts`, `core/rpcClients/{near,evm}/` | Keep supported caller-side network operations separate from custody/signing; preserve nonce reporting, verification, and custom RPC behavior. |
| Recovery and key-export UI | `publicApi/{recovery,keyExport}.ts`, `host/handlers/{recovery,export}.ts`, `core/signingEngine/uiConfirm/ui/export-viewer-host.ts` | Retain operation-specific authorization, exact export lane, recovery acknowledgement, and existing secret display/result boundary. |
| React provider state and lifecycle | `react/context/{index,SeamsWebProvider,seamsManagerSingleton,useWalletIframeLifecycle,useLoginStateRefresher,useNearProvisioningStateRefresh,useSDKFlowRuntime,useSeamsWithSdkFlow,useSeamsContextValue,useEagerPrewarm,walletSessionReadiness,reactLoginStateBuilders}.*` | Remove direct-mode dependencies; specify snapshot/events, configuration replacement, mount/unmount, SSR import behavior, and remount handling. |
| React hooks and optional UI | `react/hooks/{useWallet,useWalletAuth,useWalletDevices,useDeviceLinking,useAccountInput,useNearClient,usePreconnectWalletAssets}.*`, `react/components/`, `react/index.ts`, `react/types.ts` | Use client contracts; audit account input and NearClient access; retain narrow provider/auth-menu exports and optional UI behavior. |
| External EVM integration | `externalEvm/`, `react/externalEvm.tsx`, package `external-evm` and `react/external-evm` exports | Preserve external-wallet discovery/signing; prevent it from acquiring the embedded signing runtime. |
| Assets and preload policy | `assembly/preconnectWalletAssets.ts`, `walletIframe/client/html.ts`, `static/wallet-assets/`, worker/WASM loaders | Preserve URLs, origins, CSP/iframe permissions and required headers; separate preconnect from fetching code or initializing workers. |
| Package/build boundaries | Repository `packages/wallet/{package.json,rolldown.config.ts,build-paths.ts,build-paths.sh,tsconfig.build.json}`, `src/{index,runtime,advanced,threshold}.ts`, `scripts/build/` | Verify all package exports, declarations, side effects, runtime compatibility, prod/dev parity, static host variants, and asset manifest/version contract. |
| Measurement and package checks | Repository `packages/wallet/scripts/{reports/report-lite-bundle-sizes,checks/report-wallet-iframe-bundle-size,checks/browser-module-graph,checks/assert-runtime-entry-bundles,checks/assert-static-wallet-assets,checks/check-declarations-resolve-externally}.mjs`, `tests/scripts/check-packed-wallet-boundaries.mjs` | Measure real consumer closures and production artifact behavior; extend established checks without a parallel reporting workflow. |
| Public examples and docs | Repository `examples/{seams-auth-menu,wallet-console-lite}/`, `tests/intended-app/`, `apps/docs/src/reference/`, `apps/docs/src/concepts/custody/wallet-iframe.md`, package README, `docs/intended-behaviours.md` | Update setup, signatures, ownership, self-host instructions, lifecycle semantics, and snippets that expose execution internals. |
| Wallet verification | Repository `tests/e2e/intended-behaviours/`, `tests/wallet-iframe/`, `tests/wallet-ui/`, `tests/typecheck/`, runtime smoke scripts | Reuse supported contracts; add real production-browser evidence and targeted type fixtures for changed domain state. |
| Private product consumers | In `seams-monorepo`: `apps/{wallet-console,seams-site}/src/flows/demo/`, frontend config/providers, `apps/wallet-console/wallet-host/`, API-key setup snippets, `tests/intended-app/`, relevant top-level tests and package locks | Verify application and host deploy inputs together, update exact package releases when available, and retain local packed-candidate evidence before publication. |

### Operation coverage checklist

Each row requires member-level confirmation before its capability factory is
replaced. Message families name existing coverage to reuse; multi-step methods
also require their callback, cancellation, and terminal-result contract.

| Surface | Existing path to audit | Edge that must survive |
| --- | --- | --- |
| `auth`: unlock, lock/logout, session queries, recent unlocks, passkey lookup | `PM_UNLOCK`, `PM_LOCK`, `PM_LOGOUT`, `PM_GET_WALLET_SESSION`, exact-session get/lock, `PM_GET_RECENT_UNLOCKS`, `PM_HAS_PASSKEY` | Locked, expired, authenticated-but-unresolved, and unlocked-without-signing-session remain distinct; display wallet selection is never authority. |
| `auth`: Email OTP challenge, enrollment/login/refresh, Google flow | `PM_REQUEST_EMAIL_OTP_*`, `PM_LOGIN_EMAIL_OTP_ECDSA_CAPABILITY`, `PM_REFRESH_EMAIL_OTP_SIGNING_SESSION`, `PM_UNLOCK_ADDED_EMAIL_OTP_WALLET`, `PM_GOOGLE_EMAIL_OTP_*` and begin | Preserve multi-step flow handles, resend/cancel, external broker callbacks, one terminal outcome, and no passkey fallback. |
| `registration`: register/add signer, auth methods, provisioning and resume | `PM_REGISTER_WALLET`, `PM_ADD_WALLET_SIGNER`, `PM_ADD_PASSKEY`, `PM_ADD_EMAIL_OTP`, `PM_REVOKE_AUTH_METHOD`, enrollment, `PM_RESUME_PENDING_ECDSA_REGISTRATION`, `PM_GET_NEAR_PROVISIONING_STATE` | Preserve intent/auth-method selection, resumable checkpoints, pending NEAR, and provisioning events/awaitNearReady. |
| `near`: sign, send, execute, delegate, NEP-413, registration, test funding | Existing NEAR messages and client relayer/RPC helpers | Preserve which side sends already signed data, callback order, result type, abort behavior, and exact wallet/account. |
| `evm` and `tempo`: sign, execute, bootstrap, fee-token APIs | `PM_SIGN_TEMPO`, `PM_BOOTSTRAP_THRESHOLD_ECDSA_SESSION`, existing client fee-token/RPC helpers | EVM and Tempo results/chain selectors remain distinct; execute includes broadcast/finality; fee-token writes still use the signing/review contract. |
| Advanced nonce lifecycle | `PM_REPORT_TEMPO_*`, `PM_RECONCILE_TEMPO_NONCE_LANE` | Accepted, rejected, finalized, dropped/replaced, and ambiguous broadcast outcomes retain exact operation/lane identity. |
| `recovery` | `PM_SYNC_ACCOUNT_FLOW`, `PM_GET_WALLET_RECOVERY_CODE_STATUS`, `PM_ACKNOWLEDGE_WALLET_RECOVERY_CODE_BACKUP`, `PM_ROTATE_WALLET_RECOVERY_CODES`, custody OTP challenge | Cold recovery, interrupted commit replay, backup acknowledgement, and subsequent signing preserve supported semantics. |
| `devices` | List/revoke, scan/start/cancel, target-factor and Email OTP base-factor messages | Cover source and target browser contexts, approval, installation, acknowledgement replay, factor activation, and revocation. |
| `keys` | `PM_RESOLVE_EXACT_KEY_EXPORT_LANE`, `PM_EXPORT_KEYPAIR_UI` | Exact lane selection, relink-required outcome, fresh authorization, viewer origin, and existing UI-only completion behavior. |
| `preferences`, appearance, and chain selectors | Preference messages/events, config/appearance updates, pure selector helpers | Synchronous projection, host reconciliation, wallet-bound writes, and appearance changes preserve an existing warm session. |
| Class lifecycle, hosted menu, prewarm, and internal methods | Init/readiness/lifecycle hooks, `PM_OPEN_AUTH_MENU` and resolution/cancel, prefetch/prefill; inventory `getContext`, surface binding, internal fee-token signing | Move internal methods to their owner, preserve consumer-facing callbacks, and verify no local signing construction on mount/prewarm. |

### Verification ownership map

- Transport ordering, mismatch, cancellation, and expiry: existing
  `tests/wallet-iframe/{handshake,router.connectionClosed,router.cancellationProgress,router.sessionExpiryLifecycle,router.signingProgressForwarding}.test.ts`.
  Keep stub-harness claims limited to transport behavior.
- Preferences, auth menu, surfaces, and review: `preferences.sync.test.ts`,
  `auth-menu.host.integration.test.ts`, `tests/wallet-ui/transaction-review.browser.test.ts`,
  and the applicable real UI tests. Include preference change followed immediately
  by signing and account change while a review/request is pending.
- Registration/restore/auth-method/recovery/device persistence: existing
  `tests/e2e/intended-behaviours/` contracts, including registration resume,
  passkey and Email OTP unlock, recovery, and device linking. Cover EVM-only
  wallets and pending-NEAR provisioning rather than requiring NEAR readiness.
- Export and asset delivery: existing iframe export integration tests, UI export
  tests, and `static-wallet-assets.browser.test.ts` plus packed-package checks.
- Boundary state: existing `tests/typecheck/` fixtures for exact operation/session,
  wallet signing lifecycle, registration, and transaction review. Put new fixtures
  in the top-level tests workspace even where older source-local fixtures exist.
- Browser adapter behavior: test real supported Chromium and Safari/WebKit
  credential flows where feasible. A stubbed PRF assertion does not establish
  real Safari support; explicitly record environmental/manual verification gaps.
- Bundle acceptance: a production consumer using the packed SDK and real emitted
  host, with separate origins, observed worker contexts, and phase-based evidence.

Close the upfront gates by filling in the member dispatch audit, browser/RP
support matrix, client state/preference contract, startup-effect ownership, config
field mapping, and version-skew release decision in this document. Repository
evidence should resolve these wherever possible. Ask for a product decision only
if preserving current supported behavior requires a material scope change.

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

Keep the first cutover focused on dependency ownership and preserved behavior.
Moving the shared constructor wholesale into a host class can remove application
duplication while leaving the host's large auth closure intact; report those as
separate outcomes. Additional host-internal splitting must follow measured
dependencies. Avoid combining this work with a general signing-engine rewrite,
public API redesign, or a storage migration without a demonstrated requirement.

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
- Close the P1 decisions above and record config-field mapping, startup effects,
  supported browser/RP paths, client state/preference semantics, protocol skew,
  and per-phase performance limits before changing composition.

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
through dynamic imports. Supported client browser adapters, public RPC/broadcast
helpers, and pure contracts are classified explicitly in the ownership table.
Remove the obsolete mixed-mode implementation.

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
secrets from persisted artifacts, including screenshots and DOM snapshots during
recovery/export. Disable sensitive trace capture at collection time and retain
sanitized phase evidence for those steps. Save before/after evidence under the
existing test-artifact/evidence conventions.

Collect traffic across the browser context and relevant worker targets, rather
than relying on the parent page's resource timing alone. Resource timing may hide
cross-origin sizes, and cache hits can report zero transfer. Separate HTTP
compression, protocol overhead, decoded resource bytes, cached responses, and
repeated fetches; record the counting method. Use a fresh browser profile for cold
runs and the same profile for the corresponding warm run. Hold compression,
prewarming, network/CPU settings, and service-worker/cache policy constant.

Acceptance criteria:

1. Root and narrow React consumer graphs contain no host execution, signing
   persistence, custody implementation, or worker orchestration modules. Verify
   this using resolved production bundle graphs and observed worker creation,
   allowing the explicitly owned browser adapters and client network helpers.
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
