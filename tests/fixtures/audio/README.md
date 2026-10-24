# VoiceID browser microphone fixture

`voiceid-owner.wav` is synthetic speech generated locally with macOS Samantha.
It contains no user recording. Browser E2Es use Chromium's fake microphone with
this WAV, then execute the real MediaRecorder, resampling, ECAPA, and WebCrypto
paths. The chain RPC remains deterministic.

Regenerate on macOS:

```sh
say -v Samantha -r 145 -o /tmp/voiceid-browser-owner.aiff 'Today I am setting up my wallet and using my voice to approve this operation. I am here with my device and ready to continue.'
afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/voiceid-browser-owner.aiff tests/fixtures/audio/voiceid-owner.wav
```

`voiceid-other.wav` uses macOS Daniel to exercise a rejected voice check, followed
by an explicit retry with the enrolled Samantha voice. This checks UI recovery
and the signing boundary. Synthetic voices do not calibrate human matching.

```sh
say -v Daniel -r 145 -o /tmp/voiceid-browser-other.aiff 'My voice helps me open this wallet on my device.'
afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/voiceid-browser-other.aiff tests/fixtures/audio/voiceid-other.wav
```
