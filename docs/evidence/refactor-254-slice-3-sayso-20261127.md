# Refactor 254 Slice 3: SaySo guarded words, and the state of the gate data

Date: 2026-11-27. Plan: [Refactor 254](../refactor-254-speak-to-sign-verifier-backends.md),
Sections 4 and 5.

S1 is built and measured. The gates G1 to G3 are not run. This file records what each gate
needs, because two of the three data sets are not where the plan expects them.

## 1. S1: guarded words

SaySo `1e02ffb` (`~/Dev/purin-labs/say-so`, `main`; since S2 also at `https://github.com/seams-tech/say-so`).
The Worker at `https://sayso.seams.sh` runs S1 since 2026-11-27 03:10 UTC ("The deploy" below).

### Measured

The intent: `user_id` `near:testnet:alice.testnet`, `action` `seams.near.transfer`,
`payload_sha256_hex` `42` × 32, sentence "send ten near to bob dot testnet". The guards are
`[1, 2, 4, 5, 6]`: "ten near" and "bob dot testnet". "Before" is the wasm of SaySo `6e17c4f`.

| Heard                            | Before: no guards | After: no guards | After: guards |
| -------------------------------- | ----------------- | ---------------- | ------------- |
| send ten near to bob dot testnet | accept            | accept           | accept        |
| sent ten near to bob dot testnet | accept            | accept           | accept        |
| send ten near to rob dot testnet | accept            | accept           | refuse        |
| send ten near to dot testnet     | accept            | accept           | refuse        |

| Intent      | `intent_digest`                                                    | Before                   |
| ----------- | ------------------------------------------------------------------ | ------------------------ |
| No guards   | `51bc8d22b29c0220a5cfb1a90c3ebebea5757c7f8293c0062beef13cb5968e86` | The same value           |
| With guards | `a63e63c8e79f1e78101657310a9b5eedf1672fd5f55cf677db2be5accf86a583` | Refused: `unknown field` |

Three sources give the two digests: the Rust code, `createIntent` in TypeScript, and a separate
Python script that follows the format in the SaySo README.

### Checks

- `pnpm test` and `pnpm typecheck` pass in SaySo: 11 Rust tests and 10 TypeScript tests.
- With no guards, the new word check gives the same result as the Levenshtein rule that it
  replaces, on 5,376 heard sentences (a test in `words.rs`).
- A verdict for the intent without guards does not match the digest with guards
  (`intent_mismatch`). So a caller cannot remove the guards.
- A malformed list gives a signed `unsupported` refusal and no model call (a Worker test).
- `wrangler deploy --dry-run` builds the Worker bundle with the new wasm (190,192 bytes) and
  the container image.

### 1.1 The deploy

The owner approved the deploy on 2026-11-27. `wrangler deploy` from SaySo `1e02ffb`, with the
`seamsadmin` account token from `~/.seams/staging-deployment.env`.

- The first try failed while it pushed the container image (`EOF` from
  `registry.cloudflare.com`). Wrangler stops before the Worker upload, and a probe showed the
  old build still live. The second try passed.
- Worker version `2caac3c4-533e-4851-a7e1-e8126c5c5301`. The version before is
  `ffef6563-f057-4ea2-965f-306351c9835a`, for a rollback.
- The container image changed from `sha256:7cd2db85…` to `sha256:42cc86c7…`. The source of
  `crates/speaker-service` did not change; the image was built again on this machine.
- The secrets are the same: `SAYSO_ENROLL_SECRET` and `VERDICT_SECRET_KEY_HEX`.
  `SAYSO_API_KEY` is still not set.

Probes of the live Worker after the deploy:

| Request                                           | Answer                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `GET /healthz`                                    | `ok`, `mock: false`, the same public key `d3c6773f…4a2551e`               |
| `POST /v1/render`, the intent without guards      | `UbyNIrKcAiClz7GpDD6-vqV1fH-Ck8AGK-7xPLWWjoY`, the digest from before S1 |
| `POST /v1/render`, guards `[1, 2, 4, 5, 6]`       | `pj5jyOefHngQFlcxCpte7fFnL9X1XPZ32yvlrM-GpYM` (`a63e63c8…` in hex)        |
| `POST /v1/render`, guards `[2, 1]`                | `{ "ok": false, "reason": "unsupported" }`                                |
| `POST /v1/verify` with no token                   | 401                                                                       |

Not probed: a verify with real audio, and the new container image. Both need a token and an
enrolled voice, and a model call costs money.

### Not measured

- The Worker in `workerd` with real audio. The tests run the engine in Node with mock models.
- The stream path (`/v1/stream`) with guards from end to end. The Rust test covers its word
  check; the Worker test covers the batch path.

## 2. The gate data

The gates come from Refactor 210, Section 14.5. That document is in the seams-console
repository (`~/Dev/purin-labs/seams-console/docs/refactor-210-voice-intents.md`).

### G1: words

- **The set exists as a generator, not as audio.** STT-1 is
  `voiceId/stt-bench/transaction-grammar/` in seams-console: 250 requests, 3,000 correct
  readings and 3,742 near misses. `make_audio.py` speaks them with macOS `say` (6 voices, 160
  and 210 words per minute). `run.sh` keeps the audio outside the repository, and a search did
  not find that folder or the NEAR AI transcripts. The estimate is 8.2 hours of audio.
- **The baseline.** NEAR AI Whisper large-v3 with the slot rules of `spoken-intent`: 2,652 of
  3,000 correct readings (88.4%) and 0 of 3,742 false accepts
  (`reports/stt1-transaction-grammar-whisper-nearai-slots-2026-11-07.md`).
- **Workers AI was never measured on STT-1.** The report of 2026-10-30 covers the dictation
  and approval sets only.
- **The run needs:** the audio made again (the grammar crate now reads `spoken-intent` from
  the speak-to-sign repository, so the corpus can differ from the one of 2026-11-07), a
  Workers AI token, and a decision on the scorer.
- **The scorer is an open point.** The 88.4% is a result of the `spoken-intent` slot rules.
  SaySo does not have these rules: it compares normalized words, with S1. So "at least 88.4%
  with S1 in place" compares two different text steps. The gate must say which one it means:
  SaySo's own check (the real path), or the same slot rules on the Workers AI transcripts (a
  comparison of the two Whisper models only).

### G2: speaker

- **"Gate 0" is not a speaker set.** It is a list of 10 feasibility checks of OutLayer
  (Refactor 210, Section 10). Its item 1 compared ReDimNet in WASM with ONNX Runtime Web on "4
  real recordings" from `voiceId/fixtures`. The four clips are not named.
- **No list of accept and refuse results of the Phala build exists.** Refactor 210 asks for
  "the same embeddings as the Phala build (cosine agreement on the Gate 0 set)". Refactor 254
  asks for the same accept and refuse results at 450 milli. The two texts differ.
- **What exists:** 30 private clips in `voiceId/fixtures` of seams-console (89.5 s; owner,
  another speaker, wrong phrase, noise, too short). Its README forbids a commit or an upload
  of them. The Phala build has no funding since 2026-11-26.
- **A run that is possible now:** ReDimNet B1 in the SaySo container image on this machine
  against the same model in ONNX Runtime on this machine, on the 30 clips. It needs no deploy
  and no upload. It does not use the Phala build.

### G3: time

- It needs the S1 Worker on a lane, `SAYSO_API_KEY` or a verify token, an enrolled test voice
  and recordings of that voice. The cold start of the container is a part of the gate.
- The earlier numbers: NEAR AI Whisper p95 1.584 s for one call; Phala verify over HTTPS p95
  5.172 s; ReDimNet in the CVM p95 466 ms.

### G1 with perfect transcripts (measured)

SaySo `354016f` holds the tools in `bench/stt1`: `build-corpus.sh` rebuilds the corpus and the
audio from seams-console `78b05bdb` and seams-wallet `dfc9e5179`, `transcribe.ts` calls Workers
AI as the Worker does, and `score.ts` scores with sayso-wasm. The rebuilt corpus has 250
requests, 1,871 near-miss texts and 6,742 cases, the same counts as the baseline.

`score.ts --oracle` uses each case text as its transcript:

| Guards     | Correct readings       | Transfers              | Multisig             | False accepts  |
| ---------- | ---------------------- | ---------------------- | -------------------- | -------------- |
| The values | 2,664 of 3,000 (88.8%) | 2,160 of 2,400 (90.0%) | 504 of 600 (84.0%)   | 484 of 3,742   |
| Every word | 2,664 of 3,000 (88.8%) | 2,160 of 2,400 (90.0%) | 504 of 600 (84.0%)   | 0 of 3,742     |

- "The values" guards every word but the template words (`send`, `to`, `approve`, `proposal`,
  `add`, `remove`, `member`, `set`, `threshold`, `verifier`, `version`). Its false accepts are
  `changed_verb` 444 of 500 ("lend" for "send") and `add_remove_swapped` 40 of 40.
- All 336 refused correct readings belong to the 28 requests with more than 16 words. SaySo
  refuses their intent before it hears anything.

### G1 with Whisper large-v3-turbo (measured)

The owner approved the run on 2026-11-27. `transcribe.ts` sent 6,630 clips (401 audio minutes,
about $0.21 before the free daily allowance) to `@cf/openai/whisper-large-v3-turbo` with the
deploy token of the `seamsadmin` account, as the Worker calls it. 112 clips are longer than the
Worker's 8 s cap and were not sent; they refuse as `audio_invalid`. The cap refuses no correct
reading of a request with 16 words or less. The transcripts and score files are in SaySo
`9c78b65`, `bench/stt1/results`, so the set can be scored again with no cost.

| Text step                                   | Correct readings       | Transfers | Multisig | False accepts |
| ------------------------------------------- | ---------------------- | --------- | -------- | ------------- |
| Baseline: NEAR AI Whisper + slot rules      | 2,652 of 3,000 (88.4%) | 94.6%     | 63.7%    | 0 of 3,742    |
| SaySo, every word guarded                   | 125 of 3,000 (4.2%)    | 2.2%      | 12.0%    | 0 of 3,742    |
| SaySo, values guarded                       | 180 of 3,000 (6.0%)    | 2.2%      | 21.2%    | 33 of 3,742   |
| Test variant, every word guarded            | 1,410 of 3,000 (47.0%) | 53.8%     | 19.8%    | 5 of 3,742    |

**G1 fails.** The causes are SaySo's text step, not the hearing of Whisper:

- Whisper writes an account as "eric.testnet". SaySo makes one word of it, "erictestnet". The test
  variant (`variant.ts`) spells "." as "dot" and "-" as "dash" in an account name before the check.
- Whisper writes a name that sounds the same in another way: "eric" for "erik". The recipient is
  guarded, so the reading refuses (816 refused transfers in the variant). `spoken-intent` matches
  the recipient to a contact by its phonetic key instead.
- Whisper writes digits as a number ("10374" for "one zero three seven four") and "Approved" for
  "approve".
- A SaySo fault: the normalizer drops the digits of a mixed word ("8888net" becomes "net").
- The 5 false accepts of the variant are sound-alike contacts: the audio says "jon dot testnet",
  Whisper writes "John", and John is the recipient. Only a contact list can refuse them.

So word matching cannot carry a Wallet request with free names and amounts. The 88.4% of the
baseline comes from `spoken-intent`, which parses the transcript into the request and compares
the values, with the contacts.

### G1 under design A (measured, no cost)

The owner chose design A (plan, Q15): SaySo signs the transcript (`transcriptOnly`, SaySo
`c6235d5`), and the Wallet decides the words with `spoken-intent`. The turbo transcripts above,
scored again with the baseline's own scorer (`txg-text rulecrate`, `score_whisper_crate.py`):

| Transcriber + `spoken-intent`       | Correct readings       | Transfers | Multisig | False accepts |
| ----------------------------------- | ---------------------- | --------- | -------- | ------------- |
| NEAR AI large-v3, slot rules        | 2,652 of 3,000 (88.4%) | 94.6%     | 63.7%    | 0             |
| Workers AI turbo, slot rules        | 2,501 of 3,000 (83.4%) | 90.5%     | 55.8%    | 0             |
| NEAR AI large-v3, forgiving rules   | 2,733 of 3,000 (91.1%) | 98.0%     | 63.7%    | 0             |
| Workers AI turbo, forgiving rules   | 2,582 of 3,000 (86.1%) | 93.9%     | 55.8%    | 0             |

- The slot rules are seams-wallet `3a284a874`, with the grammar tool of seams-console
  `cc8acf90`. The forgiving rules are seams-wallet `976167297`, with seams-console `679317d5`.
- The near misses that the rules accept (64 and 107) are homophones of the true receiver. The
  baseline does not count them as false accepts either.
- The multisig cases are 588, not 600: 12 are longer than 8 s.
- Score files: SaySo `3da0c0c`, `bench/stt1/results/2026-11-27-g1-spoken-intent-*.json`.

## 3. Open points for the owner

1. G1: answered with design A (plan, Q15). Turbo with `spoken-intent` is about 5 points below
   NEAR AI large-v3. Accept the gap, or try Nova-3 (about $2.10) or a contact prompt (about
   $0.21) first?
2. G2: cosine agreement or accept and refuse results, and against which reference now that
   the Phala build has no funding.
3. G2 and G3: whether the private fixture clips can go to the SaySo Worker on Cloudflare. The
   fixture README forbids an upload.
