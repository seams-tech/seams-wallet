# Separate the application SDK client from wallet execution

Status: implementation in progress. Remaining scope narrowed by user request,
2026-10-05.

The four tasks under **Essential remaining work** are the completion checklist
for R170/R171. Earlier decisions and checkpoints describe accepted behavior and
completed work. Their historical open audit notes do not add completion gates.
Keep supported behavior, authority checks, and durable presignature retention.
Do not reopen completed work without evidence of a defect.

October 4 preparation: [API/worker inventory and measurement instructions](refactor-170-inventory.md)
record current dispatch, worker startup, shared crypto dependencies, and remaining
semantic decisions. Consumer reporting now supports retained temporary bundles;
the host report identifies identical WASM aliases. Runtime behavior is unchanged.

Implementation order: **R152 → R170/R171 → R153 → slim R154**.
R152 is complete, including published 0.8.0 releases and Console integration
evidence. Complete R170 and R171 together against that fixed-home behavior before
resuming R153 implementation. R170 owns client/host composition and lifecycle.
R171 owns final public names and consumer migration within the same cutover.
Their focused completion gates below must pass before the R153 handoff.

R153 later adds relocation ownership generations, backend writer fences, and
wallet-wide session/pool retirement. Those features are not prerequisites for
R170/R171 completion. Preserve existing authorization and material checks without
adding placeholder relocation APIs or a second lifecycle implementation.

Historical implementation checkpoint, October 4: fresh production assets and a packed
baseline are recorded in the [production receipt](evidence/refactor-170-production-baseline-20261004.json).
The production-browser registration/sign/lock/unlock scenario passes. October 5
server-side static-body counters close the initial collector's missing worker
script byte measurements; a separate cache-enabled signed-out mount/menu scenario
and safe trace also pass. The inventory records phase-specific latency limits.
Authenticated warm-cache and signer-specific evidence remain open. `near.accountExists` and its public browser contract are
implemented; account-input UI no longer reaches through execution context for
RPC reads. Host/client composition remains pending. Blanket worker startup is now removed;
production mount/menu creates zero crypto workers. The full selective-loading
matrix and initialization-failure/retry work remain open. See the
[worker-startup receipt](evidence/refactor-170-worker-startup-20261005.json).

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

Confirmed source-level causes at the investigation baseline:

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
- Worker files are split, but host warmup crosses signer boundaries:
  `walletIframe/host/context.ts` calls `prewarm({ workers: true })` when creating
  the runtime, and `core/signingEngine/workerManager/workerTransport.ts` then
  creates every `SIGNER_WORKER_KINDS` entry. NEAR, EVM, and Tempo worker startup
  initializes their WASM. This is a confirmed broad loading path; actual
  per-operation transfer savings still require browser measurement.

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
| Iframe permission delegation and external-provider callbacks | Application browser adapter; credential operations run on the wallet origin |
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
| P1 | R152 commit `f312be27` deleted the parent WebAuthn bridge and parent fallback. `walletOriginWebAuthn.ts` executes credentials on the wallet origin and returns an explicit unavailable error for unsupported registration contexts. | Preserve wallet-origin credential execution, RP selection, iframe permission delegation, cancellation, and the hosted-menu CTA. Do not restore the retired bridge or parent PRF forwarding. Verify the current supported browser/RP paths against the intended contracts; Chromium evidence alone does not prove Safari support. |
| P1 | `SeamsWeb.getContext()` exposes the signing engine and `nearClient`; `useAccountInput` uses its RPC client. Host surface binding and restored-session prefill are also methods on the public class. | Split by actual caller: give host callers internal host methods, update application RPC callers to the existing narrow public/client API, and remove the execution-bearing context from the application surface. Preserve supported custom `NearClient` behavior for application reads; a function-bearing object cannot be sent through postMessage. Record declaration changes and every affected consumer before deletion. |
| P1 | Preference getters/setters are synchronous, setters optimistically update a local mirror, and writes are queued to the host in `publicApi/preferences.ts`. `setCurrentWallet` is display selection rather than authentication. | Keep a small client preference projection with the existing synchronous contract for this refactor. Specify defaults before connection, ordered writes, wallet-bound updates, host snapshot/event reconciliation, and disposal. Preserve existing error semantics unless deliberately changing the spec and callers. Never use this projection to authorize or implicitly select a signing subject. |
| P1 | `publicApi/tempo.ts` runs `operations/tempo/executeEvmFamilyTransaction.ts` in the caller, including broadcast, receipt checks, and nonce-lifecycle reports. Transaction review spans the parent and host. | Preserve existing broadcast ownership and return/error semantics. Keep its execution-independent client helper lazy with the operation, while signing and nonce authority remain at their existing enforcement points. Audit NEAR send/delegate paths separately. Preserve review reservation, payload binding, expiration, cancellation, and host admission; moving broadcast into the iframe would require its own protocol and behavior change. |
| P1 | Host config is currently made from broad client config, with empty origin strings and a mode option suppressing nested iframes. Global host-mode and IndexedDB configuration participate in ownership. | Define separate internal client-config and host-config branches at the existing config boundary, with required identities and no invalid combined branch. Preserve all supported settings and their precedence. Construct host dependencies directly; remove empty-string and mode-switch construction tricks once their callers move. Verify the explicit runtime entry independently. |
| P1 | Removing the shared constructor moves startup work as well as imports: pending registration/recovery replay, linked-device acknowledgements, restored-session prefill, preferences, and lifecycle subscriptions. | Assign each startup effect to exactly one host lifecycle trigger. Specify readiness and failure/retry behavior, including concurrent initialization, React remount, iframe reconnect, and disposal. Subscribe/reconcile without losing a state change between snapshot and subscription. A stale result must never restore a previous wallet/session into the current client. |
| P1 | Package and wallet assets deploy independently. `messages.ts` uses protocol `2.0.0`; handshake code rejects mismatches, and the asset manifest declares that contract. | Prefer preserving the wire protocol. If messages or semantics change incompatibly, update the existing version and manifest together, test typed mismatch failures, and document a matching client/host release and rollback pair. Do not ship a new request behind an unchanged handshake version to an old host. No compatibility fallback is added. |
| P2 | The storage-migration step could imply moving secrets between origins even though iframe-mode application persistence is already disabled. | Inventory actual supported stored records first. Preserve wallet origin, RP identity, database names, and schemas by default. No secret-copy migration through the parent. If supported historical state genuinely needs relocation, specify the boundary migration and recovery implications separately before deleting access paths. |
| P2 | Several iframe tests use `tests/wallet-iframe/harness.ts`, which generates a stub host. Passing these cannot demonstrate removal of the real duplicate runtime. | Keep those tests for transport behavior; use packed production client assets and the real emitted wallet host for the bundle/network acceptance scenario. Verify application execution contexts create no signing workers. Include the existing real auth/recovery/device/export contracts. |
| P2 | A 100 KiB static entry target can hide a large router fetched immediately. A long scenario can also obscure a worse first signing experience. | Report root import, mounted provider, idle/prewarm, auth, first sign, and repeat sign separately, with cumulative app+iframe+worker totals. Report the complete client closure as well as static bytes. Set measured per-phase latency and transfer acceptance limits after the baseline, before implementation; a missed target remains an explicit deviation. |
| P2 | Host initialization prewarms all signer worker kinds, and several immediately load WASM. Separate worker files therefore do not guarantee signer-specific downloads. | Complete the targeted worker-loading workstream in step 4. Select dependencies using the actual operation, signer, and auth method; preserve shared custody dependencies and verify NEAR-only, EVM-only, and mixed-wallet flows. |

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
| Wallet-origin WebAuthn | `client/transport/iframe-transport-dom.ts`, `core/platform/browser/createBrowserPlatformRuntime.ts`, `core/signingEngine/webauthnAuth/walletOriginWebAuthn.ts`, host auth-menu and device-link flows | Preserve iframe permissions, wallet-origin credential execution, RP selection, user activation, and cancellation. Parent bridge/fallback files were deleted by R152. |
| Hosted handoff and external auth | `client/router.ts`, `host/hostedWalletSeamsSession.ts`, `host/auth-menu/`, `host/handlers/authMenu.ts`, React `HostedSeamsAuthMenu/` | Preserve origin-bound single-use handoff, wallet-host primary credential, hosted credential redemption, callback correlation, and host-owned OTP/continuation. |
| Restore and startup work | `SeamsWeb.ts` startup methods, `operations/registration/pendingRegistrationRecovery.ts`, `operations/recovery/walletRecoveryCommit.ts`, `host/restoredSessionPresignaturePrefill.ts`, `operations/devices/` | Move orchestration to one host owner; preserve restart replay, exact-session prefill, acknowledgements, and idempotency. |
| Worker selection and WASM initialization | `core/signingEngine/workerManager/{SignerWorkerManager,workerTransport}.ts`, `workerManager/workers/`, `core/signingEngine/assembly/warmup.ts`, `SeamsWeb/assembly/browserWorkerWarmupPolicy.ts`, `host/registrationPreparationPreload.ts` | Remove blanket worker startup; retain targeted preparation and on-demand loading, accurate readiness, shared initialization, and safe worker lifetime. |
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
| `auth`: Email OTP challenge, enrollment/login, Google flow | `PM_REQUEST_EMAIL_OTP_*`, `PM_LOGIN_EMAIL_OTP_ECDSA_CAPABILITY`, `PM_UNLOCK_ADDED_EMAIL_OTP_WALLET`, `PM_GOOGLE_EMAIL_OTP_*` and begin | Preserve multi-step flow handles, resend/cancel, external broker callbacks, one terminal outcome, and no passkey fallback. |
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

## Accepted API and lifecycle decisions

[R171](refactor-171.md) owns the full public naming and consumer migration,
including the decisions below. R170 owns their execution/state boundaries and
behavioral verification. Implement shared changes once at the composition
cutover; use R171 for the complete rename/internalization map.

These decisions simplify application authentication calls and preserve signing
contracts while removing execution internals from the application API. Examples are proposed
shapes, omit unrelated fields, and reuse existing domain types in implementation.
They are not evidence of completed code or a new parallel contract layer.

### Grouped auth API with one lock operation

Expose wallet session operations alongside specialized auth flows under `seams.auth`:

```ts
await seams.auth.unlock(walletId);
await seams.auth.lock();

await seams.auth.getSession();
await seams.auth.getRecentUnlocks();
await seams.auth.hasPasskey(walletId);

const unsubscribe = seams.auth.onSessionChange(listener);
```

- Keep session operations under `seams.auth`; rename the session/passkey queries
  as shown and remove `logout` without aliases. Do not expose duplicate top-level
  session calls. Registration and chain operations retain their own namespaces.
- `getSession` returns the existing precise session states. Preserve supported
  explicit-wallet queries and exact identity binding at the boundary.
- `hasPasskey` retains the supported credential-lookup meaning; it does not
  promise an authenticator will successfully perform a future assertion.
- `onSessionChange` publishes the reconciled public session state and returns an
  unsubscribe function. Use the snapshot/event ordering rules below.
- Update React bindings, examples, docs, and Console consumers together. Hooks
  expose the same operation names as the client.

Current `logout` in `operations/auth/login.ts` calls `lock` and additionally
deletes wallet-scoped durable ECDSA presignatures. Do not carry that deletion into
the unified `lock`. Preserve durable presignatures while retiring active session
authorization, clearing current authentication, fencing stale work, and clearing
volatile signing material. Capture the exact cleanup wallet before clearing
authentication; an overlapping unlock for another wallet must not be cleared by
stale completion. Attempt all
required cleanup and surface failures, preserving the existing failure-handling
intent. Keep wallet records, credentials, and recovery material intact.

Preserving durable presignatures avoids unnecessary replenishment after lock.
Retained material grants no active signing authority: a subsequent unlock must
validate authority, R152 fixed-home placement, and current material state before
reuse. Session expiry requires reauthorization and does not itself expire
otherwise-valid durable presignatures. Preserve existing material invalidation
and consumption checks.
Ordinary lock must not delete the durable pool. R153 later extends these checks
for relocation and adds wallet-wide invalidation as a separate operation.
Update the normative spec and behavioral contracts for removal of logout, including
cleanup failure, repeated lock, concurrent unlock, restart, durable-pool retention, and
signing rejection while locked. Audit every old logout and exact-session lock caller
before deleting paths; preserve exact-session targeting. Removing or changing
wire handlers follows the protocol-version rules below.

Verify the returning-user contract: lock, restart with durable storage retained,
advance time by one month, unlock, and sign the first transaction using retained
valid presignatures without waiting for replenishment. Record actual pool reuse
and first-sign latency. Elapsed time alone must not purge otherwise-valid material.

### SDK-owned account queries replace application `getContext()`

- Remove `getContext()` from the application client. Update application, React,
  example, documentation, and private Console consumers in the same change set.
- Keep the configured `NearClient` internal; preserve constructor injection and
  existing RPC defaults. Do not add a public `nearClient` accessor as a replacement
  for `getContext()`.
- Add `seams.near.accountExists(accountId)` to the existing NEAR capability.
  Account-input hooks consume this SDK-owned query. Application code never imports
  or calls `checkNearAccountExistsBestEffort`, constructs an RPC adapter for this
  task, or coordinates its fallback behavior. Keep any necessary RPC/fallback
  implementation internal and shared by the capability and SDK hooks.
- Validate account input at the public boundary. A successful lookup returns a
  boolean; an unavailable/failed lookup must remain distinguishable from a
  confirmed absent account through the SDK's existing error conventions. Audit
  the current best-effort helper before reuse, and document/test any required
  change to its failure semantics. Account-input UI owns presentation of pending
  or failed checks, with the SDK hook managing stale asynchronous results.
- Keep the existing standalone `useNearClient` adapter supported for explicit
  advanced RPC usage; ordinary account queries do not require it.
- Retain injected function-bearing clients in the application realm. The host
  constructs its own RPC dependency from host configuration; do not serialize
  an injected object across postMessage.
- Supply host controllers with their narrow execution dependencies directly.
  Move surface binding and restored-session prefill to their owning host modules.
  Delete obsolete context access paths without a compatibility shim.

```ts
const exists = await seams.near.accountExists(accountId);

type HostedAuthDependencies = {
  signingEngine: SigningEngine;
  nearClient: NearClient;
};

function createHostedAuthController(
  dependencies: HostedAuthDependencies,
): HostedAuthController;
```

Tradeoff: one domain query adds a small supported API surface and keeps RPC
implementation details inside the SDK. Limit additions to demonstrated caller
needs; do not create a parallel RPC-method family. Audit every injected-client
use before cutover, including explicit-runtime callers, and verify that the query
uses the injected client. Removing `getContext()` and adding the account query
are public declaration changes and belong in release/migration documentation.

### Synchronous preferences with acknowledged synchronization

Keep synchronous getters/setters and the immediate local display projection.
Replace the execution-owned preference manager on the client with the smallest
projection and ordered queue that implement these rules:

1. Before connection, getters return the existing configured defaults.
2. Each setter captures its target when called. Switching wallets cannot redirect
   an already queued write. Preserve existing default-scoped host semantics.
3. Send writes in order. Maintain confirmed host state plus pending local patches;
   reconcile host snapshots/events without overwriting newer optimistic changes.
4. A failed write removes its optimistic patch, exposes confirmed state with any
   remaining patches, and does not prevent subsequent writes from proceeding.
   Handle background rejections internally.
5. Add `preferences.flush(): Promise<void>`. It captures the queue boundary at
   invocation, waits for those writes to settle, and rejects if that batch has a
   failure. Later writes do not extend its wait. Retain unobserved failures until
   an applicable flush reports them; concurrent flushes covering the same batch
   must observe consistent results. Reuse existing error types where possible.
6. A signing dispatch waits for relevant earlier preference writes. If those
   writes fail, surface the failure before dispatch; do not silently sign using
   an unconfirmed preference. Host admission still enforces confirmation policy.
7. Disposal stops local delivery and rejects pending synchronization. It cannot
   undo writes already accepted by the host; reconnect reads authoritative state.
8. `setCurrentWallet` remains display selection. Signing subject resolution uses
   authenticated session state or the existing explicit subject API.

```ts
type PreferenceTarget =
  | { kind: "defaults"; walletId?: never }
  | { kind: "wallet"; walletId: WalletId };

type ConfirmationPreferenceWrite = {
  target: PreferenceTarget;
  patch: Partial<ConfirmationConfig>;
};

seams.preferences.setConfirmBehavior("requireClick");
await seams.preferences.flush();
```

Tradeoff: an ordered queue and projection preserve synchronous UI usage. Making
all setters asynchronous would create broader consumer churn. Rollback, flush,
and failure-before-signing are deliberate behavior changes: update the normative
specification, declarations, and behavioral contracts with their implementation.
Verify wallet A/B switching, failure followed by a successful write, concurrent
flushes, host events during pending writes, immediate signing, and disposal.

### Separate configuration at construction

Group the public helpers under `seams.config`: `setTheme`, `setAppearance`,
`chainTarget`, and `configuredChainTargets`. Remove their top-level counterparts.
This namespace groups the existing operations; it introduces no mutable config
store or generic setter. Keep constructor input and the existing read-only
`configs` snapshot distinct, and preserve supported read access during the audit.
Appearance changes preserve warm sessions. Chain helpers resolve/read configured
targets and do not change authentication or the selected signing subject.

Keep `defineSeamsConfig()` as the application entry. Resolve configuration once
into separate client and host types, preserving supported defaults and precedence.
Construct host dependencies directly and remove empty-origin/mode-switch tricks.

```ts
type ResolvedClientConfig = {
  kind: "client";
  walletOrigin: WalletOrigin;
  chains: ChainConfig;
  appearance: AppearanceConfig;
  storage?: never;
};

type ResolvedHostConfig = {
  kind: "host";
  allowedAppOrigins: readonly AppOrigin[];
  chains: ChainConfig;
  storage: WalletStorageConfig;
  walletOrigin?: never;
};

function createApplicationClient(config: ResolvedClientConfig): SeamsWeb;
function createWalletHost(config: ResolvedHostConfig): WalletHost;
```

The factories belong to separate entry graphs. The application entry must have
no runtime import of the host factory. The explicit runtime entry constructs
execution directly through its supported configuration. Preserve actual wallet
origin/RP/storage identity; the example's excluded `walletOrigin` means the client
iframe-target setting, not permission to discard host origin validation.

Tradeoff: two resolved types require a field-by-field ownership/precedence audit,
but reject contradictory construction. Reuse shared value types and existing
config parsers; introduce no new config framework. Add type fixtures for invalid
branch combinations and validate explicit-runtime consumers independently.

### Connection readiness and startup ownership

Expose lifecycle operations as `seams.connection.connect()`, `getState()`,
`onChange(listener)`, and `dispose()` on that namespace. General lifecycle events
use `seams.events.subscribe(listener)`. Keep no top-level instance method aliases.
`connection.dispose()` terminates the whole client and releases its owned
resources and subscriptions; it does not lock the wallet or purge durable
presignatures. React cleanup follows the same ownership contract.

Connection readiness means handshake and initial public-state reconciliation
completed. Authentication remains a separate existing session state; signing
workers initialize for operations independently of connection readiness.

```ts
type ClientConnection =
  | { kind: "idle" }
  | {
      kind: "connecting";
      generation: number;
      completion: Promise<void>;
    }
  | {
      kind: "ready";
      generation: number;
      transport: WalletTransport;
    }
  | { kind: "failed"; generation: number; error: ConnectionError }
  | { kind: "disposed" };
```

Adapt the existing lifecycle types rather than adding a competing state machine.
Concurrent initialization shares its in-flight attempt. Reconnect starts a new
generation; late results from older generations are discarded. Bind pending
results to the existing exact wallet/session identity as well, because a wallet
can change within one connection. Failed initialization can be retried explicitly;
disposal is terminal for that instance and rejects pending client requests.

This generation belongs to the client connection. It does not provide R153's
future wallet ownership generation or backend write fencing.

React rerenders/remounts reuse the provider-owned client through the existing
ownership mechanism. Effect cleanup releases subscriptions; the actual owner
disposes the client when released or replaced. Configuration replacement must
release the old ownership and prevent its results from updating the new view.
Preserve SSR-safe imports and construction.

Never automatically replay signing, registration, or broadcast requests after a
disconnect. Report the existing interrupted/unknown outcome and reconcile through
existing operation identity where supported; a lost response does not prove that
execution failed. Durable host recovery is owned separately from transport retry.

| Startup effect | Owner and trigger |
| --- | --- |
| Pending registration/recovery reconciliation | Host lifecycle after durable state is available |
| Linked-device acknowledgement retry | Host device lifecycle |
| Restored-session presign prefill | Host session lifecycle after authority, R152 fixed-home placement, and current material validation |
| Preference/session projection | Connection bootstrap and subsequent host events |
| Signing worker initialization | First operation requiring that dependency, plus approved flow-specific preparation |

Tradeoff: explicit states make races reviewable at the cost of a small amount of
lifecycle code. Single ownership does not guarantee exactly-once work across
crashes: preserve durable recovery guards. Verify reconnect, React remount,
configuration replacement, wallet changes during pending work, and disposal.

### Snapshot/event ordering and protocol deployment

Subscribe before requesting initial state and buffer events during bootstrap.
Audit the existing transport/host ordering guarantees to establish which buffered
events precede or follow the snapshot; subscription order alone is insufficient.
Prefer the existing messages if they establish this contract. If they cannot,
add host-issued revisions scoped to the connection/state stream:

```ts
type PublicStateSnapshot = {
  revision: number;
  session: PublicSessionState;
};

type PublicStateEvent = {
  revision: number;
  session: PublicSessionState;
};
```

For complete-state events as illustrated, apply the snapshot then newer revisions
within the current generation. Host state capture, revision assignment, and event
publication must be consistently ordered. If existing events are patches, preserve
their ordering and detect missing updates instead of treating them as snapshots.

Tradeoff: revisions clarify reconciliation but expand the wire contract. Add them
only if the audit demonstrates a gap. Incompatible message or semantic changes
require updating the existing protocol version and manifest together, typed skew
failures, and a documented matching client/host release and rollback pair. Do not
add a compatibility fallback. Preserve protocol 2.0.0 only if its contract remains
compatible. Verify an event concurrent with snapshot capture and stale events
arriving after reconnect.

The current-source audit in [the inventory](refactor-170-inventory.md#snapshot-ordering-and-protocol-decision)
found wallet-unbound preference snapshots and asynchronous session reads without
within-connection freshness ordering. The cutover therefore requires protocol
**4.0.0**, paired revision envelopes and preference acknowledgements, and removal
of the duplicate `PM_EXECUTE_ACTION` command. Update the
existing manifest/version and skew checks with both endpoints. The normalized
configuration transport started the unreleased 3.0.0 cutover. Removing the NEAR
command advances the matched pair to 4.0.0. Revision ordering
remains required before release. Release the client package and wallet-host assets
as a matching 4.0.0 pair; roll back both to their matching prior releases together.
Version-skew errors must reject mixed pairs. The audit specifies stale-capture
rejection and the host transitions whose revisions need coverage.

### Preserve transaction and browser-adapter ownership

Keep current application transaction review, broadcast, receipt handling, and
nonce-lifecycle reports. Keep execution-independent broadcast helpers lazy with
the operation. The host retains signing and its existing authority checks.
Preserve reservation/payload binding, expiration, cancellation, return values,
and error semantics; audit NEAR send/delegate paths independently.

Preserve wallet-origin credential execution and hosted-menu CTA behavior from
R152. The parent delegates iframe permissions and handles external-provider
callbacks; it no longer executes a credential/PRF bridge. Record and verify
current browser/RP support, including explicit unavailable outcomes. Preserve
the explicit runtime entry's browser adapter separately from the hosted client.

Tradeoff: moving these responsibilities into the iframe might further reduce
application code, but would expand this refactor into a transaction-protocol and
browser-behavior redesign. Those changes remain outside this cutover.

### Remaining evidence before cutover

Use the focused completion gates at the end of this plan. Retain existing
inventory and test evidence. Expand coverage only for a changed contract or a
concrete failure; the full browser, worker, and latency matrices are follow-ups.

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

## Current implementation checkpoint

Host context now constructs `WalletHostRuntime` directly. Host handlers and
lifecycle subscriptions no longer depend on the public `SeamsWeb` class.
Registration, session, and Email OTP commands have separate application and host
owners. The application facade no longer selects host factories or starts durable
registration/recovery replay.

NEAR, EVM, and Tempo signer factories now receive explicit application or host
commands. Public factories retain subject selection and transaction broadcasting.
Application commands own iframe transport; host commands own execution. The
command inputs require resolved wallet and chain/account identities.

Device linking and account sync also have explicit application and host owners.
The shared public API no longer requires a signing engine or constructs a host
execution domain. The application constructor and coordinator now retain only client state,
configuration, and transport. The host owns signing infrastructure and wallet-origin
IndexedDB directly. Root and provider production graphs contain no signing stores,
custody implementation, worker managers, or host runtime. The obsolete mixed-mode
storage selector and public `getContext()` have been removed.

Application preference display state is memory-only; the host retains durable
preferences. Client preference writes support rollback, bounded `flush()`, retained
failures, and a preference check before signing. Configuration now crosses the
iframe boundary as a validated resolved snapshot. Appearance updates carry a
separate resolved branch. Host-side default resolution and the direct-mode
normalization option are removed. Protocol session snapshot/event revision ordering
remains unfinished. Preference
snapshots and events now carry wallet-bound revisions; delayed snapshots cannot
replace newer events. Host preference reads now fence stale hydration, and writes
acknowledge durable storage. Host execution replacement now rejects pending runtime
requests and fences callbacks from the retired generation. Session event revisions
are implemented below; full consumer ownership verification remains open.

The host no longer reapplies an existing wallet selection during a session read.
Saved-wallet restoration now yields to selection changes made during its lookup,
including removal back to no selection. Three browser cases cover this ordering,
with production Email OTP and passkey refresh/sign/export acceptance also passing.
This closes the restoration side effect; session snapshot revisions are implemented
in the later checkpoint below.
See `evidence/refactor-170-session-selection-20261005.json`.

Client session reads now retry against the current wallet after an observed
selection change. Connection closure clears the cached session and fences delayed
session-read responses. Disposal prevents reinitialization. Session notifications
no longer reapply a result after another asynchronous boundary. These client
guards preserve selection and connection lifetime. The later snapshot checkpoint
adds local authority revisions. See `evidence/refactor-170-session-client-20261005.json`.

Host execution generations now cover requests waiting for runtime code and requests
already executing. Replacement rejects them, clears cached handler ownership, and
suppresses late results, progress, lifecycle events, and surface cleanup from the
old runtime. Appearance updates preserve active work. The comparison uses the
existing execution fingerprint shared by the host entry and runtime context.
See `evidence/refactor-170-host-generation-20261005.json`. This does not close
session-authority ordering, React ownership acceptance, or durable-pool longevity.

Exact-session observations now recheck persisted authority and the expiry deadline
after remote status work. A concurrent lock, replacement, or retirement forces a
fresh observation; repeated changes return `superseded` after three attempts. The
browser probe covers six outcomes using real IndexedDB and canonical fixtures.
Four production lifecycle cases also pass, including both cross-tab restoration races.
This costs two local reads per successful remote observation and does not close
the host transition/revision-envelope gate. See
`evidence/refactor-170-session-authority-20261005.json`.

The session transition inventory now maps persisted authority/session writes,
partial commits, remote observations, and connection changes to their owners.
It identifies writes that bypass the current event stream. The unused runtime
restore counter and its single-caller assignment wrapper are removed. This
cleanup removes 20 production lines net; it does not close revision ordering.
See the inventory's “Session transition sources and revision coverage” section.
Build, type, runtime-boundary, bloat, and two production lifecycle checks pass.
Evidence: `evidence/refactor-170-session-transition-audit-20261005.json`.

Session authorization operations now use the existing database transaction manager.
The separate transaction adapter and repeated abort handlers are deleted. Wallet
session clearing reads and deletes keys atomically. Corrupt reads retain rollback
semantics, and all operations inherit the manager's existing transaction timeout.
Seven browser cases and four production lifecycle cases pass. The change removes
29 production source lines net. Revision notifications and session envelopes remain
open. Evidence: `evidence/refactor-170-session-transactions-20261005.json`.

Session snapshots now include a host-issued observation revision. The host retries
reads interrupted by a local authority commit or selection change, and checks
again immediately before publication. The client ignores older same-wallet
snapshots. Six authority stores advance the local revision only after committed
writes; ordinary reads and aborted transactions leave it unchanged. Shared cursor
deletion paths now use tracked store deletion. Type fixtures require the snapshot
fields and preserve the captured revision. Session event revisions, remote-tab
notifications, and the remaining lifecycle acceptance matrix stay open. All 65
browser cases and four production lifecycle cases pass. This step adds 127
production lines net. Evidence: `evidence/refactor-170-authority-revisions-20261005.json`.

The host now owns one session observer per runtime and port. Queries and full-state
events share an observation clock and required wallet binding. Commit and selection
subscriptions drive event refreshes. Notifications from one host operation are
combined before its final refresh. Disposed or replaced observers cannot publish late state. Expiry notifications
carry a revision, and known expired identities cannot become active through a delayed
status reply. A fresh session identity remains independent of those expiry facts.

The client consumes host session events instead of querying again on every preference
notification. It ignores other-wallet snapshots and older observations. Bootstrap
retries switch to current-state reads after selection changes, preserving removal.
Unchanged projections do not notify login-state listeners again. Exact session
replacement skips identical persisted records. Concurrent wallet-session readers
share pending work within the same connection, selection, and observation revision.
Unlock and successful hosted authentication publish their session before completion.
Production verification exposed excessive status reads; its three-read limit remains
unchanged. The consumer now relies on provider events instead of manually refreshing
React state after passkey unlock. All 74 browser cases and four production lifecycle
cases pass, including automatic provider state and the unchanged three-read limit.
This step adds 550 production lines and removes 190, for a net increase of 360.
Evidence: `evidence/refactor-170-session-events-20261005.json`.
Database-scoped broadcast notifications now invalidate passive session observers in
other contexts. They carry only a commit marker; each receiver rereads IndexedDB and
uses its own observation revisions. Listener removal closes the channel, and database
replacement or disabled persistence retires it. A browser scenario holds an older
status read while another tab locks and then unlocks the wallet. A production
idle-tab scenario verifies that lock reaches the React UI through a host event,
without another client session query. All 24 targeted browser cases and five
production lifecycle cases pass. This step adds 63 production lines and removes
three, for a net increase of 60. Evidence:
`evidence/refactor-170-cross-tab-session-20261005.json`. Full revocation/activation and
reconnect acceptance, cross-browser delivery, and network/latency measurements remain
open.

The application now exposes complete session observations through
`auth.onSessionChange`. React consumes that subscription directly. The old public
boolean callback and React's duplicate bootstrap/read-back path are removed.
Locked observations preserve query-free passive updates; unlocked observations
bind rich reads to the exact wallet ID and share in-flight work with unlock callers.
See `evidence/refactor-170-session-subscription-20261005.json` for scoped verification.
This does not close provider replacement, all-browser delivery, or other R170 gates.

Generic application `prewarm` and `prefetchBlockheight` calls are removed, along
with React's redundant idle preparation hook and `eager` flag. Provider mount uses
`connection.connect`; selected operations retain host-owned preparation. Unused
host prewarm options and their diagnostic records are deleted. See
`evidence/refactor-170-preparation-cleanup-20261005.json`. The generic registration
menu preload is removed and measured separately in
`evidence/refactor-170-registration-menu-20261005.json`. The complete worker
dependency matrix and paired latency gates remain open.

Registration method names now match R171: `addSigner`, `addEmail`, and
`removeAuthMethod`. The application client, wallet host, React bindings, and
intended app use the same names. Existing wire messages and authorization proofs
retain their contracts. See the registration-method checkpoint in the inventory.

At the recorded bundle checkpoint, the production root-client static closure measured
66,386 bytes gzip
(64.8 KiB), compared with 739,640 bytes at baseline: a 91.0% reduction. Including
its lazy router, it measures 93,551 bytes gzip (91.4 KiB). The provider measures
73,281 bytes static and 103,213 bytes reachable gzip, excluding React peers.
These figures exclude wallet-origin assets and do not establish total network or
latency savings. Eight production lifecycle cases and 13 browser cases pass.
Production build, type checks, external declarations, runtime boundaries, packed
package boundaries, and the bloat gate pass. See
`evidence/refactor-170-client-cutover-20261005.json` for source hashes and evidence.

Complete selective-loading evidence, protocol ordering, configuration separation,
R171 naming, and consumer/release acceptance remain unfinished. See
`refactor-170-inventory.md` for historical checkpoints and remaining verification.

The public key-export API is now `keys.exportKey`. Applications no longer select
an export lane or dispatch its viewer separately. React, intended-app, and public
documentation callers use the single operation. Host dispatch preserves capability
checks and existing authorization, lane, and material binding. Private retained
test-app migration remains tied to the exact release. See the key-export checkpoint
in `refactor-170-inventory.md` for verification and remaining acceptance limits.

ECDSA bootstrap now stays inside host authentication and the explicit runtime
port. The unused application bootstrap methods, argument builders, and transport
route are removed. The iframe protocol is now 12.0.0 after removing the public pending-registration resume request; client and host deployments
must match. Custom-broadcast reporting remains supported. See the bootstrap
ownership checkpoint in `refactor-170-inventory.md`.

The package declaration check now also installs the actual tarball into an
isolated temporary npm project with optional peers omitted. Strict core and
external-EVM consumers compile, and both entries import in Node with React,
React DOM, and their type packages absent. This closes optional-peer absence
for those entries. Expanded React provider SSR/remount and deployed asset delivery checks are
deferred under the narrowed scope below. See the inventory's optional-peer checkpoint.

The React device list now delegates email removal proof to the existing host
`registration.removeAuthMethod` operation. Its duplicate challenge, OTP form, and
raw-proof submission are removed, reducing production source by 212 net lines.
Production account-menu coverage verifies removal and subsequent signing. See
`evidence/refactor-170-method-removal-20261005.json`.

### Repeated production transfer checkpoint

Three current authenticated runs transfer a median 7,807,858 static body bytes,
compared with 11,031,734 in the retained baseline (29.2% less). Three signed-out
cold/warm pairs transfer a median 958,079 cold body bytes versus 3,398,239 (71.8%
less). Warm signed-out visits revalidate assets with zero response body bytes.
No workers or WASM load during the signed-out scenarios.

This proves a transfer reduction for these completed local production scenarios.
It does not close authenticated warm-cache coverage, repeated baseline latency
acceptance, or deployed edge compression. Local preview WASM responses remain
uncompressed. See `evidence/refactor-170-repeated-assets-20261005.json` and the
inventory's repeated production asset checkpoint for counting rules and limits.

## Essential remaining work

These four tasks replace the former broad implementation and acceptance backlog.
Complete them together with R171. Commit each finished task with its evidence.

### 1. Finish the email unlock API

- [x] Implement `auth.unlockWithEmailCode({ challenge, code })` through the
  existing host-owned flows. Keep `auth.requestEmailCode` and
  `auth.startGoogleSignIn` as the supported custom and hosted entry points.
- Preserve the supported ECDSA, NEAR-only, added-method, and pending email
  activation branches. Keep relay routing and activation details inside the SDK.
- Preserve challenge purpose, exact wallet/method binding, expiry, resend,
  cancellation, and one terminal outcome. Operation-bound action proofs remain
  distinct from unlock proof. Reuse the existing flow ownership and transport.
- Delete the replaced public specialized unlock methods, handlers, and callers
  once their supported behavior is covered. Add no compatibility aliases.

Done when custom and hosted email unlock use the accepted public API, supported
branches work, and applications no longer orchestrate internal activation steps.

### 2. Finish the public API and delete replaced paths

- [x] Audit the final public declarations and repository callers against R171's
  migration map. Fix remaining mismatches in SDK, React, examples, intended app,
  and public documentation. Record private Console changes for exact-release
  adoption separately.
- Delete obsolete names, duplicate adapters, and dead construction/configuration
  paths directly replaced by this refactor. Keep one client construction path
  and one host execution owner. Preserve the explicit runtime entry.
- Keep the existing inventory current for affected paths. No exhaustive audit
  of every host helper, worker dependency, or unrelated export is required.
- Report task-owned production additions, deletions, and net change against
  `0d45cb34^`, excluding concurrent work, tests, docs, and generated output.
  Net deletion remains an expectation, not a numerical gate.

Done when ordinary callers use the accepted grouped API, removed names have no
live callers, and no obsolete parallel implementation remains in changed paths.

### 3. Verify the affected wallet flows

- [ ] Reuse existing production E2E coverage for passkey and email registration,
  unlock, NEAR/EVM/Tempo signing, lock/unlock, and restored signing. Add or extend
  a scenario only for a behavior changed by the remaining work.
- Verify the new email boundary's failure/resend/cancel behavior and pending
  activation continuation. Keep exact authority and challenge-purpose checks.
- Preserve existing lock evidence: signing fails while locked; volatile authority
  is cleared; valid durable presignatures remain reusable after unlock.
  Never add a durable-pool purge to lock. The month-later reuse requirement
  remains; the additional full-clock browser aging test is deferred below.
- Retain existing stale-result, connection/disposal, selective-worker, and
  initialization-retry evidence. Re-run relevant cases if the remaining changes
  touch those boundaries. Do not build a new exhaustive permutation matrix.
- Run the relevant type fixtures, production build, packed declarations,
  runtime-entry checks, freshness check, and `pnpm report:bloat --check`.
  Fix production failures caused by this refactor; do not weaken contracts.

Done when the changed public flows pass against the production host and assets,
with repeatable sanitized evidence. Existing valid evidence counts; do not rerun
unaffected suites solely to refresh timestamps.

### 4. Record the final bundle and migration result

- [ ] Refresh root-client and React-provider bundle reports from the final build.
  Verify that application graphs contain no host execution or worker managers.
- Run the existing signed-out cold/warm scenario and representative authenticated
  registration/sign/lock/unlock scenario. Compare static response bytes with the
  retained baseline using the existing accounting rules. Report app, iframe,
  worker, and WASM costs separately where the collector supports attribution.
- Record scenario completion and first/repeat signing timings as observations.
  Do not require repeated historical baseline reconstruction or claim a latency
  improvement without paired evidence. Explain material observed regressions.
- Publish a local completion receipt with commit/build identity, commands,
  measurements, known limits, source-line accounting, and migration instructions.
  Record the matching client/host protocol and release requirement.

Done when the smaller application client, supported wallet behavior, and public
API are verified, and the result can be reproduced from the recorded revision.

## Deferred follow-ups — not completion gates

These items remain useful, but are outside the remaining R170/R171 implementation:

- Full operation × signer × factor worker inventory and exhaustive retry,
  cancellation, origin-change, and worker-lifetime permutations.
- Further host chunk splitting, algorithm-specific import tuning, WASM binary
  trimming, and duplicate-asset removal without a demonstrated current defect.
- Authenticated warm HTTP-cache instrumentation, three repeated historical
  baseline latency runs, and deployed edge compression/cache validation.
- Additional month-later browser-restart/clock-advance presignature acceptance.
  Preserve current validity checks and fast reuse; do not shorten material
  lifetime or delete durable presignatures to avoid this scenario.
- Expanded Safari/browser/RP matrices, SSR/provider replacement permutations,
  and real-chain broadcast/receipt/delegation matrices beyond affected flows.
- New direct coverage for unchanged recovery-code rotation, account sync,
  device linking, and key export. Existing contracts still apply and run when
  a change affects those paths.
- Repository-wide abstraction and dead-code sweeps unrelated to replaced paths.
- Publication, deployment, and private Console exact-release adoption. Prepare
  migration notes now; execute release work under its separate authorization.

## Focused completion gate

R170/R171 implementation is complete when all four essential tasks above have
current evidence and no unresolved defect introduced by this refactor remains.
Accepted security, custody, authorization, session, and material-validity behavior
still applies. Deferral removes extra scope and test permutations; it does not
permit dropping supported behavior or retaining replaced public aliases.

Stop adding optimization tasks once these gates pass. Record additional findings
as follow-ups unless they break an essential gate. Release readiness and deployed
integration remain separate from implementation completion.
