# R155D: registration-to-first-signature critical path

Status: closed October 11, 2026, with scope differences and unmet performance targets.
No implementation or measurement task remained assigned to R155D.

## Why

Registration latency included serial startup, directory/database work, and client
follow-up reads. Attribution was needed before changing cryptographic work.

## What changed

- Stored unique object identifiers and started selected work during setup.
- Added a registration status seed and completed the staging role-database cutover.
- Established timing and request-count boundaries for later comparisons.
- Handed Gateway/Console batching, the recovery fix, and combined verification to R155F.

## Recorded outcome

The combined R155F comparison reduced Gateway/Console registration D1 calls from
34 to 28. It measured 3.929 seconds for registration and 4.647 seconds through the
first verified signature, excluding interaction. It did not establish an overall latency improvement.

The separate R155G early-prepare comparison measured 396 ms first signing and
4.144 seconds through registration plus signing. These cohorts must remain separate.

## Follow-up ownership

[R155F](refactor-155F-registration-round-trips.md) records the batch comparison.
[R155G](refactor-155G-apac-anchor-and-hidden-exchanges.md) retains its own placement and rollout status.
The larger latency objective was not met by closing this refactor.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-155D-registration-critical-path.md).
