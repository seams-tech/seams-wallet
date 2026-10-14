# R155J — A 12.2-second wait inside one Router wallet object

Date of the fault: October 14, 2026, 21:33:29 JST, staging, release 0.10.2.
Plan: [R155J](../refactor-R155J-p99.md). Method:
[debugging method](../debugging-method.md).

## Result

One registration of 198 took 14.8 s without the passkey step. Of that,
12.2 s is one call: `finish_registration` from the Router to its wallet
object. The object read the request and ran its storage calls at once.
Then 12.2 s passed before the Router had the reply. The object used 2 ms of
CPU in that time.

The cause left is a platform wait after the object's handler started: a
storage call that blocked, the platform's hold of the reply until the write
is confirmed, a stall of the host, or a slow delivery of the reply. Our
instruments cannot split these four. Cloudflare can, with the object id
and the time below.

Removed: our code's computation and any other service, because the command
uses 2 ms of CPU and only local storage. Removed: a wait before the handler,
because its log lines carry the event's start time, and the same clock
shows such waits in other events. Removed: the request's trip to the
object (37 ms), another event of the same object, and a reset of the
object.

## The fault

The wallet is group 20, registration 2, of the first 0.10.2 run in the
[release record](refactor-155h-release-0102-staging.md). The browser's
`respond` request took 13,650 ms; the medians of the two runs are 1,298 and
1,173 ms. All other stages were normal, and the wallet's signature
verifies.

## Facts

Times are milliseconds from the Gateway's `respond` event, which started at
2026-10-14T12:33:29.628Z.

| # | Fact | Instrument | Where and when | Checked |
| --- | --- | --- | --- | --- |
| 1 | Gateway `respond`: wall 13,302, CPU 22; span `gateway.yao_execute` 13,224 | Gateway tail | APAC Gateway `793d1777`, entered in Seattle, +0 | Event found by its timestamp and trace id `0f2c72fa…` |
| 2 | Router execute: wall 13,167, CPU 39. Its Yao spans end at +1,055 with `router.yao_execute` 896: prepare pair 538, Deriver A execute 819, Signing Worker delivery 49 | Router tail, coordinator spans | Router Worker, +119 | Same trace id in every span |
| 3 | The Router's one `finish_registration` call to its wallet object: `response_headers_ms` 12,230, logged at +13,285. No retry | `router_wallet_transport_timing` | Router Worker | The Router makes one call on this path |
| 4 | That object's event: start +1,092 (37 ms after the call), wall 12,182, CPU 2, status 200, no exception, `instance_command` 3. Both of its log lines carry +0 from the event start | Router tail, object event | Object `061da614…`, version `c5b8b4d9`, host `998f3` in SIN | Matched to fact 3 by object address and time |
| 5 | The same object's other events: wallet start −654 (wall 16), claim +148 (wall 17), finalization consumption +13,702 (wall 19, `instance_command` 4, 12,610 ms after the slow command's start) | Router tail | Same object | The instance continued through the wait |
| 6 | Router-to-object calls today: 1 of 593 in the two 0.10.2 runs and 0 of 1,186 in the four afternoon arms took more than 1 s. The other 197 finish calls tonight took 438 ms at most | `router_wallet_transport_timing` | Both runs, and the A/B/A/B arms on Router upload `378fda78` with the same Rust code | Counted from the raw tails by script |
| 7 | `handler_ms` is 0 or 1 in all 774 logged object commands, also in those of 300 to 400 ms. The first log line's offset from the event start is above 0 in 198 events, up to 240 ms | `wallet_do_command_timing`, log timestamps | Both runs | The clock does not move during storage calls, but it does show a wait before the handler, as in the events at 1791980897087 (+240) and 1791981157164 (+70) |
| 8 | The command runs six local storage calls in one transaction: ownership generation, fence, owner and registration reads, the fence again, then one write of the completed record. It makes no other request, has no alarm and no `blockConcurrencyWhile` on this path | Source: `router_wallet.rs`, `router_wallet_relocation.rs`, `durable_object/router_wallet.rs` | Release 0.10.2; the object class is SQLite-backed (`wrangler.router.toml`) | Read after facts 1 to 7 |
| 9 | In 95 of 187 matched finish calls, the object's event ended after the Router already had the reply headers (median −1 ms) | Router and object tails | Both runs | The event's end follows the reply's arrival, so its wall can hold a slow delivery |
| 10 | Write-confirmation pauses in an earlier probe in Singapore: 239 ms at the median, 3,209 ms at the largest | [Write-stall record](refactor-155h-write-stalls.md#the-cycle) | October 13 probe | Different load and objects; the largest value is not a bound |
| 11 | No other object in our tails ran on host `998f3`. The wallet's own Deriver and Signing Worker events ended before +1,092. During the wait only four Deriver alarms ran, on other SIN hosts, in 14 to 195 ms | `wallet_do_host` logs of 788 objects, all tails | Both runs | No same-host or same-time control exists |
| 12 | Four instruments agree on the wait: browser 13,652, Gateway 13,302, Router 12,230, object 12,182 | Browser, three tails | Three Workers and the client | Different clocks and machines |

## Causes against the facts

| Cause | Fact 4 (2 ms CPU; logs at +0) | Fact 7 (clock shows waits before the handler) | Fact 5 (no other event; instance continued) | Fact 8 (local storage only) | Fact 9 (event end follows the reply) | Fact 12 (four instruments agree) | Left |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Our code computes | Contradicts | Says nothing | Says nothing | Says nothing | Says nothing | Says nothing | No |
| Our code waits for another service | Says nothing | Says nothing | Says nothing | Contradicts | Says nothing | Says nothing | No |
| Delay on the request's trip to the object | Contradicts: the event started 37 ms after the call | Says nothing | Says nothing | Says nothing | Says nothing | Says nothing | No |
| Platform wait before the handler ran | Contradicts: logs at +0 | Contradicts: the clock shows such waits elsewhere | Says nothing | Says nothing | Says nothing | Says nothing | No |
| Another event of the same object blocks this one | Says nothing | Says nothing | Contradicts | Says nothing | Says nothing | Says nothing | No |
| A reset or move of the object | Says nothing | Says nothing | Contradicts | Says nothing | Says nothing | Says nothing | No |
| The measurement itself | Says nothing | Says nothing | Says nothing | Says nothing | Says nothing | Contradicts | No |
| A storage call that blocked the thread | Fits: the clock does not move in storage calls | Says nothing | Fits | Fits | Says nothing | Fits | Yes |
| The hold of the reply until the write is confirmed | Fits | Says nothing | Fits | Fits: one write | Says nothing | Fits | Yes |
| A stall of the whole host after +0 | Fits | Says nothing | Fits | Says nothing | Says nothing | Fits | Yes |
| A slow delivery of the reply to the Router | Fits | Says nothing | Fits | Says nothing | Fits | Fits | Yes |

The four causes that are left are one coarse cause: a platform wait after
the object's handler started. The hold of the reply is the same mechanism
as the write-confirmation pauses in fact 10, at four times the largest
size seen there; fact 10 does not remove it, because the probe's largest
value is not a bound.

## What is known, inferred and unknown

- **Measured:** facts 1 to 12.
- **Inferred:** the wait is in the platform, because every cause in our
  code, before the handler, or on the request's path is contradicted.
- **Unknown:** which of the four platform causes. A same-host control would
  separate a host stall from an object-only wait; none exists in this
  sample. Cloudflare can read the storage, output-gate and delivery events
  of object `061da614053f60918f7f382079a569d4c531ed556468ccf6b22154103b5ae7eb`
  of Worker `router-ab-mpc-router-staging`, colo SIN, from
  2026-10-14T12:33:30.720Z for 12.2 s.
- **Rate:** 1 of 1,779 Router-to-object calls on October 14. The R155J
  acceptance population measures how often a wait of this size occurs.

## Review

An independent reviewer received this record and the raw tails and tried
to contradict it. Each objection was verified from the data before the
record changed:

- The first version kept "a platform wait before the handler" as a cause.
  The log offsets of other events contradict it (fact 7).
- The first version removed a slow delivery of the reply, assuming the
  object's event ends when the reply leaves. Fact 9 contradicts that
  assumption, so the cause stays.
- The first version counted 1 of 775 object events, including wake-ups
  without storage work. Fact 6 now counts Router calls.
- The first version listed three storage calls and called the wallet's
  other events a control. Facts 8 and 11 correct both.

## What this does not justify

R155J forbids a longer timeout, a race between objects, or unconfirmed
writes for required claims. A completion record must stay durable before
the Router answers, so no change follows from this case alone.
