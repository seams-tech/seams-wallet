# Wallet cards as steps of an app dialog

An app can keep one dialog for a whole flow: app UI, then a Wallet card, then app UI again.
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

## Rules

- App content never renders inside the Wallet iframe.
- The card keeps its own origin line and its own controls. `chrome` adds only Back or Close.
- A `top` layer card stays above all app content.
