# VoiceID step-up UI mock

An isolated presentation preview using the same `voice-glow` `VoiceBeam` as
`VoiceAssistantCard`. The transaction summary stays visible during voice approval.
The preview simulates all audio levels and state changes. It requests no microphone
access, loads no models, and contains no wallet or transaction calls.

From the repository root:

```sh
pnpm exec vite examples/voiceid-step-up-mock --host 127.0.0.1 --port 4328
```

Open http://127.0.0.1:4328. Select a state or play the flow with Confirm with voice.
Preparing, listening, and verification advance automatically. Retry displays a new
phrase. Cancel stops the simulated flow. Approved means voice approval, not chain
confirmation. Amounts use yoctoNEAR to keep the test transfer readable. Transaction
details retain the full address and decimal NEAR amount.

For production integration, use the existing capture stream or audio-level callback
from the VoiceID plugin. Do not request a second microphone stream. Keep the Wallet
review, cancellation, expiry, and one-operation approval rules. The existing
VoiceAssistantCard is a React component; the trusted Wallet confirmation UI uses
Preact. Adapt the visual layer at that UI boundary before wiring the real lifecycle.
