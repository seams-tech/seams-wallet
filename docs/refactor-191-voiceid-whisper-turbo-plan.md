# Refactor 191 — Whisper turbo integration (deferred)

Status: deferred by the user on 2026-10-31. Browser integration will not proceed.

## Current decision

Do not integrate Whisper into the browser VoiceID package or distribute its model
files to Wallet clients. The proposed first-use download is about 602 MB. This
download is too large for users who only want to use a wallet.

An alternative voice modal that uses Whisper through an API may be considered
in the future. That option would run inference remotely and require no client
download of Whisper model files. It is a future possibility, with no approved
implementation or schedule.

The browser design, implementation steps, and acceptance gates below are retained
as historical research. They are inactive and do not authorize implementation.
The former browser decisions are superseded by this decision.

## Historical browser proposal

Add Whisper large-v3-turbo to `@seams/voiceid` as a third transcription model,
beside Citrinet and Aurora. It runs in the Wallet iframe on WebGPU through the
pinned ONNX Runtime Web 1.30.0. Voice stays optional: nothing downloads until
the person turns Whisper on and agrees to the download size.

Whisper checks the spoken phrase with a strict match against generated phrases
that follow the second phrase bank rules. The speaker check (ReDimNet B1 at
0.45) does not change, and existing enrollments stay valid.

The native Whisper adapter in seams-monorepo (branch `voiceid-whisper`,
1d49a8fb) stays unmerged. Dev removed the native engine, so the branch is a
reference only: measured results, the opt-in download design and the phrase
rules in `voiceId/engine/src/phrase.rs`.

## Why

The 2026-10-29 speech bench (seams-monorepo `voiceId/stt-bench`, on local dev
as 25d78771) used 2,640 approval cases from macOS voices, clean and with
kitchen, cafeteria and washing-machine noise:

| Runtime | Correct phrase accepted, clean / 10 / 5 / 0 dB | Near miss accepted |
| --- | --- | --- |
| MLX, 16-bit | 97.9% / 94.4% / 86.8% / 81.9% | 0 of 1,920 |
| whisper.cpp, 8-bit | 93.8% / 92.4% / 86.8% / 79.9% | 0 of 1,920 |
| Moonshine Medium | 66.7% / – / – / 45.1% | 2 of 1,920 |

The current matcher allows a 30% character difference to the nearest of 39
fixed phrases, and the source README says that some changed content words can
pass. A strict match refuses every added, missing or changed word. Generated
phrases with spoken numbers also give many more fresh challenges than 39 fixed
phrases. This does not prove liveness or replay resistance.

All bench speech so far is synthetic. Gate 3 adds recorded human speech.

## Download cost

Sizes come from the Hugging Face listing of `onnx-community/whisper-large-v3-turbo`
at revision `360ebcde2559d60bb474678be3c1de9ef347d01a` (weights: MIT) and from
the installed `onnxruntime-web` 1.30.0.

| Weights | Encoder | Decoder (merged) | Whisper total | Needs |
| --- | ---: | ---: | ---: | --- |
| q4f16 | 369,974,078 | 193,505,017 | 563,479,095 | WebGPU with `shader-f16` |
| q4 | 424,942,775 | 334,147,222 | 759,089,997 | WebGPU |
| fp16 encoder + q4f16 decoder | 1,274,342,603 | 193,505,017 | 1,467,847,620 | WebGPU with `shader-f16` |

The WebGPU build of ONNX Runtime Web has its own engine file. In 1.30.0,
`ort-wasm-simd-threaded.asyncify.wasm` is 26,781,914 bytes and the JSEP file is
28,312,028 bytes. The current CPU engine is 14,239,897 bytes. Gate 0 finds the
file that the WebGPU bundle loads.

With q4f16, the first VoiceID action with Whisper downloads about 602 MB: the
Whisper weights, the WebGPU engine, a token table of about 1 MB, B1 and Silero
VAD. The Citrinet path downloads about 36 MB.

## Design

### Opt-in

- An app sets `transcriptionModel: 'whisper-turbo'` in `voiceIdAuthMethod()`.
  This makes Whisper available. It does not download it.
- The person turns Whisper on in Manage voice. The card shows the download size,
  the licence and the free storage before the download starts.
- Until the person turns it on, the Citrinet path runs. If the browser has no
  WebGPU or too little storage quota, the card does not offer Whisper.
- If the person turns Whisper off, the Wallet deletes every Whisper chunk from
  Cache Storage.

### Hosting

Each Wallet origin (`sign.seams.sh`, `test.sign.seams.sh` and
`staging.sign.seams.sh`) is a Cloudflare Pages project, and Pages refuses a
file over 25 MiB. The q4f16 encoder is 370 MB, and the WebGPU engine
is also over the limit.

- Split each large file into chunks of 16 MiB. Serve the chunks from the Wallet
  origin under `/sdk/voiceid/whisper/<file sha256>/<index>`.
- Pin the manifest in code: for each file, the byte count, the SHA-256 of the
  file, and the SHA-256 of each chunk. The q4f16 set has 37 chunks.
- Do not put Whisper in the npm package. Add an option to
  `seams-voiceid-host` that downloads the pinned files from the Hugging Face
  revision, checks each SHA-256, and writes the chunks into the output folder.
- The browser never fetches from Hugging Face. The app cannot change the URL.

### Loader

`BrowserInferenceAsset` now downloads one file into one buffer and digests it
in one call. For Whisper it changes to chunks:

- Fetch, check and store one chunk at a time in Cache Storage, under a key that
  holds the chunk digest.
- To resume, skip each chunk that is already stored and valid. Keep the existing
  30-second stall timeout and the single automatic retry for each chunk.
- Join the chunks into one buffer only to create the session. Then release the
  joined buffer.
- Before the first chunk, read `navigator.storage.estimate()`. If the quota is
  too small, stop and tell the person the needed space.

The existing assets (B1, VAD, Citrinet, Aurora) keep their current loader.

### Runtime

- Use the WebGPU bundle of `onnxruntime-web` 1.30.0. Use q4f16 when the adapter
  has `shader-f16`; Gate 1 decides whether q4 is the fallback or whether the
  card does not offer Whisper.
- When Whisper is on, run B1 and VAD on the same engine (CPU provider), so the
  page loads one engine file.
- Write the decode loop in the package. Do not add Transformers.js: it pins its
  own ONNX Runtime Web and fetches from the Hugging Face hub by default.
  - Log-mel features with 128 bins, padded to 30 s, matched to the reference
    feature extractor within a set tolerance.
  - One encoder pass. Greedy decode with the merged decoder and its key-value
    cache, at most 32 tokens.
  - Prompt `<|startoftranscript|><|en|><|transcribe|><|notimestamps|>`.
    Suppress non-speech tokens. No previous context.
  - Token ids to text through a byte table derived from the pinned `vocab.json`.
- Prepare the sessions when the transaction review opens, as now. Release the
  GPU memory after an idle time. Gate 2 sets that time.

### Phrases

- Port the rules and the strict match from `phrase.rs` to TypeScript:
  3–8 words, no sound-alike words, the number rules, and no two phrases in one
  set that differ only by a sound-alike word or an article.
- Generate each challenge from an action and three digit words, for example
  "approve swap seven three six". Only zero, three, five, six, seven and nine
  pass the rules, so each action has 216 numbers.
- The `confirmationCommand` families stay: sale, purchase, swap and transfer.
  "sell" and "buy" are refused (they sound like "cell" and "by"), so the family
  word is a checked noun.
- Run the TypeScript matcher on the bench transcripts. It must agree with the
  Rust matcher and the Python scorer on all 126,720 decisions, except for the
  five documented "9:00" accepts.
- The Citrinet and Aurora paths keep their current phrase bank and matcher.

### What does not change

- B1 speaker matching, its 0.45 threshold, the three-sample enrollment and the
  stored templates. A change of transcription model needs no re-enrollment.
- Audio and transcripts stay in the Wallet iframe and are never stored.
- The server proof exchange, custody and signing.

## Gates

Each gate produces a repeatable artifact under `docs/evidence/`.

0. Feasibility, in the cross-origin Wallet iframe on Chrome, Safari 26 and
   Firefox, on desktop and on one recent iPhone:
   WebGPU access, adapter limits and `shader-f16`, the storage quota, the peak
   memory while the session is created, and the engine file that loads.
1. Parity: all 2,640 approval cases through the browser runtime. The
   correct-phrase accept rate must be within 2 points of MLX for clean speech,
   with 0 near misses and 0 unrelated sentences accepted. This gate selects
   q4f16 or q4.
2. Latency, from the end of the recording to the result, on an M1 MacBook Air
   class laptop: p50 at most 1.5 s and p95 at most 3 s. Also measure the first
   session creation and a reload from Cache Storage.
3. Human speech: the `human_approval_en_v2` set from the bench recorder, in a
   quiet room and at the mixer.
4. Wallet journey in the browser test suite: opt in; interrupt the download and
   resume it; unlock with Whisper; approve a NEAR testnet transfer; refuse a near
   miss; turn Whisper off and confirm that the chunks are gone.

## Steps

1. Gate 0 probe page in `tests/scripts/voiceid-whisper/`.
2. Chunk manifest, chunked loader and the `seams-voiceid-host` option.
3. Whisper runtime and the Gate 1 and Gate 2 harness.
4. Phrase rules, phrase generator, strict matcher and the agreement check.
5. Manage voice: turn on with consent, progress, turn off with deletion.
6. Gate 4 journey. Update the package README, `src/README.md`,
   `docs/intended-behaviours.md` and `docs/voiceid-model-candidates.md`.

## Limits and risks

- Browsers partition iframe storage by the top-level site. The Wallet cache in
  one app is not visible to another app. Each app that embeds the Wallet needs
  its own download of about 602 MB. The Satyr Portal is one site, so one
  download for each browser.
- Browser storage is best effort. After an eviction, the next Whisper action
  downloads again. `navigator.storage.persist()` can be refused in an iframe.
- Phones can close a tab that uses much memory. Phones stay out of scope until
  Gate 0 and Gate 2 pass on an iPhone.
- Satyr dictation (free text in the Portal) is not part of this plan. The Portal
  is a different origin, so its own Whisper copy is a second download.
- The current challenge bank has the phrases "be retarded when others are
  fearful" and "be fearful when others are retarded". Many people find this
  word offensive. Remove them from the Citrinet bank in a separate change.

## Superseded browser decisions

Browser opt-in, model-file hosting, device scope, and language scope are no longer
pending decisions. The 2026-10-31 decision defers this work and limits any future
Whisper integration to an API-backed alternative voice modal.
