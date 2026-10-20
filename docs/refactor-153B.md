# R153B: simple, fast wallet relocation

Status: implementation, review fixes, and scoped hosted acceptance completed October 7, 2026.

## Why

Per-record database transport and scheduler-driven progression lengthened the source
write pause. Relocation needed fewer transfers and continuous bounded progress.

## What changed

- Transferred each immutable D1 snapshot with one export and one import.
- Kept one active driver progressing the move with exact retries.
- Prepared the destination before the short final source write block.
- Checked final capacity under that block and recovered abandoned checks.
- Resumed partially committed custody batches and batched ECDSA transport.
- Preserved source fencing, destination activation, and cleanup ordering.

## Completion record

Both signing curves and cleanup passed in both directions. Pause through fresh
unlock and first signature measured 43.845 seconds to US and 43.326 seconds back to APAC.
These single observations met the unchanged 60-second scoped limit.

## Scope limits

Routine signing/refill routes were unchanged. Package publication, production adoption,
and broader load claims were separate work. See the [parent refactor](refactor-153-wallet-region-selection.md).

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-153B.md).
