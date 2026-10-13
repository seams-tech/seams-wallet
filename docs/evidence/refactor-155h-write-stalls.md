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
  describes this pattern, and the open-source runtime has no such timer.
  Cloudflare's D1 team has described a related one: storage operations of
  the objects on one machine can starve each other.
- **Of seven candidate causes the facts leave one.** A periodic task of the
  host's storage service holds the commit path of every object on the host.
  The section "Candidate causes against the facts" gives the table. It names
  the place, not the task.
- **The probe is a reproduction, and it matches staging only in part.**
  Staging's own stalled database writes carry the five-second signature in
  some runs and not in others.

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
| Hourly | October 13, 00:21–09:35 | The six cities | Seven rounds: twelve streams and 240 wallet-shaped objects per city and round |
| Hosts | October 13, 00:43–00:45 | SIN, HKG | 60 streams of 13 s under each of the two Worker names at once |
| Heavy and light | October 13, 01:29–01:31 | SIN, HKG | Five objects per city: cycles of 13 MB and cycles of 40 KB in turn, aligned to the host's pause |
| One layer down | October 13, 09:45–09:50 | SIN, HKG | Six objects per city: ticks with no write, with an unconfirmed `put` and with an `INSERT`; each tick reads the storage bookmark and sends a fetch. Three objects for the check of the outside clock |

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
- **Almost every cycle has a pause.** Over all runs, 656 of 660 streams of
  24 s or more showed the cycle, on 577 hosts in 14 colos. About nine cycle
  ticks in ten had a stall window.
- **All writes in a pause are released together.** A write that arrives 10 ms
  after the pause starts and one that arrives 200 ms later are confirmed at
  the same moment, within about one normal hold. The wait of a write is the
  time that is left of the pause.
- **The object's code runs during the pause.** 161 ticks with an
  unconfirmed `put` fell inside a measured pause. `sync()` stalled in 157 of
  them. The outgoing fetch of the same tick stalled in none. Only the
  confirmations stop. An earlier version of this record cited timers that
  fired on time; that fact is void, see "How the facts were checked".
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
- **Objects of two Workers share it too.** The hosts run put 240 objects on
  198 hosts. 22 pairs of objects of different Worker names were on one host;
  21 of them paused within 20 ms of each other. Of 24 pairs under one name,
  23 were within 25 ms. The exception is one object, 80–100 ms from its two
  neighbours; its 13 s stream had a single long window. The cycle belongs to
  the host, not to a Worker or its object class.
- **The length of a pause belongs to the host and the moment.** At one time
  in one colo the hosts differ: the median pause of twelve Singapore hosts
  at 00:21 was 74–441 ms, of ten London hosts 59–321 ms, of twelve Hong Kong
  hosts 129–305 ms. On one host it moves from cycle to cycle, 41–710 ms
  within three minutes. The probe's own volume does not move it: 142 ms at
  the median with a 32 KB row forty times a second, 152 ms with one small
  write per 250 ms. Something on the host that is not the probe sets the
  length.
- **One pause ends for all objects of a host at the same instant.** In the
  runs with two streams on one host, 201 of 209 pauses of one object had a
  stall window in the second object at the same time. The two ends were 2 ms
  apart at the median and 39 ms at the 90th percentile.
- **The start is a timer; the length is not.** Over three minutes the start
  of each pause stayed within 6–8 ms (standard deviation) of a straight
  cycle in Singapore, at ticks of 25 ms, while the lengths went from 41 to
  710 ms. The period was 5,000.0–5,000.7 ms: the timer does not wait for the
  work of the cycle before.
- **The pause writes nothing to the object's log.** The bookmark of an
  object that wrote nothing stayed the same through four pauses, in twelve
  objects. In 12,480 commits the first and third fields of the bookmark
  never changed, and the second advanced by one or two per commit, also
  across a pause.
- **The cycle is slightly longer than 5,000 ms.** Host 976f46 in Hong Kong
  was at 628–632 ms at 23:40 and at 787–798 ms at 00:44: 160 ms later after
  64 minutes, or 5,000.2 ms per cycle.
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

## What the pause is not

- **Not a flush of the data written before it.** Five objects per city
  learned their host's phase, then wrote in turn one heavy cycle, 64 KB per
  25 ms tick, 13 MB in the five seconds before the next pause, and one light
  cycle, 200 bytes per tick, with the same number of commits. The pause after
  a heavy cycle was 138 ms at the median and the pause after a light cycle
  173 ms; in 166 adjacent pairs on one host the difference was −8 ms at the
  median, 78 pairs positive and 88 negative. A flush of 13 MB on a data
  centre SSD takes about 10 ms, which this test cannot see; a pause that
  grew with the data would have shown.
- **Not a freeze of the object or of the host.** An object that never wrote
  sent 3,804 outgoing fetches at 1–3 ms from seven hosts, four of them slow
  by 34–75 ms on one Tokyo host and none on the others. Inside a measured
  pause, the fetch of a tick that made an unconfirmed `put` was never slow,
  0 of 161, while the `sync()` of the same tick was. Requests to an object
  with no pending write were answered in normal time.
- **Not the followers alone.** Hosts in one colo pause at different
  instants, and two objects on one host at the same instant. A pause at
  the followers would need three of five to stop together, in step with
  each leader host's own clock. The leader host is the simpler reading;
  that is an inference.

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

Seven rounds, 90 minutes apart, on October 13. Each cell is twelve streams of
45 s on new objects: the share of writes stalled over 20 ms, and the median
pause in milliseconds.

| Round | JST | UTC | SIN | HKG | NRT, KIX | US east | LHR, AMS | SYD, MEL, BNE |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 00:21 | 15:21 | 8.8%, 324 | 5.7%, 215 | 2.8%, 131 | 5.4%, 211 | 3.9%, 144 | 7.6%, 399 |
| 2 | 01:51 | 16:51 | 8.9%, 334 | 3.0%, 157 | 2.9%, 129 | 4.6%, 237 | 3.6%, 143 | 8.0%, 356 |
| 3 | 03:21 | 18:21 | 7.7%, 373 | 4.1%, 172 | 3.2%, 144 | 4.7%, 178 | 2.8%, 94 | 7.1%, 304 |
| 4 | 04:52 | 19:52 | 5.3%, 231 | 3.3%, 192 | 4.2%, 168 | 4.0%, 174 | 2.1%, 98 | 2.7%, 144 |
| 5 | 06:21 | 21:21 | 4.2%, 181 | 2.2%, 136 | 2.7%, 124 | 5.7%, 249 | 4.1%, 91 | 2.3%, 128 |
| 6 | 07:51 | 22:51 | 4.1%, 164 | 3.9%, 133 | 2.7%, 121 | 3.1%, 159 | 2.7%, 110 | 2.0%, 107 |
| 7 | 09:21 | 00:21 | 4.0%, 183 | 3.1%, 173 | 2.1%, 119 | 3.3%, 151 | 2.9%, 137 | 1.0%, 69 |

Mean stall per write, in milliseconds:

| Round | SIN | HKG | NRT, KIX | US east | LHR, AMS | SYD, MEL, BNE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 20.2 | 8.1 | 4.0 | 9.5 | 6.6 | 17.4 |
| 2 | 22.9 | 2.9 | 4.0 | 7.4 | 5.7 | 25.6 |
| 3 | 19.3 | 4.0 | 4.3 | 7.6 | 4.8 | 14.6 |
| 4 | 10.1 | 4.0 | 7.1 | 8.2 | 2.5 | 3.0 |
| 5 | 7.4 | 1.9 | 4.4 | 11.2 | 16.4 | 2.4 |
| 6 | 8.8 | 6.6 | 3.1 | 3.9 | 3.7 | 1.8 |
| 7 | 6.0 | 3.3 | 2.0 | 4.3 | 3.3 | 0.9 |

- **The pause is there in every round and every city.** 3,980 of 4,460
  cycle ticks had one, 89%.
- **Its length changes through the day.** Singapore's median pause was
  324–373 ms from 15:21 to 18:21 UTC and 164–231 ms from 19:52 to 00:21 UTC.
  Sydney's went from 304–399 ms to 69–144 ms over the same hours. Tokyo
  stayed at 119–168 ms.
- **Singapore and Sydney moved together.** One night cannot say whether the
  hour of the day, the day or something that the two share drives it.
- **Singapore had the highest mean stall per write in five of seven rounds.**
- Three more hosts carried objects of both Worker names in these rounds.
  Their phases differed by 2, 4 and 10 ms.

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

### Does staging show the probe's signature?

The probe reproduces a stall. A reproduction is a hypothesis until the real
system shows the same signal. The signal of the pause is a phase: on one
host, stalled writes start within a few hundred milliseconds of the same
place in a cycle of 5,000 ms. Staging's wallet objects are on many hosts and
the tails do not name the host, so their stalls cannot be folded. A role
database can: it is one object on one host. The Deriver wallet objects log
the time and length of each write batch to their role database.

- **Stalled batches.** Of 2,018 write batches in the hosted runs, 44 took
  more than 60 ms over the median of their kind, 2.2%, by 107 ms at the
  median and 548 ms at most.
- **Pairs on one database in one run.** 15 pairs. In 6 the two starts were
  within 300 ms of each other in the cycle. Chance gives 12%, and normal
  batches of the same runs gave 12%. The same test on the probe's own D1
  database gave 45 of 78, because some of its stalls are off the cycle.
- **By run.** The run of October 12 at 19:00 JST had four large stalls on
  one database, all within 412 ms of the cycle. Four other runs had pairs
  far apart in the cycle.

Staging therefore shows the five-second signature in part. Some of its
stalls are the pause, and some have another cause that this record did not
examine. Fifteen pairs are few.

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

## How the facts were checked

Each fact below a conclusion was checked for how it was gathered. Two did
not hold, and one instrument was discarded before use.

- **Void: "the timers fired on time".** The stream recorded how late each
  timer callback ran, and read 0 in every tick. The runtime sets
  `Date.now()` inside a timer callback to the scheduled time, as a
  side-channel defence (`IoContext::now` in `workerd`). The reading is 0 by
  construction and says nothing.
- **Discarded: the trace page's `ts` as an outside clock.** A check burned
  about 60 ms of CPU before every second tick and then read `ts`. It read
  0–1 ms after the scheduled time in all 36 burned ticks, while the caller
  measured 670–750 ms more for the request. `ts` follows the object's own
  clock.
- **The object's clock leaves out the object's own CPU time**, also after
  the next request completes. The same check shows it. A stream uses
  microseconds of CPU per tick, so its waits are not affected.
- **Valid: the wait of `sync()`.** Three independent clocks agree with it:
  the outgoing fetch after a write in the object, the round trip that a
  calling Worker measures, and the round trip of a D1 write from a
  stateless Worker.
- **Valid: the outgoing fetch that is not gated.** It is the control inside
  the object. If the object's code stopped, the fetch of the next tick would
  leave late and return late by the object's clock. It never did.
- **An inference: `fl` is the host.** 53 of 55 pairs of objects with one
  `fl` shared the phase, and three more pairs in the hourly rounds.

## Candidate causes against the facts

A cause is kept only if no fact contradicts it. The facts:

1. A strict timer: the start stays within one tick of a cycle of
   5,000.0–5,000.7 ms, and the period does not grow with the pause.
2. One phase per host, for every object, both Worker names and D1. Hosts in
   one colo differ.
3. Two objects on one host are released at the same instant.
4. In the same object and tick, a request that is not gated is not delayed.
5. A lone write after an idle cycle stalls in the predicted pause, and the
   pause moves no log position of an idle object.
6. The length does not follow the object's own volume: 13 MB against 40 KB.
7. The length differs by host at one time, 74–441 ms, and by cycle on one
   host, 41–710 ms.
8. A second cycle of 30,000 ms with its own phase.
9. Nine Singapore hosts had pauses of 1–3 s in the same five seconds, and
   Singapore and Sydney shortened together within three hours.
10. The length does not follow the hold: Singapore has the shortest hold and
    the longest pauses.

| Candidate cause | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Verdict |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| Our code or our Worker | no | no | | | | | | no | | | Out |
| The object's isolate or process stops | yes | yes | yes | no | yes | yes | yes | yes | | yes | Out |
| A flush of the object's own log at a host tick | yes | yes | no | yes | no | no | | | | yes | Out |
| One noisy neighbour at random times | no | yes | yes | yes | yes | yes | yes | no | no | yes | Out |
| The followers, or the network to them | yes | no | yes | yes | yes | yes | yes | yes | yes | | Out |
| A journal commit or page writeback of the host's kernel | yes | yes | yes | yes | yes | yes | yes | no | no | yes | Out unless two more causes are added |
| A periodic task of the host's storage service that holds the commit path of every object | yes | yes | yes | yes | yes | yes | yes | yes | yes | yes | Kept |

An empty cell means the fact does not bear on the cause.

- **No single fact picks out one cause.** Each fact removes one or two
  candidates, and together they leave one. The stall share and the tail
  percentiles are weak signals: every candidate meets them.
- **The followers fail fact 2.** A write needs three of five followers. A
  pause at the followers would need three to stop together, in step with the
  clock of each leader host.
- **The kernel candidate fails two facts.** The expiry of dirty pages after
  30 s is an age limit, not a timer with its own phase. Local disks of nine
  hosts do not slow in the same seconds without a shared cause. It can be
  kept only with a second timer and a shared slowdown added, and each
  addition explains one fact only.
- **The kept candidate is coarse.** It says where the pause is and that a
  timer starts it. It does not say what the task does. The facts that a
  customer can gather do not split it further: whether the task is CPU work
  over all objects of the host, or a call to a service that the hosts share.
  Fact 9 leans to the second.
- **It agrees with what Cloudflare has said.** The D1 team wrote in April
  2026 that storage operations of the objects on one machine can starve each
  other and that their threading is being changed.

## What stays unknown

What the task does, and why it needs 100–400 ms. Whether the objects of
another account on the host pause too. Why pauses are longest in Singapore
and Sydney, and what shortened them after 19:00 UTC. Which part of staging's
stalls is the pause. Whether Cloudflare intends the behaviour.

## Limits

- The runs cover ten hours of one night and morning, from 23:40 to 09:30
  JST. The hours from 01:00 to 14:00 UTC are not measured.
- The probe objects are new and small. Staging's objects stalled less in
  their week; the record cannot say whether the hour, the day or the objects
  make the difference.
- Both Worker names are on one account. The probe did not test whether the
  objects of another account on the same host pause with them.
- D1 was measured on one database in one colo.
- A window needs a wait 20 ms above the median. A pause shorter than that is
  not counted, so the share of cycles with a pause is a lower bound.
- The tail of the probe Worker delivered about one event in three. Four
  slow calls had a tail event.
- The staging tails name no host. Only the role databases could be folded
  on the cycle, with 15 pairs of stalled batches.
- A placement region does not fix the colo. The run for Ashburn put objects
  in five colos and the run for Sydney in three.

The [JSON record](refactor-155h-write-stalls.json) holds every sample of the
first two runs: the waits of each stream as a histogram, each stalled write
with its time, every single write, every caller round trip and every D1 row.
For the later runs it holds histograms, the pauses and the phases. The raw
responses of every run are in the private probe folder.

## Public sources

No public source reports this pattern: a pause of 100–400 ms on a cycle of
five seconds. Searched on October 12 and 13: the Durable Objects and D1
documentation, both changelogs from 2024, GitHub issues in all repositories,
Hacker News, the Cloudflare status history and, with a browser, the
Cloudflare community forum. The Discord archives could not be searched.

The forum holds reports of the same family for D1, which runs on SQLite
Durable Objects. They are stalls of seconds, not of a fraction of a second:

- [D1 Timeout Errors on Small Database](https://community.cloudflare.com/t/d1-timeout-errors-on-small-database/923198),
  April 2026. A member of the D1 team gave the root cause: the database was
  on a machine with a noisy neighbour, an expensive storage operation of one
  Durable Object can starve the storage operations of others on that
  machine, and the threading model of storage operations is being changed.
  The team moved the database to another machine.
- [Periodic "D1 DB is overloaded"](https://community.cloudflare.com/t/periodic-d1-db-is-overloaded-requests-queued-for-too-long/931705),
  June 2026. An idle database stalled for 20–30 s at the same minutes of
  every hour, while a second database in the same request never did. The
  poster reports that Cloudflare support confirmed contention on the host,
  with no date for a fix.
- [D1 sporadic long-tail latency](https://community.cloudflare.com/t/d1-sporadic-long-tail-latency-20s/956400)
  and [D1 reads with ~1 ms SQL take 2-4 s](https://community.cloudflare.com/t/d1-reads-with-1-ms-sql-take-2-4-s-overload-errors-at-1-utilisation/962003),
  September 2026. Wall time of seconds against SQL time near 1 ms. No reply
  from Cloudflare.
- A [status incident](https://www.cloudflarestatus.com/incidents/54h1hbfvchlf)
  of January 25 to 28, 2026: query timeouts for D1 and SQLite-backed Durable
  Objects, closed with changes to a watchdog and with performance work.

These establish that a host can stall the storage operations of every object
on it, and that Cloudflare knows it. They do not show a cycle of five
seconds.

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
