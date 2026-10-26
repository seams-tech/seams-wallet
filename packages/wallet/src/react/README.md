# React Entrypoint

`react` exposes the browser React integration for SeamsWeb. The public package
root is `@seams/wallet/react`.

## Exports

- `SeamsWebProvider` composes the SeamsWeb instance with theme and wallet iframe
  lifecycle wiring.
- Hooks expose browser app state, registration, login, signing, recovery, device
  linking, QR scanning, and preferences.
- Components in this tree are browser UI components and may depend on React,
  browser events, and SeamsWeb context.

## Boundary

React modules must not become dependencies of `core/runtime`, native roots, or
embedded roots. Shared domain types belong in `core/types`, `shared`, or
platform-neutral runtime modules, then this entrypoint can re-export them for
React consumers.

## Voice assistant card and glow

`VoiceAssistantCard` is a controlled card with the moving bottom lights from
the Voice Assistant Card on transitions.dev. The light uses Jakub Antalik's
MIT-licensed `voice-glow` engine. `VoiceBeam` exposes the same light for other
React surfaces. Both exports are available from the optional `@seams/voiceid/react` package.
These presentation components work without `SeamsWebProvider`.

```tsx
import { VoiceAssistantCard, type VoiceAssistantState } from '@seams/voiceid/react';
import '@seams/voiceid/styles';
import '@seams/wallet/react/styles';

const state: VoiceAssistantState = {
  kind: 'listening',
  input: { kind: 'level', level: 0.5 },
};

<VoiceAssistantCard
  name="Seams"
  initials="SW"
  description="VoiceID"
  message="Repeat the phrase shown below."
  transcript="Confirm my Seams wallet."
  state={state}
  theme="dark"
  onToggle={toggleVoice}
/>;
```

The caller owns the state, transcript, and microphone. The card does not request
audio access or perform wallet actions. A listening state requires a level
source, or `{ kind: 'microphone', stream }`. Levels accept a number from 0 to 1,
or a getter that the light samples without React renders. The other states are
`idle` and `processing`. Pass `theme="light"` or `theme="dark"` explicitly.
The default size is 360 × 340 pixels. Long content increases the height.
Reduced motion stops decorative movement and preserves state feedback.
The wallet can use this interface for a future VoiceID flow. Voice
identification and authentication decisions belong to the caller.

For a light around an existing input, use `VoiceBeam` with `active` and
`processing` set from the caller's work state. Its wrapper clips its contents.
Place menus outside that wrapper, or use a separate decorative layer with
`aria-hidden="true"` and `pointer-events: none`.
