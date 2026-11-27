# Frame kit

`@seams-internal/frame-kit` is the internal package for Seams frames on an app page. It is never
published. Each browser package bundles its source, as with `@seams-internal/shared-ts`.

It has three parts:

- **The stage dialog.** One `<dialog>` for each page that moves between stages. A stage is one
  frame or one app element. Two packages share the dialog through the `StageHost` contract
  (version 1), so they need no shared runtime object.
- **The frame transport.** `createFrame` makes a frame with an `allow` attribute for its own
  origin only. `connectFrame` gets a `MessagePort` from the frame and never posts to `*`.
  `acceptFrameConnection` is the frame's side: it answers only its parent window at an allowed
  origin.
- **The message checks.** `isMessageFrom` for window messages, a request ledger that settles each
  request once, and `isCurrentStageMessage` for a message that acts on a stage.

The design and its open parts are in
[Refactor 251](../../docs/refactor-251-auth-wallet-checkout-modules.md), Slice 3. The tests are in
`tests/frame-kit` and run in Chromium, Firefox and WebKit:

```bash
pnpm -C tests test:frame-kit
```
