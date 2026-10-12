# Periodic pauses of durable write confirmation — October 12 and 13, 2026

The [record of October 12](refactor-155h-write-hold-by-colo.md) found that
2–7% of durable object writes wait far longer than the normal hold, on a
cycle of about five seconds. It did not find what owns the cycle. This record
does, for object storage and for D1, and it gives the cost for a caller.

## Result

- **The pause belongs to the machine that hosts the object.** Each host stops
  the confirmation of durable writes on a cycle of 5,000 ms, and for a
  shorter time on a second cycle of 30 s. Two objects on one host pause at
  the same instant. Two hosts pause at different instants. The host is the
  `fl` value that the platform's trace page reports to the object.
- **The pause does not depend on the object.** Not on its age, its first
  write, its write rate, its row size, its database size or the storage API.
  One write after more than five idle seconds stalls when it arrives in the
  pause.
- **Everything behind the object's output gate waits.** Every write that
  arrives in the pause is confirmed at its end. The response of every
  request and every outgoing request wait with it, also for a request that
  wrote nothing.
- **A pause lasts 110–400 ms at the median, by city and hour.** Between 3%
  and 9% of writes meet it. Singapore's pauses were among the longest in
  every run.
- **D1 pauses the same way.**
- **`allowUnconfirmed` is the only storage option that takes an outgoing
  request out of the wait.** It exists for the KV-style `put` and `delete`,
  not for SQL.
- **What the host does during the pause is not known.** No public source
  describes it, and the open-source runtime has no such timer.

Two statements of the earlier record are wrong, and this record replaces
them. The cycle is not counted from an object's first write: an object stays
on one host, so its stalls repeat every five seconds at a phase that the host
sets. Staging did not show "the same share": 50 of the 60 slow Router
commands were claims that waited behind the start of a new object, not
stalled writes.

## Method

A probe Worker with one SQLite-backed Durable Object class, deployed under
the approved benchmark Worker names `ed25519-yao-ab-benchmark-a` and `-b`.
Each run deployed, measured and deleted its Worker, and the API confirmed
every deletion. No staging or production resource was touched. The client was
in Tokyo.

- **A stream.** The object writes on a timer, one write per 25 ms, and does
  not wait for the write before. For each write it records the time until
  `ctx.storage.sync()` resolved. For every sixth write it also records the
  time until an outgoing fetch returned. A stall therefore shows as a window
  in time, not as one slow sample.
- **The clock.** All times are the object's own `Date.now()`, so the windows
  of two objects compare in absolute time.
- **The host.** The object fetches `https://cloudflare.com/cdn-cgi/trace`
  and keeps the `colo` and `fl` values. This record takes `fl` as the name
  of the object's host. That is an inference; the result below supports it.
- **A stalled write** is one whose wait is more than 20 ms above the median
  of its stream. **A stall window** is a run of stalled writes. **A pause**
  is a stall window on the 5,000 ms cycle of its stream.
- **Placement.** A placement region moved the Worker, and new objects landed
  near it. Each result is keyed by the colo that the object reported.

| Run | Time, JST | Where | What |
| --- | --- | --- | --- |
| First | October 12, 23:40–23:58 | SIN, HKG, NRT, KIX, LHR, AMS, IAD, EWR, ATL, ORD, MIA, SYD, MEL, BNE | Per city: 46 streams on 36 objects, 240 new objects with three single writes, one caller loop |
| Second | October 13, 00:08–00:12 | HKG, SIN | 300 new objects used like wallet objects, three streams of three minutes, the tail of the probe Worker |
| D1 | October 13, 00:13–00:20 | KIX | One throwaway database, six streams from a Worker in the same colo |
| Hourly | October 13, from 00:21 | The six cities | Twelve streams and 240 wallet-shaped objects per city and round |

## The cycle

Plain SQL streams, one `INSERT` per 25 ms, first and second run:

| City | Hosts | Streams | Writes | Hold, median | Stalled writes | Cycle ticks with a pause | Pause p50 | p90 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SIN | 25 | 44 | 51,760 | 2 | 6.2% | 250 of 253 | 239 | 482 | 3,209 |
| HKG | 24 | 44 | 51,760 | 37 | 3.3% | 232 of 255 | 144 | 272 | 501 |
| NRT, KIX | 22 | 32 | 30,160 | 10 | 2.6% | 134 of 148 | 113 | 235 | 463 |
| LHR, AMS | 22 | 32 | 30,160 | 8 | 3.4% | 127 of 140 | 123 | 426 | 1,286 |
| IAD, EWR, ATL, ORD, MIA | 21 | 32 | 30,160 | 16 | 5.7% | 137 of 146 | 201 | 552 | 1,266 |
| SYD, MEL, BNE | 21 | 32 | 30,160 | 13 | 2.8% | 138 of 150 | 128 | 291 | 623 |

All values are milliseconds.

- **The period is 5,000 ms.** The gap between two neighbouring pauses of one
  stream was 4,950–5,050 ms in every city, at a resolution of 25 ms. Over
  three minutes the fitted period of six objects was 5,000.0–5,000.7 ms.
- **Almost every cycle has a pause.** In all runs up to the first hourly
  round, 1,640 of 1,800 cycle ticks had a stall window, in 232 of 234
  streams of 24 s or more, on 209 hosts in 14 colos.
- **All writes in a pause are released together.** A write that arrives 10 ms
  after the pause starts and one that arrives 200 ms later are confirmed at
  the same moment, within about one normal hold. The wait of a write is the
  time that is left of the pause.
- **The object runs during the pause.** Its timers fired on time in all
  224,000 ticks. Only the confirmations stop.
- **A second cycle of 30 s.** Five of six three-minute streams had a second
  stall window exactly six times, at a fixed place in a cycle of 30,000 ms,
  with a median length of 43–166 ms. In the 45-second streams, 24 pairs of
  such windows were 30.0 s apart.

## What owns the cycle

Nine hosts carried two objects each. The table gives the phase of each
object's cycle in absolute time, as milliseconds in the 5,000 ms cycle.

| Colo | Host (`fl`) | First object | Second object | Difference |
| --- | --- | ---: | ---: | ---: |
| EWR | 1006f53 | 3,324 | 3,313 | 11 |
| HKG | 976f46 | 628 | 632 | 4 |
| IAD | 1026f87 | 971 | 976 | 5 |
| LHR | 990f108 | 4,414 | 4,410 | 4 |
| MEL | 47f195 | 1,233 | 1,238 | 5 |
| NRT | 1173f59 | 3,782 | 3,797 | 15 |
| SIN | 1244f62 | 4,415 | 4,410 | 5 |
| SIN | 998f30 | 2,422 | 2,429 | 7 |
| SIN | 998f90 | 3,531 | 3,576 | 45 |

The last pair includes a stream with one write per 250 ms, which sets its
resolution. The two objects on host 1026f87 also shared one long pause:
1,079 ms and 1,078 ms, with starts 3 ms apart.

- **Two objects on one host share the phase.** Nine pairs of nine. By
  chance, about one pair in fifty would be within 45 ms.
- **Hosts differ.** The phases of the 209 hosts cover the whole cycle. The
  cycle is not a wall-clock event and not an event of the colo.
- **The object's start does not set the phase.** The time from an object's
  first write to its first pause was anything from 0 to 5,000 ms.
- **The phase outlives the instance.** After `ctx.abort()` the phase moved by
  10 ms at the median, 28 ms at most, in 17 objects. After 21 idle seconds
  it moved by 5 ms, 19 ms at most, in 12 objects; the instance was new each
  time. After four minutes it moved by 14 ms, 52 ms at most, in 24 objects.
- **The pause needs no earlier write.** The probe learned the phase of 19
  objects from 13 seconds of writes. Then each object wrote nothing for at
  least one full cycle, and sent one write 15 ms after the predicted start of
  a pause. 46 of 57 such writes stalled, by 84 ms at the median and 747 ms
  at most. Of 38 control writes half a cycle away, none stalled.

## Events on many hosts at once

On October 12 at 23:40:38 JST, nine Singapore hosts had pauses of 1.0–3.2 s
within the same five seconds. Each started at its own cycle tick. Every
other pause of those nine streams was under 0.6 s. Something that the hosts
share was slow for those seconds. US east and London had single pauses of
1.0–1.3 s.

## Which operations are exposed

One stream per variant and city, six cities, 30 s each and 45 s for the
slow one:

| Variant | Cycle ticks with a pause | Pause p50 | Outgoing fetch stalled |
| --- | ---: | ---: | ---: |
| `INSERT` with a 512-byte row | 31 of 36 | 195 | |
| 2 KB row | 29 of 36 | 150 | |
| 8 KB row | 29 of 36 | 128 | |
| 32 KB row | 34 of 36 | 142 | |
| Database of 4 MB | 32 of 36 | 239 | |
| Object with an alarm set | 26 of 36 | 142 | |
| Two inserts in `transactionSync` | 35 of 36 | 146 | |
| `ctx.storage.put` | 35 of 36 | 165 | |
| `ctx.storage.kv.put` | 34 of 36 | 150 | |
| `put` with `allowUnconfirmed` | 33 of 36 | 141 | 1 of 1,800 |
| One write per 250 ms | 34 of 45 | 152 | |
| A write on every second tick, a fetch on every tick | 25 of 30 | 120 | 63 of 1,800 |

- **Every write API pauses.** The row size, the database size and an alarm
  make no clear difference.
- **`allowUnconfirmed` frees the outgoing request.** `sync()` still showed
  every pause, so the write was as late as any other. The fetch after it
  waited 1–2 ms, without the normal hold and without the stall. The one
  slow fetch waited 26 ms.
- **The gate is the object's, not the request's.** In the mixed stream a
  tick that wrote nothing sent a fetch. Inside a stall window 20 of 27 such
  fetches stalled; outside, none of 873.
- **The response waits like an outgoing fetch.** A Worker called an object
  2,700 times with a request that writes once and returns. 44 responses
  stalled. A second request that writes nothing, sent 8 ms later, stalled
  with it in 43 of the 44.
- **A serial writer meets one stall per pause.** A stream that waits for each
  write before the next stalled in 1.2% of 4,500 writes, by 98 ms at the
  median.
- **A new object is exposed from its first write.** Of 4,040 single writes
  to objects one to eight seconds old, 247 stalled, 6.1%. Under one second
  it was 10 of 280: the first request of an object already waits for a pause
  that is in progress.
- **The first write of a new object** took 4 ms in Singapore and 43 ms in Hong
  Kong at the median. It was more than 100 ms above its colo's median in 12
  of 1,440 objects.

## D1

One throwaway database, created with the `apac` hint; its primary was in
Osaka. A Worker placed in Osaka sent one `INSERT` per 50 ms. The database was
deleted after the run.

| Stream | Writes | Round trip p50 | p99 | Max | Stalled | Phase |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| One write per 50 ms | 900 | 18 | 112 | 241 | 4.2% | 3,273 |
| Serial, one per 100 ms | 450 | 19 | 76 | 185 | 3.1% | 3,328 |
| Writes and reads in turn | 450 | 18 | 122 | 394 | 4.7% | 3,268 |
| One write per 250 ms | 180 | 17 | 140 | 190 | 7.2% | 3,330 |
| One write per 50 ms, five minutes later | 900 | 21 | 78 | 269 | 2.6% | 3,260 |

- **D1 has the same cycle.** The first stream had a stall window at all nine
  cycle ticks, 5,000 ms apart, 69–247 ms long. The phase held for six and a
  half minutes.
- **The time is not SQL.** D1 reported 0.15 ms for each statement.
- **A read waits behind a write.** Of 18 reads sent while a write was in a
  stall window, 13 stalled. A stream of reads alone had no window on the
  cycle.

## Stability by hour

The hourly repeats run until about 12:40 JST on October 13. Each row is
twelve streams of 45 s on new objects, and 240 new objects that take a start
request and three single writes.

| Round | Time, JST | City | Hold | Writes stalled over 20 ms | Over 100 ms | Mean stall per write | Pause p50 | p90 | Max | Wallet-shaped writes stalled |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 00:21 | SIN | 2 | 8.8% | 5.6% | 20.2 | 324 | 576 | 2,310 | 44 of 480 |
| 1 | 00:23 | HKG | 36 | 5.7% | 2.0% | 8.1 | 215 | 364 | 606 | 19 of 480 |
| 1 | 00:24 | NRT, KIX | 9 | 2.8% | 1.2% | 4.0 | 131 | 267 | 779 | 20 of 480 |
| 1 | 00:27 | US east | 17 | 5.4% | 3.1% | 9.5 | 211 | 498 | 725 | 36 of 480 |
| 1 | 00:29 | LHR, AMS | 9 | 3.9% | 2.2% | 6.6 | 144 | 441 | 737 | 16 of 480 |
| 1 | 00:31 | SYD, MEL, BNE | 13 | 7.6% | 5.6% | 17.4 | 399 | 691 | 963 | 45 of 480 |

The pauses change within the hour. Sydney's median pause was 128 ms at 23:55
and 399 ms at 00:31. Hong Kong's was 144 ms and then 215 ms.

## Staging

The tails of 74 hosted runs of October 5 to 12, with staging in Hong Kong.
A clean single-write command is a Router wallet command that finishes or
consumes a registration, or a Signing Worker wallet command whose handler
awaited nothing. Its wall time less its CPU time is one hold. Left out: the
first event of an object in a tail, which can be a cold start, and the first
two commands of a Signing Worker instance, which are slow more often, like
the Router's claim below.

| Command | Commands | p50 | p90 | p99 | Max | Over 20 ms above the median | Over 50 | Over 100 | Mean stall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Router finish and consume | 1,025 | 43 | 48 | 74 | 168 | 1.8% | 0.2% | 0.10% | 1.9 |
| Signing Worker wallet command | 2,221 | 39 | 43 | 79 | 209 | 1.8% | 0.9% | 0.23% | 2.3 |
| Both | 3,246 | 40 | 45 | 77 | 209 | 1.8% | 0.6% | 0.15% | 2.5 |

- **Staging stalled less than the probe.** The probe's Hong Kong objects
  stalled over 50 ms in 2.0% of writes on the first night and in 3.7% in the
  first hourly round; staging in 0.6%. The days differ: staging had 0.0–2.0%
  over 20 ms on October 7 to 11 and 5.0% on October 12, 11 of 218.
- **The tail of a probe object agrees with its caller.** Four slow calls of
  the second run had a tail event. In three, the tail's wall time was 69,
  143 and 1,432 ms against 77, 150 and 1,435 ms at the caller. The fourth
  was slow only at the caller, 103 ms against 3 ms. The tail delivered about
  one event in three.
- **The claim is not a stalled write.** Of 517 claims, 50 waited more than
  50 ms over the median. The tail holds the object's start for 43 of them,
  and all 43 arrived within 0.8 s of it. None of the 115 claims that arrived
  later was slow. In 40 of the 50, the object's clock had not moved since
  the start command began. They waited for the new object to start. The
  earlier record counted them as stalls.
- **One object waited about 2 s in 13 commands in a row** on October 8 at
  12:43 JST. It is left out of the table. Its cause is not known.

The Gateway routes show how small the stalls were on staging that week. The
excess of a route over the median of its own run was 299–617 ms at the 90th
percentile for the three registration routes and 440 ms for the two signing
routes. The stalls gave 2.5 ms per durable write at the mean.

## The cost for a caller

A stream samples every 25 ms what a write at that moment waits. Its samples
are the distribution for a write at a random time. The table draws chains of
independent writes from the samples of the first and second run. The model
is an estimate: a registration's writes are on four objects and several
databases, and the count of 13 comes from reading the code.

| City | Hold | Write stalled over 20 ms | Over 100 | Over 500 | Mean stall | 13 writes: stall sum over 100 | Over 200 | Mean | p90 | p99 | 3 writes: over 100 | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SIN | 2 | 6.2% | 3.9% | 0.68% | 17.6 | 42% | 29% | 224 | 536 | 2,589 | 12% | 54 |
| HKG | 37 | 3.3% | 0.8% | 0.00% | 3.1 | 13% | 3% | 40 | 117 | 275 | 2% | 9 |
| NRT, KIX | 10 | 2.6% | 0.9% | 0.00% | 3.1 | 13% | 5% | 40 | 129 | 339 | 3% | 9 |
| LHR, AMS | 8 | 3.4% | 1.8% | 0.19% | 6.3 | 22% | 13% | 83 | 253 | 977 | 5% | 18 |
| US east | 16 | 5.7% | 3.7% | 0.61% | 13.7 | 41% | 30% | 180 | 549 | 1,180 | 11% | 42 |
| SYD, MEL, BNE | 13 | 2.8% | 1.1% | 0.02% | 3.1 | 14% | 5% | 40 | 135 | 361 | 3% | 9 |

- **Singapore against Hong Kong, for 13 writes in series.** The holds add
  26 ms in Singapore and 481 ms in Hong Kong. With the stalls, the median
  chain waits about 80 ms against 490 ms, the mean 250 ms against 520 ms, the
  90th percentile about 560 ms against 600 ms, and the 99th about 2.6 s
  against 0.8 s. Singapore is faster for most registrations and slower for
  the slowest one in a hundred. Its numbers include the event of 23:40.
- **On staging's week in Hong Kong** the same chain adds 32 ms at the mean,
  and one registration in 12 has a stall over 50 ms.

## What it establishes

- **Measured.** The period, the share of cycles with a pause, the length of
  the pauses, the shared phase of objects on one `fl` value, the life of the
  phase over restarts and minutes, the stall of a lone write in a predicted
  pause, the second cycle of 30 s, the exposure of each write API, the
  effect of `allowUnconfirmed`, the wait of responses and of requests that
  wrote nothing, and the same cycle in one D1 database.
- **Inferred.** That `fl` names the machine that runs the object. That the
  pause is in the confirmation path on that machine, because the object's
  code runs and every object there waits. That the cost of a registration is
  a sum of independent draws.
- **A similarity, not a finding.** Five and thirty seconds are the default
  intervals at which a Linux kernel wakes its page writeback and expires
  dirty pages, and five seconds is the default commit interval of an ext4
  journal. A synchronous write that meets such a flush waits for it. The
  measurements fit that. Nothing here proves it.
- **Unknown.** What the host does every five and every thirty seconds.
  Whether the pause is on the object's host or on the followers that confirm
  its log. Why pauses are longer in Singapore, and why they grow within an
  hour. Why staging stalled less in its week than the probe did in its nights.
  Whether Cloudflare intends the behaviour.

## Limits

- The runs of this record cover one hour, from 23:40 to 00:33 JST. The
  hourly repeats extend it to midday; their table holds what exists at the
  time of writing.
- The probe objects are new and small. Staging's objects stalled less in
  their week; the record cannot say whether the hour, the day or the objects
  make the difference.
- No host carried objects of both Worker names, so the probe did not test
  whether two Workers on one host share the phase.
- D1 was measured on one database in one colo.
- A window needs a wait 20 ms above the median. A pause shorter than that is
  not counted, so the share of cycles with a pause is a lower bound.
- The tail of the probe Worker delivered one event in five. Three stalled
  calls had a tail event.
- A placement region does not fix the colo. The run for Ashburn put objects
  in five colos and the run for Sydney in three.

The [JSON record](refactor-155h-write-stalls.json) holds every sample: the
waits of each stream as a histogram, each stalled write with its time, every
single write, every caller round trip and every D1 row.

## Public sources

No public source reports a periodic stall of write confirmation. Searched on
October 12: the Durable Objects and D1 documentation, both changelogs from
2024, the issues and discussions of `cloudflare/workerd`,
`cloudflare/workers-sdk` and `cloudflare/cloudflare-docs`, and Hacker News.
The community forum and the Discord archives could not be searched.

- Cloudflare's [design description](https://blog.cloudflare.com/sqlite-in-durable-objects/)
  gives five followers, a quorum of three, and a batch upload to object
  storage after up to 10 seconds or 16 MB, which a write does not wait for.
  It names no interval of five or thirty seconds.
- In `workerd` at commit `fe4ed9ae`, `ActorSqlite` commits on the next turn
  of the event loop and holds the output gate on a `commitCallback` that the
  host supplies (`src/workerd/io/actor-sqlite.c++`). The commit path has no
  timer. The service behind the callback is not public.
- `sync()` waits for the commits that are outstanding when it is called and
  is not held by later ones (`onNoPendingFlush`, `OutputGate::wait`). That is
  why one `sync()` per write measures that write.
- `allowUnconfirmed` reaches `put`, `delete` and `setAlarm` of a
  SQLite-backed object. `sql.exec` and `ctx.storage.kv.put` take no option,
  and one write that must be confirmed holds the gate for its whole
  transaction.

## Probe source

The measuring loop of the object. The full probe and its drivers are in the
private folder `.artifacts/r155h-write-stall-probe/` of `seams-monorepo`.

```js
// Rows: [ms since base, ms late against the timer plan, sync wait, fetch
// wait, 1 if the tick wrote]. A wait of -1 means not measured.
async stream(p) {
  const kind = p.get('kind') ?? 'sql';
  const everyMs = bounded(p.get('everyMs'), 25, 60000);
  const count = bounded(p.get('count'), 400, 4000);
  const writeEvery = Math.max(1, bounded(p.get('writeEvery'), 1, 1000));
  const syncEvery = bounded(p.get('syncEvery'), 1, 1000);
  const fetchEvery = bounded(p.get('fetchEvery'), 0, 1000);
  const serial = p.get('serial') === '1';
  const payload = bounded(p.get('payload'), 0, 65536);
  const blob = payload > 0 ? crypto.getRandomValues(new Uint8Array(payload)) : null;
  const storage = this.ctx.storage;
  const rows = [];
  const pending = [];
  const base = Date.now();
  for (let i = 0; i < count; i++) {
    const planned = base + i * everyMs;
    let now = Date.now();
    if (planned > now) {
      await sleep(planned - now);
      now = Date.now();
    }
    const wrote = i % writeEvery === 0;
    if (wrote) this.write(kind, i, blob);
    const row = [now - base, now - planned, -1, -1, wrote ? 1 : 0];
    rows.push(row);
    const waits = [];
    if (syncEvery > 0 && i % syncEvery === 0) {
      waits.push(storage.sync().then(() => {
        row[2] = Date.now() - now;
      }));
    }
    if (fetchEvery > 0 && i % fetchEvery === 0) {
      waits.push(fetch(TRACE).then((r) => r.arrayBuffer()).then(() => {
        row[3] = Date.now() - now;
      }));
    }
    if (serial) await Promise.all(waits);
    else pending.push(...waits);
  }
  await Promise.all(pending);
  return { base, everyMs, kind, serial, payload, writeEvery, syncEvery, fetchEvery, rows };
}
```
