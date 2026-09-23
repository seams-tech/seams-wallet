# Deployed mixed-registration baseline

On 2026-09-23, four fresh passkey wallets were registered through the live demo
at `https://wallet.seams.sh/`, using the production-testnet Wallet service at
`https://test.sign.seams.sh/`. Chromium used a virtual WebAuthn authenticator
and the existing opt-in registration diagnostics. The browser ran from Tokyo.
These are diagnostic samples, not a latency distribution.

| Milliseconds | Sample 1 | Sample 2 | Sample 3 | Sample 4 |
| --- | ---: | ---: | ---: | ---: |
| Mixed registration return / EVM availability | 5,407 | 4,600 | 5,375 | 6,006 |
| Full NEAR readiness | 10,020 | 8,866 | 9,064 | 7,961 |
| ECDSA gateway respond request | 2,400 | 1,852 | 1,974 | 1,256 |
| ECDSA gateway activate request | 1,494 | 1,509 | 2,189 | 3,532 |
| NEAR custody join | 4,931 | 4,598 | 4,522 | 4,243 |
| NEAR server finalization request | 1,389 | 1,214 | 1,323 | 1,358 |
| Passkey session hydration | 589 | 593 | 682 | 565 |

The deployed path is substantially slower than the isolated local profile.
The measured request spans include browser-to-Gateway transport and backend
work; they do not identify which part dominates. The custody-join span includes
admission, checkpointing, the Router round, and client completion. These spans
overlap, so their durations should not be added to reconstruct readiness.

Sample 3's Yao response exposed a 3,637 ms Router execution: 590 ms to prepare
the two roles in parallel, 2,588 ms for role execution, and 183 ms for signing
worker delivery. The response arrived at Cloudflare's Tokyo edge and reported
remote placement in Singapore. Placement may contribute to the gap, but this
single response cannot establish how much.

For sample 4, live Router and role-worker trace spans recorded 2,988 ms for
the Router's Yao execution, including 746 ms for parallel pair preparation,
1,884 ms for the Deriver A execution request, and 252 ms for signing-worker
delivery. Inside that request, Deriver A spent 353 ms connecting its WebSocket
and 922 ms in the Yao protocol span. Deriver B recorded 513 ms in its protocol
span; its durable session operations took 407 ms during preparation, 277 ms
to begin the pair, and 351 ms to complete it. These are nested spans and
belong to different Workers. They indicate substantial transport and durable
state time alongside cryptographic work; they do not isolate a single safe
change or predict its benefit.

Both role-private D1 databases report an APAC primary and disabled read
replication. The traced pair transitions include writes, so enabling read
replicas alone would leave those writes on the primary. Cloudflare documents
that behavior in its [D1 read-replication guide](https://developers.cloudflare.com/d1/best-practices/read-replication/).

Both ECDSA responses lacked the `Server-Timing` header. The Gateway was already
collecting timing entries, but the three-route registration handlers did not
attach them to responses. This change passes a request-scoped timing sink through
respond and activate and emits the collected entries in the header. It also
aligns respond metric names with the browser's parser and promotes opt-in custody
stage logs to a visible log level. Timing data stays out of response JSON and
registration persistence.

After the instrumentation is released and deployed, collect a larger set of
fresh registrations and compare Gateway, Router, role-worker, and custody stage
durations. That breakdown will locate the next safe latency reduction. This
change itself does not claim an end-to-end speedup.
