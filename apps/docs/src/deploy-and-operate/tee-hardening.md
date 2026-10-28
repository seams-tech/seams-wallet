---
title: Future TEE hardening
description: A potential deployment hardening step that separates Deriver A and B across attested environments while preserving two-party protocols.
---

# Future TEE hardening

Seams could place Deriver A and Deriver B in separate trusted execution
environments (TEEs), with separate cloud accounts and administration. A TEE
uses hardware isolation to protect running code and data within its defined
threat model.

::: info Proposed architecture
This page describes a potential future hardening step. It is not a supported
deployment recipe or a claim about current production protection.

The `celld` runtime has qualification evidence on Google Confidential VMs and
ordinary AWS EC2 instances. Nitro Enclaves integration and attestation-controlled
key release need separate implementation and verification. See
[hosting targets](/deploy-and-operate/hosting-targets) for current scope.
:::

## Preserve the two-party boundaries

The proposal keeps both existing protocol boundaries:

- Deriver A and Deriver B cooperate during provisioning, recovery, and other
  derivation operations.
- The client and SigningWorker cooperate during ordinary signing. Derivers
  remain outside that path.

One possible deployment places A in Google Confidential Space and B in an AWS
Nitro Enclave. Each environment runs its own role through `celld`.

| Boundary | Deriver A | Deriver B |
| --- | --- | --- |
| Execution | Google Confidential Space | AWS Nitro Enclave |
| Administration | Separate Google identity and hardware security key | Separate AWS identity and hardware security key |
| Secret access | A's tenant-root share and wrapping keys | B's tenant-root share and wrapping keys |
| Persistence | A-only encrypted state and backups | B-only encrypted state and backups |
| Peer traffic | Authenticated, encrypted protocol messages | Authenticated, encrypted protocol messages |

A TEE around SigningWorker would be a separate extension. Protecting the
Derivers does not automatically protect SigningWorker or the client.

See [Router A/B](/concepts/threshold-signing/router-ab) for the existing role split.

## Expected benefits and limits

Separate accounts restrict the effect of a compromised account credential.
Different providers and isolation technologies can reduce some shared failure
modes. Attested execution can restrict secret access to approved workloads.
These protections depend on the selected platforms and their configuration.

Separate email accounts and hardware security keys, such as YubiKeys, can help
protect administrative access. Account recovery, deployment credentials, and
key-release policy administration also need separation. One person controlling
both accounts remains a common administrative authority.

This design preserves the smaller coordination surface of two-party protocols.
It does not provide three-of-five availability: either unavailable Deriver can
block a new derivation. It also does not protect against combining both roles'
secrets or every vulnerability shared by their application code.

Two hardened participants can outperform a poorly isolated larger group against
specific attacks. There is no general security ordering between two TEEs and a
three-of-five deployment. Compare administrative control, hardware assumptions,
recovery authority, compromise tolerance, and availability separately.

## Runtime integration

Google Confidential Space runs Linux containers and supports explicitly exposed
inbound ports. Packaging `celld` and the approved Worker artifacts into that
environment is a candidate integration path. Existing execution on a Confidential
VM does not establish protection from a guest administrator. See Google's
[workload documentation](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/create-customize-workloads)
and [security model](https://docs.cloud.google.com/docs/security/confidential-space).

AWS Nitro Enclaves have no external networking or persistent storage. The runtime
would need networking through `vsock`, a socket connection to the parent EC2
instance, and external encrypted persistence. The parent can relay ciphertext;
secret processing and authenticated channel endpoints must remain inside the
enclave. Ordinary Nitro-based EC2 hosting alone does not establish this boundary.
See the [Nitro Enclaves overview](https://docs.aws.amazon.com/enclaves/latest/user/nitro-enclave.html)
and [attested key-release flow](https://docs.aws.amazon.com/enclaves/latest/user/connect-enclave-kms.html).

## Bind secret access to approved code

Attestation provides evidence about the identity and state of a workload.
Secret release must verify that evidence against an approved policy.

Measuring only the `celld` executable is insufficient if it subsequently loads
replaceable JavaScript, WASM, or security configuration. The approved identity
must cover every artifact that can influence secret use.

Two candidate approaches are packaging those artifacts into the measured image,
or having measured runtime code enforce approved artifact digests before secret
release. Updates to those approvals require controlled authorization. Attestation
does not establish that approved code is free of vulnerabilities.

## Preserve separation during failure and recovery

Role separation must survive runtime ownership changes. A's objects and secret
access must stay within A's approved boundary during takeover. B's host must
never become an eligible owner of A's secret material, or vice versa.

Fleet storage, deployment manifests, credentials, and backup access must enforce
that restriction. Cross-role access through a shared fleet would weaken the
proposed account separation.

External storage needs freshness protection as well as encryption. Replaying an
old encrypted record must not restore consumed protocol material, retired
authority, or an obsolete ownership claim. Existing epochs, burned-operation
records, and ownership fences must retain their guarantees under the new host
threat model. A host-controlled snapshot cannot be the sole freshness authority.

Recovery and key release must preserve the same separation. See
[tenant-root backups](/deploy-and-operate/tenant-root-backups) and
[recovery and portability](/deploy-and-operate/recovery-and-portability).

## Performance and qualification

Continuously running instances allow more control over placement and runtime
initialization. Cross-cloud latency and transfer costs still affect derivation
ceremonies. Nearby regions may help, but the complete protocol needs measurement.
Deriver traffic remains outside ordinary signing. A separate SigningWorker TEE
integration needs its own signing measurements.

Before treating this architecture as supported, verify:

1. Both role workloads execute inside their intended protected environments.
2. Modified runtime, Worker, WASM, or security configuration cannot obtain secrets.
3. One account cannot release, recover, or deploy code with access to both shares.
4. Restart, takeover, partition, and stale-state replay preserve role and one-use boundaries.
5. Authorized updates and recovery preserve wallet identity and retire obsolete authority.
6. End-to-end ceremony measurements cover steady operation, restart, and peer failure.

Retain reproducible evidence for the exact artifacts, attestation policies,
provider configurations, and measured operations. Runtime compatibility alone
does not establish these security or performance properties.
