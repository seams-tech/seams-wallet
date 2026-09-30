#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length === 0) throw new Error('Usage: node tests/r150-hosted/analyze-d1.mjs <timing-artifact.json> ...');
const requests = [];
const queries = new Map();
for (const file of paths) {
  const artifact = JSON.parse(readFileSync(file, 'utf8'));
  for (const stage of ['registrationReturn', 'firstSigning', 'subsequentSigning']) {
    for (const response of artifact[stage].gatewayServerTimings) {
      const trace = response.d1;
      if (!trace || trace.version !== 1 || trace.pending !== 0 || trace.dropped !== 0) {
        throw new Error(`Missing or incomplete D1 trace: ${file} ${stage} ${response.path}`);
      }
      validateCalls(trace.calls);
      const calls = [...trace.calls].sort(bySequence);
      const intervals = [];
      const repeated = new Map();
      let wallMs = 0;
      let sqlMs = 0;
      let rowsWritten = 0;
      let rowsRead = 0;
      let unknownSql = 0;
      let unknownRows = 0;
      let writeCalls = 0;
      const regions = new Set();
      for (const call of calls) {
        if (!Number.isFinite(call.elapsedMs) || call.elapsedMs < 0 ||
            !Number.isFinite(call.startedMs) || call.startedMs < 0) {
          throw new Error('Invalid D1 interval');
        }
        intervals.push([call.startedMs, call.startedMs + call.elapsedMs]);
        wallMs += call.elapsedMs;
        let writes = false;
        for (const statement of call.statements) {
          if (statement.sqlMs === null) unknownSql += 1;
          else sqlMs += statement.sqlMs;
          if (statement.rowsRead === null || statement.rowsWritten === null) unknownRows += 1;
          else {
            rowsRead += statement.rowsRead;
            rowsWritten += statement.rowsWritten;
          }
          writes ||= statement.rowsWritten > 0;
          regions.add(statement.region ?? 'unknown');
          const id = statement.query.id;
          repeated.set(id, (repeated.get(id) ?? 0) + 1);
          const key = `${response.path}:${id}`;
          if (!queries.has(key)) queries.set(key, {
            path: response.path,
            query: statement.query,
            calls: 0,
            standaloneWallMs: [],
            sqlMs: [],
            rowsWritten: 0,
            rowsRead: 0,
            unknownRows: 0,
            unknownSql: 0,
            regions: new Set(),
            primary: new Set(),
          });
          const summary = queries.get(key);
          summary.calls += 1;
          // A batch has one network interval. Never attribute the whole interval
          // to every statement or invent per-statement network durations.
          if (call.method !== 'batch') summary.standaloneWallMs.push(call.elapsedMs);
          if (statement.sqlMs !== null) summary.sqlMs.push(statement.sqlMs);
          else summary.unknownSql += 1;
          if (statement.rowsRead === null || statement.rowsWritten === null) summary.unknownRows += 1;
          summary.rowsWritten += statement.rowsWritten ?? 0;
          summary.rowsRead += statement.rowsRead ?? 0;
          summary.regions.add(statement.region ?? 'unknown');
          summary.primary.add(statement.primary);
        }
        if (writes) writeCalls += 1;
      }
      requests.push({
        file, stage, path: response.path, status: response.status,
        stagesMs: response.stagesMs,
        calls: calls.length,
        statements: calls.reduce(statementCount, 0),
        writeCalls, rowsRead, rowsWritten,
        summedCallWallMs: round(wallMs),
        coveredD1WallMs: round(coveredTime(intervals)),
        sqlMs: unknownSql === 0 ? round(sqlMs) : null,
        unknownSql, unknownRows,
        regions: [...regions],
        repeatedQueryShapes: [...repeated].filter(isRepeated),
      });
    }
  }
}
console.log(JSON.stringify({
  kind: 'gateway_d1_call_analysis_v1',
  scope: 'request_windows_include_background_work; query_shapes_do_not_identify_bound_values',
  requests,
  queries: [...queries.values()].map(summarizeQuery).sort(byTotalWall),
}, null, 2));

function statementCount(total, call) { return total + call.statements.length; }
function isRepeated(entry) { return entry[1] > 1; }
function bySequence(a, b) { return a.sequence - b.sequence; }
function byStart(a, b) { return a[0] - b[0]; }
function byNumber(a, b) { return a - b; }
function byTotalWall(a, b) { return b.standaloneWallMs.total - a.standaloneWallMs.total; }
function round(value) { return Math.round(value * 100) / 100; }
function sum(total, value) { return total + value; }

function coveredTime(intervals) {
  let end = 0;
  let total = 0;
  for (const [start, nextEnd] of intervals.sort(byStart)) {
    total += Math.max(0, nextEnd - Math.max(start, end));
    end = Math.max(end, nextEnd);
  }
  return total;
}

function distribution(values) {
  const sorted = [...values].sort(byNumber);
  return {
    count: sorted.length,
    total: round(sorted.reduce(sum, 0)),
    p50: sorted.length ? round(sorted[Math.ceil(sorted.length * 0.5) - 1]) : null,
    p95: sorted.length ? round(sorted[Math.ceil(sorted.length * 0.95) - 1]) : null,
  };
}

function summarizeQuery(query) {
  return {
    ...query,
    standaloneWallMs: distribution(query.standaloneWallMs),
    sqlMs: distribution(query.sqlMs),
    regions: [...query.regions],
    primary: [...query.primary],
  };
}

function validateCalls(calls) {
  if (!Array.isArray(calls)) throw new Error('Missing D1 call list');
  const sequences = new Set();
  for (const call of calls) {
    if (!Number.isInteger(call.sequence) || call.sequence < 1 || sequences.has(call.sequence) ||
        !['first', 'all', 'run', 'batch', 'exec'].includes(call.method) ||
        !['ok', 'error'].includes(call.outcome) || !Array.isArray(call.statements)) {
      throw new Error('Invalid D1 call');
    }
    sequences.add(call.sequence);
    for (const statement of call.statements) {
      if (!/^[a-f0-9]{24}$/u.test(statement.query?.id) ||
          typeof statement.query.kind !== 'string' || !Array.isArray(statement.query.tables) ||
          !(statement.region === null || typeof statement.region === 'string') ||
          !(statement.primary === null || typeof statement.primary === 'boolean')) {
        throw new Error('Invalid D1 statement metadata');
      }
      for (const field of ['sqlMs', 'rowsRead', 'rowsWritten', 'changes', 'attempts']) {
        const value = statement[field];
        if (value !== null && (!Number.isFinite(value) || value < 0)) {
          throw new Error(`Invalid D1 metric: ${field}`);
        }
      }
    }
  }
}
