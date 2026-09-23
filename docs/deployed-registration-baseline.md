# Deployed mixed-registration baseline

On 2026-09-23, four fresh passkey wallets were registered through the live demo
at `https://wallet.seams.sh/`, using the production-testnet Wallet service at
`https://test.sign.seams.sh/`. Chromium used a virtual WebAuthn authenticator
and the existing opt-in registration diagnostics. The browser ran from Tokyo.
These are diagnostic samples, not a latency distribution.

Evidence status: the four samples below remain valid as small-sample diagnostics.
A separate 20-attempt sequential-context cohort is invalidated and excluded from
hosted latency conclusions. Its machine-readable evidence record is
[`registration-latency-evidence.json`](./registration-latency-evidence.json).

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

## Invalidated sequential-context cohort

A separate 0.6.0 experiment ran 20 sequential registrations and initially
reported 17 successes with a 15,590 ms median, a 29,629 ms maximum, and three
45-second timeouts. This cohort is invalid. Do not use it as evidence for hosted
latency, tail latency, capacity, queueing, throttling, percentiles, or an SLA.

The benchmark retained every completed browser context. Each successful
registration started a five-entry MPC presign refill. Those independent browser
contexts each had their own refill single-flight, so background refills
accumulated and saturated the local browser and worker process. The measured
tail therefore includes benchmark-client contention.

Two controls located the delay:

- With presign refill blocked, alternating registrations stayed between 6,380
  and 6,470 ms.
- With refill enabled, a later attempt spent more than 60 seconds in the client
  before sending the hosted registration respond request. Cloudflare had not
  received the request during that delay.

Five isolated registrations with one active browser context took 6,247 to
9,782 ms, with a 7,785 ms median. Cold ECDSA client creation took 1,384 to
4,103 ms, with a 2,697 ms median. A prewarmed control reached registration
readiness in 5,944 ms; client creation took 6 ms, the Gateway respond request
took 1,794 ms, and activation took 1,929 ms. These controls diagnose components
of the delay. Their sample size is too small for population percentiles or an
SLA claim.

## Registration measurement protocol

Future hosted registration measurements must meet these conditions before they
are added to latency evidence:

1. Keep one active registration per benchmark client unless the experiment is
   explicitly measuring client-side contention.
2. Close each browser context immediately after its attempt. Never retain
   completed contexts while collecting a registration latency cohort.
3. Record the time to the first hosted registration respond request. Classify
   time before that request as client initialization, browser scheduling, or
   local contention.
4. Keep the presign-refill policy identical across compared cohorts. Record
   refill start, completion, and foreground overlap separately.
5. Record Gateway, Router, role-worker, custody, and D1 spans together with the
   observed Worker and D1 placement.
6. Report bounded failures separately. Do not fold timeouts into successful
   latency percentiles or silently retry them.
7. State the sample size, concurrency, browser lifecycle, warm or cold state,
   region, release SHA, and percentile method with every result.
8. Claim population tail latency only from an independently valid cohort sized
   for that percentile.
