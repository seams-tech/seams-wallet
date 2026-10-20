# R155F: reduce NEAR registration round trips

Status: implementation, correctness checks, combined measurement, and staging restoration
completed October 11, 2026. The full registration-and-signature target remained unmet.

## Why

Registration repeated directory, persistence, and service exchanges on the critical path.
The work aimed to remove demonstrated serial overhead while preserving durable recovery.

## What changed

- Combined related registration persistence and reduced Gateway/Console exchanges.
- Preserved exact operation identity, committed replay, and recovery behavior.
- Measured the complete candidate rather than adding estimated savings from separate experiments.

## Recorded outcome

- Completed registration D1 calls fell from 34 to 28; through first signature, 41 to 35.
- Submitted registration SQL statements fell from 117 to 113.
- Candidate median registration was 3.929 seconds; first signing was 0.713 seconds.
- Combined SDK time was 4.647 seconds, excluding interaction and harness overhead.

These counts exclude custody-role databases and two background calls still pending
when responses were captured. Three candidate samples establish no latency guarantee.

## Deferred work and limits

The larger latency target remained open. R155G owned additional placement and hidden
exchange work. Later tail acceptance belongs to [R155J](refactor-R155J-p99.md).
See the [combined hosted evidence](evidence/refactor-155f-combined-registration-hosted.md).

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-155F-registration-round-trips.md).
