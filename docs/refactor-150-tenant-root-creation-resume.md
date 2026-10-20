# R150: resume tenant-root creation from durable decisions

Status: the three recorded recovery paths were implemented and verified on the VM
reference host in September 2026. This did not establish broader R150 release readiness.

## Why

Interrupted creation could leave both roles prepared, only one role activated, or
unrecorded temporary material. Retrying needed one durable decision rather than a new ceremony.

## What changed

- Resumed prepared role state before the initial activation receipt committed.
- Allowed expiry-bound abandonment only before that commit.
- Re-delivered the original receipt after commitment, including after ceremony expiry.
- Added ceremony-bound cleanup and fencing for residual material and delayed writes.
- Preserved exact tenant identity and prevented a committed creation from being abandoned.

The Router receipt determines recovery direction. Re-delivery carries the existing
committed decision and does not grant new creation authority.

## Scope limits

Refresh, managed restore, and retirement retained their separate gates. VM-specific
commands in the full record describe the historical reference host, not the current backend.

## Full record

[Original plan, decisions, and evidence](https://github.com/seams-tech/seams-wallet/blob/8c8cb24a0b791905697c69ce9defb2ba9d7a52fb/docs/refactor-150-tenant-root-creation-resume.md).
