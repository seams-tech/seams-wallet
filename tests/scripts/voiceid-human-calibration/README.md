# Local human VoiceID calibration

Run from `seams-wallet` after building the Wallet and VoiceID packages:

```sh
node tests/scripts/voiceid-human-calibration/serve.mjs 4390
```

Open `http://localhost:4390/` in Chrome. The server binds to loopback and serves
assets only. It accepts no uploads. Recordings use the production microphone,
MediaRecorder, Silero, Aurora, and ReDimNet code. This page never opens a wallet,
reads a wallet enrollment, activates an authentication method, or signs anything.
It can remember microphone preferences in this isolated localhost origin.

## Collect real readings

1. Use consenting participants and pseudonymous codes such as `p01`.
2. Put at least two different people in the calibration cohort and two other
   people in the evaluation cohort. Keep each person in one cohort throughout.
3. Prepare VoiceID. Select a participant and a session label, such as `day1_desk`.
4. Record three enrollment clips. Label every completed attempt honestly, including
   failures. Correctly read clips that pass the audio-quality check form the
   enrollment mean. Recognition and speaker scores do not filter these clips.
5. Keep the page open. After a break, select a new session label for the same
   participant. Record probe readings across the phrase bank. Repeat on later
   days and with realistic microphone and room conditions where practical.
6. Freeze calibration before adding any evaluation speakers. The tool then blocks
   further calibration recordings and holds the candidate cutoff fixed. Evaluation
   speakers must be different people. Never tune the cutoff using their results.
7. Include deliberate different-word controls. Label these as different words.
   They measure incorrect-phrase acceptance and do not fit the speaker cutoff.
   Label accidental mistakes as **I stumbled** instead. They remain in usability
   denominators and can supply usable natural speech for speaker comparisons.
8. Export scores before closing or reloading. Closing clears all voice vectors.

Prompts are chosen at random from the least-tested phrases for that participant
and role. Rejected clips still count when the participant reports reading them
correctly. Cancellations are abandoned captures and are not labeled attempts.
Do not cancel because a result looks unfavorable. Record and label it instead.

The recorder discards audio after processing. Templates and probe embeddings stay
in memory to calculate cross-speaker scores. They are never exported. The export
contains phrase labels, reading judgments, score comparisons, cohort/session
codes, model hashes, browser version, and source revision. It contains no wallet
identities, transcripts, raw audio, voice vectors, or microphone device identifiers.

## Interpret the report

Phrase success means the production matcher accepted a natural probe. Its
denominator includes stumbles, audio failures, and inference failures. The export
also separates recognition of correctly read phrases from accidental misreadings.
Enrollment attempts remain in the export but are excluded from phrase rankings.
The table also reports full VoiceID approval at the current cutoff. That count
requires both the phrase match and a genuine-speaker match. It ranks the lowest
observed approval rate first, so phrase and speaker failures remain distinguishable.
Every current phrase appears. Unobserved phrases are **Unrated**. Observed rates
remain provisional, with participant and session counts beside them.

Speaker comparisons use usable natural probes from later sessions, including
stumbles. Deliberate different-word controls remain separate. Each
probe is compared with every enrolled person in its cohort. The genuine and
different-speaker decisions use the same `score >= cutoff` rule as the Wallet.
The current cutoff is reported separately and remains unchanged in production.

Candidate selection uses calibration speakers only. It minimizes genuine rejects
without increasing the current cutoff's observed different-speaker accept count.
The candidate is then frozen and checked on evaluation speakers. A worse held-out
count blocks that candidate. Do not tune it using those evaluation results.

This preserves an observed count, not a population risk guarantee or an approved
false-accept target. Four participants only make both kinds of comparison possible;
they do not qualify authentication accuracy. Scores share people and templates.
Report denominators and independent participant/session coverage. Do not describe
zero observed false accepts as zero risk. Replay and generated-voice attacks need
a separate evaluation. Participant and session labels are self-reported.

Synthetic browser checks export `source: synthetic_fixture` and cannot produce
a human cutoff recommendation. Existing synthetic phrases and audiobook trials
must stay separate from this human microphone dataset.

After collection, inspect the JSON report before changing the phrase bank or
`VOICE_MATCH_THRESHOLD`. A cutoff change still needs an agreed wrong-person risk
target and a separate qualification dataset. This tool never applies one.

## Repeat the tool check

```sh
pnpm -C tests exec playwright test -c playwright.wallet-browser.config.ts \
  wallet-ui/voiceid-human-calibration.chromium.test.ts \
  --output=../output/playwright/voiceid-human-calibration
pnpm -C tests type-check:wallet-state
```

The browser check uses synthetic audio through real MediaRecorder, Silero,
Aurora, and ReDimNet. It produces a score export, a validation JSON file, and a
screenshot. Its source tag prevents treating that result as human evidence.
