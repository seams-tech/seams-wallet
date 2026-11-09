# Speak-to-Sign speed: from the end of speech to the receipt (2026-11-09)

Status: analysis and proposal only. No code changed, nothing deployed. Each option waits for
the user's approval. Context: [Refactor 227](../refactor-227-speak-to-sign-without-passkey.md),
release 0.60.0, verifier 0.4.1 (`d078eb11…d54c`).

## Result

- The owner waits about 9.7 s, not 8.1 s. The recorder stops only after 1.5 s of silence
  (`END_PAUSE_MS`), and the "end of speech" clock starts after that stop.
- Verify (5.2 s) is the largest part. In it, the verifier's own work is 1.7 s. OutLayer adds
  0.75 s inside the run and 1.5–3.5 s outside it (upload, queue, start, return).
- The transaction (2.9 s) is mostly NEAR. The two signing rounds took 41 ms on the local
  stack. After the transfer executed, the Wallet waited 1.3 s more: one block for the gas
  refund receipt and 0.6 s for the RPC answer.
- The Wallet already waits for `EXECUTED_OPTIMISTIC`, not `FINAL`. So "wait for an earlier
  status than final" is not a saving as stated. `INCLUDED` is the saving (about 1.1 s).
- Recommendation: first do options 1 and 2 (about 1.8 s, small work). Then choose between
  option 4 (keeps the TEE, high work) and option 5 (drops the TEE, high work) for the next
  2–3 s.

## Time breakdown

Run: local live run 2 of 2026-11-09 (0.01 NEAR, owner
`vibrant-voyage-452y2d.seams-relayer.testnet`, transaction
`3TprKNxH3DD1AxCbePKHhYUfAUTAKaqU5owudCzgrcnm`). The Wallet reported speech 4112 ms,
verify 5181 ms, transaction 2935 ms, end of speech to receipt 8118 ms.

| Segment | ms | Source | Kind |
| --- | --- | --- | --- |
| Last voiced sound → recorder stop (`endOfSpeechAt`) | 1500 + stop and decode | `END_PAUSE_MS` in `voiceid/src/browser/microphone.ts` | inferred from code; not in the 8118 |
| **Verify** (Wallet `verifyMs`) | **5181** | Wallet result | measured |
| – Wallet → stream headers (auth, body, owner check) | about 25 | CDP response log | measured |
| – OutLayer call, headers → `verdict` event | 5154 | CDP stream log | measured |
| **Transaction** (Wallet `transactionMs`) | **2935** | Wallet result | measured |
| – `verdict` in browser → co-signer admits the verdict | 408 | CDP log time vs `speak_to_sign_voice_verdicts.accepted_at_ms` | inferred (two clocks on one Mac) |
| – Gateway: claim at prepare → finalize complete | 38 (+3 admission) | `authorized_operations.claimed_at_ms` / `completed_at_ms` | measured |
| – Finalize complete → transaction in block 276921570 | 756 | D1 time vs block timestamp | inferred (Mac clock vs chain clock) |
| – Block → transfer receipt executed (block +1) | 436 | block timestamps | measured |
| – Transfer receipt → gas refund receipt (block +2) | 669 | block timestamps | measured |
| – Refund block → receipt in the Wallet | 625 | the rest of 2935 | inferred |

The six transaction rows add up to 2935 ms by construction: the receipt time is the
`verdict` time plus `transactionMs`.

### Inside verify: three direct calls to OutLayer

Same verifier version and owner, from this Mac with `curl`, sync mode, a fresh `say` clip
(about 150 KB WAV, 200 KB request). All three accepted (speaker score 889–897).

| Stage | p1 | p2 | p3 |
| --- | --- | --- | --- |
| Client wall | 5919 | 5379 | 5262 |
| Outside the run (wall − OutLayer `time_ms`) | 3460 | 2895 | 2814 |
| – of which return after the verdict signature | 325 | 367 | 334 |
| OutLayer `time_ms` | 2459 | 2484 | 2448 |
| Run overhead (`time_ms` − worker `total`) | 759 | 746 | 767 |
| Worker `total` | 1700 | 1738 | 1681 |
| – `decode` | 19 | 20 | 19 |
| – `parallel` (send + storage + wait) | 1480 | 1518 | 1493 |
| – `speaker` (Phala, critical path) | 1476 | 1515 | 1489 |
| – – `redimnet` (model time in the service) | 405 | 460 | 431 |
| – `storage` (template read, used-audio check; overlaps the requests) | 1256 | 1236 | 1217 |
| – `transcribe` (NEAR AI Whisper; upper bound, see instruments) | ≤1256 | ≤1237 | ≤1218 |
| – `mark` (used-audio write, after the decision) | 195 | 192 | 162 |
| – `policy`, `sign` | 0, 0 | 0, 0 | 0, 0 |

Control: OutLayer calls with `{"op":"probe"}`, which the verifier refuses at once.

| Input | Wall | `time_ms` | Outside the run |
| --- | --- | --- | --- |
| 300 B | 3265 | 740 | 2525 |
| 200 KB | 3383 | 747 | 2636 |
| 300 B | 2614 | 1091 | 1523 |
| 200 KB | 3468 | 755 | 2713 |

- An empty run costs 740–1091 ms of `time_ms`. So the 0.75 s run overhead is fixed, not
  verifier work.
- The input size gives no clear signal in 2 + 2 calls. The spread between calls of the same
  size (1.5–2.5 s) is as large as the difference.
- The same spread shows in the live run: verify took 5154, 3637 and 3596 ms for three
  recordings with the same verifier work.

## Facts and instruments

| # | Fact | Instrument | Where and when | Checked |
| --- | --- | --- | --- | --- |
| 1 | Verify 5181, transaction 2935, total 8118 ms | Wallet `times` | local run 2, 12:42 UTC | the CDP log gives 5154 for the same call |
| 2 | Recorder stops 1500 ms after the last sound; `endOfSpeechAt` is read after the stop | code | `microphone.ts:66`, `phrase.ts:148` | `verifyStartedAt − endOfSpeechAt` is 2 ms, so the pause is outside the figure |
| 3 | Signing rounds: 38 ms in the gateway, both rounds | D1 `authorized_operations` | run 2 database | the operation completes at finalize (`thresholdEd25519.ts`) |
| 4 | Verdict admitted 12:42:48.648; signed by the verifier 12:42:47.784 | D1 ledger; `expires_at_ms − 120 s` | run 2 database | Mac clock offset +8 ms (`sntp`) |
| 5 | Transaction in block at 49.445, transfer 49.881, refund 50.550 | NEAR RPC block headers | `test.rpc.fastnear.com` | final status `FINAL`, both receipts `SuccessValue` |
| 6 | The voice path sends with `EXECUTED_OPTIMISTIC` | code | `shared-ts/src/near/nearClient.ts:60`; no `waitUntil` in `signVoiceApproved` | the only `FINAL` callers are in `ownerNearOperation.ts` |
| 7 | Worker stage times (table above) | verifier `ms` | 3 direct calls, 2026-11-09 | stage sums match `parallel` and `total` |
| 8 | Run overhead 0.75 s, outside 1.5–3.5 s | `curl -w`, OutLayer `time_ms` | 3 verify + 4 probe calls | agrees with the probes in Refactor 227 Facts |
| 9 | The prepare claim spends one Wallet Session use | code | `thresholdEd25519.ts:577` (`consume_reusable_wallet_session`) | – |
| 10 | Staging rounds, related: prepare 307 ms, sign 307 ms (browser median) | Server-Timing, 66 registrations | [release-0110 staging](release-0110-staging-20261016.md) | not the voice path |

Instrument limits:

- `transcribe` is set when the poll loop sees the response. The poll loop runs only after
  the blocking storage calls. So `transcribe` ≈ `storage` in each call, and the true Whisper
  time is unknown. Gate 0 measured 0.72–0.79 s.
- The live test logs the "Done" card 1.6 s after the receipt. That is the test's polling
  loop, not the product. The card time is not measured.
- The verdict content of the live run was not saved, so its stage times are unknown. The
  direct calls stand in for them. Parity: the same verifier version, owner, voice and
  sentence; the client is `curl`, not the gateway.
- The local stack is not staging. The gateway, D1 and the MPC Router ran on this Mac.

## Options

Savings are per voice payment, as the owner sees them. Today: about 9.7 s from the last
spoken word to the receipt.

| Rank | Option | Saving | Work | Trade-off |
| --- | --- | --- | --- | --- |
| 1 | Show "Sent" at `INCLUDED` for a plain transfer | about 1.1 s (measured: 2 blocks), up to 1.7 s | small | see below |
| 2 | Shorter or adaptive end pause (1.5 s → 0.7–0.8 s) | about 0.7 s | very small | can cut a slow speaker |
| 3 | Write the used-audio mark during the requests | 0.16–0.20 s | small (verifier version) | burns a recording on a refusal or an outage |
| 4 | Start the OutLayer call at "Record"; the worker fetches the clip at the end | about 1.5–3 s | high | see below |
| 5 | Cloudflare-hosted verifier (Refactor 225, Decision 6) | about 2.3–4 s | high | no TEE attestation |
| 6 | Prepare round during verify; co-signer check at finalize (option a) | about 0.3–0.45 s | medium–high | see below |
| 7 | Faster speaker hop (co-locate Phala, lighter request) | at most 0.25 s now | medium | storage and Whisper become the limit |
| – | Wait for an earlier status than `FINAL` (option b as stated) | 0 | – | already `EXECUTED_OPTIMISTIC` |
| – | Smaller audio payload (compressed clip) | not shown | medium | no signal in the probes; lossy audio can lower the speaker score |

### 1. `INCLUDED` for a plain transfer

- Two forms:
  - Send with `INCLUDED`, and return `sent` at once. The app result changes: no execution
    outcome.
  - Send with `INCLUDED`, show "Sent" on the card, then read the status with
    `EXECUTED_OPTIMISTIC` before the result. The app result stays the same; only the card is
    faster.
- After inclusion, NEAR has already checked the signature, the nonce and the balance. A
  transfer can still fail only if the receiver account does not exist. The Wallet checks
  that before verify (`receiverExists`).
- A note or a rating is a contract call and can fail in the contract. It keeps
  `EXECUTED_OPTIMISTIC`.

### 2. End pause

- One constant in `voiceid/src/browser/microphone.ts`. It also applies to the VoiceID unlock
  and to enrollment.
- An adaptive rule has less risk: a short pause only when the voiced time already covers the
  expected sentence. Speak-to-Sign knows the sentence.
- Check with real voices before release. A cut sentence gives a "words" refusal and a new
  recording, which costs much more than 0.7 s.
- Also start the reported time at the last voiced frame, so the card and the metric show
  what the owner waits.

### 4. Early verifier call

- At "Record", the gateway starts the OutLayer call. The worker reads the template, then
  waits for the clip from the Seams gateway. The Wallet uploads the clip at the end.
- The OutLayer upload, queue, start and run overhead (2.3–4.2 s) then overlap the speech and
  the end pause (about 5.6 s in the live run).
- Trust is the same. The verdict binds the audio digest, and Wallet core compares it with
  its own recording.
- Costs: a paid OutLayer call for each "Record", also when the owner cancels; a new clip
  hand-off route (a Durable Object or a long poll); a new verifier version with the Seams
  host in its network list; the 15 s execution limit must cover an 8 s recording.

### 5. Cloudflare-hosted verifier

- Removes the OutLayer outside time and run overhead. The speaker and Whisper calls stay
  (about 1.5 s in parallel). Expected verify: about 2 s.
- The verdict key then lives in a Seams Worker, not in a TEE. A compromised Seams server and
  a malicious app together could approve a request that the owner did not say. Today the TEE
  stops that.
- The owner parked this as "later" in Refactor 225, Decision 6.

### 6. Prepare during verify (option a)

- The prepare round needs only the transaction, which is known before verify. The nonce and
  the block hash are already prefetched.
- The co-signer check moves to the finalize round. The finalize request must then carry the
  verdict and the unsigned transaction.
- A refused verdict still spends one Wallet Session use (fact 9) and leaves a pending
  operation.
- The saving is small: one round. Staging measured about 307 ms for a round (fact 10). The
  408 ms local gap from verdict to admission holds other client work too.

## Unknowns and how to settle them

| Unknown | Measurement |
| --- | --- |
| The voice payment time on staging | One staging voice payment with Server-Timing (`ed25519_sign_*`) and the `verdict` event saved |
| The 408 ms client gap (verdict check, signing setup, prepare request) | `performance.mark` around each step in `signWithVerdict` and the signing flow |
| The 625 ms from the refund block to the Wallet receipt (RPC delay vs client work) | Time the `send_tx` response separately from the nonce-coordinator writes |
| Whisper time in the worker | Poll the requests between the storage calls, or time the request in the host |
| What OutLayer does in the 1.5–3.5 s outside the run | Only the OutLayer team can split it; give them the call ids `da75ce9d…`, `13bcbf23…`, `b2ffeead…` |
| The card time as the owner sees it | Log the card render time in the plugin, not by test polling |

## Statements withdrawn

- "The broadcast waits for `FINAL`" (the premise of option b). The voice path waits for
  `EXECUTED_OPTIMISTIC`.
- "8.1 s from the end of speech." It is 8.1 s from the recorder stop, which is 1.5 s after
  the last voiced sound.

## Method notes

- Follows [the debugging method](../debugging-method.md) for the measurements: each
  instrument was checked, and each number is marked measured or inferred.
- Step 9 (an independent reviewer) was not done.
- Cost: 3 verify calls and 4 probe calls on OutLayer. No NEAR was spent, no live Wallet run,
  and the Phala CVM was not started or stopped.
