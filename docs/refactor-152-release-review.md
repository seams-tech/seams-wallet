# R152: Wallet 0.8.0 release summary

Status: released October 4, 2026.

## Why

Per-wallet regional ownership needed one coordinated browser/server release, verified
package contents, and private consumer adoption.

## What changed

- Released regional Gateway routing and per-wallet homes through Wallet and Wallet Server 0.8.0.
- Preserved home-bound lifecycle operations, exact ownership selectors, and restart/replay behavior.
- Validated public packages and installed the exact releases in Console.

## Completion evidence

Wallet and MPC CI passed. Release run `37199917268` published source `44b1dd07`.
The record includes registry downloads, package integrity, private checks/build,
and an ownership-scope E2E against the published server package.

## Deferred work and limits

Lifecycle D1-call optimization remained a follow-up. Regional proxy measurements did
not establish native full-browser travel latency. Restart tests did not prove arbitrary
transaction crashes, and package release did not itself deploy production infrastructure.

See [the regional plan](refactor-152-regional-D1.md#current-closure-and-remaining-gates-october-4)
for the closure boundary and remaining work.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-152-release-review.md).
