# Cloudflare write stalls

Status on October 13, 2026: open. The stall is in Cloudflare's platform. Our
code does not cause it and cannot remove it. Nobody has reported it to
Cloudflare yet; a draft report exists.

## What it is

A durable write on Cloudflare is confirmed late when it arrives during a
short pause of its host machine. The pause comes every 5,000 ms. It lasts
70–400 ms at the median, and 3.2 s at the longest measured. A second, shorter
pause comes every 30 s.

- It applies to SQLite-backed Durable Objects and to D1.
- A Durable Object holds its response and its outgoing requests until its
  writes are confirmed. So one stalled write delays everything that the
  object sends, also for a request that wrote nothing.
- The object's code keeps running during the pause. Only the confirmation
  is late.

## How to recognise it

- **The time is not ours.** The SQL takes less than a millisecond. The CPU
  time of the request is normal. The wait is between the write and its
  confirmation.
- **It repeats on one host.** Stalled writes of the objects on one host
  start at the same place in a cycle of 5,000 ms. Objects on other hosts
  stall at other places.
- **It is small against a cold start.** A stall is tens to hundreds of
  milliseconds. A new object that starts slowly, or a database on a busy
  machine, costs seconds; those are different problems.

Each wallet object logs `wallet_do_host` once per instance, with its colo and
host. The stalled commands of a hosted run can be grouped by that host and
checked against the cycle.

## What is established

Measured on October 12 and 13 with a probe Worker that shares no code with
the wallet, on more than 570 hosts in 14 colos:

- Each host has its own timer. Its period is about 5,000.2 ms and does not
  depend on how long the last pause was.
- All objects on a host pause together, also objects of two different
  Workers, and they are released together.
- The pause does not depend on the object: not on its age, its write rate,
  its row size, its database size or the storage API.
- A single write after several idle seconds stalls when it arrives in the
  pause. A write half a cycle away does not.
- The lengths of the pauses of different hosts in one region move together
  within seconds.
- `put` with `allowUnconfirmed` takes the outgoing request out of the wait.
  SQL writes have no such option.
- Between 1% and 9% of the probe's writes met a pause.

## What is not established

- **The cause.** Each host starts a step on its timer, and the step holds
  the commit path of every object on the host. It probably waits for
  something that the hosts of a region share. What the step does is inside
  Cloudflare's replication service, which is closed source.
- **Whether Cloudflare calls it a bug.** No public page describes a pause
  every five seconds. Cloudflare's design description says that a write is
  confirmed when three of five replicas have it, and names no periodic wait.
  The D1 team has written in public that storage operations on one machine
  can starve each other, that the threading is being changed, and gave no
  date. That problem is related and may be the same one.
- **Its size in our product.** The probe's stall rates are the probe's.
  Staging's own single-write commands stalled less in the week of October 7:
  0.6% waited more than 50 ms over the median. The staging logs of that week
  name no host, so its stalls could not be matched to the cycle.
- **Whether load lengthens it.** In Singapore and Sydney the pause grew from
  about 150 ms to about 400 ms while the probe ran, in three rounds of seven.
  The probe's own load is the likely cause and is not proven.

## What we can do

We cannot avoid a pause. We can meet fewer of them, and pay less for each.

- **Fewer durable commits in series.** Each commit on the path of a request
  is one more chance to meet a pause. Put the writes of one object and one
  step in one commit.
- **Overlap commits on different objects and databases.** Their hosts pause
  at different times, so overlapped waits do not add.
- **Keep background writes off an object while it serves a request.** A
  background write that meets a pause holds every response of that object.
- **Keep timeouts above four seconds** for a step that waits for a durable
  write.

An unconfirmed write, or a write that follows the response, takes both the
pause and the normal hold out of the response. The response then leaves
before the write is durable. That is a security decision for each write, and
the user decides it. A claim must stay confirmed.

## What does not help

- **Timeout and retry.** A retry goes to the same object and waits behind
  the same pause.
- **A different storage API or a smaller database.** All of them pause.
- **Moving a write to avoid the window.** The pause is predictable, but a
  write that arrives in it waits until it ends.
- **Choosing the host.** Cloudflare places the objects. There is no setting.

## How to measure it

- **Do not use the object's own clock for lateness.** `Date.now()` inside a
  timer callback is the scheduled time, and the clock leaves out the
  object's own CPU time. Use the round trip that the caller measures, or a
  request from the object that does not wait for the write.
- **Do not measure with a loop that waits for each write.** It shows one
  slow sample per pause and hides the window. The probe writes on a timer
  and reads `ctx.storage.sync()` for each write.
- **Keep the probe light.** A heavy probe may lengthen the pause that it
  measures.
- The probe, its drivers and every raw response are in the private folder
  `.artifacts/r155h-write-stall-probe/` of `seams-monorepo`. Its README
  lists the scripts and the rules.

## Open

- [ ] Send the report to Cloudflare. The user sends it; the draft is
  `cloudflare-support-draft.md` in the private probe folder. Ask what the
  hosts do every 5 s and 30 s, whether it is the storage-thread problem that
  the D1 team described, and whether the confirmation can stop waiting.
- [ ] Deploy the `wallet_do_host` log line and group the stalled commands of
  a hosted run by host. This gives the size of the problem in the product.
- [ ] Find whether the probe's own load lengthens the pause: light streams
  alone in one region, then load from a second deployment at a known time.
- [ ] Count the durable commits that a registration and a signature wait for
  in series. The estimate of 13 comes from reading the code.

## Records

- [The pauses](evidence/refactor-155h-write-stalls.md): every measurement,
  the candidate causes against the facts, the checks of each instrument and
  the limits. Its [JSON record](evidence/refactor-155h-write-stalls.json)
  holds the samples.
- [The hold by location](evidence/refactor-155h-write-hold-by-colo.md): the
  normal confirmation time in eight locations.
- [R155H](refactor-155H.md), Phase 6 and Phase 7: what the plan does about
  it.
- Related public reports from other Cloudflare customers:
  [D1 timeouts on a small database](https://community.cloudflare.com/t/d1-timeout-errors-on-small-database/923198),
  with the D1 team's explanation, and
  [periodic D1 overload](https://community.cloudflare.com/t/periodic-d1-db-is-overloaded-requests-queued-for-too-long/931705).
