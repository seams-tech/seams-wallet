# Router A/B

Router A/B is the role-separated server architecture used to provision and use
Wallet signing lanes. Deriver A and Deriver B hold separate tenant-root shares;
the SigningWorker holds the server half of activated wallet lanes; the Router
coordinates admitted protocol operations without receiving either Deriver's
share.

This directory describes the current implementation:

- [Protocol and trust boundaries](./protocol.md)
- [Ed25519 Streaming Yao](./ed25519-yao.md)
- [Cloudflare deployment](./deployment.md)
- [Local development](./local-development.md)

The numbered specifications define the product-level requirements:

- [Spec 5: Router A/B threshold protocol](../spec-5-router-ab-threshold-protocol.md)
- [Spec 6: tenant roots, recovery, and portability](../spec-6-tenant-roots-recovery-and-portability.md)

Exact wire encodings, route constants, storage schemas, and cryptographic
algorithms remain owned by the Rust crates that implement them. The source map
in [protocol.md](./protocol.md#source-map) identifies those owners. Update these
documents in the same change whenever a role, binding, persistence boundary, or
supported lifecycle changes.
