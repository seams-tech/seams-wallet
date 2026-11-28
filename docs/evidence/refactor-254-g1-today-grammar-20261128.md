# Refactor 254: G1 on today's grammar, Whisper turbo under design A

Date: 2026-11-28. Plan: [Refactor 254](../refactor-254-speak-to-sign-verifier-backends.md),
Section 5 (G1) and Q16. The measurements before this file are in the
[Slice 3 evidence](refactor-254-slice-3-sayso-20261127.md), section 2.

## Result

**G1 passes as written on today's sentences, by a small margin.** Workers AI Whisper
large-v3-turbo with today's `spoken-intent` (speak-to-sign `8db52c1`) reads 2,668 of 3,000 correct
readings (88.9%) and accepts 0 of 3,642 near misses. The gate is 2,652 (88.4%, NEAR AI Whisper
large-v3 with the slot rules on STT-1) and 0 false accepts.

| Corpus, rules                      | Correct readings           | Transfers              | Multisig (of sent) | False accepts  |
| ---------------------------------- | -------------------------- | ---------------------- | ------------------ | -------------- |
| Baseline: STT-1, NEAR AI, slot     | 2,652 of 3,000 (88.4%)     | 2,270 of 2,400 (94.6%) | 382 of 600 (63.7%) | 0 of 3,742     |
| STT-1, turbo, forgiving rules      | 2,582 of 3,000 (86.1%)     | 2,254 of 2,400 (93.9%) | 328 of 588 (55.8%) | 0 of 3,742     |
| STT-1, turbo, today's rules        | 2,597 of 3,000 (86.6%)     | 2,269 of 2,400 (94.5%) | 328 of 588 (55.8%) | 0 of 3,742     |
| Today's corpus, turbo, slot        | 2,541 of 3,000 (84.7%)     | 2,187 of 2,400 (91.1%) | 354 of 597 (59.3%) | 0 of 3,642     |
| Today's corpus, turbo, forgiving   | 2,619 of 3,000 (87.3%)     | 2,265 of 2,400 (94.4%) | 354 of 597 (59.3%) | 0 of 3,642     |
| **Today's corpus, turbo, today's** | **2,668 of 3,000 (88.9%)** | 2,279 of 2,400 (95.0%) | 389 of 597 (65.2%) | **0 of 3,642** |

- **The margin is 16 readings (0.5 points).** Turbo noise is smaller than that (section 3).
- **Multisig still holds the result down:** 65.2% against 95.0% for transfers. "Add member"
  reads 8 of 120 (section 4).
- **The 95% target of Refactor 210 Q6 is not reached.**
- **Not measured:** NEAR AI large-v3 on today's corpus. So the compare with the baseline is not
  like for like (section 5).

## 1. The question

Q16 asks whether G1 passes under design A with turbo. On STT-1, turbo with the forgiving rules
read 86.1%. The STT-1 multisig sentences are old: they end with two challenge words ("... dot
testnet violin muffin"). Today's `spoken-intent` has no challenge words in a multisig approval,
and the old grammar tool did not build with it.

## 2. The corpus

- **The grammar tool** is seams-console `e76d5b1c`, `voiceId/stt-bench/transaction-grammar`
  (two commits: `0e487439` and `e76d5b1c`). The change is small, so it stays in seams-console:
  - A multisig approval has the member and a salt, and no challenge words.
  - The tool keeps the seeded draws of the challenge words, so seed 210 gives the 200 transfer
    sentences of STT-1 again, and the same 50 proposals in today's words.
  - The swapped-challenge near miss is gone. A verifier version speaks eight check digits, not five.
  - A multisig transfer names its receiver in the corpus. `rulecrate` gives it the contacts of its
    receiver, as the verifier does (`known_accounts` in speak-to-sign `voice-verifier`), and its row
    the receiver fields of the scorer's homophone rule.
- **The script** is SaySo `9f3de86` (`main`, not pushed): `bench/stt1/build-corpus.sh <work-dir>
today`. `bench/stt1/grammar-tool.sh` pins the commits of each corpus and rule set.
- **The set:** 250 requests (200 transfers, 50 multisig approvals: 10 of each STT-1 kind), 3,000
  correct readings and 3,642 near misses, 6,642 cases. Each correct text is read by 6 macOS `say`
  voices at 160 and 210 words per minute; each near miss is read two times. The corpus file has
  the SHA-256 prefix `ef022ed3b47c8744`. The tools of `0e487439` and `e76d5b1c` build the same file.
- **The audio:** 5,415 of the 5,502 transfer clips are byte for byte the clips of STT-1. `say`
  gave other audio for 87 clips on 2026-11-28 (5 of the 6 voices), and the same audio in a test of
  three runs on one day. So the corpus text is exact, and the audio is exact only with the same
  voice files.
- **The hidden-note proposal** of today's grammar is not in the set: the STT-1 mix has five
  multisig kinds.

## 3. The run

- **The transcriber:** `bench/stt1/transcribe.ts`, `@cf/openai/whisper-large-v3-turbo` with the
  `seamsadmin` account token, as the Worker calls it. 6,560 clips (387 audio minutes, about
  $0.20); 82 clips are longer than the Worker's 8 s cap and count as refused. The run started after
  the G3 timing runs ended (12:51 JST) and ended at 13:25 JST.
- **A fault fixed:** a read timeout (`ETIMEDOUT`) threw out of `fetch` and stopped the first run
  after 4,370 cases. `transcribe.ts` now retries a network error as it retries a 5xx answer. The
  second run did the other 2,272 cases; all 6,560 answered 200.
- **The scorer:** `bench/stt1/score-design-a.sh`, which runs `txg-text rulecrate` and
  `score_whisper_crate.py` of seams-console for the three rule sets. False accepts are counted by
  the scorer's rule: an accepted near miss is a homophone, not a false accept, only if the audio
  names a sound-alike of the true receiver (`audioNamesConfusableOfReceiver`) and the decision pays
  the request (`detail.parsedReceiver` and `detail.parsedHundredths`). The accepted near misses
  (65, 108 and 122) are all such homophones.
- **The script check:** on the STT-1 turbo transcripts of 2026-11-27, the new scripts give 2,501
  and 2,582 again, as in the Slice 3 evidence.
- **Perfect transcripts:** the case texts as transcripts give 2,997 of 3,000 (3 multisig readings
  are over 8 s) and 0 false accepts with each rule set.

**The two sets compare.** On the 5,415 byte-identical transfer clips, 3 transcripts and no decision
differ from the run of 2026-11-27. So turbo is close to deterministic, and the transfer change with
today's rules (2,269 to 2,279) comes from the 87 clips with new audio.

## 4. Multisig

The gain on today's corpus has two parts:

- **No challenge words:** the forgiving rules go from 328 to 354. Whisper often heard the two
  words in another way ("fork and needle" for "falcon needle"). Also, 9 more clips are 8 s or
  shorter.
- **Contacts for a multisig transfer:** today's rules add 35 more (multisig transfers 54 to 89 of
  117), because the recipient step matches the receiver by sound.

What today's rules still refuse:

| Kind                 | Accepted   | The most common cause                                                     |
| -------------------- | ---------- | ------------------------------------------------------------------------- |
| Add member           | 8 of 120   | "Ad Member" or "at Member" for "add member"                               |
| Remove member        | 65 of 120  | A sound-alike name ("Parole", "Eric") or network ("TestNut", "Testimate") |
| Multisig transfer    | 89 of 117  | "and" or "cent" for "send", a joined "to" ("Tvalt")                       |
| Set threshold        | 110 of 120 | "2-2" for "to two"                                                        |
| Set verifier version | 117 of 120 | "115 54062": the digits in two groups                                     |

- A member sentence has no recipient step and no network suffix rules today. Those rules act only
  in a send sentence.
- **A test variant, not today's rules:** with each whole word "ad" written as "add" in the
  transcripts, today's rules read 2,701 of 3,000 (90.0%; add member 41 of 120), with 0 false
  accepts. In the crate, this would be one more entry in `PUNCTUATED_ALIASES` (not tried).

## 5. Limits

- **The baseline is not like for like.** NEAR AI large-v3 was measured on STT-1 with the slot
  rules. On STT-1 with the forgiving rules it read 5 points above turbo (91.1% and 86.1%). A NEAR AI
  run on today's corpus would show the same gap with today's rules. On 2026-11-28 the owner chose
  to skip that paid run. Also, no NEAR AI Cloud key is on the bench machine.
- **The rules know these sentences.** The transfer sentences are those of STT-1, and the forgiving
  rules came from the NEAR AI transcripts of STT-1. A new seed would show how well the rules carry
  to new amounts and names. That costs another turbo run (about $0.25).
- **SaySo's 16-word limit holds for a transcript-only intent too** (`sayso-wasm` `intent.rs`).
  SaySo refuses the intent of 32 requests: 20 transfers, 5 multisig transfers and 7 verifier
  versions, 384 correct readings. With the limit, today's rules read 2,311 of 3,000 (77.0%), or
  88.3% of the 2,616 readings that SaySo takes. The Wallet offers no spoken approval for those
  requests (Q7). The baseline had no such limit, so G1 as written does not count it.
- The score files keep the `model` and `date` strings of the 2026-11-07 scorer.

## 6. Files

- SaySo `9f3de86`, `bench/stt1/results/`: the transcripts
  (`2026-11-28-today-whisper-large-v3-turbo-transcripts.jsonl.gz`), the score files
  `2026-11-28-today-g1-turbo-{slot,forgiving,today}.json`, the perfect-transcript scores, the "ad"
  variant and STT-1 with today's rules. `bench/stt1/README.md`, "Today's grammar", has the same
  tables.
- seams-console `0e487439` and `e76d5b1c` (`dev`): the grammar tool.
- The corpus and the audio are in a scratch folder, not in a repository. `build-corpus.sh` makes
  them again.
