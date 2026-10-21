---
title: Release 0.17.0
description: Current SDK, server, CLI, and hosted runtime requirements for Seams Wallet 0.17.0.
---

# Release 0.17.0

These docs target version **0.17.0** of the browser SDK, server SDK, and recovery CLI.

| Component                               | Version    | Requirement                                               |
| --------------------------------------- | ---------- | --------------------------------------------------------- |
| Browser SDK `@seams/wallet`             | **0.17.0** | Match application code and wallet-origin assets           |
| Server SDK `@seams/wallet-server`       | **0.17.0** | Deploy the coordinated backend roles                      |
| Native CLI launcher `@seams/wallet-cli` | **0.17.0** | Use its signed native assets and the dashboard's commands |
| Wallet iframe protocol                  | **16.0.0** | Match the application and wallet host                     |

## Upcoming 0.18.0: English and Japanese controls

The source tree prepares `@seams/wallet@0.18.0` and `@seams/wallet-server@0.18.0`.
These packages are not published yet. The CLI remains on its separate 0.17.0 release.
The iframe protocol remains 16.0.0 because locale uses the existing appearance configuration.

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

Publish the paired packages with `release-wallet-packages.yml` from `main`, using version `0.18.0`.
The workflow requires both package manifests to match that version.
Then pin the exact packages in Console and deploy the matching wallet-origin assets.
An application-only update cannot translate an older hosted wallet build.

## Integration

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

## Deployment

Deploy the matching wallet host, Gateway, Wallet Runtime, Router, control plane,
both Derivers, and Signing Worker. Apply the packaged D1 migrations before the
corresponding Workers serve traffic.

Verify the release identity of each deployed service. Package publication and
hosted deployment are separate steps. Follow the
[production checklist](/deploy-and-operate/production-checklist) and verify the
[recovery CLI](/deploy-and-operate/recovery-cli) before relying on recovery tooling.
