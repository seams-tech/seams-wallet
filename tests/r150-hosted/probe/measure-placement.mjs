#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

const [accountId, since, until, output] = process.argv.slice(2);
if (
  process.argv.length !== 6 ||
  !/^[a-f0-9]{32}$/u.test(accountId ?? '') ||
  !Number.isFinite(Date.parse(since)) ||
  !Number.isFinite(Date.parse(until)) ||
  Date.parse(until) <= Date.parse(since) ||
  !output
) {
  throw new Error('Usage: measure-placement.mjs <account-id> <since-iso> <until-iso> <new-evidence.json>');
}
if (existsSync(output)) throw new Error('Placement evidence already exists');

const authentication = spawnSync('pnpm', ['exec', 'wrangler', 'auth', 'token', '--json'], {
  encoding: 'utf8',
});
if (authentication.status !== 0) throw new Error('Wrangler authentication unavailable');
const credentials = JSON.parse(authentication.stdout);
if (!['oauth', 'api_token'].includes(credentials.type)) throw new Error('Expected bearer credential');

// These dimensions describe execution locations. Request.cf.colo describes ingress.
// Adaptive analytics are aggregate evidence; they cannot identify every signing RPC.
const query = `query($account:String!,$since:Time!,$until:Time!){
  viewer{accounts(filter:{accountTag:$account}){
    workersInvocationsAdaptive(limit:1000,filter:{
      datetime_geq:$since,datetime_lt:$until,scriptName_like:"r150-bench-%"
    }){sum{requests} dimensions{scriptName scriptVersion coloCode}}
    durableObjectsInvocationsAdaptiveGroups(limit:1000,filter:{
      datetime_geq:$since,datetime_lt:$until,scriptName_like:"r150-bench-%"
    }){sum{requests} dimensions{scriptName scriptVersion coloCode namespaceId}}
  }}
}`;
const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${credentials.token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ query, variables: { account: accountId, since, until } }),
  signal: AbortSignal.timeout(30_000),
});
const result = await response.json();
const evidence = {
  kind: 'hosted_benchmark_execution_placement_v1',
  since,
  until,
  observedAt: new Date().toISOString(),
  scope: 'r150-bench-*',
  accounting: 'Adaptive aggregate invocation locations; absence does not prove no invocations.',
  query,
  httpStatus: response.status,
  result,
};
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
if (!response.ok || result.errors?.length) throw new Error('Placement query failed; inspect evidence');
const account = result.data?.viewer?.accounts?.[0];
if (!account) throw new Error('Placement query returned no account');
for (const [dataset, rows] of Object.entries(account)) {
  if (!Array.isArray(rows) || rows.length >= 1000) {
    throw new Error(`Placement dataset ${dataset} is invalid or reached its row limit`);
  }
  console.log(`${dataset}: ${rows.length} execution-location groups`);
}
