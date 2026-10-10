# Registration address allocation overlap — 10 October 2026

Setup now starts address initialization beside the ceremony read. Both operations
start after the authenticated reservation fixes the wallet and ownership generation.
Hosted latency for this change is unmeasured.

## Finding

The previous hosted candidate recorded Gateway-to-Router allocation spans of
**308, 538, and 19 ms** for three fresh wallets. The preceding ceremony reads took
**18, 14, and 8 ms**. The address lookup then started beside the ceremony write.
Its measured durations were **74, 58, and 10 ms**. These overlapping durations
must not be added as independent latency savings.

Allocation itself performs no D1 operation and opens no Durable Object. The Router
requests three IDs from the role Workers in parallel and generates its own ID.
The Gateway persists the winning address set before startup. The role invocation
traces contain short CPU spans and occasional spikes. They do not isolate how much
of the allocation variability comes from startup, configuration parsing, or dispatch.

[Hosted evidence](refactor-155d-completion-console-hosted.json) preserves the source
measurements. This change removes a known serial dependency before allocation.
It does not claim to resolve all Worker dispatch variability.

## Implementation

Previously:

1. Obtain the authenticated reservation.
2. Read and validate the ceremony.
3. Write the ceremony while initializing the addresses.
4. Sign and return the setup response.

Now:

1. Obtain the authenticated reservation and check its wallet and expiry.
2. Initialize the addresses while reading, validating, and storing the ceremony.
3. Wait for both operations, then return the setup response.

The ceremony branch can also sign its response while allocation is in progress.
The response cannot escape before both branches succeed. Both branches settle
before an asynchronous failure is reported, so a retry sees completed writes.
Existing reservations, immutable address selection, cancellation, and authority
checks remain in force. Startup cannot grant signing authority.

This reorders the existing work. It adds no request, D1 statement, schema,
configuration, cache, or compatibility path. A reserved request that later fails
ceremony validation can still initialize or warm that reserved wallet's objects.
It cannot establish the wallet or sign.

## Verification

The assembled registration scenario holds the ceremony read until the Router
receives the allocation request. The parent implementation times out at this
barrier. The candidate completes it and persists one consistent address set.

The scenario also checks eight competing allocations, lost allocation replies,
exact retry, home-write rollback, cancellation during a directory outage, tenant
isolation, immutable addresses, and a host with no startup callback. It verifies
that ceremony writes settle before an allocation failure is returned.

Four browser scenarios pass: concurrent regional setup, normal NEAR registration,
a lost completion reply, and a failed credential claim after Router consumption.
After the final callback-order adjustment, the exact candidate passes concurrent
setup through three regions and three verified signatures during a Console outage.
The server build and bloat check pass.

[Machine-readable evidence](refactor-155d-allocation-overlap.json) records source
hashes, commands, and verification artifacts. Functional checks do not establish
a new registration latency benchmark.

## Next measurement

Freeze matching SDK, Gateway, Console, Runtime, and custody versions. Compare the
combined registration improvements against the previous hosted candidate, then
repeat that baseline. Record registration-only and first-signature times separately.
Keep WebAuthn interaction, D1 counts, and allocation spans separate in the results.
