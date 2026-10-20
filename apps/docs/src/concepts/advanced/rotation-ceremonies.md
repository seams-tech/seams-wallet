---
title: Rotation ceremonies
description: Understand envelope rewrap, custody-share refresh, signer rotation, and wallet rekey ceremonies.
---

# Rotation ceremonies

Tenant-root refresh replaces the operational shares held by Deriver A and
Deriver B while preserving the effective derivation root. It leaves wallet
public keys and addresses unchanged. For other rotation types, see
[key rotation](/concepts/delegation/key-rotation).

## Admission and execution

1. The authenticated Console boundary resolves the tenant identity and active
   custody lineage. The caller supplies an operation ID, never replacement
   shares or an alternate tenant-root identity.
2. The tenant's Router-owned Durable Object records admission of the operation.
   R120 allows one successful manual refresh per rolling hour. It rejects distinct concurrent requests and requests within the cooldown before Deriver or provider work.
3. The control plane issues role-specific commands. Each Deriver reserves durable state before writing backup objects.
   It installs only its own refreshed share and returns signed public evidence.
4. Activation requires matching A/B evidence and root continuity. The
   authoritative lifecycle revision advances, and manual completion time and
   the replay receipt commit together.
5. Retirement removes superseded active records and backup objects. A failure after activation requires retirement cleanup. The previous epoch does not become active again.

Normal signing uses existing signing material throughout this operation. New tenant
derivation ceremonies may be blocked while the active epoch changes.

## Interrupted operations

Retry with the same operation ID. Durable reservations and execution checkpoints let the
existing attempt resume. Completed IDs return the recorded result. A late retry cannot
reinstall an epoch superseded by a newer refresh. Terminal role commits also have
replayable Router installation checkpoints.

Treat activation and retirement as separate outcomes. An active refresh with
unfinished retirement needs cleanup, even when normal signing works. Avoid
starting unrelated rotations to repair an uncertain response.

## Recovery and destruction

Managed restore verifies a recovered role share and requires a forward refresh
before normal lifecycle admission resumes. Its authorization is separate from
manual tenant refresh and cannot be selected through a tenant bypass flag.

The current Google KMS backup keys are shared across tenants within each role. Removing
an old R2 object does not make every historical ciphertext copy unrecoverable. Report
operational rotation and cleanup accurately. Stronger cryptographic-erasure claims
require independently verified key destruction.

## Availability

Tenant-root refresh is included in the published Wallet Server. Verify the hourly
admission policy, dashboard step-up, progress, scheduler, and recovery custody
in the deployed environment. SDK publication does not establish those operating
paths. See
[recovery and portability](/deploy-and-operate/recovery-and-portability) for
hosted rollout and recovery delivery gates.

Read next: [tenant-root backups](/deploy-and-operate/tenant-root-backups) and
[recovery and portability](/deploy-and-operate/recovery-and-portability).
