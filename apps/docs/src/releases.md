---
title: Release 0.24.0
description: Optional VoiceID authentication and the 0.24.0 Wallet package requirements.
---

# Release 0.24.0

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

## Previous releases

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
