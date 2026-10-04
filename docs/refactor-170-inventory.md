# Wallet client and worker inventory

Audited October 4, 2026. Companion to [the refactor plan](refactor-170.md).
This records current implementation and proposed ownership. It changes no
runtime behavior. Follow **R152 → R170/R171 → R153 → slim R154**.
Use completed R152 fixed-home behavior while extracting client/host ownership
and final public APIs. Refresh this inventory against the current implementation
before moving each member. Future relocation fences, invalidation, and settings
belong to R153 and do not block the R170/R171 cutover.

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

### Complete static-body counters and cache baseline

October 5 follow-up: the production preview servers now count static response
body writes after compression. Both real-browser scenarios pass, and all 485
wallet-origin response records across them match the retained asset files' raw
or gzip-level-6 sizes, including zero-body 304 responses. This closes the missing
worker-script **encoded body** measurements. HTTP/TLS framing remains separate;
CDP/browser observations overlap these server counters and must not be summed.
The earlier browser `responseBodySize` values include HTTP/1 chunk framing for
gzip responses, explaining their small excess over the server body counts.

| Scenario | Application encoded bodies | Wallet encoded bodies | Worker scripts included in wallet total |
| --- | ---: | ---: | ---: |
| Register, NEAR/EVM sign, lock/unlock, repeat signs; cache disabled by harness | 1,669,002 B | 9,362,732 B | 25 responses, 442,628 B |
| Fresh signed-out mount/idle/menu | 834,505 B | 2,563,734 B | 11 responses, 187,841 B |
| Same-profile signed-out revisit/menu | 0 B; 50 revalidations | 0 B; 118 revalidations | 11 revalidations; workers still instantiated |

Both signed-out menu phases add no requests after mount; broad startup already
fetched the dependencies. Each mount creates 11 workers. The two-second idle/menu
observation windows are intentional measurement windows and are included in phase
durations. The retained signed-out trace contains no credential operation.

Latest per-scenario reports survive isolated-run output cleanup under
`.artifacts/wallet-assets/`; the immutable baseline copies and safe trace are
under `.artifacts/r170-baseline/`. The production receipt records hashes, phases,
file-size cross-check counts, and scenario inputs. The intended app now includes
an explicit generic-menu button; compare this same app against the post-refactor
package. The auth scenario keeps traces/screenshots/video disabled.

Before/after latency acceptance: run each compared scenario three times with the
same local services, CPU/network settings, compression, observer, and cache policy.
For register, unlock, first NEAR/EVM sign and repeat signs, the post-change median
may exceed the paired baseline median by at most `max(100 ms, 20%)`. Apply the
same limit to mount/menu after subtracting their fixed two-second observation
windows. This allows local scheduling variation without accepting a large
first-operation delay. Any excess requires investigation and an explicit plan
deviation; a transfer saving alone does not satisfy this gate. Latest observed
registration/unlock were 1,950/704 ms; first NEAR/EVM signs 721/788 ms; repeat signs
698/752 ms. These single-run values are reference observations, not medians.

Remaining evidence: authenticated warm HTTP-cache behavior, decoded worker bodies
and complete execution-target attribution, the signer/factor scenario matrix,
and paired repeated latency acceptance. The full baseline gate remains open
until those scoped requirements have their evidence; static transfer accounting
and cold/warm signed-out coverage no longer depend on worker CDP completion events.

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

Freshness is diagnostic while R170/R171 modify shared build inputs.
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
| `auth.unlock`, `lock`, `logout` | `walletIframe/client/sessionCommands.ts` → router equivalents | H: `host/handlers/auth.ts`; retain exact session, progress, error, and logout cleanup semantics. |
| `auth.getWalletSession`, `getRecentUnlocks`, `hasPasskeyCredential` | `walletIframe/client/sessionCommands.ts` → router queries; session read can also prefetch blockheight | H auth queries; preserve authentication versus app-identity distinction. Recent-unlock fallback behavior needs explicit review before removing local paths. |
| `auth.prefillRouterAbEcdsaDerivationPresignaturePool` | `walletIframe/client/sessionCommands.ts` → router prefill | H: session/presignature preparation with current R152 checks. R153 adds relocation fencing later. |
| `auth.requestEmailOtpChallenge`, `requestEmailOtpSigningSessionChallenge`, `refreshEmailOtpSigningSession` | `SeamsWeb` domain methods → matching router requests | H: `host/handlers/emailOtp.ts`; challenge purpose and session scope remain distinct. |
| `auth.loginWithEmailOtpEcdsaCapability`, `unlockAddedEmailOtpWallet` | Domain → login/unlock-added router methods | H: Email OTP handler and selected factor activation. |
| `auth.beginGoogleEmailOtpWalletAuth` | Domain → router flow proxy | C proxy for H flow, including resend/reroll/submit/complete/cancel; callbacks and terminal results remain correlated to the flow. |
| `registration.registerWallet`, `registerWithEmailOtp`, `registerPasskey` | `createPublicApi.ts` delegates to `client/registrationCommands.ts`; passkey builds registration input | H registration via `PM_REGISTER_WALLET`; preserve selected auth method and signer set. `registerWithEmailOtp` currently aliases `registerWallet`. |
| `registration.addWalletSigner`, `addPasskey`, `addEmailOtp`, `revokeAuthMethod` | `client/registrationCommands.ts` → matching router messages | H registration/auth-method handlers; preserve exact authorization and effect/retry semantics. |
| `registration.requestEmailOtpEnrollmentChallenge`, `enrollEmailOtp` | Domain → enrollment router requests | H Email OTP enrollment. |
| `registration.resumePendingEcdsaRegistration`, `getNearProvisioningState` | `client/registrationCommands.ts` → resume/provisioning router requests | H registration state/replay. Preserve the completed R152 ownership contract. |
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

## Snapshot ordering and protocol decision

The existing messages do not prove the accepted bootstrap contract:

- `coordinator.ts:init` saves `exactState`, awaits `getConfirmationConfig`, then
  associates the response with the saved wallet. A selected-wallet event can
  arrive during that await. `PM_GET_CONFIRMATION_CONFIG` returns only the config,
  so the client cannot establish which wallet the snapshot describes.
- `host/runtimeContext.ts:ensureHostSeamsWeb` emits full preference values with
  `walletId` and `updatedAt: Date.now()`. Millisecond timestamps can collide and
  the preference query returns no corresponding revision. They cannot order
  bootstrap snapshots against events.
- `client/router.ts:refreshExactSessionState` awaits an asynchronous host read,
  then directly overwrites the session/review mirror. Preference changes launch
  further exact reads through `handlePreferencesChanged`; their completion order
  can differ from request order. A connection id fences port messages, but does
  not establish freshness between reads within one connection.
- The host exact-session read reconciles persisted authority and calls remote
  session status before returning. Port FIFO alone cannot order those async
  state captures against a concurrent lock, unlock, expiry, or wallet selection.

Decision: the cutover will use **protocol 3.0.0**, updating the existing protocol
constant, asset manifest, paired endpoints, skew tests, and release instructions
in the same change. Current implementation remains 2.0.0 until that paired change
lands. Mandatory wallet-bound/versioned snapshots, preference acknowledgement
semantics, and the retired logout command must not be silently deployed under
the old handshake. No old-host fallback or dual protocol is introduced.

Use host-issued monotonic revisions for the existing preference and session
projection streams, scoped to the live host connection. Preference snapshots and
full-state events carry the same wallet identity and revision. Preserve local
pending patches over confirmed state; an older snapshot cannot overwrite a newer
event. Retain exact wallet/session bindings and client connection generations.

For session reads, record the host state revision before asynchronous work and
check it again before publishing. A concurrent authority/selection change makes
that capture stale; reconcile the current state again instead of assigning a new
revision to an old result. Enumerate revision-changing host transitions during
implementation: selection, successful activation, lock, expiry, revocation,
restore, and execution-config replacement. A client read started for a previous
selection must never change the current selection. Connection restart invalidates
all prior revisions and results. Do not use display diagnostics as the source of
these transitions.

The existing exact-session/lifecycle types remain the domain values. Add the
small revision envelope at their shared message boundary; do not create a second
authorization model. Cover event-during-bootstrap, out-of-order exact reads,
wallet switch during a read/write, reconnect, and disposal in browser E2E.
A complete source-to-transition audit and those behavioral checks are required
before declaring the ordering gate verified.

## WebAuthn ownership after R152

The former parent bridge is absent from the current source. Commit `f312be27`
deleted `client/transport/webauthn-bridge.ts` and the parent fallback, updated
`docs/intended-behaviours.md`, and moved linked-device credential execution to
the wallet origin. The earlier plan's bridge-preservation finding is superseded
by this integrated behavior; it is not a remaining extraction task.

| Path | Current owner and invariant | Verification scope |
| --- | --- | --- |
| Hosted auth menu registration/unlock | `host/auth-menu/{session,passkey}.ts`; credential call starts from wallet-origin CTA activation. | Existing intended passkey registration/unlock contracts; production baseline already exercises Chromium on distinct application/wallet origins. |
| Credential execution and unavailable contexts | `core/signingEngine/webauthnAuth/walletOriginWebAuthn.ts`; single credential attempt, abort signal preserved, explicit wallet-origin-unavailable error for create ancestor/focus failures. | Keep current intended behavior; do not reintroduce parent retries. Real Safari/browser support requires its own existing browser evidence. |
| Device-link target activation | `core/signingEngine/walletCustody/passkeyLink.ts` and browser platform adapter; wallet-origin registration after target activation. | Existing device-link intended contracts with source/target contexts and post-link signing. |
| RP selection | Coordinator uses explicit `rpIdOverride`, otherwise wallet origin hostname; host credential paths consume resolved RP. | Preserve configured RP and browser domain/ROR checks. Test override separately from default-origin flow. |
| Parent iframe permissions | `client/transport/iframe-transport-dom.ts` delegates create/get to wallet origin. | Preserve allow attributes and transport origin checks during extraction. No credentials or PRF output are returned through a parent WebAuthn bridge. |
| Explicit runtime browser adapter | `core/platform/browser/createBrowserPlatformRuntime.ts` executes credentials through its own runtime port. | Keep explicit runtime support; the application iframe-client graph must exclude this execution implementation. |

This is an ownership audit, not a new cross-browser support claim. The
registration asset scenario's Chromium evidence does not close the device-link,
RP-override, cancellation, or Safari verification gates.

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
| `relayer.delegateActionRoute` | Normalizes to `network.relayer.routes.delegateAction`. Assembly now maps the resolved route back to the explicit `delegateActionRoute` wire field. The browser round trip preserves the override. | Client relay helper retains the configured route. Explicitly serialize the input field for any host consumer; do not forward mismatched resolved/input objects. |
| `registration` | Managed mode; publishable key required when registration config is explicitly supplied; optional environment cross-check, payment mode and NEAR provisioning normalized. Router forwards resolved object; host replaces the whole registration config when present. | Host ceremony/bootstrap; public client retains browser-safe registration config. Reset. Preserve signing-only construction without registration credentials. |
| `signingSessionDefaults` | Per-field override/default for TTL and use budget; forwarded; host replaces the defaults object when supplied. | Host authority inputs, with existing per-operation overrides; reset. Do not reinterpret projection values as grants. |
| `signingSessionPersistenceMode` | Validates `none` or `sealed_refresh_v1`; derives seal algorithm/group locally. Forwarded and retained when omitted. | Host persistence; reset. Keep existing storage names and schemas. |
| `emailOtpAuthPolicy` | Validates `session` or `per_operation` into `signing.emailOtp.authPolicy`. Now forwarded by router options, PM_SET_CONFIG, and host config assembly; included in the execution reset fingerprint. | Host factor/signing policy. Carry the resolved policy explicitly at cutover and include it in effective execution-config identity. Add a real per-operation Email OTP contract before calling preservation verified. |
| `routerAb` | Validates enabled/disabled normal-signing branch and required worker id; forwarded; host replaces when supplied. | Host signing policy; reset. Preserve the discriminated branch. |
| `routerAbEcdsaDerivationPresignaturePool` | Validates enabled, depth, low-watermark, concurrency, timeout against existing bounds; forwarded; host replaces when supplied. | Host background refill policy; reset. Neither config reconstruction nor cosmetic updates authorize durable-pool deletion. |
| `provisioningDefaults` | Copies the configured/default EVM and Tempo policies; forwarded; host replaces when supplied. | Host registration/signing setup, with existing per-call signer overrides; reset. |
| `authenticatorOptions` | Whole input object or defaults; assembly clones the supported options; forwarded and retained when omitted. | Host ceremonies and wallet-origin browser adapter; reset. Preserve RP/origin and activation contracts. |
| `iframeWallet.walletOrigin` | Required nonempty for public construction; used for iframe transport/origin checks. Host sanitizer forces empty to admit the current direct branch. | Client-only required origin. Delete host empty-string/mode workaround when separate construction lands. |
| `iframeWallet.walletServicePath` | Trimmed nonempty override/default, then `/wallet-service`; used by router transport. | Client-only endpoint. Host needs no nested service path. |
| `iframeWallet.sdkBasePath` | Trimmed nonempty override/default, then `/sdk`; router resolves it against wallet origin and sends `assetsBaseUrl`. Host accepts same-origin URL only, otherwise `/sdk/`. | Client URL construction and host asset resolution. Asset-base changes currently preserve warm execution state. Verify worker URL changes and disposal separately. |
| `iframeWallet.walletHostVariant` | Normalized into resolved config; the application assembly does not pass it to router options. | Audit documented host-entry selection and actual consumers before retaining or deleting this option; do not claim transport coverage. |
| `iframeWallet.rpIdOverride` | Input/default value; router sends it inside `iframeWallet`; host merges it before sanitizing nested origin/path. | Both supported credential adapters and host RP identity; reset. Must remain independent of service/asset URL choices. |
| `appearance` | Theme/palette normalized in client; current appearance sent on connection. Host merges same-theme colors/shape and replaces them on theme-id change; absent update preserves previous appearance. | Client and host display only; no execution reset. Host updates CSS and existing runtime appearance. |

The Email OTP policy omission and relayer route shape mismatch are fixed. A browser
probe exercises the real client router, cross-origin iframe transport, host config
application, and normalization. Both values survive an appearance-only update.
This proves configuration forwarding; real per-operation authentication/signing and
active-session replacement behavior remain acceptance work. Evidence is recorded in
`evidence/refactor-170-config-forwarding-20261005.json`.
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

### Worker-loading implementation checkpoint

October 5: the host no longer calls generic `prewarm` when constructing its
runtime. The all-eight-worker loop, unused readiness promises, and corresponding
warmup API/diagnostic fields are deleted. Generic explicit prewarm no longer
starts ECDSA registration crypto without a selected operation. Registration's
existing signer-selection guard still starts ECDSA preparation when required;
Email OTP Yao preparation remains factor/operation-selected. Worker operation
handlers retain their own WASM initialization checks.

Fresh production build, Wallet and intended/state type checks, bloat check, and
both production-browser scenarios pass. The mount/menu scenario now asserts no
crypto workers, permitting the separate confirmation UI worker if needed. The
observed run created **zero workers** in both cold and warm signed-out phases.
Evidence and build hashes are in the
[worker-startup receipt](evidence/refactor-170-worker-startup-20261005.json).

| Encoded static bodies, same scenario | Before | After |
| --- | ---: | ---: |
| Cold signed-out app + wallet mount/menu | 3,398,239 B | 1,645,101 B |
| Signed-out WASM | 1,560,164 B | 0 B |
| Register/sign/lock/unlock/repeat app + wallet | 11,031,734 B | 9,917,593 B |
| Same completed scenario WASM | 7,283,249 B | 6,194,505 B |

The auth/sign run creates 20 workers across its phases, versus 25 before. Latest
register/unlock durations are 1,920/709 ms; first NEAR/EVM signs 710/783 ms; repeat
signs 712/767 ms. These remain single-run observations; the paired three-run
median gate is open. Root consumer static gzip is still 739,365 B, so this is
worker-startup progress and does not satisfy the client-size/composition goal.

Still required: per-signer/factor network allowlists, recovery/export/device-link
flows, authenticated warm-cache evidence, initialization-failure recovery, and
cancellation/worker reuse. The EVM/Tempo rejected-initialization promise is now
cleared on failure. A real-browser emitted-asset test makes WASM unavailable,
observes an explicit operation failure despite thread readiness, restores delivery,
and verifies concurrent successful operations and a later operation on the same
worker with one successful WASM fetch. The Tempo output matches the existing Rust
vector. Run `pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts
wallet-iframe/static-wallet-assets.browser.test.ts --project=chromium
--output=../.artifacts/r170-worker-retry`; the retry scenario produces
`worker-wasm-retry.json`. Production build, Wallet/test type checks, both static
asset browser scenarios and bloat checks pass. This closes the demonstrated
EVM/Tempo failure-cache gap; the full operation/dependency matrix remains open.
Generic UI preparation still imports
EVM-family JS and needs the measured host feature-loading audit. Durable
presignature storage and lock invalidation behavior are unchanged in this patch.

### Loading triggers and current disposition

| Trigger | Existing path | Consequence / intended boundary |
| --- | --- | --- |
| Host first runtime construction | `SeamsWeb/walletIframe/host/context.ts` | Generic prewarm call removed; fresh signed-out construction creates no workers in production E2E. |
| Generic signer warmup | Former `prewarmWorkers()` path through warmup assembly/manager/transport | Deleted, including its readiness waits and unused timing field. Requests initialize selected workers through `getOrCreateWorker`. |
| Host UI preparation predicate | `walletIframe/host/WalletHostRuntime.ts:shouldPrewarmBrowserUi` | The application owns no signing surface. The host supplies a same-origin browser predicate directly; the disabled app policy and its module are deleted. |
| Registration surface preparation | `host/runtimeLoader.ts` → `registrationPreparationPreload.ts` | Imports NEAR preparation and ECDSA/Tempo signing engines. JS reachability must be measured separately from WASM fetches. |
| ECDSA registration preparation | `prewarmEcdsaRegistrationCrypto` → derivation-worker request | Initializes crypto while awaiting authentication; must follow selected ceremony. |
| Email OTP Yao preparation | `prewarmEmailOtpYao` → Email OTP worker dispatch | Can initialize Ed25519 Yao explicitly; keep factor/operation selection. |
| Restored-session prefill and startup replay | `host/restoredSessionPresignaturePrefill.ts`, `SeamsWeb` startup replay, device acknowledgement domains | Existing authorized/resumable work may justify loading after page startup. Preserve R152 fixed-home checks. R153 adds relocation handling later. |
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
| Device linking | Source contribution, recipient worker, selected target factor, activation/seal dependencies | Both browser contexts and acknowledgement retry. Preserve R152 placement/material semantics. R153 adds relocation later. |

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

### Host composition extraction checkpoint

The mixed facade now selects registration commands at construction:
`walletIframe/client/registrationCommands.ts` owns dispatch, application callbacks,
and the post-registration session refresh. `walletIframe/host/createRegistrationCommands.ts`
owns registration, signer/factor addition, revocation, provisioning reads, and
registration replay through the existing `RegistrationWebContext`. Neither command
factory imports or instantiates `SeamsWeb`. Their old mixed methods were removed.

The application command module's standalone esbuild input graph contains eight
modules: the command module, the registration diagnostics flag, shared normalization,
validation, errors and domain IDs, chain config, and chain-target identifiers.
It contains no worker, custody implementation, or IndexedDB modules. The local
bundle and metafile are retained under `.artifacts/r170-registration-split/`.
The diagnostics flag moved out of the custody driver so reading it cannot pull
custody execution into an application module.

`walletIframe/host/createDeviceDomain.ts` also owns host device composition.
The host now constructs `WalletHostRuntime` directly. The application facade
selects application commands only. Shared signer factories and the coordinator
still require a signing surface, so the public-client dependency gate remains
open. See the host composition checkpoint below.

Validation of the registration extraction: Wallet type checking, intended-test
and wallet-state type checking, the production build, and the bloat gate pass.
Nine production-browser contracts pass: the two asset scenarios, all four
single-signer-family factor-addition matrix cases, the passkey-to-Email-OTP
addition/revocation flow, and the Ed25519 and ECDSA add-signer contracts. The ECDSA
case includes a lost finalize response and NEAR/Tempo/Arc signing after unlock.
The first factor-addition attempt was an environment failure (expired Google
token); the repository's token-refresh command restored the configured credential
and the rerun passed. Retained result summaries are in
`.artifacts/r170-registration-split/verification.json`.

Reproduce the factor and signer cases with a fresh production build:

```sh
SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- e2e/intended-behaviours/auth-method-addition.matrix.contract.test.ts e2e/intended-behaviours/passkey.add-email-otp.contract.test.ts e2e/intended-behaviours/passkey.ed25519-yao-local.contract.test.ts --grep 'gains|a passkey wallet can add|public ECDSA add-signer|public Ed25519 Yao add-signer'
```

### Session command ownership

`walletIframe/client/sessionCommands.ts` owns application unlock callbacks,
acknowledged lock/logout dispatch, session/recent-unlock/passkey queries, and
explicit presignature preparation requests. Its standalone bundle input graph
contains only that module, the shared unlock-request builder, and shared error
normalization. The bundle/metafile are under `.artifacts/r170-session-split/`.

`walletIframe/host/createSessionCommands.ts` owns unlock-subject resolution,
local session operations, passkey-record queries, and presignature preparation.
It receives the existing wallet-auth context plus local resource warmup; it has
no coordinator dependency. Local post-unlock warmup retains its existing timing.
Restored-session preparation retains the shared `WalletSessionStatusReadScope`
across configured chain targets. The mixed `operations/auth/walletAuth.ts` module
and the mixed dependency builder were deleted; `createPublicApi` receives complete
auth commands instead of importing execution to construct them.

This extraction preserves current query/callback and cleanup behavior. The planned
`getSession`/`hasPasskey` naming, reconciled session subscription, removal of logout,
and reviewed recent-unlock failure semantics remain part of the protocol/API
cutover. The application facade now selects client commands only. It still
constructs signing infrastructure for shared signer factories, so its dependency
gate remains open.

Validation: production build, intended/state type checks, and the bloat gate pass.
Eight isolated production-browser cases pass: both asset scenarios and all six
`passkey.unlock.contract.test.ts` cases (cross-tab lock/restore races, immediate
export/shared-budget signing, refresh/step-up/export, cold sync, and interrupted
unlock retry). That file disables DOM/network/video capture for its export flows;
its existing sanitized status and race evidence remains enabled. Reproduce with:

```sh
SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.unlock.contract.test.ts e2e/intended-behaviours/passkey.registration.assets.contract.test.ts
```

### Email OTP command ownership

`walletIframe/client/emailOtpCommands.ts` owns Email OTP challenge/enrollment
transport, unlock and refresh dispatch, Google authentication dispatch, and
application progress callbacks. `walletIframe/host/createEmailOtpCommands.ts`
owns provider and authority resolution, custody restoration, enrollment,
authorization activation, and runtime postconditions. It receives the existing
host context and registration/session commands without constructing `SeamsWeb`.
Shared event and timing helpers live in `walletIframe/shared/emailOtpLifecycle.ts`.
The replaced mixed methods were removed from `SeamsWeb.ts`.

The standalone application command graph contains twelve pure modules and no
custody execution, worker orchestration, or IndexedDB implementation. Its bundle
and metafile are retained under `.artifacts/r170-email-split/`. Host composition
now owns the host factory. The public-client dependency gate remains open because
shared signer factories still retain execution dependencies.

Validation: production build, Wallet/intended/state type checks, and the bloat
gate pass. Six production-browser cases pass: the four Email OTP unlock contracts
and both factor-addition directions. These cover registration, signing across
NEAR/Tempo/Arc, refresh, export, interrupted export retry, delayed NEAR registration,
factor revocation, and unlock with an added factor.

The first factor run found an outdated test expectation. Selected-wallet Google
verification returns `wallet_identity_mismatch` after revocation removes the
wallet's enrollment. The test now checks the request's exact `wallet_id` and the
current refusal. It retains the checks that forbid OTP challenge and unlock
dispatch after refusal. Production behavior did not change for this correction.
Export scenarios disable raw trace, screenshot, and video capture.

The sanitized result receipt, source hashes, dependency graph, and reproduction
commands are in `.artifacts/r170-email-split/verification.json`. After a fresh
production build, reproduce the six cases with:

```sh
SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- e2e/intended-behaviours/email-otp.unlock.contract.test.ts e2e/intended-behaviours/email-otp.add-passkey.contract.test.ts e2e/intended-behaviours/passkey.add-email-otp.contract.test.ts
```

### Independent host composition

`walletIframe/host/WalletHostRuntime.ts` now constructs the wallet-origin runtime.
`host/context.ts` creates it directly. Handler dependencies, hosted authentication,
configuration resets, and lifecycle subscriptions use this host class. Host code
no longer imports or constructs the public `SeamsWeb` class.

`SeamsWeb.ts` now selects application registration, session, and Email OTP commands
only. Recovery and key-export methods dispatch through the iframe. Host startup
owns registration/recovery replay and linked-device acknowledgement replay. Host
methods own restored-session presignature preparation and fee-token preference
signing. The old constructor mode selector and application copies of these host
methods were removed.

`walletIframe/shared/facadeBoundary.ts` owns the existing shared input/result
normalization, appearance resolution, and provisioning-event filter. It contains
no execution composition. Each facade binds its callbacks to named methods.

NEAR, EVM, and Tempo factories now receive explicit commands from the application
or host constructor. Application commands own iframe requests and callbacks. Host
commands own signing, registration, nonce reporting, and persistence access.
Ordinary and reviewed calls use the same factories with explicit dispatch state.
The NEAR registration-input and delegate-relay modules no longer import execution.

A browser bundle graph of the three public signer factories and two application
command modules contains 41 inputs, with no IndexedDB, custody, or worker-manager
modules. The graph is `.artifacts/r170-signer-commands/commands-metafile.json`.
This proves the signer boundary only. Device linking, account sync, preferences,
and the coordinator still retain execution dependencies. Both constructors still
create signing infrastructure. Removing those dependencies remains necessary
for the full public-client dependency gate.

Consumer measurement after this change uses the same named exports, Bun production
minification, and per-file compression as the baseline. The build freshness check
passes. Root static JS measures 627,059 bytes gzip, compared with 739,640 bytes in
the recorded production baseline (15.2% lower). Root reachable JS measures 680,712
bytes gzip. The provider's static JS measures 634,037 bytes gzip. These are bundle
sizes, not browser traffic. The application remains above the 100,000-byte target.
The full report is `.artifacts/r170-host-composition/consumers.json`.

Validation: the production build, intended/state type checks, and bloat gate pass.
Eight production-browser cases pass: Email OTP lifecycle, fresh-browser Google
recovery, interrupted recovery with durable replay, linked-device signing and
revocation, both asset scenarios, immediate passkey unlock/export/signing, and
refresh with step-up/export. The test harness now observes the exact recovery
journal key through Chromium IndexedDB inspection. This replaces a development
`/@fs` import that failed against production hosting. Only journal identity
metadata leaves the browser. Recovery/export tests disable raw capture.

The checked-in receipt is
`docs/evidence/refactor-170-host-composition-20261005.json`. It records source
hashes, test results, measurement settings, and reproduction commands. Local
browser asset evidence and the signed-out trace are under
`.artifacts/r170-host-composition/`.

### Signer command verification

The signer extraction passed a fresh production build, Wallet and intended-app
type checks, domain-state type fixtures, and the bloat gate. Ten production
browser cases cover Email OTP registration/unlock, EVM signing while NEAR is
held, cross-tab lock/restore races, export, shared-budget signing, refresh,
empty-storage restoration, and interrupted-unlock retry. Six Chromium review
cases cover reserved approval, callbacks, cancellation, session replacement,
and disposal during signing. Sanitized results and source hashes are recorded
in `evidence/refactor-170-signer-commands-20261005.json`.

### Device linking and account-sync separation

Device linking now receives explicit commands. The application implementation
only dispatches iframe requests. The host owns QR flow state, owner cancellation,
authenticated linking ports, and acknowledgement replay. Shared management methods
retain the existing request/result parsers. The obsolete direct/iframe domain union
and its source-local type fixture were removed. Replacement fixtures in the tests
workspace require authenticated host ports and complete device commands.

Account sync now binds a transport implementation on the application and the existing
execution operation on the host. The mixed account-sync wrapper and forwarding-only
recovery factory were deleted. `createPublicApi` no longer accepts a signing engine
or constructs execution contexts.

A production browser bundle graph of `createPublicApi.ts` and application device
commands contains 77 inputs, with no IndexedDB, custody, or worker-manager modules.
The graph is `.artifacts/r170-device-commands/commands-metafile.json`. This covers
shared public API construction only. `SeamsWeb` still constructs signing stores,
a signing surface, and execution-owned preferences. Coordinator and preference
separation remain required before removing that construction.

Verification passed: production build, Wallet/intended/state type checks, and the
bloat gate. Four production cases cover recovery after lost finalization, second-
and third-device linking with signing/export/revocation, and empty-storage restore.
The restore case uses the hosted auth flow; separate acceptance of the public
`recovery.syncAccount` transport remains pending. Sanitized results and source hashes
are in `evidence/refactor-170-device-commands-20261005.json`.

### Application preference state separation

The application now constructs `ClientPreferenceState` for synchronous display
state. The coordinator consumes the narrow `PreferenceState` contract. The host
continues to bind its durable preference manager directly. Shared public API
construction accepts the completed preference capability and no longer selects
application versus host preference behavior.

Application preference writes now live in `walletIframe/client/preferences.ts`.
The existing ordered dispatch and captured wallet target remain intact. Background
rejections are handled. A bundle graph of the client preference modules contains
only those two modules and the existing confirmation defaults/types module.

This checkpoint does not complete preference synchronization. Confirmed state plus
pending patches, rollback, `flush()`, retained failure reporting, revision ordering,
and waiting before signing remain required. `SeamsWeb` still constructs a signing
runtime for other remaining dependencies.

The production build, Wallet/state type checks, and bloat gate passed. Five
preference browser cases and two production unlock/refresh lifecycle cases passed.
Source hashes and sanitized results are in
`evidence/refactor-170-preference-state-20261005.json`.

### Acknowledged client preference queue

Application preference state now separates confirmed values from pending patches.
Each queued write captures its wallet. Host events update confirmed values without
replacing pending patches or redirecting an explicit display-wallet selection.
Failed writes roll back their patch. Later writes continue.

`preferences.flush()` captures the current write set. It reports unobserved failures
and does not wait for later writes. Concurrent callers retain their own references
to the same results. NEAR and EVM-family commands wait for relevant earlier writes
before transport dispatch. Disposal rejects pending synchronization and stops local
events. Host setters apply their display state synchronously; host `flush()` has
no client queue to await and does not promise durable storage completion.

The new browser contract exercises A/B wallet switching, a host event during a
pending write, two concurrent flushes, a later successful write, rollback, a failed
write blocking NEAR signing, and disposal after dispatch. The first run used a
fixture with NEAR signing disabled. Classification: `valid_test_needs_update`.
Enabling the existing signing capability in the fixture let the intended admission
path execute. No production policy was weakened.

Remaining: protocol revisions for snapshot/event ordering, persistence acknowledgement
semantics if required by the host protocol audit, and removal of application signing
runtime construction. The full selective-loading and consumer acceptance gates remain
open. Queue behavior is normative in `intended-behaviours.md`.


### Application client cutover checkpoint

This checkpoint supersedes the earlier constructor-dependency and bundle-size
limitations above. `SeamsWeb` no longer constructs a signing engine, signing stores,
worker managers, or wallet execution runtime. Its coordinator owns client transport
and memory-only preferences. `WalletHostRuntime` configures wallet-origin IndexedDB
directly and has no client coordinator. The mixed-mode storage selector is deleted.

The root and narrow provider production dependency graph contains 214 resolved
inputs and no execution modules in the prohibited categories. The root static
closure is 66,386 bytes gzip, down from 739,640 bytes. Including lazy imports,
it is 93,551 bytes gzip. The provider static/reachable figures are 73,281/103,213
bytes gzip. React peers, CSS, WASM, and wallet-origin assets are counted separately.
These measurements do not establish complete scenario transfer or latency savings.

Integration changes in this checkpoint:

- `SeamsWeb.getContext()` is removed from the public declarations. Use
  `seams.near.accountExists(accountId)` for public NEAR account queries. This path
  preserves the injected `NearClient`; host execution remains internal.
- `SeamsWeb` uses the configured wallet iframe. Initialization without an iframe
  reports an explicit unavailable-configuration error. It cannot execute locally.
  Supported explicit runtime exports remain available and pass their boundary check.
- Pure presignature capacity/lifetime constants moved into `core/config/presignatures.ts`.
  Capacity remains five and maximum durable lifetime remains 90 days. This change
  does not delete durable presignatures on lock or change their validity rules.

Verification: eight production lifecycle cases and 13 focused browser cases pass.
The production build, Wallet/intended/state types, external declarations, runtime
entry boundaries, packed-package boundaries, and bloat gate pass. Evidence and
source hashes are in `evidence/refactor-170-client-cutover-20261005.json`.

Remaining acceptance includes protocol revision ordering, normalized client/host
configuration, the complete worker loading and latency matrix, direct public
account-sync coverage, R171 naming, and consumer/release integration.


## Final cleanup inventory

R170 is expected to reduce hand-maintained production code. This is not a numerical
completion gate. Phase 5 in the plan owns the cleanup and its evidence. The following candidates remain open; audit callers before deletion.
Preserve the supported explicit runtime entry and durable presignatures on lock.

| Candidate | Current caller / responsibility | Replacement owner and deletion condition | Verification | Status |
| --- | --- | --- | --- | --- |
| `walletIframe/host/config-guards.ts` | Host context sanitizes client-shaped construction input | Required host configuration; delete empty-origin sanitization when host construction accepts its own resolved type | Config browser round trip, type fixtures, intended lifecycle | Open |
| `core/config/configBuilder.ts`, `walletIframe/host/context.ts` | Client defaults are resolved, then host merges and resolves again | One boundary normalization with explicit client/host ownership; remove duplicate application of defaults | Field inventory, custom policy/route behavior, cosmetic-update session preservation | Open |
| `core/browser/walletIframe/host-mode.ts` and callers | Process-wide execution-mode checks remain in host-internal paths | Explicit construction and operation ownership; remove callers that no longer distinguish supported behavior | Runtime entry checks, browser lifecycle, worker loading matrix | Open |
| `SeamsWeb/publicApi`, `walletIframe/client`, `walletIframe/host` | Extracted factories, commands, callback adapters and facade assembly | Keep only layers with a distinct transport, identity, authorization, lifecycle, or public API role | Types, review/cancellation browser cases, intended signing/device/recovery flows | Open |
| `walletIframe/coordinator.ts`, `client/router.ts`, `host/runtimeContext.ts` | Session and preference observations plus bootstrap reads | Versioned authoritative streams; delete superseded mirrors, fallback reads and subscriptions after protocol cutover | Bootstrap ordering, out-of-order reads, wallet switching, reconnect/disposal E2E | Open |
| `SeamsWeb.ts`, React hooks, public exports and consumers | Existing names and connection wrappers await R171 migration | Final `auth`, `config`, and `connection` API; delete aliases and retired call paths after caller migration | External declarations, packed consumers, intended app | Open |
| Warmup assembly and `core/signingEngine/workerManager` | Remaining preparation/readiness paths | Operation-owned initialization; remove redundant preparation and dead readiness helpers after evidence | Full worker/WASM matrix and first-use retry checks | Open |
| Tests, fixtures, examples and documentation for replaced paths | Historical mixed-mode behavior and names | Current intended behavior and final API | Classify obsolete fixtures; run owning behavioral contracts | Open; counted separately |

Line-count checkpoint through `914eaacb`: 6,064 production/package lines added,
5,426 removed, net +638 across the 19 task-owned implementation/preparation commits.
This uses cumulative Git numstat and includes package scripts. The final audit must
exclude generated output, list the exact included commits, account for subsequent
changes, and explain the resulting net production total. Necessary additions must
have concrete responsibilities; remove redundant paths without gaming line counts.
Concurrent relocation work is
outside this count. Do not claim unique removed lines from cumulative diff totals.


Configuration probe note: constructing a signing-only client without registration
credentials still materializes a resolved registration object. Host re-normalization
then treats it as explicit registration input and requires a publishable key. The
probe uses explicit registration credentials to test the supported configured path.
Resolve this signing-only construction gap in the client/host config split; do not
add an empty-key exception or a compatibility fallback.


### Host initialization cleanup checkpoint

`WalletHostRuntime` is the only production caller of browser signing-runtime
initialization and the browser UI-preparation policy. The application constructor
no longer reaches either path. Removed their application-mode branches, the unused
configuration input to initialization, the disabled-policy module, its policy tag,
and the single-method wrapper object. The host now passes the UI preparation
predicate directly through assembly and restores its preferences from wallet-origin
IndexedDB. Same-origin and browser Worker availability checks remain unchanged.

This removes 53 net production lines. Other global host-mode callers still require
an ownership audit. Normalized client/host configuration and protocol revision
ordering remain unfinished; this cleanup does not close either acceptance gate.

Production build, Wallet/state types, runtime entry boundaries, and the bloat gate
pass. Two production browser cases pass: signed-out cold/warm startup and reload
with warm signing, one-use step-up, and export. Sanitized evidence is recorded in
`evidence/refactor-170-host-initialization-cleanup-20261005.json`.
