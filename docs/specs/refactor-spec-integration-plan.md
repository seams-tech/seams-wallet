# Refactor history consolidated into Wallet specifications

Status: documentation consolidation implemented.

## Why

Architectural requirements were scattered across implementation plans and migration
ledgers. Readers needed current contracts without reconstructing historical task order.

## What changed

- Consolidated runtime, custody, sessions, persistence, and Router A/B architecture into numbered specifications.
- Added chapters for tenant recovery, hosted surfaces, agent authority/payment direction, and verification ownership.
- Kept exact public user journeys in `docs/intended-behaviours.md`.
- Kept detailed protocol requirements and proof limits beside their crates.
- Preserved unresolved proposals with their own approval and implementation status.

## Authority and history

[Intended behaviors](../intended-behaviours.md) owns supported user-visible lifecycle behavior.
The [numbered specifications](../README.md#choose-a-topic) own architecture contracts.
Public guides explain released interfaces. Refactor documents preserve decisions,
rationale, scoped results, and pending work; they do not override current contracts.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/specs/refactor-spec-integration-plan.md).
