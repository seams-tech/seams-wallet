# VoiceID motion comparison

Saved preview of the centered bars, flowing ribbon, and SDK VoiceBeam variants. Glow + ribbon and the light theme are selected by default. The ribbon uses a 1 px main stroke, 0.65 px supporting strokes, visual gain 1.5, and the gentler 38 px maximum amplitude setting.

This is a standalone design preview. Production VoiceID is unchanged by this snapshot. Demo levels are simulated. Microphone mode analyzes audio locally and does not record, persist, or upload it. The preview includes independent phrase-progress exploration; it is not authentication evidence.

## Open

From the repository root:

```sh
python3 -m http.server 4343 --bind 127.0.0.1 --directory docs/previews/voiceid-motion
```

Open http://127.0.0.1:4343/. Use an unused port if the original preview is still running. The committed bundle permits use without rebuilding.

## Rebuild VoiceBeam

```sh
pnpm exec esbuild docs/previews/voiceid-motion/voicebeam-entry.js --bundle --format=esm --minify --define:process.env.NODE_ENV='"production"' --outfile=docs/previews/voiceid-motion/voicebeam.js
```

VoiceBeam uses the installed voice-glow 0.2.1 component re-exported by the SDK. React and React DOM are bundled for this standalone page; their license notices remain in the bundle. Voice-glow and Hairline licenses accompany their code. The Hairline kernel is copied unchanged from the installed hairline-create skill. Custom vocal lines use its spring engine, not a packaged isometric figure.

`ribbon-gentler.png` records the selected light preview. Browser inspection verified the selected mode and display. Human microphone comparison remains interactive.
