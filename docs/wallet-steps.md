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
  the page is inert while the card shows, so the card draws its own Back, Close or both. The
  default, `layer="page"`, paints the card in the page's own stacking order, as page content
  does. Use it for a sign-in menu that is part of a page.
- `chrome` adds controls inside the card, in its origin line: Back (`'back'`), Close
  (`'close'`) or both (`'back_and_close'`). Back is before the site name, Close after it.
  `'none'` (default) adds nothing. The SDK never adds an approve control.
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
    chrome: 'back_and_close', // 'back' | 'close' | 'back_and_close' | 'none'
    onEnter: ({ height }) => resizeDialogTo(height),
    onReady: () => hideAppPanel(),
    onBack: () => setStep('note'),
    onClose: () => closeDialog(),
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
  close control, and the VoiceID card shows Back in place of Cancel, in its leading corner.
  With `'back_and_close'`, each card shows Back in its leading corner and keeps its close
  control in its trailing corner. With `'close'` or `'none'`, each card keeps only its own
  close control.
- Each control reports what the person pressed: Back calls `onBack`, Close calls `onClose`.
  Escape counts as Back when the chrome draws Back, and as Close when it does not.
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

## App steps inside the Wallet's own modal

When the app has no dialog of its own, the Wallet's modal can hold the app's steps. These steps
need `TransactionReviewHost` from `@seams/wallet/react`; without it, the call rejects with
`review_host_unavailable`.

A transaction takes `steps: { title, validity, before, after }`. `before` shows before the
Wallet's approval, `after` shows the signed result in the same modal. See
[Custom React transaction review](transaction-review.md).

The sign-in menu and the Speak-to-Sign requests take `steps: { title, before, after }`. Give
`before`, `after` or both:

```tsx
const outcome = await seams.authMenu.open(request, undefined, {
  steps: {
    title: 'Place a bet',
    before: ({ continueToWallet, cancel }) => (
      <BetForm onContinue={continueToWallet} onCancel={cancel} />
    ),
    after: (outcome, { close }) => <BetPlaced outcome={outcome} onDone={close} />,
  },
});

const result = await seams.speakToSign.requestNote({
  walletId,
  contract,
  postId,
  text,
  summary,
  steps: { title: 'Add a note', after: (result, { close }) => <NotePosted onDone={close} /> },
});
```

- The SDK's modal opens with `before`. `continueToWallet()` opens the Wallet's card in the same
  modal. It never signs: the person approves inside the card.
- With `before`, the card shows Back and Close. Back returns to `before`, which stayed mounted,
  so its state is kept. Continue again opens a new card for the same call. Close closes the
  modal.
- Without `before`, the card opens at once and shows Close.
- When the card completes, the call's promise settles first. Then `after` shows the result in
  the same modal, until `close()` or Escape. A card that did not complete, such as a refused
  verdict, closes the modal and shows no `after`.
- `cancel()`, Escape or Close before the card completes closes the modal. The sign-in menu then
  resolves `{ kind: 'cancelled', reason: 'close_button' }`, and a Speak-to-Sign request
  resolves `{ kind: 'cancelled' }`.
- `steps` and an anchor element, or `steps` and `presentation`, do not go together.
- One modal shows one flow at a time. A second call while it shows rejects.

## The events

The events carry the card's size, its readiness, Back, Close and how the card ended. They carry
no approval data. The call's own result does.

| Event | When it runs |
| --- | --- |
| `onEnter({ width, height })` | The card has its size and is still hidden. The anchor already reserves the height. The card shows one frame later, or after `transition.enterDelayMs`. |
| `onReady()` | The card has faded in and is painted at its size. |
| `onResize({ width, height })` | The card changes size. It runs before the new size paints. |
| `onBack()`, `onClose()` | The person pressed Back or Close in the card, or Escape (see `chrome`). They run before the card fades out. |
| `onExit({ kind })` | The card has faded out and is gone. `kind` is `completed`, `back`, `closed`, `cancelled` or `failed`. |

The sign-in card animates its own height when its view changes. Then `onResize` reports each
frame of that change. Apply each size as it comes, with no animation of your own.

The transaction and VoiceID cards ease a new size over 180 ms with
`cubic-bezier(0.2, 0.7, 0.2, 1)`, as the Wallet's modal does. `onResize` and the anchor's
height give the new size at once, so your dialog can ease to it with the same timing.
`WalletStep` does this for you. With reduced motion, the card applies each size at once.

The anchor keeps the card's last height after `onExit`. Change it when the next app step
shows, so that nothing jumps.

## The transition times

`transition` sets how long the card waits and fades. Each time is in milliseconds, from 0 to
1000. A time that you leave out is the Wallet's own.

| Time | What it sets | Default |
| --- | --- | --- |
| `enterDelayMs` | The wait between `onEnter` and the card's fade-in. Set it to the time that your dialog takes to animate to the card's size. | 0: the card shows one frame after `onEnter` |
| `fadeInMs` | The card's fade-in. `onReady` runs after it. | 150 |
| `fadeOutMs` | The card's fade-out. `onExit` runs after it. | 150 |

```tsx
<WalletStep surface={surface} transition={{ enterDelayMs: 200, fadeInMs: 100, fadeOutMs: 80 }} />
```

- `WalletStep`, `HostedSeamsAuthMenu`, `seams.surfaces.mount`, the `step` of
  `seams.authMenu.open` and an anchored `presentation` all take `transition`.
- A card reads `transition` when it opens. A later change applies to the next card.
- With a time of 0, the card shows or goes with no fade.
- A time outside 0 to 1000 makes the call fail before the card opens.
- With reduced motion, the card does not wait and does not fade.
- The times apply only to a card in your dialog. The Wallet's own modal keeps its own times.
- The SDK in your page runs these transitions, so they need no change in the hosted Wallet.

The time that a card eases a new size (180 ms) is not in `transition`. The Wallet iframe and
the SDK ease the size together, so the two sides must have the same time.

## The hand-off

The owner of the dialog animates the dialog. Each side fades only its own content.

Into the Wallet card:

1. The app fades out its own step.
2. The SDK loads the card at the anchor, hidden, and calls `onEnter`.
3. The app animates its dialog to that size. `transition.enterDelayMs` holds the card for
   that time.
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
- The card keeps its own origin line and its own approve controls. `chrome` adds only Back and
  Close, never an approve control.
- A `top` layer card stays above all app content, and it takes input only when nothing covers
  it.
- The events carry size, readiness, Back, Close and the kind of exit. They carry no approval
  data.
- An anchored transaction or Speak-to-Sign card needs `behavior: 'requireClick'`.

## Replacing earlier workarounds

| Earlier workaround | Now |
| --- | --- |
| Read `data-seams-auth-menu-ready` with CSS `:has()` | `onReady` |
| Read the `--seams-auth-menu-height` variable | `onEnter` and `onResize` |
| Reserve 450 px, then change to the measured height | Hold the app step's height until `onEnter` (`WalletStep` `initialHeight`) |
| An app Close button in its own layer above the card | `chrome: 'back'`, `'close'` or `'back_and_close'` |
| `--seams-wallet-inline-dialog-z` above the app's overlay | `layer: 'top'` |
| A frame loop that follows the dialog | Nothing: the SDK follows the anchor while the card shows |
| A Wallet confirm or VoiceID card on top of the app's dialog | `presentation: { kind: 'anchored', ... }` |

The attribute and the variable stay as internal details. Do not build new code on them.

## Releases

The SDK and the hosted Wallet ship together. A Wallet host without these changes rejects an
auth-menu request that has `chrome`, draws no Back on the transaction card, and does not hold
the card's controls. `@seams/voiceid` ships with the same release: its card reads the Back
and Close controls from the Wallet host.

`'back_and_close'` needs a Wallet host that knows it. An older host rejects it in an
auth-menu request. On the transaction and VoiceID cards, an older host ignores it: each card
keeps only its own close control, and the host does not hold the card's controls. The host
tells the SDK which control the person pressed (`SURFACE_CONTROL`). An older SDK ignores that
message, so a newer host still works with it.
