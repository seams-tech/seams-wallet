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
