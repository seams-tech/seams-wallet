---
title: Hosting targets
description: Where the Seams wallet server roles run today, Cloudflare Workers, Google Cloud VMs, and AWS EC2, and what each target has been tested for.
---

# Hosting targets

The Seams wallet server roles run on three hosting targets:

| Target | Runtime | Storage | Status |
| --- | --- | --- | --- |
| Cloudflare | Workers and Durable Objects | D1, KV, and R2 | Production path. The hosted Seams service runs here. |
| Google Cloud | Seams runtime build on Compute Engine VMs | Cloud Storage buckets | Tested on ordinary and Confidential (AMD SEV-SNP) VMs. |
| AWS | Seams runtime build on EC2 instances | S3 buckets | Tested on ordinary instances. |

The roles are the same on every target: Router, Deriver A, Deriver B,
SigningWorker, and the tenant-root control plane. Each target runs the
released Wallet Server package without changes to its request handlers.

## Seams runtime build

On VMs, the roles run in a Seams build of the open-source
[celld](https://github.com/denoland/celld) runtime. It runs Worker code,
provides Durable Objects and the D1 and KV APIs, and keeps durable state in
object storage. It needs no separate database or cache service.

One VM is one host failure domain. Two or more VMs share one fleet bucket.
When a node fails, another node takes over its Durable Objects.

## What each target has been tested for

**Cloudflare.** The Wallet lifecycle contract suite runs on the Workers
runtime. The hosted service runs on Cloudflare.

## Historical provider qualification

The current SDK release is **0.28.0**. The results below record the versions and configurations tested at those dates.
They do not establish qualification of 0.28.0 on the same infrastructure.
See [Release 0.28.0](/releases) for current deployment requirements.

**Google Cloud.** Tested in `us-central1` with Wallet Server 0.11.0. All 16
selected Wallet browser contracts pass on an ordinary VM and on an AMD SEV-SNP
Confidential VM. A live Yao key ceremony keeps its safety guarantees when a
node is killed or when the peer network is cut. The interrupted attempt stays
unusable. The surviving node takes over, and a new wallet completes.

**AWS.** Tested in `ap-southeast-1` (Singapore) on 2026-10-21 with Wallet
Server 0.17.0, on two `m7i.xlarge` instances with S3 storage. The single-node
service check passes: HTTPS forwarding, the request body limit, and state
recovery after a forced restart. The same Yao node-loss and network-cut checks
pass as on Google Cloud.

Compatibility with a Confidential VM does not give attestation-controlled key
release. That needs a separate design.

## Not yet available

- **Self-serve deployment tooling.** VM deployments currently need our help.
  Contact us for early access. A customer deployment tool, wallet import, and
  verified cutover are planned. See
  [recovery and portability](/deploy-and-operate/recovery-and-portability).
- **On AWS:** the browser contract suite, an S3 access-denial check, and
  Confidential instances. Singapore has no SEV-SNP instance types.
- **Moving a live deployment between targets.** Move wallets only through the
  authorized relocation or recovery flow. Never copy storage snapshots between
  hosts.
