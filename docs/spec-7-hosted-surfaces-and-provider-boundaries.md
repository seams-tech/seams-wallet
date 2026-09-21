# Spec 7: Hosted surfaces and provider boundaries

An application opens Wallet authentication, signing, and settings through the
public SDK. Wallet supplies the screens and performs the wallet operations;
the application uses the returned result to continue its own workflow.

## Opening Wallet UI

The application owns the surrounding page and the container that displays
Wallet. The hosted iframe owns the authentication inputs and compact Wallet
interactions. Account, security, and device management live in the separate
Wallet settings application.

When a surface opens, the application manages placement, dismissal, and focus
return. Wallet manages its content, internal navigation, and authentication
progress. It reports its size so the container can fit the content.

The SDK returns a clear outcome: completed, cancelled, expired, or failed.
Closing a window or navigating away does not prove that an operation succeeded.

An authentication request crosses the boundary like this:

```mermaid
sequenceDiagram
    participant A as Application
    participant W as Wallet iframe
    participant G as Gateway
    A->>W: Open an SDK request
    Note over W: User interacts with Wallet-owned inputs
    W->>G: Submit authentication evidence
    G-->>W: Checked Wallet outcome
    W-->>A: SDK result for the same request
    A->>A: Continue workflow and restore focus
```

## Keeping the documents separate

Wallet UI runs on its configured origin. This keeps authentication inputs and
Wallet state inside the Wallet document while the application receives only the
supported SDK messages.

Each message is checked against the expected origin, window, request, and live
surface instance. A message from a closed surface cannot complete a later
request. Production configuration uses specific allowed origins.

## External EVM accounts

The application document may connect an existing EVM wallet through the public
external EVM connector. EIP-6963 discovery presents each announced provider as a
user-selectable wallet. Phantom is also discovered through its wallet-specific
`window.phantom.ethereum` namespace when it omits an EIP-6963 announcement. The
connector never selects the shared `window.ethereum` provider. EIP-1193 requests,
account and chain events, and provider errors remain with the selected wallet.
The connector never reads private key material and never creates a Seams Wallet
Session, custody record, signing lane, or iframe message.

External account state is separate from Seams authentication and signing state.
An application must retain the source as either a Seams account or an external
EVM account and route operations through the matching capability. Connecting an
external account does not authenticate a Seams user or authorize a Seams wallet.

The selected provider, account, chain, and connection generation are captured for
each operation. Account, chain, provider, local-disconnect, and provider-disconnect
events invalidate prepared operations. A transaction hash returned after a wallet
approval remains a submitted result for the captured account and chain; transport
loss after dispatch is reported as an unknown outcome and is never retried
automatically. Local disconnect clears browser state and listeners; revoking site
permission remains a wallet action.

The first public connector supports desktop EVM providers, configured chain
switching, `personal_sign`, EIP-712 typed data, and ordinary `eth_sendTransaction`.
It excludes Solana, mobile transports, WalletConnect, account linking, and custody
import. Wallet names, icons, and reverse-domain metadata are untrusted display
data and cannot establish wallet identity.

Provider secrets and private service credentials stay on the server. Public
browser configuration contains only the values needed to reach and display
Wallet. The public Wallet site remains usable without signing in.

For example, [Console Lite's setup response](../examples/wallet-console-lite/src/localWorkspace.ts)
gives the browser this configuration:

```ts
export type LocalWalletConfig = {
  projectEnvironmentId: string;
  publishableKey: string;
  gatewayUrl: string;
  walletOrigin: string;
  signingWorkerId: string;
};
```

These values identify the project and services. The publishable key is designed
for the browser; private service credentials never enter this response.

## Email and identity providers

Wallet connects to email and identity providers through server adapters.
An adapter translates Wallet requests into provider calls and checks the
responses before returning a Wallet result.

Sending an email successfully is only a delivery result. The user must complete
the relevant challenge before the method can authorize a Wallet operation.

Applications can choose supported providers through configuration. That choice
preserves the same wallet identity and authentication rules described in
[Spec 2](spec-2-auth-custody-and-credentials.md).

## Running your own deployment

Self-hosting supplies the Wallet origins, passkey configuration, providers,
storage, and deployment credentials. It uses the same SDK contracts and server
checks.

For local development, run `pnpm router` and `pnpm site` in separate terminals.
Together they start the public Wallet services, hosted UI, and console-lite
example.

Start with [Wallet Console Lite](../examples/wallet-console-lite/README.md)
or the [self-hosting example](../examples/self-host-cloudflare-worker).
The [provider guides](auth-provider-integrations/README.md) cover configuration
for individual identity services.
