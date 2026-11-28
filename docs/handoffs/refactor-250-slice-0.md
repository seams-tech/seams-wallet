# Handoff: Refactor 250, Slice 0

Written on 2026-11-18. Use it to continue Slice 0 of
[Refactor 250](../refactor-250-seams-checkout.md), the Seams Checkout. The plan is the source
of truth. This file tells the next session where the work stops and how to continue it.

## Where the work stops

Slice 0 checks the unknowns before any code. Its research part is done:

- Commit `9203a8805` answers U1 to U13 from public documentation, read on 2026-11-18. It
  changes D1, D13 and D14, and adds facts to D2, D3, D5 and D8.
- Commit `ffba1bac3` adds the section "Remaining Slice 0 tasks" with tasks T1 to T19. The
  status line and the Slice 0 entry of Section 8 point to it.

When this file was written, no code existed for the checkout. Slice 0 ends when each of T1 to
T19 is done or dropped by the owner.

## Where to read in the plan

- "Decisions": D1, D2, D3, D5, D8, D9, D13 and D14 are open, each with a recommendation.
- "Unknowns to check first (Slice 0)": the answer, the source URL, the date and the next check
  for each of U1 to U13. U9 has a gas table.
- "Remaining Slice 0 tasks": T1 to T19, grouped by who does them.
- Section 4: the stablecoin rail. It uses the U8, U9 and U13 results.
- Section 8: the slices and what each waits for.

## What is done since (2026-11-28)

- **T11, T12 and T13** are done. The results are in the plan under U8 and U13.
- **T14 to T19:** the question texts are in
  [refactor-250-provider-questions.md](refactor-250-provider-questions.md). The owner sends
  them.
- **T2:** the owner was asked once, with the recommendations. The code of Slices 2 to 4, 7 and
  9 is built on the recommendations. The plan lists the slice that each decision blocks.
- **The slices:** Section 8 of the plan has the result of each built slice and what each open
  slice waits for.

## What the next session can do

After the owner does T1 (the Stripe Japan and KOMOJU test accounts):

- **T6 to T8** in the KOMOJU test account.
- **T9 and T10** in the Stripe test account.
- The sandbox checks that Slices 2 to 4 and 7 name under "Waits for the owner".

Only the owner can do T1 to T5: the accounts, the decisions, the relayer funding and gas cap,
the review by a lawyer and a PCI QSA, and the PCI texts behind a licence page.

## Rules for this work

- Do not open accounts, sign up or enter data on a provider's site. The owner does T1.
- No test moves real money. Use testnets, test accounts and `eth_call`.
- Record each result in the plan, under its unknown or decision, with the date and the source.
  Then mark the task done in "Remaining Slice 0 tasks".
- If a result changes a decision, update the decision and say why, as the 2026-11-18 changes do.
- U6 gives published rates only, with no tax advice. U10 lists duties and gives no legal
  conclusion.
- Keep the Seams names. They change to Purin with the brand rename (Refactor 251, D22).
- Write in ASD-STE100 Simplified Technical English. Keep lines at 100 characters or less.
- Run `pnpm report:bloat --check` before a commit. Other agents share this checkout: stage only
  your own files, and only at commit time.

## Facts that the tasks need

- Current JPYC: `0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29` on Ethereum, Polygon, Avalanche
  and Kaia. It is a proxy to FiatTokenV1 at `0xafAC17FC3936A29CA2D2787cEd3c5d1c52007d2e`.
  EIP-712 domain: name "JPY Coin", version "1". It takes v, r, s signatures only (no ERC-1271).
- The old prepaid JPYC v2 is `0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB`. It has the same name
  and symbol, so the checkout names a token by its address.
- USDC (FiatToken): EIP-712 domain name "USD Coin", version "2". It supports EIP-3009 and
  EIP-2612.
- The relayer calls `transferWithAuthorization`, not `receiveWithAuthorization`, because the
  second one requires the payee to be the caller. The Worker finds the transfer by the
  `AuthorizationUsed(authorizer, nonce)` event, with the nonce from the quote ID.
- NEAR RPC cannot search transfers by account. Use an indexer (neardata, Intear, FastNEAR
  Transfers) and confirm with `EXPERIMENTAL_tx_status`. NEAR Lake was retired on 2026-03-24.
- The public NEAR RPC allows 30 requests each minute.

## Tips from the first session

- `help.komoju.com` returns 403 to a fetch. Read KOMOJU's PDFs, or ask the owner to open the
  page.
- `docs.komoju.com` page URLs are hard to guess. The `.md` source URLs work and are short.
- BSD `awk` counts bytes, so Japanese text looks too long. Count characters with
  `perl -CSD -ne 'print "$.\n" if length($_) > 101'`.
- The shared notes file `refactor-250-slice0-answers.md` of the parent session was written
  before the task list. It has no T IDs. This handoff replaces it.
