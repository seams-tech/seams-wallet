# The hold after a durable object write, by location — October 12, 2026

A Durable Object holds its outgoing requests and its response until its
earlier storage writes are durable. The staging tails of October 12 showed a
steady 43–63 ms before Deriver A's connection left its wallet object, and
about 45 ms of wait in every Router wallet-object command. This record
measures that hold directly, in eight locations.

## Method

A probe Worker with one SQLite-backed Durable Object class, deployed under
the approved benchmark Worker name `ed25519-yao-ab-benchmark-a` and deleted
after the runs. No staging resource was touched. The object runs one fixed
statement, then fetches `https://cloudflare.com/cdn-cgi/trace` and reports
the wait for that fetch and the colo it names. Modes: no statement, a read,
one `CREATE TABLE IF NOT EXISTS` on an existing table, five of them, and one
`INSERT`. The Worker's placement region was changed between runs, and each
run created a new object, so the object landed where the Worker ran. The
client was in Tokyo. Fifteen samples per mode in the first two runs and eight
in the others, modes alternating.

## Result

| Object colo | Samples | No statement | Five no-op `CREATE TABLE` | After one write, p50 | p90 | Hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SIN | 16 | 1 | 1 | 3 | 4 | 2 |
| LHR | 16 | 1 | 1 | 10 | 11 | 9 |
| NRT | 23 | 2 | 1 | 11 | 11 | 9 |
| SYD | 8 | 1 | 1 | 14 | 15 | 13 |
| IAD | 8 | 1 | 1 | 15 | 17 | 14 |
| SJC | 8 | 1 | 1 | 30 | 31 | 29 |
| ICN | 8 | 1 | 1 | 33 | 34 | 32 |
| HKG | 23 | 2 | 2 | 36 | 37 | 34 |

All values are milliseconds of wait for the outgoing fetch. The object's
response to its caller waits the same time: the round trip to an object that
wrote and fetched nothing rose by the same amount in every location.

## What it establishes

- **One durable write costs 34 ms in Hong Kong, 9 ms in Tokyo and 2 ms in
  Singapore.** The hold is a property of the location, steady between the
  median and the 90th percentile.
- **A `CREATE TABLE IF NOT EXISTS` on an existing table holds nothing.** The
  five schema statements at the top of each wallet-object request are free.
  This rejects the hypothesis that they delay an object's first database
  read.
- **Staging's APAC home pays the highest hold measured.** Its Gateway, its
  role databases and its wallet objects are in Hong Kong. An estimate from
  the code and the chain, not a measurement of each write: a registration
  after setup waits for about 13 durable writes in series. They are the
  Gateway's respond batch, the Router's claim, Deriver A's admission, its
  reservation, the claim, the completion, the Signing Worker's delivery, the
  Router's finish, the Gateway's lifecycle record, and four to five batches
  of finalization. At 35–50 ms each that is 450–650 ms. At Tokyo's hold, and
  if D1 follows it, the same chain would wait about 130–200 ms.

## Is the Hong Kong hold stable?

Yes. The staging tails kept since October 7 hold 1,662 Router
wallet-object commands in 52 hosted runs, at all hours of six days. Each
command writes once, and its wall time less its CPU time is the hold plus a
few milliseconds. The median of every run is between 39 and 44 ms. The APAC
Gateway was placed in Hong Kong for the whole period, and the placement
record of October 8 found the wallet objects there.

A second probe created new objects in each city and measured each one:

| Object colo | Objects | Hold per object, range | Median |
| --- | ---: | ---: | ---: |
| SIN | 16 | 2–5 | 3 |
| HKG | 16 | 33–40 | 37 |
| NRT and KIX | 8 | 8–25 | 10 |

The hold belongs to the location, not to one object.

## Stalls

A third probe wrote to three new objects per city for about 50 seconds each,
56 writes per object.

| Object colo | Writes | p50 | p90 | p99 | Max | Slow writes | Their size | Mean |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SIN | 168 | 4 | 5 | 527 | 633 | 10 | 26–633 | 19 |
| HKG | 168 | 38 | 44 | 126 | 320 | 7 | 62–320 | 43 |
| NRT and KIX | 168 | 11 | 14 | 119 | 179 | 7 | 52–179 | 16 |

A slow write is one more than 20 ms above the city's median. Every city has
them, about one write in twenty, and most of them fall near multiples of
five seconds of the object's age. Singapore's were the largest that evening: five of 168
writes waited 218–633 ms. Singapore still has the lowest median, and its mean
is close to Tokyo's and less than half of Hong Kong's. The cause of the
five-second cycle was not investigated. The Cloudflare API returned gateway
timeouts to two deployments during these runs, so the size of the stalls
needs a repeat on another day.

Older staging data gives a second view of Singapore. Until the move of
October 10, Deriver B's role database had a Singapore primary and Deriver A's
an Osaka primary; both were called from wallet objects in Hong Kong. The
write batch of each admission, in milliseconds:

| Role | Primary | Period | Writes | p50 | p90 | p99 | Max | More than 100 ms over the median |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Deriver A | HKG | October 11 to 12 | 245 | 59 | 76 | 247 | 388 | 10 |
| Deriver A | KIX | October 8 to 10 | 240 | 84 | 99 | 142 | 180 | 0 |
| Deriver B | HKG | October 11 to 12 | 244 | 62 | 72 | 94 | 151 | 0 |
| Deriver B | SIN | October 8 to 10 | 240 | 62 | 107 | 222 | 315 | 4 |

Deriver B's median did not change with the move: the distance to Singapore
went away and the Hong Kong hold replaced it. A database write therefore
follows the object hold of its primary's location. With the Singapore primary,
four of 240 writes stalled, 222–315 ms.

## The ceremony in three cities

The benchmark pair, yield variant with the SIMD build, 31 ceremonies per run,
with the Worker placement changed between runs.

| Run | Client wall p50 | A samples | A CPU p10 | A CPU p50 | A over 400 ms | B samples | B CPU p10 | B CPU p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Singapore 1 | 946 | 0 |  |  |  | 31 | 153 | 275 |
| Singapore 2 | 960 | 31 | 184 | 572 | 20 | 31 | 195 | 340 |
| Hong Kong 1 | 407 | 31 | 168 | 267 | 10 | 30 | 151 | 175 |
| Hong Kong 2 | 684 | 31 | 184 | 274 | 7 | 31 | 158 | 175 |
| Tokyo 1 | 545 | 9 | 161 | 662 | 7 | 6 | 234 | 265 |
| Tokyo 2 | 427 | 16 | 238 | 277 | 1 | 16 | 244 | 260 |

Inconclusive for machine speed. The fastest ceremonies cost about the same
CPU in all three cities. The medians differ because of first runs in new
isolates: 20 of 31 ceremonies in the Singapore run with a complete tail, 7
and 10 of 31 in Hong Kong. One run per city pair is too little to call that a
property of Singapore. The first Singapore run lost Deriver A's tail, and the
Tokyo tails delivered 9 and 16 of 31 invocations.

## What triggers a stall

A fourth probe wrote to new objects with three spacings at once, for about 50
seconds: three objects every 0.3 s, eight every 3.3 s and eight every 7 s.

| Object colo | Spacing | Writes | Median | Slow writes | Share | Median stall | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SIN | 0.3 s | 450 | 3 | 21 | 4.7% | 213 | 772 |
| SIN | 3.3 s | 112 | 4 | 8 | 7.1% | 189 | 651 |
| SIN | 7 s | 56 | 3 | 4 | 7.1% | 132 | 271 |
| HKG | 0.3 s | 450 | 39 | 15 | 3.3% | 114 | 195 |
| HKG | 3.3 s | 112 | 40 | 2 | 1.8% | 108 | 108 |
| HKG | 7 s | 49 | 38 | 2 | 4.1% | 102 | 102 |

- **The share does not depend on how often an object is written.** A write
  that follows seven idle seconds stalls as often as one in a dense stream.
  The probe's dense writing did not cause the stalls.
- **Each object stalls on a cycle of about five seconds.** In the dense
  streams, 15 of 21 slow writes in Singapore fell between 2.0 and 2.5 s of
  the cycle that starts with the object's first write, and Hong Kong's
  cluster at 1.2 and 2.9 s. A write that lands in a short window of the cycle
  waits; the others do not.
- **Staging shows the same share.** Of the 1,716 Router wallet-object
  commands of October 7 to 12, 60 waited more than 50 ms over the median,
  3.5%, with a median wait of 278 ms among them.
- **The cause inside the platform is not established.** Cloudflare's
  [description](https://blog.cloudflare.com/sqlite-in-durable-objects/) names
  one periodic task per object, the upload of batched changes to object
  storage "over a period of up to 10 seconds", and says a write does not wait
  for it. The measured cycle is five seconds and a write does wait, so either
  the upload or another periodic task delays the confirmation. No experiment
  here separates them.

With about 13 durable writes in series and a share of 3.5–7%, between one
third and three fifths of all registrations meet at least one stall. A stall is
a cost of each durable write. Only fewer writes in series reduce it.

## Limits

- The probe measures object storage. D1 uses the same storage layer, and
  staging's D1 write batches take 45–60 ms in Hong Kong, but no D1 database
  was measured in another location.
- Eight samples per mode in eight of the ten runs. The spread within a run
  was 1–3 ms.
- A placement region does not fix the colo. The run with
  `aws:ap-northeast-1` created its object in Hong Kong, because the Worker
  still ran at its earlier placement, and `aws:eu-central-1` gave London.
  The table is keyed by the colo that the object reported.
- The first unexplained wait of the tails remains: a database read from a
  wallet object costs 53–65 ms against 12–20 ms from the stateless Worker.

The [JSON record](refactor-155h-write-hold-by-colo.json) holds every sample.

## Probe source

```js
import { DurableObject } from 'cloudflare:workers';

// Measures how long an outgoing request, and the object's own response, wait
// after different kinds of SQL statements. Fixed statements, no user data.
export class GateProbe extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') ?? 'none';
    const outgoing = url.searchParams.get('outgoing') !== '0';
    const sql = this.ctx.storage.sql;
    if (mode === 'setup') {
      sql.exec('CREATE TABLE IF NOT EXISTS t (x INTEGER)');
      return Response.json({ mode });
    }
    if (mode === 'noop_ddl') sql.exec('CREATE TABLE IF NOT EXISTS t (x INTEGER)');
    if (mode === 'noop_ddl5') for (let i = 0; i < 5; i++) sql.exec('CREATE TABLE IF NOT EXISTS t (x INTEGER)');
    if (mode === 'write') sql.exec('INSERT INTO t (x) VALUES (1)');
    if (mode === 'read') sql.exec('SELECT count(*) AS n FROM t').toArray();
    let waitedMs = null;
    let colo = null;
    if (outgoing) {
      const started = Date.now();
      const response = await fetch('https://cloudflare.com/cdn-cgi/trace');
      const text = await response.text();
      waitedMs = Date.now() - started;
      colo = /colo=(\w+)/.exec(text)?.[1] ?? null;
    }
    return Response.json({ mode, outgoing, waitedMs, objectColo: colo });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/probe') return new Response('not found', { status: 404 });
    const hint = url.searchParams.get('hint');
    const id = env.GATE_PROBE.idFromName(url.searchParams.get('name') ?? 'probe');
    const stub = env.GATE_PROBE.get(id, hint ? { locationHint: hint } : undefined);
    const started = Date.now();
    const response = await stub.fetch(request);
    const body = await response.json();
    return Response.json({ ...body, roundTripMs: Date.now() - started, workerColo: request.cf?.colo ?? null });
  }
};
```
