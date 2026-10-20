# Refactor 140: application components in transaction review

Status: implementation completed. Credential-backed checks and release evidence were
recorded in the original plan. A physical mobile-keyboard check remained unverified.

## Why

An application needed its own purchase review before wallet approval, presented as
one continuous modal without moving application code into the wallet origin.

## What changed

- Added an explicit React review host and six bound transaction adapters for NEAR, EVM, and Tempo.
- Reused one outer dialog, backdrop, FIFO surface reservation, and transition.
- Handed the reservation to the matching wallet request without an ownership gap.
- Kept wallet approval, credential prompts, signing authorization, and secrets inside the wallet iframe.
- Connected cancellation, expiry, disposal, and activation/admission handling.

Continuing application review never approved the wallet operation. Incompatible
silent, auto-approve, or drawer combinations failed before dispatch.

## Scope limits

Message signing, authentication, recovery, export, and external-wallet approval windows
were outside the initial custom-review scope. Publication remained separate from implementation.

Current consumer guidance: [transaction review](../transaction-review.md).

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/archive/refactor-140-custom-components.md).
