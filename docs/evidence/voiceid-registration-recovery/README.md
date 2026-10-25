# Local registration recovery — 2026-10-25

Registration recovered after a controlled restart of the existing local role Workers. The same live-page browser journey then passed in 1.7 minutes, covering registration, recovery backup, enrollment, rejection/retry, unlock, and reviewed signing with the glow and thin ribbon UI.

## Facts

| Fact | Evidence | Limit |
| --- | --- | --- |
| Three earlier wallet journeys failed during registration. The gateway reported execution_failed and upstream worker HTTP 500. | /private/tmp/voiceid-glow-ribbon-proof.log | VoiceID had not opened. |
| The worker log repeatedly reported “Yao ceremony ended without packages”. | /private/tmp/voiceid-live-wallet-services.log | This means the delivery channel closed; it does not identify the earlier cause. |
| Supervisor PID 2591 belonged to start-local-role-workers.mjs with root /private/tmp/voiceid-live-wallet-20261024. SIGUSR2 was sent to that PID. | Process inventory and initiating command in this chat | PID is historical, not a reusable command. |
| The supervisor logged generation 2. The gateway remained ready. | Same service log and /readyz HTTP 200 | Restart reused existing persistence paths. No database deletion, credential reset, or new bootstrap ran. |
| The live-page journey passed after restart. | voiceid-live-page.json and screenshots in this folder | Synthetic browser speech and deterministic NEAR RPC; no human or on-chain result claimed. |

## Cause assessment

| Candidate | Assessment |
| --- | --- |
| Glow/ribbon changes caused registration rejection | Contradicted: registration fails before VoiceID, and the same UI build passed after the worker restart. |
| Deterministically invalid registration input | Weakened: the same test scenario passed after restart. The test allocates a fresh wallet each run. |
| Stale loaded code, stale peer state, or another transient worker fault | Consistent with restart recovery. The available evidence does not distinguish these causes. |
| Database needed deletion or user enrollment needed resetting | Contradicted as a recovery requirement: neither action was performed. |

The root cause remains narrower than a source-code defect: this was a restart-sensitive local runtime failure. There were no before-and-after hashes of loaded worker code, so unchanged running code must not be claimed. The worker restart reloads artifacts from disk. This is a service recovery, not a proven permanent source fix.

An independent read-only review challenged the stale-state attribution. Its objections are reflected above. If this recurs, capture artifact hashes and the first coordinator error with a request trace before restarting. The package-channel closure is secondary evidence.

## Repeat

For this local stack, verify the supervisor process whose command ends with `start-local-role-workers.mjs --root /private/tmp/voiceid-live-wallet-20261024`. Send SIGUSR2 to that verified PID. Wait for the generation increment and gateway readiness. Do not restart unrelated stacks or delete local data.

Use the connection settings in ../voiceid-ui-integration/README.md to repeat the live-page contract. The user can continue the live page with their existing wallet and enrollment.

The separate fresh-session unlock/signing and per-wallet method-selection contracts also passed after recovery (2 tests, 1.6 minutes). This closes the three previously blocked automated journeys. The human enrollment, unlock, and NEAR testnet transfer check remains pending.
