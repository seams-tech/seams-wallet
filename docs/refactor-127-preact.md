# Refactor 127: replace internal Lit surfaces with Preact

Status: engineering implementation and scoped verification completed in September 2026.

## Why

Built-in wallet surfaces carried Lit elements, upgrade observers, stylesheet adoption,
and first-paint gates. A single internal renderer simplified their lifecycle and packaging.

## What changed

- Mounted the hosted auth menu, confirmation, private-key export, and recovery backup through Preact.
- Removed built-in Lit registration, the unused custom-element bridge, and upgrade observation.
- Consolidated hosted styling into `wallet-ui.css`.
- Kept the public React integration native React and removed its `@lit/react` dependency.
- Removed the temporary visual-parity harness after its acceptance matrix passed.

## Recorded verification

The final record reports 192 visual-parity cases, 511 browser cases across Chromium,
Firefox, and WebKit, seven public React checks, and 21 runnable credential-gated contracts.
Packed consumers and build, CSP, runtime, and asset checks passed for the recorded artifacts.

## Deferred work and limits

Two Router fault-injection contracts lacked the required isolated-runner proxy and fault hooks.
Publication and exact consumer adoption remained separate release operations.
These historical results do not establish acceptance for later builds.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-127-preact.md).
