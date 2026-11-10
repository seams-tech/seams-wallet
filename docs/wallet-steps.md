# Wallet cards as steps of an app dialog

An app can keep one dialog for a whole flow: app UI, then a Wallet card, then app UI again.
The Wallet card can be the sign-in menu, the transaction confirm or the VoiceID card.
The Wallet card shows as one step of the app's dialog, not as a second dialog on top of it.
The change between the steps is one transition.

The Wallet card stays in the Wallet iframe. The SDK places the iframe over an element in the
app's dialog (the anchor), keeps it there while the dialog moves, and tells the app what the
card does. App content never renders inside the Wallet iframe.

## The sign-in step

```tsx
import { HostedSeamsAuthMenu } from '@seams/wallet/react';

function SignInStep({ heldHeight, onCardReady, onSignedIn, onBack }) {
  const [height, setHeight] = useState(heldHeight);
  return (
    // The step keeps the size of the app step before it until the card has its own size.
    <div style={{ height }}>
      <HostedSeamsAuthMenu
        layer="top"
        chrome="back"
        onEnter={({ height }) => setHeight(height)}
        onResize={({ height }) => setHeight(height)}
        onReady={onCardReady}
        onBack={onBack}
        onOutcome={(outcome) => outcome.kind === 'authenticated' && onSignedIn()}
      />
    </div>
  );
}
```

- `layer="top"` paints the card in the browser's top layer, above all app content. The rest of
  the page is inert while the card shows, so the card draws its own Back or Close. The default,
  `layer="page"`, paints the card in the page's own stacking order, as page content does. Use
  it for a sign-in menu that is part of a page.
- `chrome` adds a Back (`'back'`) or Close (`'close'`) control inside the card, in its origin
  line. `'none'` (default) adds nothing. The SDK never adds an approve control.
- A `top` layer step reserves no space and shows no placeholder before `onEnter`. The app keeps
  its own step until then.

`seams.authMenu.open(request, anchor, step)` is the same without React. `request.chrome` sets
the control, and `step` holds the layer and the events.

## The transaction confirm and the VoiceID card

Pass `presentation` to `wallet.near.signAndSendTransaction`, to the EVM and Tempo
`signTransaction` and `signAndSendTransaction` methods, and to the `speakToSign` requests.

```ts
await wallet.near.signAndSendTransaction({
  receiverId,
  actions,
  presentation: {
    kind: 'anchored',
    anchor: slotRef.current, // an element in the app's dialog
    chrome: 'back', // 'back' | 'close' | 'none'
    onEnter: ({ height }) => resizeDialogTo(height),
    onReady: () => hideAppPanel(),
    onBack: () => setStep('note'),
  },
});

await seams.speakToSign.requestNote({ walletId, contract, postId, text, summary, presentation });
```

- Without `presentation`, or with `{ kind: 'modal' }`, the card shows in the Wallet's own
  modal, as before.
- An anchored card always paints in the top layer, above all app content.
- An anchored card needs explicit approval. The effective settings must be `uiMode: 'modal'`
  and `behavior: 'requireClick'`. Other saved or per-call settings make the call fail before
  the card opens. The person still approves inside the Wallet's card.
- With `chrome: 'back'`, the transaction card shows Back in its origin line in place of its
  close control. With `'close'` or `'none'`, it keeps its own close control. The VoiceID card
  keeps its own Cancel control: the SDK reports it as Back or Close from `chrome`.
- `presentation.signal` ends the card as `cancelled` when you abort it.
- The app shows its own result step, so an anchored transaction card shows no receipt. The
  call's result carries the outcome.
- A reviewed call (`review`) shows in the Wallet's own modal and takes no anchored
  presentation.

## `WalletStep` in React

`WalletStep` places a Wallet card in your dialog for you. Mount it when the card should open.
Unmount it to end the card. Each mount starts one call.

```tsx
import { WalletStep } from '@seams/wallet/react';

{step === 'confirm' && (
  <WalletStep
    surface={{
      kind: 'transaction_confirm',
      send: (presentation) => wallet.near.signAndSendTransaction({ ...bet, presentation }),
    }}
    chrome="back"
    initialHeight={noteStepHeight}
    onBack={() => setStep('note')}
    onOutcome={(outcome) => setStep(outcome.kind === 'result' ? 'placed' : 'note')}
  />
)}
```

- `surface.kind` is `auth_menu`, `transaction_confirm` or `speak_to_sign`. An `auth_menu`
  surface takes the `HostedSeamsAuthMenu` props. The other kinds take `send`, which calls the
  method with the presentation that the step gives it.
- `initialHeight` is the height that the step keeps until the card has its size, for example
  the height of the app step before it. Then the dialog changes size once.
- `onOutcome` receives `{ kind: 'auth_menu', outcome }`, `{ kind: 'result', result }` or
  `{ kind: 'error', error }`.

Without React, `seams.surfaces.mount(anchor, { surface, chrome, ...events })` does the same.
It returns `{ result, dispose }`. `dispose()` ends the card as `cancelled`.

## The events

The events carry the card's size, its readiness, Back, Close and how the card ended. They carry
no approval data. The call's own result does.

| Event | When it runs |
| --- | --- |
| `onEnter({ width, height })` | The card has its size and is still hidden. The anchor already reserves the height. The card shows one frame later. |
| `onReady()` | The card has faded in and is painted at its size. |
| `onResize({ width, height })` | The card changes size. It runs before the new size paints. |
| `onBack()`, `onClose()` | The person pressed Back or Close in the card. They run before the card fades out. |
| `onExit({ kind })` | The card has faded out and is gone. `kind` is `completed`, `back`, `closed`, `cancelled` or `failed`. |

The sign-in card animates its own height when its view changes. Then `onResize` reports each
frame of that change. Apply each size as it comes, with no animation of your own.

The anchor keeps the card's last height after `onExit`. Change it when the next app step
shows, so that nothing jumps.

## The hand-off

The owner of the dialog animates the dialog. Each side fades only its own content.

Into the Wallet card:

1. The app fades out its own step.
2. The SDK loads the card at the anchor, hidden, and calls `onEnter`.
3. The app animates its dialog to that size.
4. The SDK fades the card in and calls `onReady`.

Back out:

1. The person finishes, or presses Back or Close in the card.
2. The SDK calls `onBack` or `onClose`, fades the card out and calls `onExit`.
3. The app animates its dialog to its next step and fades that step in.

## Tracking

The SDK follows the anchor on every frame while the card shows. A dialog that moves, scales or
changes size carries the card with it, also long after the card opened.

## The card takes input only when nothing covers it

A `top` layer card takes a click only when the whole card is in view and nothing covers it.
Two checks hold the card's controls:

- The SDK in your page checks the card on every frame. The card's box must be inside the visual
  viewport, the card must be fully opaque and on top at nine points, and no popover, modal
  dialog or fullscreen element may open above it later. The SDK reports each change to the
  Wallet iframe.
- Where the browser supports visibility tracking (Chromium), the Wallet iframe also checks
  itself. The browser tells it when anything covers the card or changes how it looks. A page
  cannot change that report.

Until both checks pass, the Wallet iframe ignores clicks and pointer presses on the card. Escape
still works. The card takes input about 100 ms after `onReady`.

## Rules

- App content never renders inside the Wallet iframe.
- Continue alone never signs. The person approves inside the Wallet's card.
- The card keeps its own origin line and its own approve controls. `chrome` adds only Back or
  Close, never an approve control.
- A `top` layer card stays above all app content, and it takes input only when nothing covers
  it.
- The events carry size, readiness, Back, Close and the kind of exit. They carry no approval
  data.
- An anchored transaction or Speak-to-Sign card needs `behavior: 'requireClick'`.

## Releases

The SDK and the hosted Wallet ship together. A Wallet host without these changes rejects an
auth-menu request that has `chrome`, draws no Back on the transaction card, and does not hold
the card's controls.
