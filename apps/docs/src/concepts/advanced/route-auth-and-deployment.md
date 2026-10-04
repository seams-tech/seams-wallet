---
title: Route auth and deployment
description: Protect Router, worker, wallet-session, and deployment routes with exact identity and request authentication.
---

# Route auth and deployment

Router routes, private worker routes, wallet-session routes, and deployment roles each
have their own authentication requirements.

## Public Router boundary

Before dispatching work to private workers, public signing routes should require:

- Wallet Session bearer authority.
- Strict request-body parsing.
- Origin policy checks.
- Replay checks.
- Quota checks.
- Signing budget admission.

## Private Worker boundary

Deriver and SigningWorker private routes should be reachable only through
approved service bindings or private service auth. They should not expose public
browser CORS or parse Wallet Session credentials directly.

## Deployment roles

Both supported Cloudflare profiles keep Router, Deriver A, Deriver B, and
SigningWorker as distinct runtime roles:

| Profile | Use | A/B transport | Security boundary |
| --- | --- | --- | --- |
| Same account | Selected P0 production, staging, local parity, and benchmarks | Service Binding WebSocket | Separate Worker runtimes under one shared account control plane. |
| Separate accounts | Deferred stronger-operator experiment | Public WebSocket in the measured checkpoint | Independent A and B administration can strengthen the control-plane boundary after its open reliability and latency gates pass. |

The deployment profile is selected before startup. Client requests cannot choose the
topology. Same-account deployment retains isolation against a runtime compromise
confined to one Worker while the account control plane remains honest. Its P0 claim
excludes shared-account administrator compromise. The measured separate-account
deployment missed the current p95 latency target. This target measures the time within
which 95% of requests finish. The profile remains deferred.