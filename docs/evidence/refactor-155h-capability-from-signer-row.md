# Registration writes no shared capability record

Recorded October 13, 2026, for [R155H](../refactor-155H.md) Phase 9. This is
a local storage change. No hosted resource changed, and no hosted latency is
claimed here.

## What changed

The signer row of a wallet holds its active Ed25519 capability. One record
for all wallets of an environment, `router-ab-yao:router-ab-ed25519-yao:shared`,
also held the last 32 capabilities. Every registration loaded that record,
checked it, added its capability and wrote all of it back under one version
check. On staging the record measured 580 KB.

- **Registration.** The wallet commit checks the capability against its
  admission and its result, then commits its own rows. It reads and writes no
  shared record.
- **Lookup.** A lookup reads the signer row and the shared record side by
  side and writes nothing. Before, a lookup of a wallet outside the last 32
  wrote the shared record.
- **Signing.** A signing admission resolves its material from the signer row
  that its session read already holds. The session statement no longer reads
  the shared record.
- **Recovery.** A recovery admission stores the signer row's capability in
  the shared record and then suspends it there, as before. The shared record
  now holds recovery state only: every suspended capability, and the four
  newest that no recovery suspends.

## Why the guards still hold

| Guard | Before | Now |
| --- | --- | --- |
| A finalization becomes visible once | The lifecycle decision insert and its guard, in the wallet batch | The same statements, unchanged |
| A cancelled registration writes no wallet | The fence statement that the shared record write added for the capability's wallet | The same fence statement, added by the wallet commit |
| A relocating wallet takes no write | The same fence | The same fence |
| A suspended capability is not active for a lookup | The lookup read the shared record | The lookup reads the shared record beside the signer row |
| A promoted recovery replaces the signer row | One batch with the recovery state | Unchanged |

The shared record never held more than 32 capabilities, so its conflict check
at registration covered recent wallets only. The lifecycle decision covers
all of them.

## Database calls

Counted on real local D1 by `tests/e2e/registration-credential-reservation.e2e.mjs`.

| Operation | Before | Now |
| --- | ---: | ---: |
| Wallet commit of a fresh passkey registration | 2 (one read, one batch) | 1 batch |
| Wallet and session commit with founding rows | 3 (two reads, one batch) | 2 (one read, one batch) |
| Capability lookup, wallet among the last 32 | 1 read | 2 reads, side by side |
| Capability lookup, another wallet | 5 calls with one write | 2 reads, side by side |
| Signing admission | the session statement read the shared record | the shared record is not read |
| Commits of two wallets at the same time | the second batch failed its version check and ran again | both commit once |

## Verification

| Check | Result |
| --- | --- |
| Server package type check, and the two test type checks | Pass |
| `tests/e2e/registration-credential-reservation.e2e.mjs` on real local D1 | Pass |
| `tests/e2e/authorization-storage-transfer.e2e.mjs`, with the write fence and capability scenarios | Pass |
| `unit/ed25519SigningCredentialReads.unit.test.ts` | Pass |
| Contract suite, 134 cases on release Workers, three shards | 128 pass |
| The four cases that failed for the environment, run again alone | Pass |
| Bloat check | Pass |

The six cases that did not pass in the shards:

- Three asset cases read a commit id and ran in a tree that was not a git
  checkout. They pass in a git checkout.
- One Email OTP case timed out at its start while three stacks ran. It
  passes alone.
- Two cases inject a terminal Router failure and need the debug Router
  build. They did not run. Neither reaches a wallet commit or a capability
  lookup.

The suite covers registration with a passkey and with Email OTP, the first
signature, unlock, sync, add-signer, device linking, export and recovery.
The recovery cases include an interrupted attempt that a second attempt
supersedes, which is the path that stores and suspends a capability.

The reservation scenario writes its counts to
`.artifacts/registration-credential-reservation/proof.json`.
