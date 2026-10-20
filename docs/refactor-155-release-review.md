# R155: Wallet release preparation summary

Status: historical publication and validation record for Wallet 0.9–0.12 in October 2026.

## Why

The accumulated custody, routing, runtime, and registration changes needed coordinated
packages, migration checks, and exact private consumer versions.

## What shipped

- Wallet 0.9 introduced the revised registration contract and coordinated protocol/migration cutover.
- Subsequent patches repaired setup compatibility and transient registration response failures.
- Wallet 0.11 removed the Node Gateway, Express entry point, and native VM role hosts.
- Wallet 0.12 removed unused self-hosted factories and Node Redis TCP session-seal adapters.
- The 0.12 Router dispatched Deriver and Signing Worker calls from its stateless Worker again.
- Hosted recovery UI and test-app Arc endpoint changes accompanied those releases.

## Why the Router correction mattered

Calls from fresh per-wallet Router objects frequently started cold callee isolates.
The recorded 0.12 staging comparison reduced cold-call share and started the first
Deriver earlier. These measurements apply to their dated cohorts, not all later deployments.

## Scope limits

Publication, backend deployment, activation, and frontend adoption were separate steps.
Old serving-version notes in the full record are historical and are not current rollout instructions.
Current installation and upgrade guidance lives in [release notes](../apps/docs/src/releases.md)
and [hosted integration](../apps/docs/src/deploy-and-operate/hosted-integration.md).

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-155-release-review.md).
