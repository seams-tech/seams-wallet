# Minimal VoiceID prompt mock

The voice step follows transaction review. Keep the prompt focused on the phrase,
a live waveform, a short status, and Cancel. Transfer details, account labels,
branding, and model details stay outside the capture card.

The preview uses the existing `voice-glow` `VoiceBeam` as a subtle background.
The trace is the main feedback. It draws the capture as a line from left to right:

- A thin ripple shows ambient room sound. Its height follows the room level on a
  decibel scale, from flat at -66 dBFS to 3.5 px at -30 dBFS.
- Frames that count as speech open into two contours. Their height uses the
  SDK's `voiceDisplayLevel` curve.
- A dotted line shows the time ahead. It closes on the pen during the 1.5 s pause
  that ends the capture.
- When the capture ends, the trace trims to the speech span and centres over the
  glow. During the check it dims, because the glow's processing beam is the
  feedback. Approval draws a check at its end.

The preview requests automatic gain control off and measures 16 ms frames.
`voiceCapture.ts` applies the capture rules of `browser/microphone.ts`: a 0.006
RMS minimum, speech after 100 ms of sound, a 1.5 s end pause and an 8 s limit.
The SDK also asks its voice activity model; this preview has no model, so sound
must also rise 2.5 times above the room level measured in the first 200 ms and
last 48 ms. A click stays in the ambient ripple. This
changes only the preview display; production VoiceID capture and model inputs are
unchanged. There is no decorative speaking animation in microphone mode.

From the repository root:

```sh
pnpm exec vite examples/voiceid-step-up-mock --host 127.0.0.1 --port 4328
```

Open http://127.0.0.1:4328 and select Record for live microphone feedback.
Audio is analyzed locally until a 1.5-second pause after speech, for at most
eight seconds. It is never stored or sent; the trace keeps only frame levels.
Cancel, changing preview state, and leaving the page stop capture. If microphone
permission resolves after cancellation, the new stream is stopped immediately.
A completed microphone preview reports Recording complete. It cannot verify
identity, approve an operation, or send a transaction.

The state buttons outside the card demonstrate Ready, Listening, Checking,
Approved, and Retry. Listening demo uses generated levels and is labelled as a
demo; the other stages show one generated capture. Actual microphone capture
starts only from Record. Reduced motion updates the trace every 160 ms and drops
the settle and check animations.

For production, use the VoiceID plugin's existing recording stream or measured
levels. Do not open another microphone. Feed real recognition results into the UI.
Keep cancellation, expiry, transaction review binding, and one-operation approval.
The current confirmation UI uses Preact, while VoiceBeam exposes a React component;
adapt the visual layer at that boundary. This mock does not change authentication.
