# Refactor 254 Slice 3: SaySo S1 to S3, and the gates G1 to G3

Date: 2026-11-27. Plan: [Refactor 254](../refactor-254-speak-to-sign-verifier-backends.md),
Sections 4 and 5.

S1, S2 and S3 are done. G2 passes. G1 and G3 do not pass as written (section 2):

- G1: Workers AI reads the STT-1 sentences some points below the NEAR AI baseline.
- G3: the verify step has p95 4.57 s warm, above 4 s. The Whisper turbo call on Workers AI is
  the likely cause (inferred).

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

### 1.2 The second deploy: transcript-only intents

The owner approved it on 2026-11-27. SaySo `3da0c0c` (the same tree as `origin/main`) is Worker
version `04760e00-e4b1-4f6b-87d8-f3d7dccab92c`; the version before is `2caac3c4`. The container
image did not change, and the secrets are the same.

| Request (`POST /v1/render` unless named)            | Answer                                                    |
| --------------------------------------------------- | --------------------------------------------------------- |
| `GET /healthz`                                      | `ok`, `mock: false`, the public key `d3c6773f…4a2551e`    |
| The intent with no guards                           | `UbyNIrKcAiClz7GpDD6-vqV1fH-Ck8AGK-7xPLWWjoY`, unchanged  |
| Guards `[1, 2, 4, 5, 6]`                            | `pj5jyOefHngQFlcxCpte7fFnL9X1XPZ32yvlrM-GpYM`, unchanged  |
| `transcript_only: true`                             | `fw0hpoPb_6fdBnhnDbGo0znlEMNlSOuCNAjjzKMQDZ8` (`7f0d21a6…`) |
| `transcript_only` and guards                        | `{ "ok": false, "reason": "unsupported" }`                |
| "Pay $5 to acct7 now"                               | `pay five dollars to acct seven now`                      |
| `POST /v1/verify` with no token                     | 401 `unauthorized_verify`                                 |

Not probed: a verify with real audio, and a transcript-only verdict from the live Worker.

### 1.3 S3: the Worker of the staging-testnet lane

Deployed on 2026-11-27 with the owner's "complete it all": the Wrangler environment
`staging-testnet` of SaySo, Worker `sayso-verifier-staging-testnet` in the `seamsadmin` account.

- **No public route.** The Worker has no route and no `workers.dev` URL. A Gateway reaches it
  through a service binding. It has no `SAYSO_ENROLL_SECRET`, so no browser token works.
- **Its own key.** `VERDICT_SECRET_KEY_HEX` is new. The public key is
  `3d96c3d21be6b7864cadfe1d5e57366e45774d7513972710e2569aa33a0d6895`. `SAYSO_API_KEY` is new.
  Both are in `~/.seams/staging-testnet/sayso.env` (mode 0600), the only copy. The Gateway of
  the lane needs the same `SAYSO_API_KEY` (Slice 6).
- **Its own state.** Its Durable Objects and its container application
  (`sayso-verifier-speakercontainer-staging-testnet`) are apart from those of `sayso.seams.sh`.
- **The image.** The lane runs the speaker image of the default Worker by its registry tag
  (`sayso-verifier-speakercontainer:2caac3c4`). A local image build was not possible: the Docker
  Desktop credential helper (`docker-credential-desktop get`) stopped answering on this machine,
  so the build waited on Docker Hub. With the tag (SaySo `e5d5fc1`), the lane needs no build,
  and it runs the image that G2 measured. A restart of Docker Desktop fixed the helper on
  2026-11-28.
- **Versions.** `14addab6` first; `aaa9a9a6` with the fix below; `5ae975d1` with the stream
  options of section 2 (SaySo `f7aa760`).
- **Test users.** The G3 runs left the templates of a few `near:testnet:g3-<hex>.testnet` users
  in the lane's Durable Objects.

Probes through the G3 probe Worker (section 2, G3), which calls the Worker over a service
binding:

| Request                                      | Answer                                                   |
| -------------------------------------------- | -------------------------------------------------------- |
| `GET /healthz`                               | `ok`, `mock: false`, the public key `3d96c3d2…0d6895`    |
| `POST /v1/verify`, no key or a wrong key     | 401 `unauthorized_verify`                                |
| `POST /v1/enroll` with a browser token       | 401 `unauthorized_enrollment`                            |

**A fault found and fixed: every enrollment on a cold container failed.** The first enrollment
refused as `speaker_unavailable` after about 2 s. The Worker log
(`wrangler tail`) showed "The container is not listening in the TCP address 10.0.0.1:8080" in
`SpeakerContainer` for two of the three recordings:

- An enrollment sends its three recordings to the speaker container at the same time.
- The first request started the container and waited for `/healthz`. `running` was true as soon
  as `start()` returned, so the other two did not wait. They called the port before the service
  listened.
- The fix (SaySo `2b74793`): all requests wait for one shared start, and a start that does not
  end in 8 s answers 503 `container_not_ready`. A new test
  (`workers/verifier/tests/speaker.test.ts`) fails with the old code and passes with the fix.
- A verify sends one recording, so it did not have this fault.
- `sayso.seams.sh` had the same code. It runs the fix since 2026-11-28 (section 1.4).

After the fix, an enrollment of the `say` voice accepts with an agreement of 814 milli.

### 1.4 The third deploy: the speaker start and the stream options

Deployed on 2026-11-28 with the owner's yes: `sayso.seams.sh` runs SaySo `98f8691` (Worker
version `2535f751`; the version before is `04760e00`). It has the speaker start fix
(`2b74793`) and the Nova-3 stream with no options (`f7aa760`). The deploy ran from a clean
`git worktree` of `98f8691`, because other sessions had edits in the SaySo checkout. `/healthz`
gives `mock: false` and the same verdict key (`d3c6773f…`).

**A fault found and fixed: the speaker image did not build from its lock.** The deploy built a
new image (digest `ed29844a…`, the one before `42cc86c7…`), although the speaker source did not
change.

| Measured                                   | Image `2caac3c4` (G2) | Image `2535f751` (now) |
| ------------------------------------------ | --------------------- | ---------------------- |
| Model file SHA-256                         | `e04dd7a6…`           | `e04dd7a6…`            |
| Binary size                                | 28,483,392 bytes      | 28,484,656 bytes       |
| Crate paths in the binary that differ      | `hyper-1.12.0`        | `hyper-1.13.0`         |
| Embeddings of 3 `say` clips, byte for byte | equal                 | equal                  |

- The cause: the Dockerfile copied `Cargo.toml` but not `Cargo.lock`, so each build took the
  newest crate versions. Neither binary matched the tracked lock (both had `anyhow` 1.0.105,
  the lock 1.0.104).
- The fix (SaySo `a0c4318`): the build copies the lock and runs `cargo build --locked`, and the
  lock is regenerated. A local build from it gives the binary of `sayso.seams.sh` exactly (SHA-256
  `092d33ec…`), so the tracked lock describes what runs.
- The staging lane still runs image `2caac3c4` by its tag. The two images give the same
  embeddings, so G2 holds for both. Inferred, not measured: the 30 private clips of G2 give the
  same result on the new image, because only the HTTP library differs.

### 1.5 The fourth deploy: the hedge and the template delete

Deployed on 2026-11-28 07:17 UTC with the owner's yes: `sayso.seams.sh` runs SaySo `9f3de86`
(Worker version `1cf117c2`; the version before is `2535f751`). It adds the time of each part in
the `ms` record (`8f93822`), the hedged turbo call (`b4481dc`), the locked speaker build
(`a0c4318`) and `POST /v1/template/delete` (`d6ccbea`). The deploy ran from a clean
`git worktree` of `9f3de86`. Its wasm is byte for byte the wasm of the SaySo checkout.

- **The image did not change.** The locked build gave image `ed29844a…` again, so wrangler
  skipped the push. The container application rolled out its version 4 with that image. So the
  lock of `a0c4318` describes the image that runs.
- **Checked live.** `/healthz` gives `mock: false` and the same verdict key (`d3c6773f…`).
  `POST /v1/template/delete` answers 401 `unauthorized_enrollment` for a user with no token, and
  400 `invalid_user_id` with no user. An unknown route answers 404.
- **Not measured on `sayso.seams.sh`:** a verify, and so the hedge itself. A verify needs
  `SAYSO_ENROLL_SECRET`, and that secret is not on this machine. The Worker code is the code of
  the staging lane, where G3 measured the hedge.
- **The lane.** Another session deployed SaySo `d6ccbea` to `staging-testnet` at 07:16 UTC
  (version `43b22fac`). Its Worker code is the code of `9f3de86`, because `9f3de86` changes only
  `bench/`.

## 2. The gate data

The gates come from Refactor 210, Section 14.5. That document is in the seams-console
repository (`~/Dev/rust/seams-console/docs/refactor-210-voice-intents.md`).

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
- **The audio is made again** by SaySo `bench/stt1/build-corpus.sh` from the exact versions of
  the baseline (below).
- **The scorer.** The 88.4% is a result of the `spoken-intent` slot rules, and SaySo compares
  normalized words. Design A (plan, Q15) settles it: the Wallet decides the words with
  `spoken-intent`, so G1 compares the transcribers under the same rules. SaySo's own check is
  scored too.

### G2: speaker (measured, passes)

"Gate 0" is not a speaker set, and no list of results of the Phala build existed. Refactor 210
asks for cosine agreement with the Phala build; Refactor 254 asks for the same accept and refuse
results at 450 milli. The run measures both.

- **The reference** is the image that Phala ran:
  `ghcr.io/seams-tech/speaker-service@sha256:2f3475cd…fdfd`, pinned in speak-to-sign
  `crates/speaker-service/docker-compose.yml` at `8db52c1`. The Phala deployment has no funding,
  so the run starts that image on this machine, with a development key and no dstack call.
- **The candidate** is the SaySo image that `sayso.seams.sh` and the staging lane run
  (`sayso-verifier-speakercontainer:2caac3c4`, image `42cc86c71a49`).
- **The clips** are the 30 private clips of `voiceId/fixtures` in seams-console. They went only to
  the two local containers, as their README requires. The decoded audio was deleted after the
  run.
- **The math.** The template and score code is the same in both (`embedding.rs` and `audio.rs` of
  sayso-wasm and of the voice-verifier), so only the embedding can differ. The template is the
  unit mean of the three `owner_enrollment` clips; their pair agreement is 653 milli in both.
- The tools are in SaySo `98f8691`, `bench/g2` (`run.sh`, `run.py`). The result file stays out of the
  repository, because it names the clips.

| Clips                                | Count | SaySo                           | Phala      | Agree |
| ------------------------------------ | ----- | ------------------------------- | ---------- | ----- |
| Owner, enrollment                    | 3     | template                        | template   | 3     |
| Owner, verification                  | 3     | 3 accept                        | the same   | 3     |
| Owner, wrong phrase (speaker only)   | 5     | 5 accept                        | the same   | 5     |
| Noise                                | 9     | 1 accept, 3 speaker, 5 quality  | the same   | 9     |
| Too short                            | 5     | 5 quality                       | the same   | 5     |
| Owner, changed voice                 | 2     | 2 speaker                       | the same   | 2     |
| Synthetic other speakers             | 3     | 3 speaker                       | the same   | 3     |

- **The embeddings agree.** The cosine between the two builds' embeddings of the same clip is
  0.99999999 to 1.00000001 for the 25 clips with an embedding. The largest score difference is 0
  milli, so no decision differs.
- **Near the cutoff:** the raspy owner variant scores 449 in both, and refuses by 1 milli. Three
  noisy owner clips refuse as `speaker` (349, 283 and 201) in both. These are properties of the
  model, not differences between the builds.
- Docker ran both linux/amd64 images under emulation (about 172 ms a clip for SaySo), so these
  times are not G3 numbers.

### G3: time (measured, fails at p95)

The staging-testnet Worker (version `aaa9a9a6`), called through a service binding as the
Gateway will call it. The lane Worker has no public route, so a short-lived probe Worker
(`sayso-g3-probe`, SaySo `bench/g3/probe`) holds the binding and times the call. The voice is
macOS `say`, so no recording of a person left this machine. One enrollment, 40 warm verifies
(2.1 s apart), then 5 cold verifies, each after 300 s with no request (the container sleeps after
3 minutes). Each verify is a transcript-only intent with its own sentence. Tools: SaySo
`bench/g3`.

| Verifies   | Accepted | p50     | p95     | Max     |
| ---------- | -------- | ------- | ------- | ------- |
| Warm, 40   | 40       | 1.68 s  | 4.57 s  | 5.70 s  |
| Cold, 5    | 5        | 2.47 s  | —       | 6.87 s  |

- The times are of the binding call (`bindingMs`), the time that the Gateway waits. The time from
  this machine through the probe is 20 to 110 ms longer.
- **The speech-to-text call is the likely slow part (inferred).** Speech to text, the speaker
  and the Durable Object run in parallel (`critical_parallel`: 0.63 s to 6.79 s for 1.8 to 2.4 s
  of audio). The Worker does not report the turbo time alone. Two facts point to it: the speaker
  model takes 125 to 189 ms, and the time grew when the G1 runs loaded Workers AI (below).
- **The cold container adds about a second.** The cold enrollment, three recordings with the
  container start, took 2.0 s in the speaker step. The cold verifies have a median 0.8 s above
  the warm ones. The 6.87 s verify cannot be split: the Worker reports the speaker's model time
  (134 ms), but not the time of the container start or of the turbo call alone.
- **Load matters.** A first run overlapped with the G1 transcriptions (12 Workers AI calls at a
  time from the same account). Its 40 warm verifies had p50 2.06 s, p95 4.33 s and a maximum of
  8.2 s. That run is not the result.
- Not in the time: the Gateway's own work and the upload from the browser.
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

### G1: Deepgram Nova-3 (measured, fails, and a fault in SaySo's stream fixed)

With the owner's "complete it all": `@cf/deepgram/nova-3` on the same 6,630 clips, two times
(400.9 audio minutes each, about $2.08 each). The first run used the options of SaySo's stream
then (`numerals`, `smart_format`); the second used no options. Design A is scored with
`bench/stt1/score-design-a.sh`, which gives the turbo numbers above again (2,501 and 2,582) on
the turbo transcripts. "SaySo" is SaySo's own word check with every word guarded.

| Transcriber                           | A, slot rules | A, forgiving rules | False accepts (A) | SaySo  | False accepts (SaySo) |
| ------------------------------------- | ------------- | ------------------ | ----------------- | ------ | --------------------- |
| Whisper turbo (above)                 | 83.4%         | 86.1%              | 0 and 0           | 4.2%   | 0                     |
| Nova-3, `numerals` and `smart_format` | 45.5%         | 60.2%              | 6 and 9           | 25.4%  | 8                     |
| Nova-3, no options                    | 62.1%         | 80.7%              | 0 and 0           | 33.7%  | 8                     |

- **With `numerals`, Nova-3 drops a spoken "point".** The request "Send 9,621 NEAR to
  alicia.testnet" spoken wrongly as "nine hundred sixty two point one" becomes "Send 9621 near to
  alicia dot test net", which pays the request. All the false accepts under design A are such
  moved decimal points. Turbo writes "962.1".
- **SaySo's stream had the same options.** `/v1/stream` signs the Nova-3 transcript. SaySo's
  word check reads "9621" as "nine thousand six hundred twenty one", the words of the request. On
  this set the account words refused those readings ("test net"), so no false accept shows; a
  clean account reading would pass. The Wallet does not use the stream (Q5).
- **The fix:** the stream sends no options since SaySo `f7aa760`, and staging runs it
  (version `5ae975d1`). Nova-3 with no options is better on every measure above. The stream path
  itself is not measured end to end: the probe passed no WebSocket.
- The 8 false accepts of SaySo's word check are sound-alike contacts ("jon" heard as "John"), as
  with turbo and the punctuation variant.
- Nova-3 stays below turbo under design A: it writes account names in many ways ("tom. Test
  net.", "Hannah dot testament").

### G1: turbo with the contacts as `initial_prompt` (measured, worse)

The 60 contacts of the corpus, as a comma list, in Whisper's `initial_prompt`. The run stopped at
1,816 cases (the transfers of 67 requests), for two reasons:

- **The prompt makes each call slower.** The same clip took 3.06 s with the prompt and 1.27 s
  without it. G3 already fails on the time of this call.
- **The prompt damages amounts.** "send eight thousand eight hundred eighty eight near" became
  "send 88888 near" in most readings of that request.

On the same 803 correct readings, without and with the prompt:

| Rules     | No prompt     | Contacts prompt | False accepts |
| --------- | ------------- | --------------- | ------------- |
| Slot      | 716 (89.2%)   | 534 (66.5%)     | 0 and 0       |
| Forgiving | 750 (93.4%)   | 543 (67.6%)     | 0 and 0       |

So a contact prompt is not a way to close the G1 gap.

## 3. Open points for the owner

1. **G1.** Neither Nova-3 nor a contact prompt closes the gap. The best Workers AI result stays
   turbo with the forgiving rules: 86.1% (transfers 93.9%) against 91.1% (98.0%) for NEAR AI
   large-v3, with no false accept in either. Accept the gap for `staging-testnet`, or keep the
   gate? Most of the rest is multisig wording ("Approved" for "approve", digit strings). STT-1
   cannot measure a fix for it: today's `spoken-intent` has no challenge words, so the STT-1
   multisig sentences are old. That needs a new corpus.
2. **G3.** p95 is 4.57 s warm, above the 4 s target, likely because of the turbo call. Next: have
   the Worker report the turbo time alone. Then the choices: a second, hedged turbo call when the
   first takes more than about 1.5 s (it costs about $0.00003 a verify); accept the time (the
   Phala path had p95 5.17 s); or measure again through the Gateway in Slice 6.

`sayso.seams.sh` runs both fixes since 2026-11-28 (section 1.4).

G2 needed no decision: the run measured both cosine agreement and the decisions at 450 milli,
against the image that Phala ran. No private clip left this machine: G2 ran locally, and G3 used
a `say` voice.
