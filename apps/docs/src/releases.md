---
title: Release 0.31.0
description: Exact dependency versions, React 19.1.1 peers, and aligned Wallet runtime builds.
---

# Release 0.31.0

Version **0.31.0** pins external npm and Cargo dependencies and aligns the Wallet runtime builds.

| Component | Version |
| --- | --- |
| `@seams/wallet` | **0.31.0** |
| `@seams/wallet-server` | **0.31.0** |
| `@seams/voiceid` | **0.31.0** |
| Signed recovery CLI | **0.29.0** |
| Wallet iframe protocol | **20.0.0** |
| Wallet-management protocol | **5** |

React integrations require `react@19.1.1` and `react-dom@19.1.1`.
Optional QR integrations use `jsqr@1.4.0` and `qrcode@1.5.4`.
Update the browser SDK, hosted Wallet assets, server SDK, and enabled VoiceID plugin together.
This release adds no database migrations or iframe protocol changes.

## Release 0.30.0

Version **0.30.0** combines Seams authentication and configured external wallet connections in one hosted screen.

| Component | Version |
| --- | --- |
| `@seams/wallet` | **0.30.0** |
| `@seams/wallet-server` | **0.30.0** |
| `@seams/voiceid` | **0.30.0** |
| Signed recovery CLI | **0.29.0** |
| Wallet iframe protocol | **20.0.0** |
| Wallet-management protocol | **5** |

- Use `HostedSeamsAuthMenu` with optional ordered `walletAlternatives.primary` and `walletAlternatives.secondary` groups.
- Omitted configuration and empty groups hide their sections. Secondary wallets appear inside More wallets.
- Reuse the existing NEAR and EVM controllers. Connection callbacks stay in the application.
- Recover or link wallet expands device linking and recovery. Alternative icons gain color on hover or keyboard focus.
- Closing the menu or replacing a controller invalidates pending connections. Completed connections survive menu closure.
- Signing sessions use sealed refresh by default. Passkey unlock also works without saved sealed-session material.

`WalletConnectorMenu` is removed. Move its wallet entries into `HostedSeamsAuthMenu.walletAlternatives`.
Low-level connector requests use `alternativeId`. External success emits `wallet_connected` without creating a Seams session.
Upgrade application SDKs and hosted Wallet assets together. This release changes the iframe protocol and adds no database migrations.
See the [React reference](/reference/react#wallet-alternatives) for configuration.

## Release 0.29.0

Version **0.29.0** connects an application's authenticated user to a readable wallet.
Fresh wallet-origin owner proof approves each NEAR transaction.

| Component | Version |
| --- | --- |
| `@seams/wallet` | **0.29.0** |
| `@seams/wallet-server` | **0.29.0** |
| `@seams/voiceid` | **0.29.0** |
| `@seams/wallet-cli` | **0.29.0** |
| Wallet iframe protocol | **19.0.0** |
| Wallet-management protocol | **5** |

- Configure an Ed25519 application issuer in the existing Console environment trust setting.
- Google and application-passkey login can resolve to one stable application subject.
- Associate and unlink identities through fresh owner approval without opening a reusable signing session.
- Register a NEAR-only passkey wallet through `registration.registerOwnerWallet`.
- Use `near.prepareOwnerTransaction` for one fresh transaction approval, including after reload.
- Observe capability-specific React wallets and operation states. A read connection supplies no reusable signer.
- Persist a public recovery descriptor. Recover an existing submission by status query, with no repeat broadcast.

Upgrade the browser package, hosted Wallet assets, server package, and enabled VoiceID plugin together.
Apply signer migrations `0086` and `0087` and Console migration `0112`.
These migrations replace the previous identity and trust storage shapes.
Complete or cancel unfinished relocation operations before applying signer migrations.

The initial owner-operation API supports NEAR and an enrolled wallet-origin owner passkey.
GetSignal's passkeys authenticate GetSignal's application session.
Read the [application-session guide](/guides/application-auth) and maintained example before integration.

## Release 0.28.0

Version **0.28.0** lets applications reuse a Google ID token to open associated wallet settings. Signing and custody operations keep their owner authentication requirements.

| Component | Version |
| --- | --- |
| Browser SDK `@seams/wallet` | **0.28.0** |
| Server SDK `@seams/wallet-server` | **0.28.0** |
| Optional plugin `@seams/voiceid` | **0.28.0** |
| Native CLI launcher `@seams/wallet-cli` | **0.28.0** |
| Wallet iframe protocol | **18.0.0** |

- `auth.authenticate` accepts Google credentials or a browser-bound backend handoff. An owner-authorized association is required.
- Settings sessions have explicit read permission, origin binding, expiry, and revocation. They issue no signing quotas and open no custody envelopes.
- Wallet settings support a responsive drawer and localized views of accounts, methods, and devices.
- VoiceID supports configurable Citrinet and Aurora transcription models and includes updated phrase calibration tools.

Upgrade the browser SDK, hosted Wallet assets, server SDK, and enabled VoiceID plugin together. Apply the server migrations before enabling external authentication.
See the [authentication guide](/guides/authentication) for the supported flows.
Use the [Google SSO guide](/guides/google-sso) for the complete BYO auth integration.

## Release 0.27.0

Version **0.27.0** adds the default customizable wallet connector and improves authentication, receipt, and VoiceID flows.

| Component | Version |
| --- | --- |
| Browser SDK `@seams/wallet` | **0.27.0** |
| Server SDK `@seams/wallet-server` | **0.27.0** |
| Optional plugin `@seams/voiceid` | **0.27.0** |
| Native CLI launcher `@seams/wallet-cli` | **0.25.0** |
| Wallet iframe protocol | **17.0.0** |

- `WalletConnectorMenu` supplies wallet selection, official wallet icons, configurable copy, and a continuous transition into hosted authentication.
- Back navigation returns to wallet selection. Connector controls and authentication success indicators use SDK theme tokens.
- Transaction details scroll within the viewport. Receipt transitions retain their text position and stay inside the iframe.
- NEAR transaction results distinguish rejection before submission, uncertain submission, and unresolved final outcomes.
- VoiceID supports loading recovery, explicit retry, and consistent microphone capture across attempts.

Upgrade the browser SDK, hosted Wallet assets, server SDK, and enabled VoiceID plugin together.
See the [React reference](/reference/react) for connector configuration.

## Previous releases

## Release 0.26.0

Version **0.26.0** repairs stale browser authority records after cold passkey custody recovery.

| Component | Version |
| --- | --- |
| Browser SDK `@seams/wallet` | **0.26.0** |
| Server SDK `@seams/wallet-server` | **0.26.0** |
| Optional plugin `@seams/voiceid` | **0.26.0** |
| Native CLI launcher `@seams/wallet-cli` | **0.25.0** |
| Wallet iframe protocol | **17.0.0** |

- Recovery adopts the verified Ed25519 activation and removes superseded local seals. Existing stale records can reconnect through normal passkey unlock.
- Authority identity, permissions, revocation, and concurrent lock checks remain enforced. Delayed responses cannot replace a newer session.
- Browser TLS passkey failures show trusted HTTPS guidance. Actual user cancellation remains silent.
- Device linking requires explicit approval inside the Wallet origin. Parent applications cannot supply that approval.

Upgrade the application SDK and hosted wallet assets together. VoiceID hosts use the matching plugin version.
Avoid browser SDK **0.25.0** because cold recovery can leave a stale authority record that prevents later unlocks.

## Release 0.25.0

Version **0.25.0** protects SDK controls from broad application CSS and adds an app-controlled settings modal.

| Component | Version |
| --- | --- |
| Browser SDK `@seams/wallet` | **0.25.0** |
| Server SDK `@seams/wallet-server` | **0.25.0** |
| Optional plugin `@seams/voiceid` | **0.25.0** |
| Native CLI launcher `@seams/wallet-cli` | **0.25.0** |
| Wallet iframe protocol | **17.0.0** |

- SDK controls and portalled overlays use a consistent namespace and explicit control defaults.
- `AccountMenuButton` supports its dropdown and a modal controlled through `isMenuOpen` and `onMenuOpenChange`.
- Applications can use their own buttons to open the settings modal with `presentation="modal"`.
- VoiceID action challenges accept `confirmationCommand` to select an action-specific phrase.

The CLI includes signed native binaries for macOS on Apple Silicon and Intel, plus Linux x86_64.
See the [recovery CLI guide](/deploy-and-operate/recovery-cli) for installation and verification.

See the [React reference](/reference/react) for the settings API.
Deploy the matching wallet host assets with the browser SDK.

## Release 0.24.0

Version **0.24.0** adds optional VoiceID enrollment, unlock, and reviewed NEAR and Arc testnet signing.

| Component | Version |
| --- | --- |
| Browser SDK `@seams/wallet` | **0.24.0** |
| Server SDK `@seams/wallet-server` | **0.24.0** |
| Optional plugin `@seams/voiceid` | **0.24.0** |
| Wallet iframe protocol | **17.0.0** |

VoiceID models and inference code ship in `@seams/voiceid`. The base Wallet package has no VoiceID model or engine payload.
Import `voiceIdAuthMethod` from `@seams/voiceid` and explicitly enable it in `authMethods`.
The Wallet host operator installs the plugin assets with `seams-voiceid-host ./wallet-with-voiceid`.
See [VoiceID setup](/concepts/auth-methods/voiceid) for the complete application and host steps.
Enabling the descriptor alone causes no VoiceID download.

The first VoiceID operation shows one download indicator for the engine and three models, then **Preparing VoiceID…**.
Voice samples persist until the owner changes or removes them. Speaker verification remains at 0.5.
`VoiceBeam` and `VoiceAssistantCard` now come from `@seams/voiceid/react`; card styles come from `@seams/voiceid/styles`.

## Release 0.22.0

These docs target version **0.22.0** of the browser and server SDKs. The recovery CLI uses **0.21.0**.

Prepared on 2026-10-25. Check npm publication and each hosted deployment separately.

### Changes in 0.22.0

- The unlock menu shows saved wallets while authentication prepares.
- Transaction settings provide a review switch and modal or drawer layouts.
- NEP-413 message signatures show a completed receipt with three filled tracks.
- The link-device factor selector and Continue button follow the wallet theme.
- The NEAR relayer reads the access key and recent block concurrently.

| Component                               | Version    | Requirement                                               |
| --------------------------------------- | ---------- | --------------------------------------------------------- |
| Browser SDK `@seams/wallet`             | **0.22.0** | Match application code and wallet-origin assets           |
| Server SDK `@seams/wallet-server`       | **0.22.0** | Deploy the coordinated backend roles                      |
| Native CLI launcher `@seams/wallet-cli` | **0.21.0** | Use its signed native assets and the dashboard's commands |
| Wallet iframe protocol                  | **16.0.0** | Match the application and wallet host                     |

The CLI pins a new prelaunch recovery root. Recovery packages signed under the earlier root
need new packages and certificates. The old root has no continuity bridge.

### Recovery security

The browser SDK removes passkey PRF outputs before it sends recovery assertions to the server.
The server rejects recovery assertions and registrations that still contain extension output values.
ECDSA signing step-up and key-export proofs also omit PRF output, and the server requires redacted assertions.
Recovery administration requires a fresh, operation-bound full-owner proof.

### Documentation

The Japanese docs now cover the complete documentation site, including deployment, recovery, examples, and API references.
The formal verification docs distinguish proved invariants from assumptions and remaining work.

### Hosted wallet controls

- Hosted authentication confirms success before closing and returning the result to the app.
- Cancelling a menu before it opens prevents the wallet host from showing it.
- Account panels, key export rows, and QR camera views fit narrow screens and scaled hosts.

### English and Japanese controls

This release aligns the browser and server SDKs at `0.22.0`. The recovery CLI uses `0.21.0`.
The wallet iframe protocol remains 16.0.0.

Set the SDK language when creating the provider configuration:

```tsx [Partial example]
import { normalizeWalletLocale } from '@seams/wallet';

const appearance = {
  locale: normalizeWalletLocale(new URL(location.href).searchParams.get('locale')),
};
```

Pass `appearance` to `defineSeamsConfig` or `SeamsWebProvider`'s `config`.
Use `appearance: { locale: 'ja' }` for Japanese, or omit locale for English.
The provider and wallet-origin controls share this configuration.
SDK previews also accept `locale` on `AccountMenuButtonMock` and `SeamsAuthMenuMock`.
Applications provide translations for their own headings and custom copy overrides.

Pin the exact `0.22.0` browser and server packages in Console and deploy the matching wallet-origin assets.
An application-only update cannot translate an older hosted wallet build.

### Integration

Install the browser SDK through [Start here](/). Follow
[hosted integration](/deploy-and-operate/hosted-integration) for the wallet host
and backend. Deploy application code and wallet assets together.

React's `useSeams()` supplies authentication actions and the current bound `wallet`:

```tsx [Partial example]
const { unlock, lock, wallet } = useSeams();
```

The wallet is `null` while signed out. Its NEAR signer remains `null` until a
NEAR account is ready. Check `wallet?.near` before signing. Use the wallet
from the authenticated render after unlock completes.

Registration defaults to a server-assigned wallet ID. Omit `wallet` in
`registerWallet` for that flow. Explicit wallet selection remains available.
Omit `signerSelection` to use the configured chains and provisioning defaults.
Custom signer selections remain available.

### Deployment

Deploy the matching wallet host, Gateway, Wallet Runtime, Router, control plane,
both Derivers, and Signing Worker. Apply the packaged D1 migrations before the
corresponding Workers serve traffic.

Verify the release identity of each deployed service. Package publication and
hosted deployment are separate steps. Follow the
[production checklist](/deploy-and-operate/production-checklist) and verify the
[recovery CLI](/deploy-and-operate/recovery-cli) before relying on recovery tooling.

### Prepared NEAR connector

Each wallet is explicitly enabled through `wallets`. The demo and examples select
Meteor only. `setWallets` supports runtime changes, including an empty list to
disable every wallet. See [wallet selection configuration](/reference/configuration#external-near-wallet-selection).

Checked on **2026-10-26**: npm's latest browser SDK is `0.22.0`.
The external NEAR connector is implemented on `dev` and is **not part of that release**.
No new package version or deployment is claimed here.

The [connector guide](/guides/external-near-wallets) covers Meteor, HOT, and Intear,
the two new package entry points, and compiled development examples.
Real Meteor testnet connection and a zero-deposit transaction passed final execution
and exact contract readback. HOT mainnet connection and retry after popup cancellation were also
verified with a real extension. HOT transaction signing and Intear real-wallet checks
remain pending.
Publication and private-app adoption still need an exact SDK release.
