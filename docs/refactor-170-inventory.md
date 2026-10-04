# Wallet client and worker inventory

Audited October 4, 2026. Companion to [the refactor plan](refactor-170.md).
This records current implementation and proposed ownership. It changes no
runtime behavior. R152/R153 continue to own placement, replay, persistent state,
presignature invalidation, and settings changes; refresh this inventory after
their integration before moving those implementations.

## Reproduce bundle measurements

### Implementation baseline and production-browser runner

The [fresh production receipt](evidence/refactor-170-production-baseline-20261004.json)
records the successful `build:prod` baseline at revision `822dfb30`, before runtime
changes, with build-input, emitted-ESM, lockfile, and packed-tarball hashes. The
minimal root consumer measured 739,640 bytes gzip statically and 793,388 bytes
including reachable lazy JS. Keep this distinct from the earlier exploratory
build and from observed browser traffic.

The existing intended-services runner now accepts `SEAMS_INTENDED_PRODUCTION=1`
to build/serve the intended app with Vite production output on separate app and
wallet origins. `SEAMS_INTENDED_WALLET_DIST_ROOT` selects an unpacked package's
`dist` for both origins. Install that package's runtime dependencies before using
it; a tar extraction alone is not an installed consumer.

```sh
SEAMS_INTENDED_PRODUCTION=1 node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.registration.assets.contract.test.ts
```

For a retained production package and already-built local services, set
`SEAMS_INTENDED_SKIP_BUILD=1` and `SEAMS_INTENDED_WALLET_DIST_ROOT` to its absolute
`dist` path. The scenario emits `wallet-assets.json` into its Playwright output
directory. It covers registration, NEAR/EVM signing, lock, unlock, and repeat
signing. Only static asset metadata is retained; auth bodies, headers, OTPs,
recovery codes, and key material are excluded. Browser traces/screenshots/video
are disabled for this custody scenario.

This collector is initial instrumentation, not completion of the browser gate:
the intended harness's request routing disables HTTP caching, and context-level
request events do not establish complete worker-target coverage. It explicitly
reports missing measurements. Add cache-enabled and worker-target evidence,
separate mount/menu phases, selective signer scenarios, safe boot tracing, and
measured latency limits before claiming the cutover baseline complete.

The packed baseline scenario passed twice (37.1 s and 34.1 s overall test runs).
The later report is retained at `.artifacts/r170-baseline/wallet-assets.json`;
its digest, phase measurements, and limitations are in the production receipt.
Twenty-three worker-script responses lacked measurements. Worker events show
broad NEAR/EVM/Tempo/Email OTP/custody startup during registration and again on
reload/unlock. A worker URL's origin is not proof of its creating execution
realm; add target-level attribution before making that ownership assertion.

A subsequent CDP observation passed the same scenario in 35.7 s. Page network
events attribute all 25 worker-script starts to the wallet document origin;
recursive worker-target observation records six completed WASM requests. The
supplemental report is `.artifacts/r170-baseline/wallet-assets-cdp.json`, with its
hash and observer-source hash in the receipt. It still has 25 pending script
records and three target-observation errors. Those records
must not be counted as zero-byte downloads. Page/worker and context observations
overlap and must not be added together. Target startup is briefly paused to
enable observation; keep this instrumentation identical for latency comparisons.
The next measurement task is complete script-transfer evidence, followed by the
cache-enabled mount/menu and signer-specific scenarios.

From `seams-wallet`, with existing SDK outputs and installed dependencies:

```sh
node packages/wallet/scripts/reports/report-lite-bundle-sizes.mjs --consumers --json > /tmp/wallet-consumers.json
node packages/wallet/scripts/checks/report-wallet-iframe-bundle-size.mjs --json > /tmp/wallet-host-assets.json
```

The first command builds named-import consumer fixtures with Bun in a retained
temporary directory. Set `BUN_BIN` if Bun is outside PATH. The directory contains
fixture sources, build logs, bundles, and `report.json`. It never rebuilds shared
`dist`. A changed emitted-ESM hash during measurement rejects the result.
Revision, relevant source dirty state, lockfile hash, build-input manifest,
emitted-ESM hash, tools, and freshness diagnostics accompany the measurements.

| Fixture | Import contract | Interpretation |
| --- | --- | --- |
| `root-client` | `SeamsWeb`, `defineSeamsConfig` from root | Retains the public client class and its methods. |
| `react-provider` | `SeamsWebProvider` from `react/provider` | Provider integration without optional application UI. |
| `hosted-auth-menu` | `HostedSeamsAuthMenu` from its narrow export | Component-only cost; requires a provider in a working application. |
| `react-hosted-auth` | Provider and hosted menu from `react` | Measures their shared graph together; do not add the two separate fixture totals. |

React/ReactDOM peers are external, other resolved dependencies are bundled.
Production minification and ESM splitting apply to the consumer. Static and
all-reachable JS closures overlap. Emitted CSS/other assets are separate; explicit
application stylesheet imports, wallet-origin requests, workers, and runtime WASM
fetches are outside these consumer totals. Per-file gzip uses level 9; Brotli
uses quality 11. These are reproducible bundle measurements, not browser traffic
or a guarantee about another bundler's output.

The existing lite report's asset sum covers selected files only. Its root
`index.js` row excludes imports. The host report covers static boot, reachable
feature closures, CSS, and selected workers/WASM separately; its worker sum is
inventory rather than a session download. Identical WASM groups are SHA-256
matches across `dist/workers/*.wasm`; separate URLs remain separate assets.
No aliases are removed or assumed to share a download cache.

Freshness is diagnostic while R152/R153 are modifying shared build inputs.
Retain stale-output measurements as exploratory evidence with their hashes.
Rebuild and establish the release baseline after the active work is integrated;
the current manifest does not record whether the source build was production.

### October 4 exploratory results

The [machine-readable measurement receipt](evidence/refactor-170-bundle-measurement-20261004.json)
records the exact output and tool hashes. The existing-build freshness check
reported newer wallet-server inputs. These numbers are useful for the cleanup
baseline but do not establish the size of a newly built release.
An independent repeat completed with identical emitted-ESM hash and all four
consumer results; its later freshness check passed while other work continued.
Both run identities are retained in the receipt. The original build mode
remains unrecorded.

| Consumer | Static JS gzip | All reachable JS gzip | Separate emitted assets gzip |
| --- | ---: | ---: | ---: |
| Root client | 723.2 KiB | 776.2 KiB | 0 |
| Narrow React provider | 730.4 KiB | 786.1 KiB | 0 |
| Hosted auth menu alone | 13.6 KiB | 13.6 KiB | 0 |
| React provider + hosted auth menu | 736.5 KiB | 789.1 KiB | 5.8 KiB |

The small standalone menu number excludes the required provider. The combined
fixture measures both together. Zero emitted assets does not imply a functioning
wallet needs no CSS, workers, or WASM; runtime fetches and explicit stylesheet
imports are outside this consumer build.

## API dispatch inventory

Implementation progress: `near.accountExists(accountId)` now owns public account
lookup using the configured/injected RPC client. `useAccountInput` calls this
capability without waiting for an iframe or reaching through `getContext()`.
The mixed RPC/auth module's former best-effort account helper is deleted. The
public query rejects invalid input and unavailable reads instead of returning
false; its contract and browser scenario are in `docs/intended-behaviours.md`
and `tests/wallet-iframe/account-query.test.ts`. This does not yet remove host
context callers or complete the client/host split.

Paths in this section are relative to `packages/wallet/src/SeamsWeb/`.
The callable-member lists cover `publicApi/types.ts` capability interfaces and
the public methods on `SeamsWeb`. Names grouped on one row share an ownership
decision, but still retain their individual result/callback contracts.

`C` means application client orchestration; `H` means host execution through the
existing router; `L` means a local value, display projection, or subscription.
Current factories often import both C and H implementations. The target is to
remove that dependency overlap while retaining these distinctions.

| Public surface and members | Current client path / protocol | Host owner or local responsibility |
| --- | --- | --- |
| `auth.unlock`, `lock`, `logout` | `publicApi/auth.ts` → `operations/auth/walletAuth.ts` → router equivalents | H: `host/handlers/auth.ts`; retain exact session, progress, error, and logout cleanup semantics. |
| `auth.getWalletSession`, `getRecentUnlocks`, `hasPasskeyCredential` | Same domain → router queries; session read can also prefetch blockheight | H auth queries; preserve authentication versus app-identity distinction. Recent-unlock fallback behavior needs explicit review before removing local paths. |
| `auth.prefillRouterAbEcdsaDerivationPresignaturePool` | Domain → router prefill | H: session/presignature preparation; R153 overlap. |
| `auth.requestEmailOtpChallenge`, `requestEmailOtpSigningSessionChallenge`, `refreshEmailOtpSigningSession` | `SeamsWeb` domain methods → matching router requests | H: `host/handlers/emailOtp.ts`; challenge purpose and session scope remain distinct. |
| `auth.loginWithEmailOtpEcdsaCapability`, `unlockAddedEmailOtpWallet` | Domain → login/unlock-added router methods | H: Email OTP handler and selected factor activation. |
| `auth.beginGoogleEmailOtpWalletAuth` | Domain → router flow proxy | C proxy for H flow, including resend/reroll/submit/complete/cancel; callbacks and terminal results remain correlated to the flow. |
| `registration.registerWallet`, `registerWithEmailOtp`, `registerPasskey` | `createPublicApi.ts` aliases/delegates to `SeamsWeb` domain; passkey builds registration input | H registration via `PM_REGISTER_WALLET`; preserve selected auth method and signer set. `registerWithEmailOtp` currently aliases `registerWallet`. |
| `registration.addWalletSigner`, `addPasskey`, `addEmailOtp`, `revokeAuthMethod` | Domain → matching router messages | H registration/auth-method handlers; preserve exact authorization and effect/retry semantics. |
| `registration.requestEmailOtpEnrollmentChallenge`, `enrollEmailOtp` | Domain → enrollment router requests | H Email OTP enrollment. |
| `registration.resumePendingEcdsaRegistration`, `getNearProvisioningState` | Domain → resume/provisioning router requests | H registration state/replay; R152/R153 overlap. |
| `registration.onNearProvisioningStateChanged`, `awaitNearReady` | Lifecycle subscription; `publicApi/awaitNearReady.ts` combines read and subscription | C observation of H state, with timeout and disposal; pending NEAR must not invalidate an EVM-ready wallet. |
| `near.registerNearWallet`, `evm.registerEvmWallet` | Capability builds registration input → router `registerWallet` | H unified registration; C retains public argument/result adaptation. |
| `near.fundImplicitNearAccountForTesting` | `publicApi/near.ts` → router test-funding request | H NEAR handler; preserve test-only scope. |
| `near.executeAction`, `signAndSendTransaction`, `signTransactionWithActions`, `sendTransaction`, `signDelegateAction`, `signNEP413Message` | `publicApi/near.ts` → matching router methods (`signNep413Message` spelling in router) | H `host/handlers/near.ts`; preserve supplied subject, transaction review where applicable, callbacks, and signed/send result distinctions. |
| `near.sendDelegateActionViaRelayer` | `publicApi/near.ts` → core relayer HTTP helper | C sends an already signed delegate action. No new iframe command is required. |
| `near.signAndSendDelegateAction` | C composes `signDelegateAction` and `sendDelegateActionViaRelayer` | H signing + C relaying; retain one outer completion callback and separate signing/relay failures. |
| `evm.signTransaction`, `tempo.signTransaction`, `tempo.signTempo` | `publicApi/{evm,tempo}.ts` → router `signTempo` | H `host/handlers/ecdsaTempo.ts`; chain family and result validation remain exact. |
| `evm.executeTransaction`, `tempo.executeTransaction`, `tempo.executeEvmFamilyTransaction` | `operations/tempo/executeEvmFamilyTransaction.ts` orchestrates signing, broadcast, receipts, verification, reports | C lifecycle with H signing/admission; preserve existing broadcast ownership. |
| `evm.bootstrapEcdsaSession`, `tempo.bootstrapEcdsaSession`, both `.advanced.bootstrapEcdsaSession` | Capability → router bootstrap | H ECDSA bootstrap; do not change placement/material semantics during this cleanup. |
| `tempo.reportBroadcastAccepted`, `reportBroadcastRejected`, `reportFinalized`, `reportDroppedOrReplaced`, `reconcileNonceLane`; same members on both `.advanced` objects | Capability → corresponding `PM_REPORT_TEMPO_*` / reconcile messages | H nonce lifecycle; C handles broadcast outcome/reporting. These are also the members of `EvmFamilyAdvancedCapability`. |
| `tempo.getFeeTokenPreference`, `validateFeeToken`, `setFeeTokenPreference` | `operations/tempo/feeTokenPreference.ts` | C public RPC reads and transaction construction; writes use the existing signing/execution capability. |
| `recovery.syncAccount` | `operations/recovery/accountSync.ts` → router sync | H `host/handlers/recovery.ts`; remove local execution dependency after host split. |
| `recovery.getWalletRecoveryCodeStatus`, `acknowledgeWalletRecoveryCodeBackup`, `requestWalletCustodyEmailOtpChallenge`, `rotateWalletRecoveryCodes` | Domain → matching router requests | H recovery/status/backup handlers; preserve fresh authorization and replay. |
| `devices.startDevice2LinkingFlow`, `scanAndLinkDevice`, `cancelDeviceLinking` | `publicApi/devices.ts` and device domains → start/scan/cancel transport | H device execution; preserve source/target factor-action callbacks and cancellation. |
| `devices.listLinkedDevices`, `revokeLinkedDevice` | `createWalletIframeLinkedDeviceManagementPortV1` → router | H device management with current authority checks. |
| `keys.resolveExactKeyExportLane`, `exportKeypairWithUI` | `publicApi/keyExport.ts` → domain/router | H export lane and UI; preserve operation-scoped authorization. |
| `keys.exportKeypair` | C resolves subject, lane, then invokes export UI | H secret/viewer execution; C returns completion/relink outcome. Method name does not imply returning private key bytes. |
| `preferences.setCurrentWallet`, `getCurrentWalletId`, `onCurrentWalletChange` | `publicApi/preferences.ts` → preference manager | L selected-wallet mirror; never an authentication source. |
| `preferences.setConfirmBehavior`, `setConfirmationConfig`, `getConfirmationConfig`, `onConfirmationConfigChange` | Local optimistic mirror, serialized router writes, host preference events | L/C projection of H confirmation preferences; keep synchronous return semantics until a deliberate API change. |

### Public class methods and fields

| Members | Current ownership and action needed before extraction |
| --- | --- |
| `configs`, `theme`, `auth`, `registration`, `near`, `evm`, `tempo`, `recovery`, `devices`, `keys`, `preferences` | Public configuration/state and capabilities listed above. Configuration normalization must keep supported options and precedence. |
| `initWalletIframe`, `getWalletIframeExactSessionState`, `lockWalletIframeExactSession`, `isWalletIframeReady`, `onWalletIframeReady`, `onWalletIframeLoginStatusChanged`, `onWalletIframePreferencesChanged` | C coordinator/router; preserve exact-session identity and connection lifecycle. |
| `onSdkLifecycleEvent` | C subscriptions currently select host or iframe event source; keep one source per realm and avoid stale events after reconnect. |
| `openHostedAuthMenu`, `cancelHostedAuthMenu`, `onHostedAuthMenuExternalAuthRequest`, `onHostedAuthMenuDemoEmailOtpDelivery`, `resolveHostedAuthMenuExternalAuth` | C menu transport and application callbacks; H auth inputs, continuations, and credential redemption. |
| `setTheme`, `setAppearance` | L appearance plus H propagation; changing appearance must preserve signing state. |
| `chainTarget`, `configuredChainTargets` | L pure configuration/selector helpers; keep lightweight. |
| `prewarm`, `prefetchBlockheight`, `prefillRestoredWalletSession` | Mixed C/H preparation today; move host work to an explicit lifecycle trigger, retaining intended client calls. Worker details below. |
| `getContext` | Exposes signing engine and NearClient. `react/hooks/useAccountInput.ts` uses the NearClient; host/domain callers use broader context. Give each caller its narrow dependency before removing the exposure. |
| `setWalletIframeSurfaceMeasurementBinding`, `signTempoFeeTokenPreferenceInternal` | Host/internal execution helpers exposed on the class; migrate their call sites to host composition. |
| `dispose` | Currently disposes device domain, coordinator, and signing engine. Split cleanup by owning realm; preserve pending-request cancellation and worker lifetime. |

### Consumers, contracts, and unresolved specification work

- React: `react/context/` constructs the singleton, mirrors login/preferences,
  manages lifecycle and SDK-flow hooks; `react/hooks/useWallet.ts` binds the
  rendered wallet to operations. `useAccountInput` additionally reads recent
  unlocks, credentials, and NEAR RPC. `useNearClient` remains a public RPC adapter.
- Application transaction review: `react/transactionReview/` and
  `publicApi/transactionReview.ts` reserve/bind operations before host admission.
- Wallet examples: `examples/{seams-auth-menu,wallet-console-lite}/` and
  `tests/intended-app/`. Private consumers: `seams-monorepo/apps/{wallet-console,seams-site}/`
  providers, frontend config, demo hooks, settings, and its `tests/intended-app/`.
- Host handlers: `walletIframe/host/handlers/` consume shared context. Every
  handler must stop importing/constructing the application facade at cutover.
- Package entry audit: root, `external-evm`, `advanced`, `threshold`, `runtime`,
  `react`, `react/profile`, `react/hosted-seams-auth-menu`, `react/provider`,
  `react/external-evm`, `react/styles`, and `web/wallet-iframe-client-html`.
  Retain supported narrow exports; type-only exports add no JS bytes.
- Contracts: `tests/e2e/intended-behaviours/` owns real registration, auth, restore,
  recovery, and linking; `tests/wallet-iframe/` owns router/host behavior;
  `tests/wallet-ui/transaction-review.browser.test.ts` owns review interaction;
  `tests/typecheck/` owns changed domain-state constraints. Stub-host tests do not
  establish production download or cryptographic behavior.

No missing whole operation family was demonstrated by this source audit. That
does not prove complete semantic equivalence. The October 4
[accepted API and lifecycle decisions](refactor-170.md#accepted-api-and-lifecycle-decisions)
specify SDK-owned account queries with internal RPC handling, synchronous
preference projection with rollback/flush,
separate configuration, startup ownership, reconnect behavior, and conditional
protocol revisions. These are implementation decisions, not completed verification.
Before extraction, finish the member/custom-RPC/config audits, multi-step callback
transport review, snapshot-ordering proof, browser/RP evidence, and matching
client/host version decision. No new protocol messages were introduced by this
inventory work.

## Configuration boundary audit

Source chain: `core/config/defineConfig.ts` → `configBuilder.ts` →
`SeamsWeb/assembly/createWalletIframeRouter.ts` →
`walletIframe/client/router.ts:connectAndConfigure` →
`host/context.ts:applyWalletConfig` → host constructor normalization.
`PMSetConfigPayload` currently extends `Partial<SeamsConfigsInput>`; that broad
type does not prove every input field survives the round trip.

This table covers every top-level `SeamsConfigsInput` field, including nested
transport settings. “Reset” means the current host fingerprint disposes the
runtime when the effective field changes; it is evidence of current behavior,
not permission to delete persisted presignatures.

| Input | Normalization and current transport | Target owner / update semantics |
| --- | --- | --- |
| `chains` | `resolveChains` resolves configured RPC/explorer/network values; router forwards normalized chains; host clones incoming array or retains previous array. | Client public RPC/selection and host signing config; reset. Preserve chain order and primary NEAR RPC selection. |
| `relayerAccount` | Trimmed nonempty override, then default; sent separately from relayer object; host uses incoming, previous, then empty string. | Client display/public calls and host registration; reset. Preserve existing discovery separately from normalization. |
| `relayer.url` | Trimmed override/default, required nonempty; forwarded and shallow-merged at host. | Both client relaying and host execution; reset. |
| `relayer.delegateActionRoute` | Normalizes to `network.relayer.routes.delegateAction`. Assembly passes the normalized relayer object where the router expects the input shape. Host re-normalization reads `delegateActionRoute`, so the override is lost there. | Client relay helper retains the configured route. Explicitly serialize the input field for any host consumer; do not forward mismatched resolved/input objects. |
| `registration` | Managed mode; publishable key required when registration config is explicitly supplied; optional environment cross-check, payment mode and NEAR provisioning normalized. Router forwards resolved object; host replaces the whole registration config when present. | Host ceremony/bootstrap; public client retains browser-safe registration config. Reset. Preserve signing-only construction without registration credentials. |
| `signingSessionDefaults` | Per-field override/default for TTL and use budget; forwarded; host replaces the defaults object when supplied. | Host authority inputs, with existing per-operation overrides; reset. Do not reinterpret projection values as grants. |
| `signingSessionPersistenceMode` | Validates `none` or `sealed_refresh_v1`; derives seal algorithm/group locally. Forwarded and retained when omitted. | Host persistence; reset. Keep existing storage names and schemas. |
| `emailOtpAuthPolicy` | Validates `session` or `per_operation` into `signing.emailOtp.authPolicy`. **Omitted** by router options, PM_SET_CONFIG construction, host config assembly, and reset fingerprint. | Host factor/signing policy. Carry the resolved policy explicitly at cutover and include it in effective execution-config identity. Add a real per-operation Email OTP contract before calling preservation verified. |
| `routerAb` | Validates enabled/disabled normal-signing branch and required worker id; forwarded; host replaces when supplied. | Host signing policy; reset. Preserve the discriminated branch. |
| `routerAbEcdsaDerivationPresignaturePool` | Validates enabled, depth, low-watermark, concurrency, timeout against existing bounds; forwarded; host replaces when supplied. | Host background refill policy; reset. Neither config reconstruction nor cosmetic updates authorize durable-pool deletion. |
| `provisioningDefaults` | Copies the configured/default EVM and Tempo policies; forwarded; host replaces when supplied. | Host registration/signing setup, with existing per-call signer overrides; reset. |
| `authenticatorOptions` | Whole input object or defaults; assembly clones the supported options; forwarded and retained when omitted. | Required parent WebAuthn adapter and host ceremonies; reset. Preserve RP/origin and activation contracts. |
| `iframeWallet.walletOrigin` | Required nonempty for public construction; used for iframe transport/origin checks. Host sanitizer forces empty to admit the current direct branch. | Client-only required origin. Delete host empty-string/mode workaround when separate construction lands. |
| `iframeWallet.walletServicePath` | Trimmed nonempty override/default, then `/wallet-service`; used by router transport. | Client-only endpoint. Host needs no nested service path. |
| `iframeWallet.sdkBasePath` | Trimmed nonempty override/default, then `/sdk`; router resolves it against wallet origin and sends `assetsBaseUrl`. Host accepts same-origin URL only, otherwise `/sdk/`. | Client URL construction and host asset resolution. Asset-base changes currently preserve warm execution state. Verify worker URL changes and disposal separately. |
| `iframeWallet.walletHostVariant` | Normalized into resolved config; the application assembly does not pass it to router options. | Audit documented host-entry selection and actual consumers before retaining or deleting this option; do not claim transport coverage. |
| `iframeWallet.rpIdOverride` | Input/default value; router sends it inside `iframeWallet`; host merges it before sanitizing nested origin/path. | Both supported credential adapters and host RP identity; reset. Must remain independent of service/asset URL choices. |
| `appearance` | Theme/palette normalized in client; current appearance sent on connection. Host merges same-theme colors/shape and replaces them on theme-id change; absent update preserves previous appearance. | Client and host display only; no execution reset. Host updates CSS and existing runtime appearance. |

Two demonstrated round-trip gaps are the Email OTP policy omission and relayer
route shape mismatch. These are configuration preservation work for the cutover;
the source audit does not establish their end-to-end behavioral impact yet.
`walletHostVariant` also needs a supported-consumer decision. Do not fix these by
adding another default or a compatibility branch. Use explicit boundary mapping
and update the paired protocol/version if the resulting semantics require it.

The host currently normalizes a second time against its own defaults. Separate
client/host config must preserve the effective application settings rather than
silently substituting host-release defaults. Cosmetic updates must continue to
preserve the execution instance; changed execution settings must dispose its
volatile resources and fence pending work. The new required host-config branch,
paired protocol decision, and browser verification are still pending.

## Worker and WASM inventory

Paths below are relative to
`packages/wallet/src/core/signingEngine/workerManager/workers/` unless specified.
Creating a worker loads its JavaScript; importing a wasm-bindgen JS wrapper does
not alone establish that the binary was fetched. Startup versus request-time
initialization is recorded separately.

| Worker / owner | WASM and execution dependency | Current trigger |
| --- | --- | --- |
| `near-signer.worker.ts` | `wasm_signer_worker_bg.wasm` | Startup initializes WASM before best-effort READY; operations also await initialization. |
| `evm-crypto.worker.ts` | `evm_crypto.wasm`; secp256k1/transaction and WebAuthn P256 helpers | Startup initializes WASM before best-effort READY; operations await it again. Filename alone does not imply every use is an EVM transaction. |
| `tempo-signer.worker.ts` | `tempo_signer.wasm` | Startup initialization and operation guard. |
| `ecdsa-derivation-client.worker.ts` | `router_ab_ecdsa_client_bg.wasm`; material/registration/export and opaque presign authority | Startup initialization and explicit preparation requests; connected presign/online operations depend on this authority or a linked holder. |
| `ecdsa-presign-client.worker.ts` | No directly loaded WASM binary in this worker; routes opaque authority requests through MessagePorts | Immediate READY, authority/pool setup on requests. Separate JS does not mean independent crypto state. |
| `ecdsa-online-client.worker.ts` | No directly loaded WASM binary; coordinates via presign worker | Immediate READY; request-time channel use. |
| `email-otp.worker.ts` → `email-otp/{dispatch,crypto}.ts` | Request-dependent Email OTP runtime, EVM crypto, custody ceremony, Ed25519 Yao client, and Shamir seal runtime | READY reports thread startup. Explicit Yao prewarm and operations initialize required runtimes. |
| `wallet-custody-ceremony.worker.ts` | `wallet_custody_ceremony_bg.wasm`; selected handlers also initialize NEAR signer or Ed25519 Yao WASM | `handleRequest` awaits custody initialization; additional modules initialize within their operations. Custody crate links both protocol families. |
| `passkey-confirm.worker.ts` | Confirmation messaging/UI; no direct WASM loader | Owned by confirmation infrastructure outside the generic signer-worker list. Do not count it as a curve-specific signer. |
| `passkey-mpc-session.worker.ts` | Shamir runtime via `shamir3pass/runtime.ts`, which manages a separate worker | Explicit prewarm and session/seal operations. |
| `passkey-mpc-export.worker.ts` → `passkeyMpcExportRuntime.ts` | Ed25519 Yao client initialization during selected export work; confirmation | Request-time export work; requires fresh export-scoped authorization. |
| `shamir3pass.worker.ts` | `shamir3pass_runtime_bg.wasm` | Thread-ready notification and request-time WASM initialization/warmup. |
| `device-linking-key.worker.ts` | `router_ab_ed25519_yao_client_bg.wasm` for lane-recipient operations | Request-time initialization with a cached promise; managed outside the generic signer-worker list. |

### Loading triggers to change later

| Trigger | Existing path | Consequence / intended boundary |
| --- | --- | --- |
| Host first runtime construction | `SeamsWeb/walletIframe/host/context.ts` → `SeamsWeb.prewarm({ workers: true })` | Broad host preparation; replace only during runtime work. |
| Generic signer warmup | `assembly/warmup.ts` → `SignerWorkerManager.prewarmWorkers()` → `workerTransport.ts` | Creates all eight registered kinds: NEAR, ECDSA derivation/presign/online, EVM, Tempo, Email OTP, custody. Awaits four WASM-ready workers. |
| Application iframe-mode warmup policy | `SeamsWeb/assembly/browserWorkerWarmupPolicy.ts` | Disables local worker warmup in the application realm; host same-origin policy enables it. |
| Registration surface preparation | `host/runtimeLoader.ts` → `registrationPreparationPreload.ts` | Imports NEAR preparation and ECDSA/Tempo signing engines. JS reachability must be measured separately from WASM fetches. |
| ECDSA registration preparation | `prewarmEcdsaRegistrationCrypto` → derivation-worker request | Initializes crypto while awaiting authentication; must follow selected ceremony. |
| Email OTP Yao preparation | `prewarmEmailOtpYao` → Email OTP worker dispatch | Can initialize Ed25519 Yao explicitly; keep factor/operation selection. |
| Restored-session prefill and startup replay | `host/restoredSessionPresignaturePrefill.ts`, `SeamsWeb` startup replay, device acknowledgement domains | Existing authorized/resumable work may justify loading after page startup; active R152/R153 ownership. |
| Confirmation/session/export manager startup | Confirmation and passkey MPC managers outside `WorkerTransport` | Must be included in browser evidence; changing only the eight-kind loop cannot prove zero unrelated workers. |

### Operation-to-dependency audit

| Operation | Required dependency family | What remains to verify in real-browser evidence |
| --- | --- | --- |
| Idle fresh host | Transport and UI; no operation-selected signing dependency | Separate unconditional warmup from pending persisted work. |
| NEAR passkey unlock/sign | Selected passkey session/seal and Ed25519/NEAR execution | Which workers own Yao material for that lane; remove unrelated EVM/Tempo warmup while preserving shared factor primitives. |
| EVM/Tempo unlock/sign | Selected factor, ECDSA holder/presign/online authority and transaction codec | Per-chain worker set, shared auth helpers, first-sign prefill, and warm reuse. |
| Email OTP unlock/sign | Email OTP runtime plus selected lane's crypto and seal helpers | A NEAR flow may use a binary named EVM crypto for shared helper functions; do not forbid URLs solely by filename. |
| Registration/recovery | Custody ceremony plus selected signer-set dependencies | Both protocol families are linked into the shared ceremony binary; separate optional worker downloads from necessary shared binary code. |
| Key export | Selected lane, fresh factor authorization, export worker/viewer, Yao or ECDSA export dependencies | No ordinary warm-signing authority substitution; observe per-lane loads. |
| Device linking | Source contribution, recipient worker, selected target factor, activation/seal dependencies | Both browser contexts and acknowledgement retry; placement/material changes belong to R152/R153. |

These rows are source-based dependency families, not final network allowlists.
Use the real production host to establish exact sets before enforcing absence of
individual assets. In particular, worker naming and configured chain lists are
insufficient to decide whether shared crypto is required.

### Alias and caching accounting

The measured existing output contains byte-identical pairs for
`evm_crypto.wasm` / `evm_crypto_bg.wasm`, `tempo_signer.wasm` /
`tempo_signer_bg.wasm`, and `near_signer.wasm` / `wasm_signer_worker_bg.wasm`.
The host report now identifies these by content hash. Its selected inventory
includes both NEAR names but does not include every alias in its sum. Several
workers can also initialize the same WASM URL in separate execution contexts;
network cache reuse and compilation/instantiation cost are separate measurements.
No binary or alias should be deleted without auditing all emitted URL consumers.
