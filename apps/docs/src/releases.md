---
title: Release 0.19.0
description: Current SDK, server, CLI, and hosted runtime requirements for Seams Wallet 0.19.0.
---

# Release 0.19.0

These docs target version **0.19.0** of the browser SDK, server SDK, and recovery CLI.

| Component                               | Version    | Requirement                                               |
| --------------------------------------- | ---------- | --------------------------------------------------------- |
| Browser SDK `@seams/wallet`             | **0.19.0** | Match application code and wallet-origin assets           |
| Server SDK `@seams/wallet-server`       | **0.19.0** | Deploy the coordinated backend roles                      |
| Native CLI launcher `@seams/wallet-cli` | **0.19.0** | Use its signed native assets and the dashboard's commands |
| Wallet iframe protocol                  | **16.0.0** | Match the application and wallet host                     |

## Hosted wallet controls

- Hosted authentication confirms success before closing and returning the result to the app.
- Cancelling a menu before it opens prevents the wallet host from showing it.
- Account panels, key export rows, and QR camera views fit narrow screens and scaled hosts.

## English and Japanese controls

This release aligns the browser SDK, server SDK, and recovery CLI at `0.19.0`.
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

Pin the exact `0.19.0` packages in Console and deploy the matching wallet-origin assets.
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
