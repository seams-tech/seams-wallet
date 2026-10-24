# Minimal VoiceID prompt mock

The voice step follows transaction review. Keep the prompt focused on the phrase,
a live waveform, a short status, and Cancel. Transfer details, account labels,
branding, and model details stay outside the capture card.

The preview uses the existing `voice-glow` `VoiceBeam` as a subtle background.
The waveform is the main feedback. Its bars show recent microphone amplitude,
including quiet gaps. There is no decorative speaking animation in microphone mode.

From the repository root:

```sh
pnpm exec vite examples/voiceid-step-up-mock --host 127.0.0.1 --port 4328
```

Open http://127.0.0.1:4328 and select Record for live microphone feedback.
Audio is analyzed locally for eight seconds. It is never stored or sent.
Cancel, changing preview state, and leaving the page stop capture. If microphone
permission resolves after cancellation, the new stream is stopped immediately.
A completed microphone preview reports Recording complete. It cannot verify
identity, approve an operation, or send a transaction.

The state buttons outside the card demonstrate Ready, Listening, Checking,
Approved, and Retry. Listening demo uses generated levels and is labelled as a
demo. Actual microphone capture starts only from Record. Reduced motion lowers
the waveform update rate while preserving meaningful audio feedback.

For production, use the VoiceID plugin's existing recording stream or measured
levels. Do not open another microphone. Feed real recognition results into the UI.
Keep cancellation, expiry, transaction review binding, and one-operation approval.
The current confirmation UI uses Preact, while VoiceBeam exposes a React component;
adapt the visual layer at that boundary. This mock does not change authentication.
