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
The table preserves the initial API audit. Later checkpoints below record
completed migrations and removed names. Its callable-member lists covered
`publicApi/types.ts` capability interfaces and public methods on `SeamsWeb`. Names grouped on one row share an ownership
decision, but still retain their individual result/callback contracts.

`C` means application client orchestration; `H` means host execution through the
existing router; `L` means a local value, display projection, or subscription.
Current factories often import both C and H implementations. The target is to
remove that dependency overlap while retaining these distinctions.

| Initial public surface and members | Audited client path / protocol | Host owner or local responsibility |
| --- | --- | --- |
| `auth.unlock`, `lock`, `logout` | `walletIframe/client/sessionCommands.ts` → router equivalents | H: `host/handlers/auth.ts`; retain exact session, progress, error, and logout cleanup semantics. |
| `auth.getWalletSession`, `getRecentUnlocks`, `hasPasskeyCredential` | `walletIframe/client/sessionCommands.ts` → router queries; session read can also prefetch blockheight | H auth queries; preserve authentication versus app-identity distinction. Recent-unlock fallback behavior needs explicit review before removing local paths. |
| Internal presignature preparation | Registration/unlock scheduler and host restoration | Public auth call and iframe route removed. The host retains existing session/material checks and durable reuse. |
| `auth.requestEmailCode` | Application command → router request | H: login challenge handling remains public for custom UI. Manual signing-session challenge/refresh was removed; signing owns its operation-bound step-up. |
| `auth.loginWithEmailOtpEcdsaCapability`, `unlockAddedEmailOtpWallet` | Domain → login/unlock-added router methods | H: Email OTP handler and selected factor activation. |
| `auth.startGoogleSignIn` | Domain → router flow proxy | C proxy for H flow, including resend/reroll/submit/complete/cancel; callbacks and terminal results remain correlated to the flow. |
| `registration.registerWallet`, `registerWithEmailOtp`, `registerPasskey` | `createPublicApi.ts` delegates to `client/registrationCommands.ts`; passkey builds registration input | H registration via `PM_REGISTER_WALLET`; preserve selected auth method and signer set. `registerWithEmailOtp` currently aliases `registerWallet`. |
| `registration.addWalletSigner`, `addPasskey`, `addEmailOtp`, `revokeAuthMethod` | `client/registrationCommands.ts` → matching router messages | H registration/auth-method handlers; preserve exact authorization and effect/retry semantics. |
| Internal Email OTP enrollment | `registration.registerWallet` / `addEmail` | Standalone public calls, iframe routes, and duplicate worker finalization removed. Registration retains its internal challenge and factor preparation. |
| Pending registration continuation; `registration.getNearAccountState` | `auth.unlock` → host recovery; client registration readiness query | H registration state/replay. Public resume request removed; passkey recovery uses ordinary unlock. Email OTP continuation remains open. |
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

The initial audit found these gaps in the bootstrap contract (preference transport is updated in the checkpoint below):

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
in paired changes. Configuration transport has started the unreleased 3.0.0
cutover; revision ordering remains open. Mandatory wallet-bound/versioned snapshots, preference acknowledgement
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

#### Session transition sources and revision coverage

Source audit at `bd3d9f15` (2026-10-05). Paths below are relative to
`packages/wallet/src/`. This maps the sources that revision tracking must cover.
It does not prove that revision tracking is implemented.

| Transition | Current source and commit boundary | Required ordering coverage |
| --- | --- | --- |
| Selected wallet changes or is removed | `core/signingEngine/session/userPreferences.ts`: `setCurrentWallet`, `projectCurrentWallet`, and store deletion handling | Invalidate captures for the previous selection. Selecting the same wallet is not proof that its authority stayed unchanged. |
| Registration and activation | `core/indexedDB/seamsWalletDB/repositories.ts`: `installLocalAuthority`, `finalizeLocalAuthorityActivation`, `publishLocalAuthorityActivation`, `persistFoundingWalletAuthority`, and `publishPendingWalletRegistrationCommit` / `AndRetain` | Observe successful persisted authority, method, selection, and session changes. Some paths publish these in separate transactions. |
| Unlock and session replacement | `SeamsWeb/operations/auth/login.ts`, `SeamsWeb/operations/authMethods/emailOtp/walletActivation.ts`, and `SeamsWeb/signingSurface/BrowserSigningSurface.ts` | Cover exact credential writes and `markWalletSelectionUnlocked`, including same-wallet unlock. `setWalletAuthenticated` alone does not cover the earlier persisted writes. |
| Lock and signing failure | `SeamsWeb/operations/auth/login.ts:lock`; `SeamsWeb/signingSurface/BrowserSigningSurface.ts:terminateWalletStateAfterSigningFailure` | Cover lock-generation advance and credential retirement separately. A later failure can leave an earlier mutation committed. Preserve valid durable presignatures. |
| Session credential writes and retirement | `core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore.ts`: `replaceExactActive`, `refreshExactWithOperationCredential`, `retireExactActiveForWallet`, `clearWallet`, `clearAll` | Observe successful transactions. A failed compare-and-update does not establish a new session. Reads that delete legacy rows also mutate this store. |
| Recovery | `SeamsWeb/operations/recovery/syncAccount.ts`; repository `persistRecoveredWalletAuthority` and `publishPendingWalletRecoveryCommit` | Cover authority replacement, method replacement, and subsequent credential publication. Recovery's material replacement policy is separate from ordinary lock retention. |
| Auth-method revocation and deletion | `SeamsWeb/operations/authMethods/revokeAuthMethod.ts` calls `upsertWalletAuthMethodV2`; repository `clearProfileAuthenticators` and `deleteProfileData` remove methods | A selected method can become unusable without a selection event. Refresh its session projection after persistence succeeds. |
| Authority extension | Repository `adoptAddedEcdsaSignerAuthority`, `reconcilePendingNearRegistrationAuthority`, and pending registration publication | Cover authority digest and capability changes that retain the same wallet and credential. A session-id comparison alone is insufficient. |
| Remote status reconciliation | `SeamsWeb/walletIframe/shared/exactSessionReconciliation.ts`; repository `replaceExactActiveWalletSessionFromStatus` | Capture ordering before remote work. Observe any successful local update before the final capture. Do not advance the revision only when an old response completes. |
| Expiry and quota status | `core/signingEngine/session/SigningSessionCoordinator.ts`, `SeamsWeb/walletIframe/shared/exactSessionState.ts`, and `SeamsWeb/walletIframe/host/context.ts` | Recheck the deadline before publication. Order an expiry event against pending active responses. Remote status can change without a local write. |
| Execution configuration replacement | `SeamsWeb/walletIframe/host/index.ts`, `context.ts`, and `runtimeContext.ts` | Retain execution-generation cancellation. Retire the old runtime's session observations and subscriptions. Appearance changes preserve execution. |
| Connection restart and disposal | Host connection state and `SeamsWeb/walletIframe/client/router.ts` | Scope revisions to the live connection. Reject old-port results and reset the projection revision when the connection changes. |
| Other wallet tabs | The same IndexedDB repositories in another context; `seamsWalletDB/manager.ts` broadcasts a database-scoped commit marker | Receivers invalidate and reread local persistence. Keep persisted authority checks and transactional compare-and-update. The browser scenario covers passive lock and fresh unlock during a delayed read; production UI acceptance is recorded separately. |

The current `IndexedDBEvent` union only reports user updates, preference updates,
and user deletion. It does not report authority or session commits.
`WalletSessionAuthorizationRepository` also has no change subscription.
The session repository now uses `SeamsWalletDBManager.runTransaction` for every
operation. This removes its separate transaction context and repeated abort/settle
code. Other authority transactions still call
`replaceExactActiveWalletSessionAuthorizationInTransaction` within the manager's
transaction. Tracking only the public session repository would miss those writes.

Session reads can prune legacy rows, so they retain read-write transactions.
A read-write transaction is not proof that authority changed. Revision tracking
must distinguish a successful mutation from an unchanged read or a superseded
compare-and-update; otherwise each observation could invalidate itself.

`clearWallet` now reads indexed keys and deletes them in one transaction. It no
longer has a gap between the key snapshot and deletion. Corrupt exact reads still
abort any earlier legacy-row deletion before returning `corrupt`. Infrastructure
failures still return `persistence_unavailable`. These operations now share the
manager's existing eight-second open and transaction timeouts.

`tests/wallet-iframe/session.persistence.test.ts` runs against browser IndexedDB.
It proves rollback after malformed data, legacy-row pruning on success, scoped
wallet deletion, successful retirement, stale refresh rejection, store clearing,
and the unavailable result with disabled persistence. Its receipt contains no
operation credentials. The six authority-race browser cases and four production
lifecycle cases also pass. Evidence:
`evidence/refactor-170-session-transactions-20261005.json`.

Session snapshots now carry `{ revision, walletId, state }` in the unreleased 3.0.0
protocol. The host assigns the observation revision before asynchronous work.
The client accepts only newer snapshots within its current connection and returns
the current projection when an older response arrives. Selection and connection
generation checks still run before accepting that snapshot.

The database manager tracks writes to the six stores used by exact-session
authority reads: authorities, auth methods, selections, session credentials,
authority signer material, and authority export roots. It advances a local
revision after a transaction with a tracked write commits. Ordinary reads,
aborted writes, and superseded compare-and-update operations do not advance it.
An identical `put` or an empty `clear` still counts as a committed write. The
revision is conservative; it does not compare record contents.

The host captures that local revision and observes selection changes before its
read. A change causes another capture, with a limit of three attempts. Repeated
changes reject the request. Selection removal produces a fresh locked projection
without restoring the saved wallet again. The final revision check and response
publication share the same synchronous continuation.

The two authority deletion paths that used cursors now delete through the shared
store helper. Current authority mutations use the tracked store operations within
`runTransaction`. This revision does not observe raw database writes or another
tab's manager. Keep persisted identity checks and compare-and-update protection.

Browser evidence covers a delayed missing-authority result across a real authority
commit, reversed same-wallet snapshot delivery, revision behavior on commit and
abort, selection removal, and disposal. The snapshot envelope also has type
fixtures for missing fields and mutation of its captured revision.

Session events now use the same wallet-bound snapshot envelope. Expiry notifications
carry a revision beside the unchanged public lifecycle event. The host session
observer owns both reads and event publication. It subscribes to local authority
commits and selection changes, combines changes within an active host operation,
and stops after disposal. Runtime and port replacement retire the old observer.

The client no longer starts a second session query from a preference notification.
It consumes the host's full-state event. It rejects snapshots for another selected
wallet, including locked snapshots. A stale expiry retains exact-request failure
handling while leaving a newer projection unchanged. Known expiry facts also guard
host projections against a delayed active status for that same session.

Bootstrap retains saved-wallet restoration. Current reads use the current selection
without restoring it. A client retry after a selection change switches to current
mode, so removal cannot launch another restoration.

The observer's status refreshes can add network requests after commits. Pending
refresh requests are combined. Identical exact-session replacements now skip the
store write. Unchanged session projections do not notify login-state listeners.
Concurrent rich session reads share pending work only within the same connection,
selection generation, and observation revision. Unlock and successful hosted auth
publish the session before returning. Production verification exposed a status-read
regression; the existing three-read limit remains unchanged. All 74 browser cases
and four production lifecycle cases pass, including automatic provider state after
unlock. The receipt and source hashes are recorded in
`evidence/refactor-170-session-events-20261005.json`. End-to-end traffic and latency measurements remain
part of the worker/network acceptance phase. Database-scoped broadcast channels now
notify other contexts after committed authority writes. A receiver rereads persisted
state and does not broadcast the notification again. The message contains only a
commit marker. Listener removal, database replacement, and disabling persistence
retire receiving channels. The browser scenario covers another tab locking during a
held status read, followed by a fresh unlock. The production idle-tab check verifies
a new host event and a locked React UI while the client session-query count stays
at four. All 24 targeted browser cases and five production lifecycle cases pass.
Evidence: `evidence/refactor-170-cross-tab-session-20261005.json`.
Full revocation/activation, reconnect and cross-browser delivery acceptance remain
open; do not close the full ordering gate yet.
The earlier snapshot-only checkpoint passed 65 browser cases and four production
lifecycle cases. The event-observer change needs its own final acceptance evidence.
Evidence: `evidence/refactor-170-authority-revisions-20261005.json`.

The existing SDK lifecycle stream reports session expiry and NEAR provisioning.
It does not report every activation, lock, recovery, or revocation.
The preference manager suppresses ordinary same-wallet selection notifications.
Its revision orders preference reads; it is not an authority revision.
The unused `walletAuthenticationRestoreGeneration` field had no readers and could
not reject stale work. The cleanup removes it and the single-caller authentication
assignment wrapper. State assignment and preference selection remain together in
`setWalletAuthenticated`. The 20-line net reduction includes the obsolete wrapper
comment; it is a source-line count, not a statement-count reduction.

Implementation order for the remaining gate:

1. Verify the implemented commit-driven session events across the remaining
   revocation and activation paths. Keep event payloads free of credentials.
2. Pair that invalidation with host selection, expiry, and execution changes.
   Capture a revision before asynchronous reads. Re-read when it changes.
3. Verify event and snapshot ordering across reconnect and other supported browsers.
   Passive cross-tab lock and fresh unlock now have Chromium evidence. The paired
   wire envelope is implemented.
4. Exercise same-wallet unlock, expiry during a read, revocation, authority
   extension, reversed response delivery, reconnect, and disposal through the
   real host transport. Preserve the existing cross-tab production race checks.

Do not mark this gate complete from the transition inventory alone. The existing
local authority rechecks and client selection guard cover only part of it.

The exact-session reader now rechecks persisted authority after the remote status
read. It compares the selected method and lock generation, active method/authority
state, authority digest/revocation epoch, exact authorization record, and operation
credential. A changed binding starts a fresh observation. Three interrupted
attempts produce the existing `superseded` result. Expiry is checked again after
the remote read. A delayed active response cannot undo a lock, use a retired
credential, or restore a replaced authority through this read path.

`tests/wallet-iframe/session.authority.test.ts` uses real IndexedDB repositories
and canonical fixture builders. Its controlled status boundary covers unchanged
authority, lock, authority replacement, session retirement, expiry, and repeated
replacement. This adds two local reads after a successful remote observation.
It does not make all local reads atomic or establish wire revision ordering.
Keep the host transition audit and paired revision-envelope gate open. Evidence:
`evidence/refactor-170-session-authority-20261005.json`.

The selection-restoration race is fixed in `host/handlers/auth.ts`. The saved-wallet
lookup observes selection changes until it finishes. A newer selection, including
removal back to no selection, wins over the lookup. Existing selections are no
longer reapplied after an asynchronous helper returns. The host requires the
selection subscription already supplied by its preference manager.

`tests/wallet-iframe/session.selection.test.ts` exercises the real auth handler,
preference manager, IndexedDB, client router, and cross-origin transport. It holds
the saved-wallet inventory response while selection changes. Its three cases
cover ordinary restoration, a newer wallet, and removal of that newer wallet.
The inventory response and unrelated host operations use the browser harness.
These cases prove selection preservation; session-result revisions and
execution-configuration fencing remain open.

Client session reads now capture the live connection and the observed selection
generation. A newer wallet selection causes a fresh current-wallet read before
the result can update the projection. Selection removal clears the projection.
Disconnect clears the cached session, and a disposed router cannot initialize
again. The duplicate session application after the notification helper's `await`
is removed. The browser ordering scenario records delayed-read results, emitted
login status, removal, pending-read rejection, and attempted reinitialization.

This client generation tracks selection only. It does not establish authority
ordering between concurrent reads for the same wallet. Host-issued revisions,
lock/unlock/revocation/expiry capture rules, reconnect acceptance, and consumer
ownership across execution replacement remain required. Host request fencing is
recorded in the configuration section below. Evidence:
`evidence/refactor-170-session-client-20261005.json`.

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
`shared/configuration.ts:createWalletHostConfig` →
`client/router.ts:connectAndConfigure` → `parseWalletConfigurationUpdate` →
`host/context.ts:applyWalletConfig` → `WalletHostRuntime`.

The client resolves defaults once. Protocol 3.0.0 sends a complete host snapshot,
with a separate appearance-update branch. The host validates incoming values and
stores the resolved snapshot directly. It does not merge raw inputs or apply its
own defaults. An invalid update leaves the previous snapshot in place.

This table covers every top-level `SeamsConfigsInput` field. “Reset” means changed
execution settings dispose the volatile runtime. It never authorizes deletion of
valid durable presignatures. Host generation fencing now rejects pending operations
and prevents retired handlers from acquiring the replacement runtime.

| Input | Resolved transport | Owner / update semantics |
| --- | --- | --- |
| `chains` | `network.chains`, preserving configured order and resolved RPC/explorer values | Client public RPC/selection and host signing; reset. |
| `relayerAccount` | `network.relayer.accountId` | Client public calls and host registration; reset. |
| `relayer.url` | `network.relayer.url` | Client relaying and host execution; reset. |
| `relayer.delegateActionRoute` | `network.relayer.routes.delegateAction`; no conversion back to raw input | Client relay helper and host consumers; reset. Custom route round trip is covered. |
| `registration` | Complete resolved managed registration object | Host ceremony/bootstrap. Signing-only clients retain the resolved empty credential state; registration keeps its existing credential requirements. Reset. |
| `signingSessionDefaults` | `signing.sessionDefaults` | Host defaults for operation inputs; reset. These values are not authority grants. |
| `signingSessionPersistenceMode` | `signing.sessionPersistenceMode` and matching `signing.sessionSeal` branch | Host persistence; reset. Storage names and schemas remain unchanged. |
| `emailOtpAuthPolicy` | `signing.emailOtp.authPolicy` | Host factor/signing policy; reset. Browser probe checks `per_operation` forwarding. Real per-operation signing remains an acceptance item. |
| `routerAb` | `signing.routerAb`, with validated normal-signing branch | Host signing policy; reset. |
| `routerAbEcdsaDerivationPresignaturePool` | `signing.routerAbEcdsaDerivation.presignaturePool`, validated against shared bounds | Host refill policy; reset. Durable-pool retention still applies. |
| `provisioningDefaults` | `signing.thresholdEcdsa.provisioningDefaults` | Host registration/signing defaults; reset. |
| `authenticatorOptions` | `webauthn.authenticatorOptions` | Host ceremonies and credential adapter; reset. |
| `iframeWallet.walletOrigin` | Required on `SeamsClientConfig`; absent from `WalletHostConfig` | Client transport/origin checks. Empty-origin sanitizer and direct-mode normalization option are deleted. |
| `iframeWallet.walletServicePath` | Client router option only | Client-only endpoint; absent from host configuration. |
| `iframeWallet.sdkBasePath` | Router resolves `assetsBaseUrl`; host accepts its same-origin URL, otherwise `/sdk/` | Client URL construction and host asset resolution. Host configuration has no iframe metadata; verify changed worker URLs separately. |
| `iframeWallet.walletHostVariant` | Client config retains the existing value; host configuration excludes it | Supported-consumer audit remains open; plugin host generation owns actual entry selection. |
| `iframeWallet.rpIdOverride` | Shared resolver uses a nonempty override, otherwise the wallet-origin hostname; host requires branded `wallet.rpId` | Credential identity; reset. Host parser rejects absent identities and nested iframe settings. |
| `appearance` | Complete resolved `ui.appearance`; appearance updates have their own wire branch | Display only. Client resolver merges same-theme values and replaces old-theme values. Host updates CSS and existing runtime appearance without an execution reset. |

Browser coverage uses the actual source router, cross-origin MessagePort transport,
and actual host parser/config application. It covers policy, custom route, explicit
RP, signing-only construction, rejection of an incomplete snapshot, and rendered
CSS after theme changes. Production lifecycle coverage is recorded in the normalized
configuration checkpoint below. The shared raw/direct config option and redundant
host resolver are deleted. No old-payload fallback is retained.

Host request fencing uses the existing execution fingerprint in both the lightweight
entry and runtime context. A changed fingerprint advances the execution generation,
rejects requests waiting for module loading or execution, cancels admitted reviews,
and retires runtime callbacks. Cached handlers belong to that generation. A late
handler cannot acquire a new runtime, publish results/progress, or clear its surface
binding. Appearance and invalid updates preserve the active generation. No durable
presignature deletion is introduced, and committed side effects are not rolled back.

`tests/wallet-iframe/config.execution.test.ts` uses the real host entry, configuration
boundary, runtime context, and runtime construction. A controlled loader and handler
hold requests at both asynchronous boundaries. The receipt proves preserved cosmetic
updates, rejected invalid input, rejected old requests, suppressed late results, and
fresh runtime ownership. Type fixtures require immutable captured request generations.
See `evidence/refactor-170-host-generation-20261005.json`.

Remaining work: `walletHostVariant` ownership, consumer ownership across execution changes, and
revision-ordered session observations. Keep the unreleased protocol 3.0.0
client and host paired; complete revision semantics before release.

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
| `wallet-custody-ceremony.worker.ts` | `wallet_custody_ceremony_bg.wasm`; selected handlers also initialize NEAR signer or Ed25519 Yao WASM | New key-set runs, NEAR ceremony restoration, and recovery-code rotation await ceremony initialization. Envelope and lane-source handlers initialize their own modules. Custody crate links both protocol families. |
| `passkey-confirm.worker.ts` | Confirmation messaging/UI; no direct WASM loader | Owned by confirmation infrastructure outside the generic signer-worker list. Do not count it as a curve-specific signer. |
| `passkey-mpc-session.worker.ts` | Shamir runtime via `shamir3pass/runtime.ts`, which manages a separate worker | Explicit prewarm and session/seal operations. |
| `passkey-mpc-export.worker.ts` → `passkeyMpcExportRuntime.ts` | Ed25519 Yao client initialization during selected export work; confirmation | Request-time export work; requires fresh export-scoped authorization. |
| `shamir3pass.worker.ts` | `shamir3pass_runtime_bg.wasm` | Thread-ready notification and request-time WASM initialization/warmup. |
| `device-linking-key.worker.ts` | `router_ab_ed25519_yao_client_bg.wasm` for lane-recipient operations | Request-time initialization with a cached promise; managed outside the generic signer-worker list. |

### Worker-loading implementation checkpoint

Historical startup checkpoint (see later client-cutover measurements): the host no longer calls generic `prewarm` when constructing its
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
The later registration-menu checkpoint removes generic UI preparation's
EVM-family import. Durable presignature storage and lock invalidation behavior
are unchanged in this patch.

### Loading triggers and current disposition

| Trigger | Existing path | Consequence / intended boundary |
| --- | --- | --- |
| Host first runtime construction | `SeamsWeb/walletIframe/host/context.ts` | Generic prewarm call removed; fresh signed-out construction creates no workers in production E2E. |
| Generic signer warmup | Former `prewarmWorkers()` path through warmup assembly/manager/transport | Deleted, including its readiness waits and unused timing field. Requests initialize selected workers through `getOrCreateWorker`. |
| Host UI preparation predicate | `walletIframe/host/WalletHostRuntime.ts:shouldPrewarmBrowserUi` | The application owns no signing surface. The host supplies a same-origin browser predicate directly; the disabled app policy and its module are deleted. |
| Registration surface preparation | `host/runtimeLoader.ts`; former `registrationPreparationPreload.ts` | Generic registration preload is deleted. Runtime imports follow the typed operation route; recovery-code UI retains its separate preload. |
| ECDSA registration preparation | `operations/registration/registration.ts:beginRegistrationWarmup` → `prewarmEcdsaRegistrationCrypto` | Starts only when signer selection includes `evm_family_ecdsa`. Failure is best-effort; the operation independently initializes WASM. |
| Email OTP registration preparation | `registrationEmailOtpYaoPrewarmWork`; `googleEmailOtpWalletAuthFlow.ts:startGoogleEmailOtpRegistrationPrewarm` | Both paths use `registrationSelectionIncludesNear` on the resolved signer selection. ECDSA-only Google registration and reroll no longer prepare Yao. |
| Restored-session prefill | `host/restoredSessionPresignaturePrefill.ts:scheduleRestoredSessionPresignaturePrefills` | Active sessions and unlocked exhausted sessions may prefill configured ECDSA targets. Locked, expired, and unresolved identities return immediately. The downstream prefill owns lane/material eligibility. |
| Startup replay | `WalletHostRuntime.ts:resumePendingRegistrationOnStartup`, device acknowledgement domain | Replays pending NEAR registration, wallet recovery, and device acknowledgements. Persisted work can justify loading after mount; clean-profile idle evidence does not cover replay. |
| Confirmation/session/export manager startup | Confirmation and passkey MPC managers outside `WorkerTransport` | Must be included in browser evidence; changing only the eight-kind loop cannot prove zero unrelated workers. |
| Volatile-material cleanup | `workerTransport.ts:requestOperation` | Absent ECDSA derivation and Email OTP workers are no longer created by cleanup. Existing workers receive the original request. Durable presignatures are unaffected. |

### Operation-to-dependency audit

| Operation | Required dependency family | What remains to verify in real-browser evidence |
| --- | --- | --- |
| Idle fresh host | Transport and UI; no operation-selected signing dependency | Separate unconditional warmup from pending persisted work. |
| NEAR passkey unlock/sign | Confirmation, passkey session, nested Shamir worker, custody worker for envelope operations, and NEAR execution | Production registration/lock/unlock/reload/sign passes with no ECDSA or Email OTP workers. The custody worker still initializes the ceremony binary for every request; see audit below. |
| EVM/Tempo unlock/sign | Selected factor, ECDSA holder/presign/online authority and transaction codec | Per-chain worker set, shared auth helpers, first-sign prefill, and warm reuse. |
| Email OTP unlock/sign | Email OTP runtime plus selected lane's crypto and seal helpers | A NEAR flow may use a binary named EVM crypto for shared helper functions; do not forbid URLs solely by filename. |
| Registration/recovery | Custody ceremony plus selected signer-set dependencies | Both protocol families are linked into the shared ceremony binary; separate optional worker downloads from necessary shared binary code. |
| Key export | Selected lane, fresh factor authorization, export worker/viewer, Yao or ECDSA export dependencies | No ordinary warm-signing authority substitution; observe per-lane loads. |
| Device linking | Source contribution, recipient worker, selected target factor, activation/seal dependencies | Both browser contexts and acknowledgement retry. Preserve current placement and material semantics. Third-device signing/export passes; per-phase asset attribution remains open. |

These rows are source-based dependency families, not final network allowlists.
Use the real production host to establish exact sets before enforcing absence of
individual assets. In particular, worker naming and configured chain lists are
insufficient to decide whether shared crypto is required.

### Initialization and lifetime audit at `20974d3c`

This source audit separates worker creation, binary initialization, and cleanup.
Paths in this subsection are relative to `packages/wallet/src/`.

| Owner / entry point | Initialization and lifetime behavior | Remaining work |
| --- | --- | --- |
| `core/signingEngine/workerManager/workerTransport.ts:getOrCreateWorker` | One worker per kind. Requests reuse it. Timeout/crash resets the affected worker; ECDSA authority resets also retire dependent presign/online workers. Ordinary RPC error replies reject the request without resetting its worker. Origin changes reset workers. | Verify concurrent cancellation, origin replacement, and retry against real emitted workers. A rejected initialization promise therefore must clear itself. |
| `workerManager/workers/{near-signer,evm-crypto,tempo-signer,ecdsa-derivation-client}.worker.ts` | Startup preparation catches failure before READY. Operation dispatch independently awaits initialization. Failed initialization promises clear. | EVM/Tempo same-worker retry has browser evidence. Extend failure/retry evidence to NEAR and derivation. READY alone is not crypto readiness. |
| `workerTransport.ts:connectPresignAuthorityChannel`, `connectPresignOnlineChannel` | Presign session initialization connects a derivation or linked-holder authority. Online requests connect presign and online workers. These two coordinator workers load no separate WASM. | Record restoration and authority replacement separately from first-use signing. Do not remove required channels to reduce worker counts. |
| `workerManager/workers/wallet-custody-ceremony.worker.ts:handleRequest` | Every request first awaits the full ceremony binary. Envelope open/reseal and export-root transfer handlers separately await NEAR signer WASM. Lane-source operations await Yao. All three initialization promises clear on failure. | Move ceremony initialization to operations that use ceremony exports or restore ceremony handles. Envelope-only unlock must retain authenticated seed/manifest checks while avoiding unrelated ceremony initialization. |
| `workerManager/workers/email-otp/crypto.ts` | EVM helper, Email OTP runtime, and ceremony initializers cache promises without clearing rejection. Yao initialization already clears rejection. Dispatch selects helper calls by operation. | Fix the three failed-promise caches and verify same-worker retry after unavailable WASM. Preserve concurrent request coalescing. |
| `workerManager/workers/shamir3pass.worker.ts:ensureWasm` | Request-time initialization caches a rejected promise. Its parent runtime rejects ordinary RPC errors without restarting the worker. | Fix the rejected-promise cache and verify seal work after transient delivery failure. A parent runtime singleton reset does not repair the child worker's promise. |
| `core/signingEngine/uiConfirm/{UiConfirmManager,PasskeyMpcSessionManager,PasskeyMpcExportManager}.ts` | Managers own workers outside the signer transport. Confirmation owns UI messages. Session operations and explicit Shamir preparation create the session worker, which creates Shamir on demand. Export starts its worker for the export request; its runtime initializes Yao for selected Ed25519 work. | Include these workers in operation measurements. Preserve fresh export authorization and reject pending requests when their owner disposes. |
| `SeamsWeb/operations/devices/deviceLinkingWorkerChannels.ts`; `workerManager/workers/device-linking-key.worker.ts` | The default endpoint is created on first use; injected authenticated endpoints remain supported. Lane-recipient work initializes Yao with a retryable cached promise. Closing the owner terminates its endpoint. | Capture source and recipient contexts, cancellation, acknowledgement replay, and retry. |

The next fixes are operation-specific custody initialization, Email OTP/Shamir
initialization retry, and signer-selected Google registration preparation.
These are source findings; successful lifecycle runs do not prove failure recovery
or an exact network allowlist. No binary split or new worker registry is needed.

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
| Host configuration construction | Shared mapper/parser supplies required `WalletHostConfig` | Raw/direct normalization and redundant host resolver are deleted. Host requires explicit RP identity and excludes client transport metadata | Config browser round trip, type fixtures, intended lifecycle | Resolved wire and identity split complete |
| `core/config/configBuilder.ts`, `walletIframe/host/context.ts` | Client resolves defaults; host validates the complete snapshot | Duplicate host default application and raw merging are removed | Field inventory, custom policy/route behavior, cosmetic-update session preservation | Complete for normalized transport |
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


Configuration probe resolution: signing-only construction now crosses the wire as
resolved configuration. The host no longer interprets the empty resolved credential
as explicit raw registration input. The browser probe covers both managed and
signing-only clients; no raw-input exception or compatibility fallback was added.


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


### Resolved host constructor checkpoint

`WalletHostRuntime` now requires `WalletHostConfig`. Raw application configuration,
a general client/host union, and a nested iframe origin are rejected by type
fixtures. `configuration.ts` owns host input resolution. Only the RP override is
carried from incoming iframe settings. The host constructor stores the resolved
value directly and does not normalize it again.

Deleted `config-guards.ts`, its empty-origin/service-path workaround, and its
redundant assertion. The execution-config fingerprint now selects the RP override
rather than unused client iframe-target settings. The browser probe confirms that
custom delegate routes, Email OTP policy, and explicit RP identity survive an
appearance update; the resolved host has no nested iframe origin.

This establishes the constructor boundary only. The wire payload and host message
state still use input-shaped configuration. Complete the required resolved wire
contract, remove the shared direct-mode normalization option, and fix signing-only
registration configuration during the remaining client/host split. Do not count
this checkpoint as completion of normalize-once transport semantics.

Validation passes: production build, Wallet/state/browser types, runtime entry
boundaries, configuration browser round trip, and two production lifecycle cases
(Email OTP multi-chain lifecycle and passkey reload with step-up/export). This
checkpoint removes 25 net production lines. Source hashes and sanitized receipts
are in `evidence/refactor-170-host-config-constructor-20261005.json`.


### Shared appearance normalization checkpoint

The host now uses `resolveRuntimeAppearance`, the existing application/runtime
resolver. Deleted its separate raw appearance readers, legacy-token readers,
string-map helper, and theme-merge implementation. CSS emission receives resolved
appearance values and retains token-name/value filtering. This removes 87 net
production lines without introducing another normalization abstraction.

The browser configuration scenario now verifies same-theme color/shape merging,
replacement when the theme ID changes, and actual computed CSS properties inside
the iframe. Old colors and shape values disappear after replacement. Auth policy,
custom relay route, and RP identity remain unchanged. Build, type and runtime-entry
checks pass. Evidence is in `evidence/refactor-170-shared-appearance-20261005.json`.
The normalized configuration wire contract and protocol ordering remain open.

### Normalized configuration transport checkpoint

The configuration wire contract is now implemented in both endpoints. The client
constructs `WalletHostConfig` from its resolved configuration. The host validates
the snapshot and stores it directly. Appearance messages carry a separate complete
appearance value. Deleted the redundant host resolver, raw partial-config merging,
the `allowDirectWalletMode` option, unused chain-cloning exports, and the retired
mode alias. `SeamsWeb` now requires the narrower resolved client branch internally.

Signing-only construction works without registration credentials because the host
does not reinterpret resolved configuration as raw registration input. Invalid
snapshots fail before state replacement. Configuration changes notify an existing
runtime immediately without importing it during idle setup. The recovery summary
browser test confirms that display and cancellation need no full runtime load.

Both endpoints and the generated asset manifest declare protocol 3.0.0. Skew tests
reject a 2.0.0 host and a newer incompatible endpoint. This starts an unreleased
cutover: session/preference revision ordering remains required before release.
Release the client and wallet assets together and roll back the pair together.
No compatibility path accepts the old partial configuration payload.

The production build, Wallet/state/browser/intended types, runtime-entry checks,
external declarations, and bloat gate pass. All 44 selected browser cases and four
production lifecycle cases pass. The lifecycle cases cover Email OTP registration
and unlock, registration/signing asset traffic, signed-out cold/warm traffic, and
passkey refresh with warm signing, one-use step-up, and export. Source hashes,
sanitized receipts, reproduction commands, and package validation are recorded in
`evidence/refactor-170-normalized-config-20261005.json`.

This task adds 421 and removes 291 production lines, net +130. The boundary parser
accounts for necessary validation that raw partial merging previously lacked.
The root client measures 66,218 bytes static gzip and 93,297 bytes including its
lazy router. The provider measures 73,225 and 103,055 bytes respectively, excluding
React peers. These are JavaScript bundle measurements, not total page traffic.

Remaining configuration cleanup: required explicit host RP identity, removal of
unused client transport metadata from the host type, host-variant ownership, and
active-operation fencing on execution replacement. The full revision-ordering,
worker-loading, durable-presignature, R171, and consumer acceptance gates stay open.


### Explicit host credential identity checkpoint

Host configuration now requires branded `wallet.rpId` and rejects all nested iframe
settings. Client configuration requires its iframe transport branch and rejects
host identity fields. Both branches use the shared `Variant` helper. The host no
longer carries service paths, SDK paths, or host-variant selection.

Registration and host construction share one RP resolver. It preserves nonempty
explicit overrides and otherwise selects the configured wallet-origin hostname.
The host validates the serialized identity before accepting configuration. Type
fixtures reject absent or raw RP identities and mixed client/host branches. The
browser probe covers override and fallback behavior, missing RP rejection, and
nested-iframe rejection without replacing the previous valid state.

Deleted `isConfigured()` and unreachable missing-origin branches from the client
coordinator. Required client configuration supplies the origin at construction.
Transaction review still requires its live provider bridge and the router's
existing connection/session checks. Source changes remove 62 net production lines.
Verification receipts are in `evidence/refactor-170-host-identity-20261005.json`.

Remaining work includes host-variant API ownership, active-operation fencing,
session/preference revision ordering, selective worker-loading evidence, durable
presignature acceptance, R171 naming, and consumer integration.


### Preference snapshot ordering checkpoint

Preference snapshots and events now share `{ walletId, confirmationConfig,
revision }`. The host assigns monotonic revisions from its live context; timestamp
ordering is removed. The client accepts only newer revisions and rejects malformed
snapshots. A snapshot response cannot overwrite a newer event. Connection changes
clear the accepted revision, and a read checks that its connection still owns the
response before applying it.

The coordinator no longer fetches a second bootstrap snapshot or associates it with
a saved session's wallet. Router initialization owns the initial snapshot and uses
the same wallet-bound event path as subsequent updates. The existing client
preference projection retains pending local writes over confirmed host values.

This completes transport ordering for preference observations only. The audit also
found host-domain work that must precede final acceptance: asynchronous preference
hydration can outlive a wallet switch; setters acknowledge before IndexedDB writes
finish, and storage failures are currently logged rather than returned. Fix those
at the owning manager/handler boundary. Session reads still need revisions and
state-change fencing for selection, activation, lock, expiry, revocation, restore,
and execution-config replacement. Keep protocol 3.0.0 unreleased until these gates
are complete.


Validation for preference transport: production build, Wallet/state/browser types,
runtime-entry checks, external declarations, and bloat gate pass. Eighteen selected
browser cases pass; the ordering case also passes after extension to delay the
initial bootstrap snapshot. Two production cases pass: Email OTP lifecycle and
passkey refresh with warm signing, step-up, and export. This checkpoint adds 60
and removes 39 production lines, net +21. Evidence and sanitized receipts are in
`evidence/refactor-170-preference-revisions-20261005.json`.


### Durable preference acknowledgement checkpoint

The host preference handlers await writes through the owning manager. Removed the
handler's duplicate IndexedDB read/merge and the manager's unused application mirror
method. Manager writes capture their wallet at invocation, execute in order, merge
against that wallet's stored values, and publish confirmed values after storage
succeeds. Successful acknowledgements include the current wallet-bound revision
snapshot. The client parses read/write responses through one ordering path, so
an acknowledgement that precedes its event still supplies the current layout.
Failures reach the existing application rollback/flush path. A missing
wallet row is an explicit error; the storage adapter now returns its actual result.

Preference loads carry a manager revision and wallet identity. Selection, newer
reads, writes, deletion, and disposal invalidate earlier reads. Selecting another
wallet publishes defaults before loading that wallet's stored values. A completed
write to a previously selected wallet updates its storage without changing the
current wallet's projection. Observer errors cannot turn a committed write into a
reported storage failure.

The first-save audit found that records without preferences are valid, but a
confirmation-only write produced a record rejected by required unrelated network
and relayer settings. These are optional configuration values in both persistence
and session-message parsing. Existing values are retained and validated; no network
or relay choice is invented for a new wallet. Confirmation settings remain required.

The browser scenario uses the actual manager and preference handlers, a real
cross-origin router, and real IndexedDB. Its test store adapter delays reads and
writes and injects one storage failure. It verifies late reads, first save,
acknowledgement timing, wallet switching during a write, retained values after
failure, and a later successful write. This scoped host harness does not substitute
for production lifecycle coverage or the remaining full protocol acceptance.


Nineteen selected browser cases and two final-source production lifecycle cases
pass. The earlier production attempt passed three cases before a retryable NEAR
fetch failure; the final refresh/export rerun passed. Build, types, declarations,
runtime boundaries, and the bloat gate pass. Package validation and sanitized
receipts are recorded in `evidence/refactor-170-preference-durability-20261005.json`.
This task adds 138 and removes 123 production lines, net +15. Session revision
ordering and execution-configuration replacement fencing remain unfinished.


### Configuration namespace checkpoint

The application client exposes `config.setTheme`, `config.setAppearance`,
`config.chainTarget`, and `config.configuredChainTargets`. The old top-level
methods are deleted. Chain selection binds the existing resolver directly.
Appearance retains its existing application owner and asynchronous host update.
The current theme is derived from appearance, removing a duplicate mutable field.

React's existing SDK proxy wraps `config.setTheme` to preserve the optional host
theme callback. Provider appearance updates and settings controls use the same
namespace. Public docs and examples use the new calls. Type fixtures reject all
four old methods and direct mutation of the theme projection.

The browser configuration scenario exercises detached namespace methods, chain
selection, appearance changes, and host forwarding. It writes `configuration.json`
to the Playwright output directory. Verification is recorded in
`evidence/refactor-170-config-api-20261005.json`. Other R171 namespaces and the
private Console release migration remain pending.

Nine browser cases and one production refresh/signing/step-up/export case pass.
Build, types, external declarations, runtime boundaries, and the bloat gate pass.
Production source adds 56 lines and removes 47, net +9; the public contract
comments and React namespace binding account for the small increase.


### Event and hosted auth-menu namespaces checkpoint

The application client binds `events.subscribe` and the four public `authMenu`
operations directly to its existing coordinator. It deletes the replaced
top-level forwarding methods. The React hosted menu and intended application
use the new names. Type fixtures preserve wallet-owned request identity and
reject the five removed methods. The explicit host/runtime and internal router
retain their own execution and transport methods.

The demo OTP delivery callback remains pending internalization into demo/test
integration. It was not added to the ordinary `authMenu` capability.
The connection checkpoint below addresses the readiness and subscription gaps
identified here. Earlier router readiness preceded session/preference reconciliation,
and coordinator ready subscriptions made before router creation were discarded.

Verification is recorded in `evidence/refactor-170-event-auth-menu-api-20261005.json`.

Fourteen browser cases and two production authentication cases pass. Build,
types, external declarations, runtime entry boundaries, and bloat checks pass.
Production source adds 48 lines and removes 42, net +6; type fixtures,
tests, and documentation are excluded. New capability declarations and bindings
replace the old forwarding methods.


### Connection lifecycle checkpoint

The coordinator owns `idle`, `connecting`, `ready`, `failed`, and `disposed`
connection state. A connecting branch owns its generation, shared completion
promise, and interruption signal. Public snapshots expose state and generation,
with an error for failure; transport internals remain private. Readiness follows
the initial session and preference reconciliation. Subscriptions deliver the
current snapshot immediately and survive router replacement.

Failed initialization releases the router. An explicit retry creates a new
generation. Disconnect interrupts pending requests and releases the old router;
no interrupted operation is replayed. Disposal is terminal, rejects a pending
connection, disposes a late-created router, and releases coordinator subscriptions
and preference work. It does not lock the wallet or invalidate durable material.

Application, hosted-menu, recovery acknowledgement, and transaction-review calls
now use one reconciled router-acquisition path. The unused wallet argument on
router acquisition is removed; operation payloads retain their exact identities.
Redundant post-registration/unlock initialization and connection-wide blockheight
prefetch are removed. Operation-owned preparation remains in its existing paths.

React uses `connection` state and the shared connection promise. It no longer
polls readiness or repeatedly nudges initialization. Coordinator-owned login
subscriptions remain attached across router replacement. The unused public host
preference-event method is removed; public preference subscriptions use the
existing preference state owner.

Acceptance covers failure/retry, concurrent initialization, held reconciliation,
iframe reload/reconnect, subscription continuity, terminal disposal, and disposal
during delayed router import. Each new scenario writes a JSON artifact. Type
fixtures reject missing generations, mixed failure/ready state, invalid spreads,
mutable snapshots, and the removed public methods. Evidence is recorded in
`evidence/refactor-170-connection-20261005.json`. Full React provider replacement
acceptance, all remaining API migration, and other R170 gates remain open.

The separate private repository still uses the published API in
`apps/wallet-console/src/flows/demo/hooks/useDemoWalletSessionLifecycle.ts:33` and
`apps/seams-site/src/flows/demo/hooks/useDemoWalletSessionLifecycle.ts:33`. Both
`initWalletIframe` calls must migrate to `connection.connect` with the exact new
package release. No private source or package pins changed in this checkpoint.

Final-source verification passes 59 browser cases and three production lifecycle
cases. Build, types, declarations, bundle boundaries, and bloat checks pass.
Production TypeScript adds 290 lines and removes 280, net +10. This excludes
type fixtures, tests, Markdown, and evidence artifacts. The connection state and
interruption handling replace polling, duplicate startup, and forwarding paths.


### Auth reads and unified lock checkpoint

The public SDK exposes `auth.getSession`, `auth.hasPasskey`, and `auth.lock`.
`getRecentUnlocks` retains its accepted name. React context and `useWalletAuth`
expose `getSession`. Replaced public names have no aliases. Redundant React
forwarding closures are deleted; bound capability methods remain bound.
Session reads no longer trigger a blockheight prefetch.

The old logout implementation, `PM_LOGOUT` request, host handler, and application
forwarders are removed. The logout-only signing-engine facade and bulk durable
pool deletion method are also removed. Existing lock still attempts generation
fencing, authorization retirement, conditional authentication cleanup, and
volatile material cleanup. Material retirement, expiry, atomic claim, and
consumption retain their independent persistence paths.

The logout unit suite is classified `obsolete_test_or_fixture` because it tests
the deleted operation and destructive behavior. The durable IndexedDB suite
retains sealing, tamper rejection, atomic claim, capacity, and 30-day storage
restoration coverage; only bulk-delete assertions are removed. The production
lock scenario reads record IDs only, verifies their retention across lock and
fresh unlock, then signs a Tempo transaction. It emits a sanitized count-based
artifact. This immediate lifecycle check does not close the full 30-day return
and latency gate.

Private Console and site consumers remain pinned to the published API. Both
`apps/wallet-console` and `apps/seams-site` still call `auth.getWalletSession` in
`src/flows/demo/hooks/useDemoThresholdAccountState.ts:45` and
`src/flows/demo/hooks/useDemoNearActions.tsx:192`. Migrate those four calls with
the exact new package release.

Final-source verification passes 24 browser cases and the production retention
case. Four broader production lifecycle cases passed before the final internal
export and browser-fixture cleanup. Build, types, declarations, and runtime
bundle checks pass. Production TypeScript adds 38 lines and removes 145, net
−107; tests, type fixtures, documentation, and evidence are counted separately.
The storage fixture now bundles its internal probe through the existing esbuild
pattern because the production output no longer exports its internal constructor.

Evidence is recorded in `evidence/refactor-170-auth-api-20261005.json`.
`auth.onSessionChange`, remaining public auth consolidation, demo callback
internalization, worker optimization, and complete R170 acceptance remain open.

### Session subscription prerequisite: rich-read ordering

The `auth.onSessionChange` audit found that exact-session snapshots reject stale
observations, while rich `auth.getSession` responses did not recheck the client
selection or observation revision. A delayed rich response could therefore expose
an earlier wallet or authority state to a future public subscription.

The rich read now captures the connection identity and retries if the observed
selection generation or session revision changes before its response arrives.
Current-wallet reads follow current selection. Explicit-wallet reads keep their
requested identity across retries. A changed connection or disposed router
rejects the read. Concurrent same-generation reads still share their in-flight
promise; completed responses are not cached.

This covers changes the client has observed. It does not claim an atomic snapshot
of all stores or prevent a host change after a completed read. The public
subscription still needs to deliver the full `WalletSession`, suppress superseded
asynchronous deliveries, handle connection replacement and disposal, and replace
the old boolean login callback and React read-back path. Its implementation remains
open. Do not rename the boolean callback and call the public state contract done.

Verification passes 15 browser cases and two production cases (delayed restoration
and refresh with signing, step-up, and export). Production build, wallet/browser
types, and bloat checks pass. Production TypeScript adds 19 lines and removes five,
net +14. The browser scenario adds 110 test lines and emits an ordering artifact.
Evidence: `evidence/refactor-170-session-read-ordering-20261005.json`.


### Public session subscription checkpoint

`auth.onSessionChange` now delivers `WalletSession` values. The old public
`onWalletIframeLoginStatusChanged` method and its boolean callback path are
removed. The internal router emits validated exact-session observations to the
coordinator. The coordinator binds its existing rich read to the observed wallet
ID, sharing an in-flight read with unlock callers for that same identity and
revision. It returns enriched identity and capability state. A newer observation supersedes pending delivery;
connection replacement invalidates prior reads. Listener failures are isolated,
and unsubscribe/disposal fence pending callbacks. Subscriptions survive reconnect.

Locked observations use the canonical anonymous-session builder shared with the
host query. They require no new session RPC and clear application authority
immediately. The router accepts newer revisions but emits only changed exact-session states,
preserving its existing deduplication of repeated host observations. Subscribing
after connection requests current rich state. No observer means no enriched read.

React subscribes before connecting and consumes complete states. Its separate
exact-session bootstrap, boolean status conversion, async generation guard, and
per-event session read are deleted. Host auth command types exclude the
application subscription; the explicit runtime export remains independent.

The browser contract covers full state, subscriptions before/after connection,
reconnect, delayed response supersession, throwing listeners, unsubscribe, and
pending disposal. Production verification covers React's Email OTP flow, passive
cross-tab lock, and refresh with signing, step-up, and export. Results and artifacts
are recorded in `evidence/refactor-170-session-subscription-20261005.json`.
Broader R170 worker, provider replacement, 30-day latency, and release gates remain
open. The private Console/site source audit found no old login-callback callers.

Final-source verification passes 27 browser cases and three production lifecycle
cases. Build, wallet/test/docs types, external declarations, runtime boundaries,
and bloat checks pass. Passive lock preserves four client queries before/after.
The unchanged post-unlock three-status-read limit passes after binding subscription
reads to the observed wallet ID. Production TypeScript adds 132 lines and removes
215, net −83. Tests/type fixtures add 179 and remove 10; Markdown and evidence
are separate.


### Generic preparation cleanup checkpoint

The application `prewarm` method only connected the iframe after the earlier
worker cutover. React's idle `useEagerPrewarm` hook called it even though
`useWalletIframeLifecycle` already connects on mount. The hook, idle timer,
`eager` props, application method, and their intended-app caller are removed.
Manual client setup uses `connection.connect`.

The host's generic `prewarm` method had no callers. It and its option parser are
removed. The app/host prewarm records, scope/request types, and Email OTP diagnostic
snapshot plumbing are deleted; actual per-stage Email OTP timings remain. The
public `prefetchBlockheight` method and its unused `PM_PREFETCH_BLOCKHEIGHT` RPC,
router method, host wrapper, handler, and obsolete test stubs are also removed.
No aliases or fallback flags are retained.

Required internal preparation remains at its existing owners:

| Selected operation | Preserved owner |
| --- | --- |
| Registration surface and signer selection | `operations/registration/registration.ts`, including ECDSA crypto and Email OTP Yao preparation |
| Google/Email OTP auth | `host/createEmailOtpCommands.ts` and `prewarmEmailOtpYaoDomain` |
| Successful unlock preparation | `host/createSessionCommands.ts` → `warmCriticalResources` |
| NEAR context preparation | `core/signingEngine/assembly/warmup.ts` → `prefetchNearContext` |
| Worker/WASM first use | Existing worker manager, transport, and operation handlers |

The removed facade diagnostic could describe iframe-only connection as a worker
prewarm attempt. Its removal changes diagnostics only; no auth/control-flow branch
consumed it. This cleanup does not claim extra worker-transfer savings because
the all-worker startup loop was already removed.

Private consumer migration remains tied to the exact new release. Both
`apps/wallet-console/src/context/frontendRuntime.tsx` and
`apps/seams-site/src/context/frontendRuntime.tsx` declare/destructure/forward
`eager`; remove those wrapper props. Also remove `eager` from
`apps/wallet-console/src/marketing/WalletMarketingRoute.tsx`. Their current package
pins remain unchanged. No private app prewarm call was found in the source audit.

Evidence: `evidence/refactor-170-preparation-cleanup-20261005.json`.
The complete per-operation worker matrix and cold/warm latency gates remain open.

Final-source verification passes 43 browser cases and six production cases,
including worker initialization retry, interrupted Email OTP export recovery,
EVM execution with NEAR admission/execution held, and cold/warm signed-out assets.
Cold/warm signed-out mount/menu creates zero workers; the authenticated asset
scenario creates 20 across registration, signing, and unlock. These are current
observations, not an attributed transfer saving. Production TypeScript adds six
lines and removes 401, net −395. Build, types, declarations, runtime boundaries,
and bloat checks pass.

### Registration-menu preload checkpoint

The `initialMode === 'register'` branch in `host/auth-menu/controller.ts` called
`preloadWalletHostRegistrationSurface` before account input. That path loaded
`runtime-near`, `runtime-ecdsa-tempo`, both EVM/Tempo signing implementations, and
both signer engine constructors. It was independent of the selected registration
operation. The branch, loader promise/helper, and `registrationPreparationPreload.ts`
are deleted.

Actual registration retains `AuthMenuSession.setRegistrationPreparation` and
`startPasskeyPreparation`, then the controller's typed signer selection and
`prepareHostedPasskeyRegistration`. `startRegistrationWarmup` still prepares ECDSA
only when selected and Email OTP Yao only when the factor/signer set requires it.
Signing still awaits the existing loaders through `transactionExecutor` and
`signingFlowRuntime`. Recovery-code surface loading is unchanged.

The earlier generic-menu measurement opened in login mode and did not cover this
branch. The new production scenario opens a sponsored-account registration menu
with empty input, under cold then warm caches. It records assets without invoking
registration. An initial fixture used implicit-wallet mode, which supplies a
generated read-only name; that was classified `valid_test_needs_update` and changed
to the existing sponsored-account form before the SDK modification.

The unchanged-SDK baseline fetched seven additional JS assets during cold menu
opening, totaling 8,002 browser-reported encoded body bytes. After removal, the
same cold-menu phase makes zero additional asset requests. Both runs create zero
workers. This task removes 36 production TypeScript lines and adds none.
The 11 browser cases and three production asset scenarios pass. The production
scenario also checks that cold/warm empty registration menus fetch no signing
implementation chunks. Build, types, declarations, and runtime boundary checks pass.
Before/after artifacts, accounting limits, and production registration/signing
acceptance are recorded in `evidence/refactor-170-registration-menu-20261005.json`.
This is a measured deferral of unused menu work; do not infer a whole-operation
payload saving or close the paired-median latency/complete worker-matrix gates.

### Unified registration API checkpoint

The public client, explicit runtime, and React now expose one wallet-creation
operation: `registration.registerWallet` (React `registerWallet`). Removed
`registerPasskey`, `registerWithEmailOtp`, `near.registerNearWallet`, and
`evm.registerEvmWallet`, including their option types, duplicated client/host
input builders, and React progress wrappers. No aliases remain.

All four former paths already reached the unified ceremony. Callers now supply
its existing `authMethod`, `wallet`, and `signerSelection` fields directly.
Implicit and sponsored NEAR provisioning remain signer-selection branches.
The hosted menu still resolves configured defaults and selected-flow preparation.
Custom UI passes explicit intent; it can request a server-allocated identity.
The unified client error path supplies the error to `afterCall`, preserving the
former chain shortcut's callback contract.

The intended app's combined passkey flow now uses the React `registerWallet`
hook. Its existing NEAR-only and ECDSA-only flows use the same client operation.
Public examples and creation docs use the unified call. Negative type fixtures
reject the four removed names and registration without authentication.
A source scan found no callers of the removed creation methods under private
`apps/` or `packages/`; exact-release adoption remains a separate pending gate.

Verification and source accounting are recorded in
`evidence/refactor-170-registration-api-20261005.json`. This checkpoint does not
complete the remaining email, device, key, recovery, and provisioning API renames.

The final source passes 11 browser cases and five production cases: Email OTP
registration/unlock/export/signing, NEAR-only signing across refresh, protocol
rejection/reload, ECDSA reply-loss retry, and immediate mixed-wallet signing.
The protocol case initially failed because its storage probe used Vite `/@fs/`
in production. Classified `valid_test_needs_update`, it now serves a bundled
probe and passes without changing the storage assertion. Production TypeScript
adds 21 lines and removes 406 (net −385), excluding type fixtures and docs.

### Public NEAR account readiness checkpoint

The registration capability now names its read, wait, and subscription
`getNearAccountState`, `waitForNearAccount`, and `onNearAccountChange`. Client,
explicit runtime, React profile/refresh consumers, type fixtures, and public
examples use those names. The message discriminator and underlying provisioning
state/event shapes retain their existing contracts. There are no public aliases.

The public factory binds the existing wait directly, removing its forwarding
closure and repeated dependency object. The intended app uses this public wait
instead of its separate subscription/read/timeout implementation. A source audit
found that the former timeout expression clamped missing input to 1 ms before
applying the documented default. Missing input now selects 120 seconds first.
The wait still subscribes before reading and cleans up listeners and timers.

The existing gated-registration E2E now starts the default public wait while
NEAR is held. It verifies the wait remains pending for 250 ms, releases the gate,
and verifies account readiness, unchanged session authority, and NEAR signing.
Each run attaches `near-account-readiness.json` with these non-secret facts.
Results and source accounting are recorded in
`evidence/refactor-170-near-account-api-20261005.json`.
No private `apps/` or `packages/` callers use the replaced readiness method names.

Five production cases pass on the final build: four held admission/execution
cases across passkey and Email OTP, plus immediate owner-session signing.
Build freshness, types, declarations, runtime boundaries, and bloat checks pass.
Production TypeScript adds 129 lines and removes 137 (net −8), counting the file
rename on both sides. Test code adds 40 lines and removes 68 (net −28).

The declaration-resolution probe needed the renamed method and now passes.
Its scope is unresolved modules and `any` degradation. Initial raw diagnostics
also showed generated WASM `Symbol.dispose` errors with the probe's ES2022 libs.
Do not treat that probe as complete external-consumer compilation evidence;
resolve the library contract and verify all diagnostics before final acceptance.

### Packed external TypeScript consumer checkpoint

The exposed `WasmRouterAbEd25519YaoActiveClientV1` implementation constructor
pulled a generated WASM declaration into the public type graph. That declaration
requires `Symbol.dispose`, which an ordinary ES2022 consumer does not declare.
Only a constructor-rejection type fixture imported the implementation class.
Runtime callers already consume the existing active-client interfaces.

The class is now module-internal. Its construction guard, verified WASM ownership,
activation paths, and disposal behavior are unchanged. The type fixture now
rejects access to the internal constructor. Declaration emission no longer
includes the class, its construction input, or the generated WASM import.
No generated files, compiler-library settings, or global type shims were edited.

`check:declarations-external` now packs and extracts the actual Wallet npm
artifact, then compiles root, React, and explicit-runtime consumers. It checks
for `any` through type assertions and requires a zero compiler exit code, with
strict ES2022 settings, no SDK source aliases, and `skipLibCheck: false`.
The old diagnostic substring filter could report success despite other errors.
The strengthened check failed on the previous declarations and passes after
regeneration. It reports the tested tarball integrity and always removes its
temporary directory.

Installed runtime dependencies, optional peers, and peer typings are linked from
the repository. This is package-content and strict declaration evidence, not a
fresh registry installation, optional-peer absence test, or complete runtime
acceptance. Verification details are in
`evidence/refactor-170-external-consumer-20261005.json`.

Final verification passes the strict tarball consumer, the existing packed
Wallet/server boundary smoke check, runtime-entry checks, and two production
cases. Those cases cover NEAR-only signing across refresh and Email OTP
registration/unlock/export/signing. The normal npm packaging lifecycle supplies
the tested archive. The verifier reports its integrity in the saved evidence.

### Registration method names checkpoint

The public registration namespace now uses `addSigner`, `addEmail`, and
`removeAuthMethod`. Client commands, host commands, explicit runtime, React
components, and the intended app use those names without compatibility aliases.
React context and `useWalletAuth` expose `addSigner`. A redundant async React
forwarder is removed; the existing SDK-flow callback owns instrumentation.
Public input type fixtures reject the three replaced method names.

Arguments, callback outcomes, wire message discriminators, and authorization
proofs retain their existing contracts. Internal Email OTP and revocation modules
keep their domain-specific file names. No private application/package call sites
use the replaced names; exact-release adoption remains a separate gate.

Production verification found a stale aggregate session-read limit in the unlock
harness. The intended behavior permits each sibling method to retain its own
active session. The host reconciles each stored session with its own credential.
A temporary trace found three reads for the selected session and one for its
sibling. The check now allows one read per distinct session plus two repeated
reads across the whole unlock. A single-session unlock retains its three-read
limit. Missing request identities fail the check. The trace records session and
quota identifiers, never operation credentials, for repeatable request accounting.
Temporary stack instrumentation was removed.

Verification and source accounting are recorded in
`evidence/refactor-170-registration-methods-20261005.json`. The complete worker,
returning-user, browser, and release acceptance gates remain open.

Nine browser cases and four production cases pass. Production cases cover
distinct Ed25519 signer addition, ECDSA addition across a lost response, and both
authentication-method addition directions through signing, export, and removal.
Strict packed declarations, runtime boundaries, build freshness, types, and the
bloat gate pass. Production source adds 73 lines and removes 78 (net −5).
The harness accounting correction has separate evidence in
`evidence/refactor-170-session-read-accounting-20261005.json`.

### EVM and Tempo transaction names checkpoint

EVM and Tempo expose `signAndSendTransaction` for the existing complete send
lifecycle. React bindings, reviewed capability calls, documentation, and examples
use the new name. `signTransaction` retains chain-specific request and signed
result types. Tempo exposes `getFeeToken`, `validateFeeToken`, and `setFeeToken`.
The last operation still submits an on-chain fee-token update.

Deprecated `signTempo`, `executeEvmFamilyTransaction`, ordinary bootstrap, and
Tempo lifecycle-reporting aliases are removed. Host handlers use the canonical
signing method and `advanced` reporting. EVM advanced bootstrap now binds the
existing EVM-specific builder; the old shared advanced object used Tempo's
builder. The host retains the same chain-specific bootstrap behavior through
these bindings. Bootstrap internalization remains an open R171 task.

One composition function constructs both capabilities and privately shares the
existing EVM-family send implementation. No generic execution alias is needed
on Tempo. Ordinary and reviewed construction reuse this same composition.
Wire messages and the execution lifecycle implementation remain unchanged.
Negative type fixtures reject all removed ordinary aliases. A private-source
scan found no callers of the renamed transaction or fee-token methods.

Evidence: `evidence/refactor-170-transaction-names-20261005.json`.
Live-chain broadcast/finalization and fee-token transaction acceptance remain
open. These scoped checks do not replace the full R170 operation matrix.

The production build, types, strict packed declarations, runtime boundaries,
freshness, and bloat checks pass. All 31 transaction-review browser cases and
three production signing/lifecycle cases pass. Production code adds 81 lines and
removes 106 (net −25), excluding type fixtures and documentation.

### NEAR transaction submission consolidation checkpoint

`near.signAndSendTransaction({ receiverId, actions, options })` is the sole NEAR
sign-and-submit operation. React context and bound wallets use the same name.
Callers supply a single action as a one-element array. The former `executeAction`
path duplicated input resolution, callbacks, review dispatch, router handling,
and the core sign/send sequence. Those paths and the unused default-wait entry
are removed. The React context uses the existing bound capability directly.

The audit found a failure-contract difference: `executeAction` converted caught
exceptions into `success: false`; the canonical send operation rejects. Migrated
callers now use the canonical rejection contract. Its existing confirmation,
wait status, callback ownership, signed-result readiness, nonce reporting, and
error details remain unchanged. No compatibility wrapper or handler remains.

Removing `PM_EXECUTE_ACTION` advances the iframe protocol from 3.0.0 to 4.0.0.
The existing build generates the asset manifest from that same source constant.
Release and rollback require matched client and wallet-host artifacts; mixed
versions reject at handshake. This is an unreleased source change, with no
publication or deployment performed.

Existing behavioral tests now send the canonical payload through cancellation,
timeout, connection closure, session expiry, preference ordering, and review
flows. The duplicate reviewed-method branch is retired; callback and error
assertions remain for every supported transaction method. Type fixtures retain
subject requirements and reject the removed public method. No private application
or package callers use the removed operation.

Evidence: `evidence/refactor-170-near-consolidation-20261005.json`.
NEAR sign-only/message/delegate naming and test-funding export cleanup remain
open, together with live-chain submission, worker, returning-user, and release
acceptance gates.

All 56 selected browser cases and three production registration/signing cases
pass. Types, production build, strict packed declarations, runtime boundaries,
build freshness, and bloat checks pass. Production source adds 13 lines and
removes 348 (net −335), excluding tests and documentation. The production HTTP
protocol-rejection case is separate from iframe handshake-skew coverage.

### NEAR signing method names checkpoint

NEAR now exposes `signTransaction`, `signMessage`, and `sendDelegateAction`.
Client commands, router calls, host commands, React bindings, the intended app,
public examples, and the console-lite example use those names. Core operation
entry names follow their callers, while internal payload and wire discriminators
retain their existing contracts. No legacy aliases remain on the public API.
The message React binding directly reuses the existing bound capability.
Two signing-dispatch helpers with no external callers are module-internal.
The console-lite example no longer passes the retired provider `eager` prop.

A production E2E scenario signs a message before and after browser refresh, then
signs a NEAR transaction. It compares the account and public key with registration,
independently encodes the existing message/recipient/nonce/state payload, verifies
the Ed25519 signature, and verifies rejection of an altered message. It attaches
`near-message-signatures.json` with public inputs, nonces, signatures, keys, and
digests so verification can be repeated. This closes the absent production
message-signing check without changing the codec or cryptographic protocol.

The private Console and site still call the old delegate submission name in
`apps/wallet-console/src/flows/demo/hooks/useDemoNearActions.tsx` and
`apps/seams-site/src/flows/demo/hooks/useDemoNearActions.tsx`. Their migration must
accompany adoption of the matching exact Wallet release. Their currently pinned
published release is unchanged by this local SDK task.

Evidence: `evidence/refactor-170-near-names-20261005.json`.
Live delegate relay submission, funding-tool export cleanup, and the full worker,
returning-user, browser, and consumer-release acceptance gates remain open.

All 40 selected browser cases and three production scenarios pass. A separate
message-case rerun verifies persistent artifact output. The evidence embeds its
public receipts and source-artifact hash. Production build, source/consumer types,
strict packed declarations, runtime boundaries, freshness, and bloat checks pass.
SDK production source adds 62 lines and removes 67 (net −5); E2E verification
and documentation additions are separate.

### Device API names checkpoint

The public device capability now uses `startLinking`, `approveLinking`,
`cancelLinking`, `list`, and `remove`. React context, QR components, device menus,
the application command adapter, host handlers, and intended-app callers use the
same names. The new device starts linking; the authorized device approves it.
Two redundant React wrappers are removed. Negative type fixtures reject the old
public names. Internal router methods and management ports retain their precise
operation names. Wire messages and iframe protocol 4.0.0 are unchanged.

Removal still accepts `requestedAtMs` and `sourceProof`. Existing passkey and
email proofs bind that timestamp before submission. Generating another timestamp
inside `remove` would invalidate the proof. The higher-level
`registration.removeAuthMethod` already owns passkey proof preparation. Email
challenge and returned-flow consolidation remain open and must move preparation
and submission together. The rename does not weaken proof admission or change QR
validation, pagination, activation, revocation, or material retirement.

Private Console/site source searches found no callers of the retired device
methods. Scoped verification is recorded in
`evidence/refactor-170-device-names-20261005.json`. Full cancellation, expiry,
selective worker loading, and cross-browser acceptance remain open.

All eight selected browser cases and three production cases pass. Production
cases cover lost activation/acknowledgement responses, third-device ECDSA signing,
and email-authorized revocation after a refused commit. Source types, production
build, packed declarations, runtime boundaries, freshness, and bloat checks pass.
SDK production source adds 65 lines and removes 76 (net −11), excluding fixtures.

### Recovery API names checkpoint

Recovery code calls now use `getCodeStatus`, `confirmBackup`, and `rotateCodes`.
The public client, router, wallet host, React menu, and intended app use those
names. The React flow adapter reuses the bound recovery capability and overrides
only `syncAccount`; four forwarding closures are deleted. Three redundant client
block scopes are removed. Negative type fixtures reject the old public names.

Wire requests, authorization inputs, backup acknowledgement semantics, and
rotation outcomes remain unchanged. `confirmBackup` records the user's backup
acknowledgement; it does not verify an external copy. Core rotation operations
retain their domain-specific names. No public compatibility aliases remain.

The private repository's retained intended-app source still has two old status
calls in `tests/intended-app/src/page.tsx`. Migrate them with its matching exact
package release if that app remains supported. Private application/package
source searches found no other callers of these retired recovery methods.

Scoped evidence: `evidence/refactor-170-recovery-names-20261005.json`.
Direct rotation acceptance, `syncAccount` acceptance, email challenge
internalization, and the full worker/browser matrix remain open.

The host summary/cancellation case passes (1.6s). Google recovery with a lost
finalization response and runtime reset passes (33.7s). The corresponding passkey
case fails twice during the subsequent unlock. Confirmation is clicked, the UI
stays on “Unlocking wallet”, and the action exceeds its 120-second wait.

A production build of base commit `9153c56b` reproduces the stalled path:
recovery finalization replays successfully, the unlock challenge returns HTTP 200,
and its two allowed credentials include the recovered credential. No unlock
verification request follows. The comparison was terminated after observing the
same stall beyond the unlock wait limit. This is evidence of an existing
acceptance failure, not a passing baseline test. Root cause remains unresolved
between wallet behavior and browser/test infrastructure. No behavior or test
expectation was changed to bypass it. Diagnose and close this gate before the
full R170 recovery acceptance claim.

Source types, packed declarations, runtime boundaries, freshness, and the
production build pass for the renamed API. SDK production source adds 39 lines
and removes 57 (net −18), excluding type fixtures.

### Recovery journal probe session ownership

The passkey unlock failure above is resolved as `environment_or_infrastructure_failure`.
The journal probe created and detached a second Chrome debugging session while
WebAuthn used the harness-owned session. Diagnostic reads found the virtual
WebAuthn environment disabled immediately after the journal probe. Re-enabling
that environment found that the authenticator was gone. Chromium's
[WebAuthn handler](https://chromium.googlesource.com/chromium/src/+/HEAD/content/browser/devtools/protocol/webauthn_handler.cc)
disables the virtual environment when its renderer is detached.

The harness now retains its initialized debugging session and lends it to journal
reads. The probe releases its remote row object after extracting identity
metadata; it never detaches the harness session. Custody material stays in the
browser. No production code, recovery invariant, or test expectation changes.
Temporary browser instrumentation and credential probes are removed.

Both existing production cases pass: Google recovery (32.6s) and passkey recovery
(30.3s), each with a lost finalization response and runtime reset. The passkey case
then unlocks, signs Tempo and NEAR, and rejects reuse of the consumed recovery
code. Evidence and reproduction command:
`evidence/refactor-170-recovery-probe-session-20261005.json`.
This resolves the previously recorded replay/unlock gate. Direct rotation,
`syncAccount`, selective loading, and cross-browser acceptance remain open.

Other network observers detach only when their observation finishes. Keep that
point after the scenario's last WebAuthn operation; they must not be used as
mid-flow snapshots that detach an active test authenticator.

### Confirmation preference naming checkpoint

The public and React setter is now `setConfirmationBehavior`. Client and host
adapters, the preference manager, account-menu callers, and existing preference
scenarios use that name. A negative type fixture rejects `setConfirmBehavior`.
React directly reuses the bound behavior setter, configuration setter, and
configuration getter, removing three forwarding closures.

The setter still updates the application preference view synchronously and queues
its write. `flush`, wallet-bound ordering, rollback, signing admission, and durable
host acknowledgement keep their existing contracts. Wire message names and
iframe protocol 4.0.0 are unchanged. Private source searches found no callers of
the old preference setter.

Scoped verification and package integrity are recorded in
`evidence/refactor-170-preference-name-20261005.json`. The full React remount/SSR,
worker-loading, browser, and release-consumer acceptance gates remain open.

Eight preference browser cases pass across the initial run and targeted fixture
rerun. The persistence fixture correction is committed separately as `a66bb657`;
it aligns the stub's selected-wallet snapshot with its real preference manager.
The production custom-review Arc signing scenario passes (27.3s). Types, build,
packed declarations, runtime boundaries, and freshness pass. SDK production source
adds 16 lines and removes 30 (net −14), excluding type fixtures.


### Key export API checkpoint

The public operation is `keys.exportKey`. React and documentation examples use
that name. Lane resolution and viewer dispatch remain internal operations, with
no advanced public alias. Host dispatch retains the capability check for each
operation. Wallet, account, chain, lane, material activation, and authorization
checks keep their existing owners. The wire messages and protocol 4.0.0 remain
unchanged. The operation returns `exported` or `relink_required`; private keys
remain inside the wallet-origin viewer.

The intended app now exercises the single public call for both curves. Its Email
OTP unlock summary projects target addresses from the public session, using the
same helper as registration. This summary no longer independently probes export
lanes. Actual signing scenarios still compare recovered signing addresses with
registered addresses. Export scenarios exercise the internal lane handoff.

Private apps and packages have no callers of the removed export steps. The
private retained intended app has five references and needs migration with the
exact SDK release. Release migration, relink acceptance, selective loading, and
cross-browser acceptance remain open.

Four browser cases pass after the obsolete preference fixture override was
removed in `cb19e299`. Three production cases pass: Email OTP registration,
unlock, refresh, signing and export; interrupted export authorization retry;
and third-device signing and export of both curves. Types, production build,
packed declarations, runtime boundaries, freshness, docs/examples, and bloat
checks pass. SDK production source adds 84 lines and removes 112 (net −28),
excluding type fixtures. Evidence: `evidence/refactor-170-key-export-20261005.json`.


### ECDSA bootstrap ownership checkpoint

Application callers no longer expose `evm.advanced.bootstrapEcdsaSession` or
`tempo.advanced.bootstrapEcdsaSession`. Searches of public examples, docs,
intended apps, and private apps/packages/tests found no runtime callers. The
positive public type fixture was the only application call site. Negative type
fixtures now reject both methods and the retired transport route.

Removed `BootstrapThresholdEcdsaSessionArgs`, both chain-specific bootstrap
argument builders, public forwarding methods, application/host command adapters,
router dispatch, and `PM_BOOTSTRAP_THRESHOLD_ECDSA_SESSION`. The EVM advanced
capability now reuses the same broadcast-reporting object as Tempo. Its five
supported broadcast and nonce methods remain available.

Host authentication still calls the existing `LoginWarmSigningSurface` bootstrap
port, with the resolved wallet identity, exact chain target, and runtime scope.
The explicit runtime port and core bootstrap implementation remain in place.
Public Email OTP results still use `PublicThresholdEcdsaSessionBootstrapResult`;
that result type is retained for those supported flows.

Removing the route increments the iframe protocol from 4.0.0 to 5.0.0. Deploy the
client and wallet host together. Existing handshake tests check rejection of the
previous version and a future incompatible version. No compatibility route is
retained. The router session-loss fixture now directs users to unlock rather
than naming a removed application method.

Sixteen browser cases pass, including handshake version rejection, session-loss
handling, and signing progress. Two production scenarios pass: passkey unlock
with immediate export/shared-budget signing (31.8s), and refresh with warm
signing, one-use step-up, and export (36.4s). Types, build, packed declarations,
runtime boundaries, freshness, docs/examples, and bloat checks pass. SDK source
adds 3 lines and removes 177 (net −174), excluding type fixtures. Evidence:
`evidence/refactor-170-bootstrap-internal-20261005.json`.


### React session and account-input naming checkpoint

`useSeams` and `useWalletAuth` expose `refreshSession`. `useSeams` and
`useAccountInput` expose `setAccountName`. Context construction, provisioning
updates, QR linking completion, account-menu authentication, the intended app,
and wallet-console-lite use the new names. The replaced names have no aliases.
Negative type fixtures reject the old members.

`refreshSession` still returns `Promise<void>` and refreshes React's session
projection with the existing exact-wallet selection and readiness checks.
`getSession` remains the operation for retrieving a session value. `setAccountName`
retains lowercase input normalization, empty-input autofill suppression, and
saved-wallet matching. Removed the helper that merely forwarded refresh through
an extra async call. These changes do not complete the provider replacement,
remount, SSR, or cross-browser acceptance gates.

Private Console and site `HostedPasskeyLoginMenu` callers and the retained private
intended app still use `refreshLoginState`. Migrate them with the exact SDK release.
The account-menu responsiveness fixture now supplies `refreshSession`; its behavior
assertions remain unchanged.

Five account-menu browser cases and the production Email OTP registration,
unlock, refresh, signing, and export lifecycle pass. Types, build, packed
declarations, runtime boundaries, freshness, docs/examples, and bloat checks pass.
The example's existing refresh callback initially collided with the SDK rename;
renaming that local callback to `refreshSelectedWallet` fixed its type check.
SDK production source adds 59 lines and removes 65 (net −6), excluding type
fixtures. Evidence: `evidence/refactor-170-react-names-20261005.json`.


### External EVM receipt waiting checkpoint

`ExternalEvmController.waitForReceipt` replaces `observeReceipt`. The previous
method performed one lookup; the new method uses the existing EVM RPC polling
operation. No new polling engine or compatibility alias is added. Chain ID is
checked before polling; hash, sender, status, and block checks remain after it.
The captured submission remains independent of later provider selection changes.

Polling defaults to 90 seconds and a 1.25-second interval. Optional `timeoutMs`
and `signal` configure waiting. Inclusion in one block returns `confirmed` or
`reverted`. Missing configuration, timeout, cancellation, or an unverified receipt
returns `unresolved`. This does not promise finality or trigger transaction resend.
An in-flight request can complete before cancellation settles.

The old single-lookup unit case encoded retired behavior and was removed. The
replacement browser contract imports the production public entry and covers
pending-to-confirmed/reverted, wrong sender/hash/chain, timeout, and cancellation.
It writes `receipt-observations.json`. Controlled RPC responses are used; extension
and real-chain release acceptance remain open. Types, build, packed root/React/
runtime declarations, runtime boundaries, and freshness pass. SDK production
source adds 8 lines and removes 9 (net −1). Evidence:
`evidence/refactor-170-external-receipt-20261005.json`.


### Optional React peer absence checkpoint

The existing `check:declarations-external` command now checks two consumers from
the same npm tarball. The original consumer retains workspace dependencies and
checks strict root, React, and runtime declarations. A separate temporary project
installs the tarball with `npm install --ignore-scripts --omit=optional
--legacy-peer-deps --no-audit --no-fund`. It has no workspace dependency links.

The isolated core consumer imports root and external-EVM APIs, compiles with
`strict: true`, `skipLibCheck: false`, no path aliases, and no automatic type
packages. A Node import probe resolves the two entries and asserts that React,
React DOM, and their type-package manifests cannot be resolved. It also checks
the `waitForReceipt` declaration and rejects the removed `observeReceipt` name.
The command logs tarball integrity and the isolated install lock hash, then
removes both temporary projects. It installs only into temporary directories.

This proves core/external-EVM package use without React. It does not prove React
provider SSR, remount, browser feature behavior, optional QR feature loading, or
published-release deployment. No SDK production source changed. Evidence:
`evidence/refactor-170-optional-react-20261005.json`.

### Signer-specific asset checkpoint

Production browser scenarios now measure NEAR-only and ECDSA-only passkey wallets
through registration, lock, reload, unlock, signing, and restored signing.
ECDSA-only includes Tempo and Arc EVM. The scenario consumes three authorized
signatures, checks the authoritative exhausted session state, and verifies fresh
authorization for the fourth signature. Both scenarios pass. The common unlock
harness now verifies the existing absent-NEAR branch while retaining identity
checks for NEAR-ready wallets and the separate pending-NEAR scenario.

The NEAR-only run creates ECDSA derivation and Email OTP workers during unlock.
It creates no ECDSA presign or online worker. The ECDSA-only run creates no
NEAR signing worker. Shared envelope cryptography can still load near_signer
WASM; worker names alone do not establish unnecessary binary dependencies.
Trace cleanup operations that create workers before claiming selective loading.

Browser routing disables caching in these scenarios. The local preview serves
both gzip and identity responses. Server body totals are 9,257,258 bytes for the
NEAR run and 8,871,339 bytes for the ECDSA run, across all phases and reloads.
These are separate scenarios, not a before/after comparison. Browser body capture
has 13 and 20 errors respectively across reloads; network collectors report no
errors. Retained artifacts preserve completion states and separate accounting.
Paired cold/warm measurements, deployed compression, and repeatable latency gates
remain open. No SDK production source changed. Evidence:
`evidence/refactor-170-signer-assets-20261005.json`.

### Cleanup without worker creation checkpoint

The transport now completes volatile linked-holder and Email OTP cleanup locally
when the owning worker is absent. An existing worker still receives the same
cleanup request. The existing worker map owns this decision; no registry,
eviction policy, or durable presignature deletion is added. ECDSA transport
requests now preserve the correlation between operation type and payload.

The production NEAR-only scenario asserts that no ECDSA or Email OTP worker
starts across registration, lock, unlock, and restored signing. It passes with
12 worker creations, compared with 15 before this change. ECDSA-only restored
signing and step-up, the Email OTP lifecycle, and third-device linking with
signing and export also pass. These flows exercise already-created workers.

The single routed measurements do not establish cold/warm latency improvement
or deployed transfer savings. Full worker lifetime and dependency acceptance
remains open. Production source adds 22 lines and removes 5 (net +17).
Evidence: `evidence/refactor-170-cleanup-workers-20261005.json`.

### Operation-specific custody loading checkpoint

The custody worker no longer initializes the ceremony binary before every
request. New key-set runs, NEAR ceremony restoration, and recovery-code rotation
explicitly await it. Continuation steps already hold ceremony handles. Envelope
and export-root handlers retain NEAR signer initialization; lane-source handlers
retain Yao initialization. No custody proof, authorization, or persistence changes.

Production NEAR-only and ECDSA-only scenarios assert a ceremony WASM request during
registration and none during ordinary unlock after reload. Both pass. Assertions
use request-start phases from the existing network observer; successful registration
provides a positive observation check. Recovery followed by Email OTP addition,
signing, export, and step-up passes. Resumed encrypted NEAR registration and
third-device linking with NEAR/Tempo signing and both exports also pass.

Types, build, runtime boundaries, freshness, and the bloat gate pass. Production
source adds 3 lines and removes 1 (net +2). Direct public recovery-code rotation
acceptance remains open, so its broader plan item stays unchecked. These routed
single runs do not establish warm-cache latency or deployed transfer savings.
Evidence: `evidence/refactor-170-custody-loading-20261005.json`.

### Failed initialization retry checkpoint

Email OTP's EVM helper, unlock runtime, and ceremony loaders now clear rejected
initialization promises. The Shamir worker does the same. Existing in-flight
promises still coalesce concurrent requests; successful initialization remains
cached. Redundant async wrappers are removed. The change follows the existing
Email OTP Yao failure-reset pattern and changes no authorization or stored material.

The emitted-worker browser scenario now covers Shamir alongside EVM and Tempo.
It makes WASM unavailable, observes operation failure, restores delivery, and
verifies concurrent success and reuse with one successful binary fetch and one
worker creation. A separate browser probe runs the production Email OTP loader
source against emitted WASM for all three repaired loaders. It verifies the same
failure/concurrency/reuse sequence, including unlock-seed derivation. It does not
dispatch the full Email OTP worker protocol; that same-worker acceptance remains
open. Both probes write repeatable JSON artifacts.

All three static-asset browser scenarios pass. The production Email OTP lifecycle
also passes through registration, unlock, signing, export, reload, and step-up.
Wallet/browser types, production build, runtime boundaries, freshness, and bloat
checks pass. Production source adds 43 lines and removes 31 (net +12).
Evidence: `evidence/refactor-170-loader-retry-20261005.json`.


### Email OTP signer-selection and NEAR restoration checkpoint

Google registration now checks its resolved signer selection before starting Yao
preparation. Direct registration shares that predicate; the old plan-conversion
predicate is removed. Wallet-name reroll preserves the selection. ECDSA-only
Google registration and Tempo/Arc signing pass without a Yao binary request.
NEAR-only registration requests Yao and passes signing plus reload/restored signing.

The new NEAR scenario exposed an existing restoration defect: its host path
required an ECDSA manifest even for an Ed25519-only authority. The host now chooses
an explicit absent/required ECDSA branch from active authority signer ownership.
A combined authority still fails if its exact ECDSA manifest is unavailable.
The worker boundary rejects incompatible fields. NEAR-only restoration uses the
existing Ed25519 recovery completion; combined restoration retains ECDSA activation
and exact session checks. Both branches verify the returned authorization before
using it. The NEAR-only refreshed credential is persisted for later restoration.

Static fixtures reject missing material, mixed literals, broad spreads, and
incompatible branch assertions. The combined production Email OTP lifecycle passes
through unlock, signing, export, reload, and step-up. The two signer-specific
helpers now retain the registered wallet ID after reroll. Asset recording uses one
shared fixture, with separate Email OTP and passkey auth guards.

Production source adds 212 lines and removes 110 (net +102). The new branches fix
required behavior; line removal remains an expectation rather than a gate.
Injected preparation failure remains open. Routed observations do not establish
warm-cache latency or deployed delivery savings. Evidence:
`evidence/refactor-170-email-otp-signer-selection-20261005.json`.


### Camera controls and internal retry (2026-10-05)

`useQRCamera` exposes `selectCamera` instead of `handleCameraChange`. Its error
setter and unused facing-mode callback are removed from the public return shape.
The hook still selects camera constraints internally. `QRCodeScanner` uses
`startScanning` for its retry action, which clears the error and starts the camera.
The hook documentation no longer claims a provider dependency that does not exist.

A browser scenario loads the emitted hook with React and the real QR decoder.
Controlled media-device requests reject the first attempt and return canvas-backed
MediaStreams afterward. The scenario verifies retry, back-camera constraints,
release of the previous stream, explicit stop, file-mode cleanup, camera-mode
restart, and unmount cleanup. All four acquired tracks end. This verifies the
hook lifecycle with controlled hardware; it does not prove physical-camera or
QR-payload recognition behavior. Chromium passed in 2.6 seconds.

Wallet/browser typechecks, production build, packed declarations, runtime entry
boundaries, and build freshness passed. SDK production source: 6 lines added,
20 removed (net -14). Repeatable evidence and command:
`evidence/refactor-170-camera-api-20261005.json`. Broader React replacement and
cross-browser acceptance remain open.


### Google sign-in entry and returned-flow inventory (2026-10-05)

`auth.startGoogleSignIn` replaces the old Google authentication entry across the
client, runtime, hosted menu, docs example, and intended app. It preserves
`GoogleEmailOtpWalletAuthStartInput` and the existing Result-style return union.
Provider evidence remains the required `idToken`. Login requires a discoverable
or exact-wallet target. Registration retains signer selection and backup policy.
No compatibility alias or new protocol message is introduced.

The returned flow owns the wallet identity, flow identity, expiry, and prompt.
Applications select controls through its existing `mode`/`state` discriminants.

| Branch | Public controls | Current ownership and behavior |
| --- | --- | --- |
| Both | `cancel()` | Host burns the flow's active flag. The client sends the bound handle, flow, wallet, and mode. |
| Registration (`registration_ready`) | `completeRegistration()` | Uses the selected wallet and signer arguments. Successful persistence returns registration and session results. The client reconciles the exact wallet session. |
| Registration (`registration_ready`) | `rerollWalletId()` | Returns a replacement registration flow and retires the prior flow. Preserves signer selection and started preparation. |
| Login (`challenge_sent`) | `resend()` | Obtains a replacement challenge and returns a replacement login flow. Retires the old flow after the challenge succeeds. |
| Login (`challenge_sent`) | `submit({ otpCode })` | Validates a six-digit code and performs the existing authority/curve-specific unlock. Successful client completion reconciles session state. |

The host checks activity and expiry before each operation. This static inspection
is insufficient to prove cancellation during an outstanding operation: liveness
is checked before awaited work. Keep concurrent cancel/submit, repeat completion,
expiry, and resend replacement acceptance open. The demo callbacks were subsequently internalized in the checkpoint below. General Email OTP
challenge/refresh methods and added-factor unlock still need their separate
purpose and authority audit before consolidation.

The renamed entry passed the production Email OTP lifecycle in 47.9 seconds and
the exact-session router browser case in 1.7 seconds. Wallet, intended, browser,
and docs types passed, as did the production build, packed declarations, bundle
boundaries, and freshness check. The packed consumer rejects the removed entry.
SDK production source remains line-neutral (18 added, 18 removed). Evidence:
`evidence/refactor-170-google-sign-in-api-20261005.json`.


### Demo Email OTP handling stays in the SDK (2026-10-05)

The wallet-origin OTP view displays demo codes from its existing delivery state.
The same renderer supports hosted Google login and recovery. Provider delivery
has no demo code. Replacement delivery replaces the displayed value; rendering
never submits a code. Custom UI retains the existing returned-flow delivery data.

Removed the `onDemoEmailOtp` React prop and handler type, the Google-flow
`onDemoOtp` input callback, the top-level hosted delivery subscription, and all
coordinator/router listener and forwarding code. Removed the host-to-parent event,
its parser, payload type, and React re-exports. The existing StrictMode fixture
lost its obsolete fake subscription. No compatibility path remains.

The iframe protocol advances from 5.0.0 to 6.0.0. Client and host must deploy
matching protocol versions. Existing mismatch tests now exercise versions 5/6
and 6/7. Hosted external provider evidence and terminal outcome callbacks remain
unchanged. General Email OTP challenge consolidation remains open.

The production Email OTP lifecycle passed in 47.4 seconds. The initial browser
run passed 16 cases, including demo replacement, host integration, React lifecycle,
and protocol rejection. Two confirmation handoff cases requested an obsolete
source-shaped module URL. Classified as `valid_test_needs_update`: the build emits
`sdk/tx-confirm-ui.js`. The tests and shared path now use that emitted entry; both
handoff cases passed afterward. The associated motion suite passed three cases
and exposed a separate raw-calldata height-change failure. Its cause is still
under investigation; no production motion code was changed for this cleanup.

Wallet, intended-app, browser, and docs types passed. Production build, packed
consumer declarations, bundle boundaries, freshness, and bloat checks passed.
SDK production source: 23 lines added, 225 removed, net -202. Evidence:
`evidence/refactor-170-demo-email-internal-20261005.json`.

The raw-calldata motion failure reproduced in isolation after the path correction.
Keep this acceptance gap open. Inspect the rendered disclosure, its actual height
change, and emitted measurement before classifying it as a production defect or
an obsolete geometry expectation. Do not weaken the assertion or change production
motion solely to satisfy the fixture. The trace path is in the evidence file.


### Raw calldata shares the hosted disclosure path (2026-10-05)

The preceding motion failure was a `production_regression`. Browser measurements
showed the card growing from 675.6875 px to 969.6875 px while its iframe remained
676 px. The raw-data `<details>` element bypassed the shared resize announcement
and clamp. The existing contract correctly rejected that overflow.

`TransactionReview` now uses `ReviewDisclosure` for raw data. A presentation
option retains the raw-data class, and its CSS follows the shared body wrapper.
The wrapper contains the existing code-block margins. No second animation or
forwarding path was added. Existing disclosure timing and reduced-motion handling
remain in effect.

All four motion cases passed in 15.1 seconds. The expanded raw-data case passed
in 6.9 seconds with opening, closing, and reduced-motion checks. Normal motion
emitted one target measurement per transition, +298 px and -298 px; every sampled
card fit its iframe. The test saves the measured frames and reduced-motion bounds.
Wallet/browser types, production build, bundle boundaries, and freshness passed.
SDK production source: 10 added, 8 removed, net +2. Evidence:
`evidence/refactor-170-raw-disclosure-motion-20261005.json`.
This closes the previously recorded raw-calldata motion gap.


### Presignature preparation has no application entry (2026-10-05)

Removed the public auth method, client session adapter, router method, host request
handler, request classification, and iframe payload. The host's public-session
command factory no longer creates a preparation adapter. Its restoration helper
also loses the unused wait-for-pool option. No application or test consumer called
the removed operation; the packed consumer explicitly rejects the retired name.

Internal ownership remains unchanged: `scheduleEcdsaSessionPresignaturePrefill`
runs from registration and passkey unlock; `scheduleRestoredSessionPresignaturePrefills`
runs from the host's restored-session path. These preserve current authorization
and material checks. No durable storage, lock behavior, presignature consumption,
or cryptographic protocol changed. The iframe protocol advances from 6.0.0 to
7.0.0 because the public request was removed. Client and host must deploy together.

Production lock/unlock retention passed in 30.2 seconds. All original durable
record identifiers remained after lock and fresh unlock, and Tempo signing passed.
The page-refresh lifecycle passed in 36.8 seconds, including warm signing, step-up,
and key export. Five handshake cases passed in 2.6 seconds. Wallet, intended-app,
and browser types, production build, packed declarations, runtime boundaries,
and freshness passed. SDK production source: 3 added, 94 removed, net -91.
Evidence: `evidence/refactor-170-presign-preparation-internal-20261005.json`.
Month-later return latency and validity-clock acceptance remain open.


### Email OTP signing owns step-up (2026-10-05)

The manual `requestEmailOtpSigningSessionChallenge` and `refreshEmailOtpSigningSession`
methods had no application consumers. Removed their public types, command adapters,
router requests, host handlers, signing-surface methods and ports. Their core
refresh implementation, dependency wiring, and duplicate exact-authority resolver
had no remaining callers and were removed as well. The shared auth-lane builder
remains because active ECDSA selection uses it.

The active `createEmailOtpEcdsaTransactionSigningBridge` is unchanged. It supplies
the exact step-up authority, wallet session, chain, and operation fingerprint to
the challenge callback. Existing signing execution remains responsible for proof
verification and material activation. No unlock proof was substituted for a
transaction proof. No durable signing material was deleted.

The former public-path type fixtures were obsolete after removal. Their useful
constraints now target the live bridge: EVM-family chain selection, normalized
wallet identity, required operation fingerprint, and rejection of mixed live-session
and capability-step-up authority. Packed consumers reject both retired methods.
Protocol 8.0.0 removes both iframe requests and requires matched deployment.
General Email OTP login/enrollment consolidation remains open.

Production Google Email OTP lifecycle passed in 49.2 seconds. The added-email
lifecycle passed in 39.4 seconds, including lost-response retry, both signer
families, step-up, key exports, and method revocation. Five protocol handshake
cases passed in 2.6 seconds. Wallet/intended/browser types, the production build,
packed declarations, bundle boundaries, freshness, and bloat checks passed.
SDK production source excluding type fixtures: 6 added, 980 removed, net -974.
Evidence: `evidence/refactor-170-email-step-up-internal-20261005.json`.


### Email OTP enrollment stays inside wallet operations (2026-10-05)

Removed the unused public `requestEmailOtpEnrollmentChallenge` and `enrollEmailOtp`
methods, their application/host adapters, iframe requests, signing-surface ports,
and standalone worker enrollment operation. `registerWallet` retains the internal
challenge and factor preparation. `addEmail` retains its existing authorized
addition flow. The custom Google authentication flow contract is unchanged.

The worker now only prepares enrollment material. Removed its duplicate server
finalization, optional secret return, associated mode flags, and unused progress
adapters. The retained worker clears its factor and unlock-key buffers and destroys
its seal handle. The Email OTP command factory now returns its auth commands
directly because the separate registration group has no remaining commands.

The retired enrollment type fixtures were obsolete. Their normalized-wallet and
parent-bearer constraints now target live registration preparation and the
registration iframe input. The packed consumer check rejects both removed public
methods. Protocol 9.0.0 removes their iframe routes; client and host must match.
General Email OTP login consolidation and durable registration continuation remain
open. Verification is recorded in
`evidence/refactor-170-email-enrollment-internal-20261005.json`.

The NEAR-only signing defect was already fixed in `391d4be9`. Its existing E2E
scenario now also rejects ECDSA worker creation across registration, signing, and
reload/restored signing. It passed against the current production build in 34.4
seconds. See `evidence/refactor-170-near-only-recheck-20261005.json`.

The Email OTP lifecycle passed in 45.9 seconds. The added-email lifecycle passed
in 39.4 seconds, including lost-response retry, signing, exports, and revocation.
Five handshake cases passed in 2.7 seconds. Wallet, intended, browser, state-fixture,
and documentation type checks passed. Production build, packed declarations,
runtime boundaries, freshness, and bloat checks passed. SDK production source
excluding type fixtures: 49 lines added, 762 removed, net -713.


### Custom email-code request and unlock contract audit (2026-10-05)

`auth.requestEmailCode` replaces the public `requestEmailOtpChallenge` name.
The account-menu device-removal flow and intended app use the accepted name.
The host still resolves an omitted method from the selected active Email OTP
method and rejects unresolved identity. The operation and fingerprint cross the
same request boundary. No protocol shape or proof scope changed.

The remaining unlock consolidation must preserve these existing contracts:

| Existing flow | Required evidence and binding | Completion and remaining gap |
| --- | --- | --- |
| ECDSA capability login | Exact wallet session, method, provider subject/email, selected chain, key handle, OTP, and Ed25519 selection | Returns bootstrap/recovery and exact authorizations. Internal Google orchestration also supplies publication targets. Move activation details into the host before exposing `unlockWithEmailCode`. |
| Added-email authority unlock | Exact wallet/method, verified email subject, challenge, and OTP | Restores the authority's existing signer families and resumes pending acknowledgements. Preserve the all-family result when consolidating. |
| Google sign-in | Provider evidence resolves the wallet and subject before issuing the challenge | Keep its flow's submit/resend/cancel contract and NEAR-only branch. Concurrent cancellation, expiry, and resend replacement still need acceptance evidence. |
| Device-removal code | Exact selected source method and transaction-operation fingerprint | The result goes to `devices.remove` with owner-proof binding. It must never become an unlock proof through the new API. SDK-owned device-removal prompting remains a separate cleanup item. |

The current challenge result alone does not contain all provider and activation
facts required by both unlock implementations. `unlockWithEmailCode({ challenge,
code })` therefore needs a host-owned continuation that retains those facts and
rejects stale, replaced, expired, or wrong-purpose challenges. A mechanical rename
of the ECDSA input would expose the same activation details and leave the
all-family branch unresolved. The two old unlock calls remain pending this work.

The production device-revocation scenario passed in 40.2 seconds. It covers a
refused commit, exact-request retry/replay, altered-request rejection, revoked
device signing refusal, and continued owner signing. Wallet, intended-app,
browser, and documentation types pass, as do the production build, packed
consumer declarations, runtime boundaries, freshness, and bloat checks. This
naming change has zero net production-source lines. Evidence:
`evidence/refactor-170-request-email-code-20261005.json`.


### Registration continuation audit and production baseline (2026-10-05)

Both current passkey activation-response-loss cases pass in production, each in
28.3 seconds. ECDSA-only and mixed wallets each replay the exact activation three
times, reject a changed activation digest before prompting, unlock the exact method
once, and produce one verified EVM signature. Neither creates another registration.
Evidence: `evidence/refactor-170-registration-continuation-baseline-20261005.json`.

These cases use `tests/intended-app/src/ResumeRegistration.tsx`, which asks the
application for the wallet ID, ceremony ID, and expected passkey origin at that
baseline. The later wallet-identity checkpoint removes ceremony and origin inputs. They do
not prove the accepted SDK-owned continuation. `WalletHostRuntime` calls
`resumePendingNearRegistrations` at startup, but that function returns
`unlock_required` for ECDSA/mixed commits. Startup only reports failures. Normal
`auth.unlock` resolves published subjects before doing any pending-registration
work, so the normal unlock path does not replace the separate resume operation.

The existing mixed recovery publishes the ECDSA registration projection. Its E2E
checks only EVM signing. Mixed NEAR rows are also reported as `unlock_required` by
startup. The separate planned/prepared NEAR continuation in `registration.ts` must
be reconciled during authenticated recovery. These passing tests do not establish
that the mixed wallet's NEAR registration completes after reload.

Complete this migration in the following dependency order:

1. Completed for activation replay: resolve a pending registration from wallet identity inside the host. Reject
   ambiguous or mismatched records. Derive passkey origin from the executing host;
   applications must not supply ceremony IDs or activation details.
2. Reuse exact activation replay, fact validation, and method unlock. Preserve one
   authentication prompt and the normal unlock selection, policy, progress, and
   failure contracts. Do not call ordinary unlock again after a fresh recovery
   unlock merely to construct its result.
3. Continue the persisted mixed NEAR plan through its existing custody/provisioning
   path. Expose EVM availability and pending NEAR state accurately. Verify NEAR
   readiness and a NEAR signature before calling mixed continuation complete.
4. Integrate Email OTP continuation with its existing provider/challenge flow.
   Retain exact method and challenge ownership; do not consume the same OTP again
   in a second unlock path. Verify response loss for both authentication methods.
5. Move the E2E driver to normal `auth.unlock` and the accepted email flow. Preserve
   the corrupted-digest rejection, exact replay, single prompt, and unchanged
   registration-count assertions. Then remove the public resume method, iframe
   request, special resume form, and obsolete request/result exports together.


### Google preparation failure and operation retry (2026-10-05)

A production Google NEAR-only registration scenario now rejects Yao WASM delivery
until the emitted Email OTP worker reports that preparation failed. A test observer
records only that outcome; it does not replace worker execution or capture request
payloads. Registration completes through its custody ceremony. First NEAR signing
then retries the download, and two NEAR signatures verify successfully. The second
signature makes no additional Yao request. One Email OTP worker serves the flow.

The initial test incorrectly required a retry before signing. This was a
`valid_test_needs_update`: registration can finish without the prewarmed Yao
runtime. The final test checks the operation's actual first-use boundary. It passes
in 33.3 seconds. Intended types, build freshness, and bloat checks pass. No production
source changed. Evidence: `evidence/refactor-170-google-preparation-retry-20261005.json`.

This closes the selected-signer Google preparation failure/retry acceptance case.
It does not close emitted-worker retry coverage for the separate EVM, Email OTP
runtime, or ceremony helpers. Those retain their existing source-loader evidence.

### Public NEAR test-funding removal (2026-10-05)

Removed `near.fundImplicitNearAccountForTesting`, its result type, client/host
adapters, duplicate session lookup, and iframe request. The repository had no
callers of the public helper. No replacement wrapper was required. Confirmed NEAR
signing still uses the existing internal relayer funding function after validating
the authenticated operation. That production path is unchanged.

The iframe protocol is now 10.0.0. Packed declaration consumers reject the removed
method. All five handshake cases pass, including mismatched client/host versions.
The production NEAR-only registration, signing, reload, and restored-signing case
passes in 31.5 seconds without an ECDSA worker. It does not force the internal faucet
branch. Wallet, intended-app, browser, and docs types pass, as do the production
build, packed declarations, runtime boundaries, and freshness checks.

This removes 165 production source lines net. Evidence:
`evidence/refactor-170-near-funding-internal-20261005.json`.

### Pending activation selection belongs to the host (2026-10-05)

Pending activation recovery now accepts wallet identity and the authentication
method. The host selects the unique stored activation for that wallet and rejects
missing or ambiguous records. A different method fails before replay. Passkey
verification obtains the origin from the executing wallet host. The application
no longer supplies a ceremony ID or expected origin. The redundant method
dispatcher and its optional port override are removed.

The exact-method union rejects combined passkey/email proofs, including broad
spreads. Packed declaration checks also reject the removed caller inputs.
The iframe protocol is 11.0.0. All five handshake cases pass.

Both production activation-response-loss scenarios pass in 26.6 seconds each.
ECDSA-only and mixed wallets each reject an unrelated wallet before replay and an
altered activation digest before unlock. Each then performs three exact activation
replays in total, one exact-method unlock, and one independently verified EVM
signature. The verification request uses the executing host's origin. No new
registration request occurs during recovery.

This completes the host-selection prerequisite. The public resume operation and
special test form still exist. Normal unlock integration, preservation of its
session options and callbacks, Email OTP acceptance, and mixed NEAR completion
remain open. These tests prove EVM recovery for a mixed wallet; they do not prove
NEAR readiness after recovery.

Production source changes remove 22 lines net. Build, wallet/intended/browser/docs
types, packed declarations, runtime boundaries, and freshness checks pass.
Evidence: `evidence/refactor-170-pending-identity-20261005.json`.

### Mixed passkey activation recovery completes NEAR (2026-10-05)

After publishing recovered ECDSA registration, the host now starts the existing
NEAR continuation with the same verified passkey credential, custody envelope,
and exact Wallet Session. It continues the saved NEAR journal without another
unlock. NEAR work runs asynchronously, so it cannot delay the ECDSA recovery reply.
The continuation owns a factor-secret copy and zeroizes it through its existing
cleanup path. Internal unlock results distinguish passkey and Email OTP material;
type fixtures reject missing passkey proof and cross-method broad spreads.
The public recovery result contains no credential or custody material.

ECDSA-only recovery passes in 27.8 seconds. Mixed recovery passes in 27.7 seconds.
The mixed E2E holds NEAR finalization while it verifies an EVM signature. After
release, it checks NEAR readiness and verifies an Ed25519 signature. NEAR completion
preserves the Wallet Session ID, quota ID, expiry, remaining uses, and existing
ECDSA capability subjects. The flow records one unlock and no new registration
setup/respond request. Exact replay and altered-activation rejection remain covered.

The first mixed run encountered a `valid_test_needs_update`: the completed EVM
receipt intercepted the next page button. Its active trace identified the wait.
The test now reuses the existing confirmation settlement helper. The corrected
mixed run passes. No production behavior changed for that test repair.

This closes the mixed passkey activation-recovery NEAR gap. It does not close
normal `auth.unlock` integration, public resume removal, or Email OTP continuation.
The previously recorded activation baseline remains historical evidence.

Wallet, intended-app, wallet-state, and docs types pass, along with production
build, packed declarations, runtime boundaries, and freshness checks. Production
source adds 47 lines net. Protocol 11.0.0 is unchanged.
Evidence: `evidence/refactor-170-pending-near-continuation-20261005.json`.

### Pending recovery honors the unlock session policy (2026-10-05)

Ordinary unlock and pending activation recovery now share the existing unlock
policy normalization. Pending recovery previously used fixed threshold defaults.
It now receives a required enabled policy from the wallet host. It uses configured
session lifetime and use limits for both passkey and Email OTP session requests.
A disabled policy fails before activation replay or authentication and leaves the
pending journal available for a later permitted recovery.

The shared resolver has explicit enabled and disabled branches. Ordinary unlock
keeps its existing per-call overrides, configured defaults, use cap, and disabled
behavior. Recovery type fixtures reject missing or disabled policy inputs.
The intended app can supply test session defaults through its existing URL-input
pattern; the SDK gains no new configuration source or public option.

Both production response-loss cases pass with a two-use, ten-minute policy.
Disabled recovery makes no additional activation replay or unlock request.
ECDSA-only recovery passes in 28.3 seconds. Mixed recovery passes in 27.8 seconds,
including EVM signing while NEAR finalization is held, followed by NEAR signing.
NEAR completion preserves the remaining one-use budget, expiry, and session
identity. The ordinary lock/fresh-unlock case passes in 27.0 seconds and preserves
durable presignature reuse.

Build, wallet/intended/wallet-state/docs types, packed declarations, runtime
boundaries, and freshness checks pass. Production source adds 34 lines net.
Evidence: `evidence/refactor-170-unlock-policy-20261005.json`.

This removes the fixed-policy obstacle to normal unlock integration. The public
resume operation remains until normal unlock owns selection, events, callbacks,
and recovery completion. Email OTP continuation and month-later latency acceptance
remain open.


### Normal unlock owns pending passkey activation (2026-10-05)

`auth.unlock(walletId)` selects pending activation before resolving established
wallet subjects. Recovery uses the founding passkey, the host origin, and the
ordinary unlock policy, events, and callbacks. Applications supply no ceremony
identity and perform no second unlock. The public resume method, its types,
client/host adapters, and transport request are removed. Protocol 12.0.0 requires
matching client and host deployments.

Default mixed recovery allows EVM signing during deferred NEAR provisioning.
Explicit NEAR selection waits for provisioning and returns a NEAR unlock result.
An ECDSA-only pending wallet rejects a NEAR request before replay or proof.
Production ECDSA-only, mixed, and required-NEAR scenarios pass. They verify exact
replay, altered-digest rejection, one authentication request, completion callbacks,
and independently verified transaction signatures. Existing disabled-policy and
unrelated-wallet checks remain in the same scenarios.

Evidence: `evidence/refactor-170-normal-unlock-20261005.json`. Email OTP pending
continuation, cancellation/lock races, and full runtime-lifetime acceptance remain
open. This checkpoint does not close the broader auth consolidation gate.


### Email unlock consolidation boundary audit (2026-10-05)

The existing host owns three email unlock branches. The replacement API must
retain all three. Their current owners are:

| Branch | Current owner and binding | Consolidation requirement |
| --- | --- | --- |
| Ordinary ECDSA, optionally with NEAR | `googleEmailOtpWalletAuthFlow.ts::loginWithConfiguredTargets`; challenge-selected method, key handle, signer selection, verified provider identity, configured publication targets | Retain exact challenge selection in the host. Applications must not rebuild capability inputs. |
| NEAR-only | The same selection function routes to `loginWithEmailOtpEd25519YaoCapabilityDomain` | Follow the wallet's signer selection even when application configuration includes EVM chains. |
| Added-method or linked authority | `loginWithLinkedEmailOtpWalletDomain` and `unlockLinkedDeviceEmailOtpWallet` | Resolve the exact authority, unlock its owned families, and resume pending acknowledgements. |
| Pending ECDSA activation | Internal pending recovery accepts exact Email OTP material; public integration remains absent | Continue the saved activation with its founding method before ordinary subject resolution. |
| Device removal | `LinkedDevicesModal.tsx` and the intended app request `transaction_sign` with an operation fingerprint | Keep this proof separate from unlock. Move orchestration into the owning device/auth-method operation. |

Google flow handles already carry verified provider state, submit/resend/cancel,
and terminal outcomes. Reuse this machinery when implementing
`auth.unlockWithEmailCode({ challenge, code })`. Do not convert an action-bound
challenge into an unlock challenge. The request must retain the verified provider
identity and exact wallet/method selection without accepting application-supplied
key handles, capability records, or relay routing.

The audit found that `requestLoginChallenge` discarded the server challenge expiry.
The flow retained only its provider deadline. The code now requires challenge
expiry at that boundary and checks it before unlock execution. Resend retains the
provider deadline and supplies a fresh challenge deadline. The production scenario
also exposed a missing Google error notice: the flow stored failures, but the
shared notice area rendered only passkey failures. Google login and registration
now use that existing notice area. Completion evidence is
recorded in `evidence/refactor-170-email-challenge-expiry-20261005.json`.

The public consolidation remains open. Outstanding work includes purpose-bound
challenge handles, concurrent submission and cancellation, pending activation,
removal of the two specialized public unlock methods, and consumer migration.
