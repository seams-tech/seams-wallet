# Core Platform

`core/platform` defines the TypeScript runtime port contract used by browser SDK
signing services. A runtime port bundle supplies storage, secret handling,
authenticator assertions, signer-core execution, HTTP transport, time, and
randomness without letting core signing code import browser implementations.

## Branches

- `browser/`: web implementation backed by browser APIs and browser signing
  workers.
- `embedded/`: device-local runtime notes for the separate Rust embedded SDK.
- `generated/`: signer-core command schemas generated from Rust.

## Rules

- Parse raw platform responses once at the adapter boundary.
- Keep browser storage and DOM APIs inside `browser/`.
- Keep embedded SDK implementation code out of this package; it is distributed
  through Cargo.
- Add TypeScript runtime ports only for browser SDK or TypeScript test/runtime
  behavior.

## Native distribution boundary

The npm package owns `SeamsWeb` and the browser runtime. Native SDKs belong in
their platform distributions: Swift for iOS and Cargo for embedded Rust. They
consume Rust signer-core contracts and language-neutral schemas or fixtures;
they must not depend on npm implementation files or native-looking npm
subpaths.

Native adapters own authentication, protected secret storage, transport, and
process lifecycle on their platform. Browser iframe, DOM, React, and IndexedDB
implementations stay outside those adapters. Share protocol contracts and
cryptographic implementations without exporting the browser service graph.

A native release must demonstrate the current command contracts through its
actual binding and persistence adapter. Historical browser or HSS bootstrap
vectors alone do not establish native signing, restore, or export readiness.
