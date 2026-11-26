# WalletIframe

## Overview

The wallet iframe hosts wallet UI, signing state, and worker orchestration at the
configured wallet origin. The application owns transport, public state, transaction
review, and some broadcast/RPC work. Hosted authentication uses wallet-origin user
activation. The transport also includes a parent WebAuthn bridge that can return
serialized credentials with PRF outputs; isolation claims must account for that
supported browser path and its origin/RP configuration.

## How It Works

The system consists of three layers:

1. **SeamsWeb** - The application SDK client. Its `WalletIframeCoordinator` owns the iframe connection and wallet execution calls forward to the router
2. **WalletIframeRouter** - Handles communication between the main app and the iframe using MessagePort
3. **Wallet Host** - `WalletHostRuntime` owns execution inside the iframe. Typed host commands invoke operations through its signing surface.

Calls such as `seams.registration.registerWallet()` and
`seams.evm.signTransaction()` dispatch through these layers. The parent surface
queue manages visibility for the request and the host reports its measured UI
size. Public progress events remain available to application callbacks.

The application client contains transport, configuration, and public state. Host
execution, wallet-origin storage, worker managers, and custody code belong to
`WalletHostRuntime`. Fresh host construction creates no signing workers without
selected operations or persisted work to resume. Registration preparation follows
the selected signer set. Generic confirmation preparation does not import EVM or
Tempo signing modules; those modules load through their selected signing operation.

## Architecture Overview

### Core Components

#### 1. **Entry Point Layer**

- **`coordinator.ts`** - `WalletIframeCoordinator`, which `SeamsWeb` uses for the iframe lifecycle and preference mirroring. `requireRouter()` returns the connected router, created by `SeamsWeb/assembly/createWalletIframeRouter.ts`.

#### 2. **Client-Side Communication Layer** (Runs in Parent App)

- **`client/router.ts`** - The `WalletIframeRouter` class that manages all communication with the iframe. It handles:
  - Request/response correlation using unique request IDs
  - Progress event bridging from iframe back to parent callbacks
  - Overlay show/hide logic for user activation
  - Timeout and error handling
- **`client/inboundMessages.ts`** - Validates incoming host messages before the
  router handles requests and session transitions.
- **`client/transport/IframeTransport.ts`** - Low-level iframe management:
  - Creates and mounts the iframe element
  - Handles the CONNECT → READY handshake using MessageChannel
  - Manages iframe permissions and security attributes
  - Waits for iframe load events to avoid race conditions
- **`client/progress/on-events-progress-bus.ts`** - Forwards flow progress metadata
  to subscribers. The request surface queue and renderer own iframe DOM visibility.

#### 3. **Host-Side Execution Layer** (Runs in Iframe)

- **`host/index.ts`** - The main service host entry that:
  - Receives messages from the parent via MessagePort
  - Creates and manages `WalletHostRuntime` through the host context
  - Executes wallet operations (register, login, sign, etc.)
  - Sends progress events back to the parent
  - Routes each request to its typed runtime handler

#### 4. **Shared Communication Protocol**

- **`shared/messages.ts`** - Defines the typed message protocol:
  - Parent-to-child message types (PM_REGISTER_WALLET, PM_UNLOCK, etc.)
  - Child-to-parent response types (PROGRESS, PM_RESULT, ERROR)
  - Payload interfaces for all message types
  - Typed progress payloads for public flow updates

#### 5. **Supporting Infrastructure**

- **`sanitization.ts`** - Security utilities for HTML and URL sanitization
- **`client/html.ts`** - Generates minimal HTML for the wallet service page

### Data Flow Architecture

```
Application origin                         Wallet origin
SeamsWeb → coordinator → router             host handlers → WalletHostRuntime
                           │                    │              │
                     IframeTransport ← port → host       signing surface
                           │                                   │
                 request surface queue                  workers and WASM
```

### Key Design Patterns

1. **Public browser API**: application construction requires a wallet origin. The host constructs its execution runtime separately. Public RPC/broadcast helpers can remain application-local.
2. **Message Passing**: Wallet requests use typed messages over MessagePort; handshake and browser bridge messages also use window messaging.
3. **Event Bridging**: Progress events flow from iframe back to parent callbacks
4. **Overlay Management**: The parent surface queue owns request-bound visibility; progress metadata remains available to callbacks.

### Security Model

- **Origin Isolation**: Wallet operations run in a separate origin/domain
- **Permission Delegation**: WebAuthn permissions are delegated to the iframe
- **Message Validation**: Boundary parsers validate message envelopes and payloads
- **Capability Delegation**: The iframe grants WebAuthn and clipboard access via explicit `allow` attributes. Sandboxing is intentionally omitted for cross-origin deployments because Chromium drops transferred `MessagePort`s from sandboxed iframes, which would break the CONNECT → READY handshake.
- **No Function Transfer**: Functions never cross the iframe boundary

## Request and progress flow

1. The application command obtains the connected router from the coordinator.
2. The router posts the typed request through its MessagePort and retains callbacks locally.
3. The host dispatches the request to its typed handler and execution runtime.
4. The host sends request-bound `PROGRESS` events and a final result or error.
5. The router matches each message to the pending request and settles its promise.

Public progress uses `WalletFlowEvent`. Private worker progress reaches the
application only when the operation explicitly maps it to a public event.
Functions do not cross the iframe boundary. Operation adapters retain their
completion and error callback contracts.

## Modal Overlay (iframe sizing behavior)

The wallet iframe mounts as a hidden surface. `WalletIframeRouter` owns one
typed foreground surface at a time and the surface renderer is the only writer
of iframe visibility, geometry, focusability, title, and pointer events.

### Surface lifecycle

- `hidden`: no footprint and no hit target.
- `modal_registration_confirm`, `modal_transaction_confirm`,
  `modal_key_export_confirm`, and `modal_unlock_confirm`: viewport modal
  surfaces that expose wallet-origin confirmation controls.

Each foreground surface carries its authenticated connection identity and
request identity. Result, error, cancellation, timeout, and connection close
events clear only a matching active surface. Progress events remain available
to app callbacks and diagnostics; they cannot modify the iframe DOM.

`OverlayController` is a low-level renderer target. The surface renderer uses
its hidden and viewport-modal operations. Styling is CSP-safe and uses the
shared overlay stylesheet. The default z-index is `2147483646`.

### Host box shape vs confirmation variant — READ BEFORE TOUCHING EXPORT UI

These are **two different values**. Conflating them has caused the same bug
twice (a card stranded in the top-left corner of the screen, and a viewer that
never appeared at all), so keep them distinct:

| Value | Attribute | Who decides | What it means |
| --- | --- | --- | --- |
| Confirmation variant | `data-seams-confirm-variant` | the Confirmer UI setting | what THIS confirmation renders: a modal card, or a bottom sheet |
| Host box shape | `data-seams-confirm-surface` | the parent, per request | `wallet-iframe` = the parent measured the card and sized the iframe to hug it, so the card must NOT position itself. `standalone` = the card owns a full-viewport canvas and centres (modal) or bottom-anchors (drawer) itself. |

The key viewer follows the Confirmer UI setting: `modal` opens a centered card,
`drawer` opens a bottom drawer, and `none` uses a modal to display the exported keys.
An explicit export `options.variant` overrides the preference. The parent and viewer
read the same resolved variant for the entire request, including any Email OTP prompt.

The pin travels on `UiConfirmSurfaceMeasurementBinding.hostSurfaceVariant`, set
in `host/runtimeContext.ts` from the same `payload.options.variant` the parent
reads in `confirmationUiModeForRequest` (`client/router.ts`). Reading one field
on both sides is what keeps the two descriptions of the box from drifting.

### Notes

- Layering: the iframe overlay uses `z-index: 2147483646`, kept one below the inner modal card (2147483647) to ensure the UI remains clickable when visible.
- Debugging: set `window.__SEAMS_DEBUG__ = true` (or pass `debug: true` to the client) to log surface transitions and progress routing.
