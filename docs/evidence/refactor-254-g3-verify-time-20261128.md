# Refactor 254 G3: the time of each part of the verify step

Date: 2026-11-28. Plan: [Refactor 254](../refactor-254-speak-to-sign-verifier-backends.md),
Section 5 (G3) and Section 8 (Q17). The run before:
[Slice 3 evidence](refactor-254-slice-3-sayso-20261127.md), "G3: time".

**Result.** G3 passes on staging with a hedged turbo call. The Whisper turbo call on Workers AI
sets the time of every warm verify (320 of 320). With a second call after 1.5 s:

- 160 warm verifies: p50 1.39 s, p95 3.21 s, maximum 4.71 s. Without the hedge, at the same
  times of day: p50 1.48 s, p95 3.85 s, maximum 6.86 s.
- 5 cold verifies: maximum 2.59 s. The container start makes the speaker call 1.6 s to 2.0 s,
  and that call runs in parallel with the turbo call.
- The extra Workers AI cost is about $0.009 for each 1,000 verifies.

Not measured: the Gateway's own work and the upload from the browser (Slice 6).

## 1. The fault

G3 asks for the whole verify step at p95 of 4 s or less on staging, also when the speaker
container starts cold. On 2026-11-27 the staging lane gave 40 warm verifies at p95 4.57 s and
a cold maximum of 6.87 s. The Worker reported only the time of its parallel part
(`critical_parallel`), so the slow part was not measured.

## 2. The instruments

- **The time of each part.** SaySo `8f93822` adds to the `ms` record of each verify:
  - `stt`: the Whisper turbo call (`transcribeBatch`).
  - `speaker`: the call to the speaker container, with its start when it is cold.
  - `redimnet`: the speaker model alone, inside `speaker`.
  - `storage`: the Durable Object that consumes the audio digest and reads the template.

  Each time runs from the start of the parallel part to the end of that part. The `ms` record
  is a field of the verify output, so no route changed.

- **A known non-zero case.** The unit test "A verify reports the time of speech to text, the
  speaker and storage apart" uses a 60 ms transcriber and a 10 ms speaker. It checks that `stt`
  is 55 ms or more and that `speaker` is less than `stt`.
- **What the clock cannot see.** In a Worker the clock moves only across I/O. Each part ends in
  I/O, so each time is the time of its part. The wasm work is outside the parts; `decode` and
  `sign` were 0 ms in every verify.
- **The probe.** `sayso-g3-probe` (SaySo `bench/g3/probe`) is a Worker with a service binding
  to `sayso-verifier-staging-testnet`, as the lane's Gateway will have. `bindingMs` is the time
  of the binding call. The probe was deleted after the runs.
- **The voice.** macOS `say` (Samantha), 1.82 s to 2.49 s a sentence (mean 2.22 s). Each verify
  is a transcript-only intent with its own sentence. No recording of a person left this machine.
- **The control.** `bench/g3/pairs.ts` (SaySo `554a8c3`) calls the same turbo model through the
  Workers AI REST API from this machine, with no SaySo code in the path. It sends 40 pairs of
  two equal calls at the same time.
- **Load.** Before the runs, the G1 session confirmed that no transcription batch ran. It held
  its batches until the runs ended at 12:51 JST.
- **Counts.** `bench/g3/run.ts` gives each table below from its `result.json`. A separate script
  on the same files gave the pooled rows and the correlations. The raw files are in the shared
  notes folder of the Refactor 254 sessions, outside the repository.

## 3. The runs

All on 2026-11-28 (JST), on the staging-testnet Worker, through the probe. "Without" is Worker
version `8c6ede2b` (SaySo `8f93822`). "With" is version `538d0a45` (SaySo `554a8c3`), which
starts a second turbo call when the first has not answered after 1.5 s
(`STT_HEDGE_AFTER_MS`). The container image did not change
(`sayso-verifier-speakercontainer:2caac3c4`).

Runs 1 to 4 switch the version with `wrangler versions deploy`, one after the other in 9
minutes, so the two versions see the same load.

### Warm verifies (`bindingMs`)

| Run | Start | Hedge   | Verifies | p50    | p95    | Max    | Above 4 s | Second call: started, answered |
| --- | ----- | ------- | -------- | ------ | ------ | ------ | --------- | ------------------------------ |
| A   | 11:24 | Without | 80       | 1.50 s | 3.73 s | 5.61 s | 3         | —                              |
| B   | 11:56 | With    | 80       | 1.13 s | 2.65 s | 3.16 s | 0         | 29, 6                          |
| 1   | 12:42 | Without | 40       | 0.93 s | 3.11 s | 4.03 s | 1         | —                              |
| 2   | 12:44 | With    | 40       | 1.36 s | 3.29 s | 4.14 s | 1         | 20, 8                          |
| 3   | 12:46 | Without | 40       | 1.92 s | 3.99 s | 6.86 s | 2         | —                              |
| 4   | 12:48 | With    | 40       | 1.83 s | 3.29 s | 4.71 s | 1         | 24, 8                          |
| All | —     | Without | 160      | 1.48 s | 3.85 s | 6.86 s | 6         | —                              |
| All | —     | With    | 160      | 1.39 s | 3.21 s | 4.71 s | 2         | 73, 22                         |
| 1–4 | —     | Without | 80       | 1.44 s | 3.85 s | 6.86 s | 3         | —                              |
| 1–4 | —     | With    | 80       | 1.70 s | 3.29 s | 4.71 s | 2         | 44, 16                         |

All 320 warm verifies accepted. No turbo call failed.

### The parts of a warm verify (all 320)

| Part                                | p50    | p95    | Max      |
| ----------------------------------- | ------ | ------ | -------- |
| `stt`, without the hedge (160)      | 1.46 s | 3.83 s | 6.85 s   |
| `stt`, with the hedge (160)         | 1.35 s | 3.17 s | 4.12 s   |
| `speaker`                           | 225 ms | 245 ms | 322 ms   |
| `redimnet` (inside `speaker`)       | 128 ms | 142 ms | 151 ms   |
| `storage`                           | 16 ms  | 21 ms  | 63 ms    |
| `bindingMs` less the engine `total` | 21 ms  | 30 ms  | 3,706 ms |

- `stt` was the slowest part in all 320 warm verifies.
- The time outside the engine (the Worker's authorization, rate limit and JSON work, and the
  binding) was above 100 ms in 2 verifies. Run 4, verify 34, took 4.71 s with an engine `total`
  of 1.01 s: 3.7 s went outside the engine. That is the maximum of the hedged runs. Its cause is
  not measured (section 6).

### Cold verifies (each after 5 minutes or more with no request)

| Run | Hedge   | `bindingMs`                    | `speaker`                      | `stt`                          | Slowest part         |
| --- | ------- | ------------------------------ | ------------------------------ | ------------------------------ | -------------------- |
| A   | Without | 2.57, 1.90, 1.72, 3.11, 2.15 s | 2.10, 1.82, 1.65, 2.32, 1.86 s | 2.51, 1.01, 1.07, 3.04, 2.10 s | `stt` 3, `speaker` 2 |
| B   | With    | 2.07, 2.01, 1.69, 2.09, 2.59 s | 2.00, 1.90, 1.63, 2.01, 1.85 s | 1.26, 1.02, 0.95, 1.93, 2.48 s | `speaker` 4, `stt` 1 |

- All 10 accepted. The cold maximum is 3.11 s without the hedge and 2.59 s with it.
- A warm speaker call takes 0.20 s to 0.32 s, so the container start adds 1.3 s to 2.1 s.
- In run B, the fourth cold verify came 22.5 minutes after the third, not 5 minutes, because
  this machine paused. The container sleeps after 3 minutes, so that verify was cold too.
- A cold enrollment (three recordings) took 1.96 s and 2.39 s at the binding.

### The control: pairs of turbo calls outside SaySo

40 pairs through the REST API, 11:54 JST, between runs A and B. These times include the path
from this machine to the API, so only their spread compares with `stt`.

| Calls                   | p50    | p95    | Max    |
| ----------------------- | ------ | ------ | ------ |
| One call (80)           | 1.69 s | 3.80 s | 4.83 s |
| The faster of each pair | 1.13 s | 2.38 s | 3.07 s |

- The correlation of the two times of a pair is 0.07. A slow call does not make the other call
  of its pair slow, so a second call can answer first.
- The correlation of one pair's time with the pair before it is 0.06 (in run A, −0.004). Slow
  calls do not come in groups.

## 4. The cause table

The fault: the verify time has a tail above 4 s. Facts:

1. `stt` is the slowest part in 320 of 320 warm verifies.
2. Warm `speaker` is at most 322 ms; `storage` at most 63 ms.
3. The time outside the engine is at most 30 ms at p95.
4. The audio length does not explain `stt`: correlation 0.10, over 1.82 s to 2.49 s of audio.
5. The REST control, with no SaySo code, has the same spread: p95 3.80 s, maximum 4.83 s.
6. No transcription batch ran, and the spread is still there.
7. Two equal calls at the same time are almost independent (0.07).
8. The load changes within minutes: the unhedged p50 was 0.93 s in run 1 and 1.92 s in run 3,
   4 minutes later.

| Cause                                        | 1           | 2           | 3           | 4           | 5           | 6           | Left |
| -------------------------------------------- | ----------- | ----------- | ----------- | ----------- | ----------- | ----------- | ---- |
| The warm speaker container                   | contradicts | contradicts | —           | —           | —           | —           | no   |
| The Durable Object                           | contradicts | contradicts | —           | —           | —           | —           | no   |
| The Worker's work outside the engine         | contradicts | —           | contradicts | —           | —           | —           | no   |
| The audio length                             | fits        | —           | —           | contradicts | —           | —           | no   |
| Our own code around the turbo call           | fits        | —           | —           | —           | contradicts | —           | no   |
| The measurement itself (probe and binding)   | —           | —           | contradicts | —           | contradicts | —           | no   |
| Our own Workers AI load (the G1 batches)     | fits        | —           | —           | —           | fits        | contradicts | no   |
| The service time of Workers AI for the model | fits        | fits        | fits        | fits        | fits        | fits        | yes  |

- The cause that is left is inside Workers AI, which we cannot read: a queue, the routing or the
  model server. Fact 8 fits it. Cloudflare can refine it. The load of the account (the
  2026-11-27 run with the G1 batches) makes it worse, but it is not necessary.
- The prediction that only this cause makes: a second, equal call is an independent draw, so the
  faster of two is much faster in the tail. The control measured it (fact 7), and the hedged
  runs measured it in the Worker (section 3).
- For a cold verify the container start is a second cause. It stays under the turbo tail: the
  cold speaker call is at most 2.32 s.

## 5. The hedge and its cost

- **The code.** SaySo `b4481dc`, `workers/verifier/src/stt.ts`: `firstAnswer` starts the turbo
  call, and starts an equal second call when the first has not answered after 1.5 s, or at once
  when the first fails. It takes the first answer. There are never more than two calls. The
  other call is not stopped. Unit tests: `workers/verifier/tests/stt.test.ts`.
- **The delay.** 1.5 s is the warm `stt` p50 of run A (1.48 s). A model from the 80 warm `stt`
  times of run A, with two independent calls, gave p95 3.13 s at 1.5 s (a second call in 49% of
  verifies) and 2.77 s at 1.0 s (76%). The hedged runs measured 3.21 s and 46%.
- **How often.** A second call started in 73 of 160 warm verifies (46%; 36% to 60% in a run) and
  in 2 of 5 cold verifies. It gave the answer in 22 of the 73.
- **The price.** Workers AI bills `@cf/openai/whisper-large-v3-turbo` at 46.63 neurons an audio
  minute, $0.000513 an audio minute (the model page, 2026-11-28; the pricing table rounds it to
  $0.0005). One call on 2.22 s of audio is 1.73 neurons, $0.000019.
- **The extra cost.** 46% of a call is $0.0000087 for each verify: $0.009 for each 1,000
  verifies, or $0.87 for each 100,000. If Workers AI bills a second call that the Worker does not
  wait for, this is the cost; if it does not, the cost is less. The upper limit, a second call on
  every verify, is $0.019 for each 1,000.
- **These runs** made 485 turbo calls on 17.5 audio minutes: about $0.009.

## 6. Measured, inferred and unknown

**Measured:** the time of each part for 320 warm and 10 cold verifies; the hedge counts; the
REST control and its correlations; the price on Cloudflare's pages.

**Inferred:** the tail comes from the service time of Workers AI (section 4). The 6.87 s cold
verify of 2026-11-27 was most likely a slow turbo call, because today no cold speaker call took
more than 2.32 s. It cannot be checked now.

**Unknown, and the measurement that settles each:**

- The 3.7 s outside the engine in run 4, verify 34. Time the rate limit call and the request
  parse in the Worker (`index.ts`), and look for more such cases in a longer run.
- Whether Workers AI bills the call that the Worker does not wait for. Compare the neurons of a
  day in the Workers AI dashboard with the number of calls.
- The hedge under heavy account load, for example during a G1 batch. A second call adds load
  when the service is slow. Run G3 with a known batch at a known time.
- The Gateway's own work and the upload from the browser. Measure through the Gateway in
  Slice 6.

**Parity.** The probe calls the lane Worker the way the Gateway will, through a service binding.
Parity with the Gateway path is not established, because the Gateway adds its own work. Each
number here is the probe's number.

**Withdrawn.** Slice 3 said that the turbo call is "the likely cause (inferred)". It is now
measured. Slice 3 also said that the cold container "adds about a second"; the measured start
adds 1.3 s to 2.1 s to the speaker call, but less to the verify, because the turbo call runs at
the same time.

## 7. What changed

- SaySo `8f93822`: the time of each part in the `ms` record, and the per-part summary in
  `bench/g3/run.ts`.
- SaySo `b4481dc`: the hedged turbo call, with `stt_calls` and `stt_answer` in the `ms` record.
- SaySo `554a8c3`: the REST control `bench/g3/pairs.ts`.
- The runs used staging-testnet version `538d0a45` (SaySo `554a8c3`). Since 2026-11-28 07:17 UTC
  the lane runs SaySo `d6ccbea` (version `43b22fac`) and `sayso.seams.sh` runs `9f3de86` (version
  `1cf117c2`). Both have the hedge and the same Worker code.
- The commits are on SaySo `main`, pushed on 2026-11-28.
- The runs left the templates of 6 more `near:testnet:g3-<hex>.testnet` users in the lane's
  Durable Objects.
