# Deployed mixed-registration baseline

On 2026-09-23, two fresh passkey wallets were registered through the live demo
at `https://wallet.seams.sh/`, using the production-testnet Wallet service at
`https://test.sign.seams.sh/`. Chromium used a virtual WebAuthn authenticator
and the existing opt-in registration diagnostics. The browser ran from Tokyo.
These are diagnostic samples, not a latency distribution.

| Milliseconds | Sample 1 | Sample 2 |
| --- | ---: | ---: |
| Mixed registration return / EVM availability | 5,407 | 4,600 |
| Full NEAR readiness | 10,020 | 8,866 |
| ECDSA gateway respond request | 2,400 | 1,852 |
| ECDSA gateway activate request | 1,494 | 1,509 |
| NEAR custody join | 4,931 | 4,598 |
| NEAR server finalization request | 1,389 | 1,214 |
| Passkey session hydration | 589 | 593 |

The deployed path is substantially slower than the isolated local profile.
The measured request spans include browser-to-Gateway transport and backend
work; they do not identify which part dominates. The custody-join span includes
admission, checkpointing, the Router round, and client completion. These spans
overlap, so their durations should not be added to reconstruct readiness.

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
