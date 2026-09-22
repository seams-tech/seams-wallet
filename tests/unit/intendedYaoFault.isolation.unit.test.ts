import { expect, test } from '@playwright/test';
import {
  isLocalIntendedYaoFaultTokenV1,
  LocalIntendedYaoFaultControllerV1,
} from '../../packages/wallet-server/src/localIntendedYaoFault';
import { requireLocalIntendedYaoFaultRouterOrigin } from '../e2e/intended-behaviours/harness';

const ROUTER_EXECUTE_URL = 'https://router-ab-mpc-router/router-ab/router/ed25519-yao/execute';

function successfulRouterFetch(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ status: 'succeeded' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

function routerExecuteRequest(traceId: string, body: string, replay: boolean): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-seams-trace-id': traceId,
  });
  if (replay) headers.set('x-seams-yao-replay', '1');
  return new Request(ROUTER_EXECUTE_URL, {
    method: 'POST',
    headers,
    body,
  });
}

async function verifyOverlappingIntendedFaultIsolation(): Promise<void> {
  const retryController = new LocalIntendedYaoFaultControllerV1(successfulRouterFetch);
  const terminalController = new LocalIntendedYaoFaultControllerV1(successfulRouterFetch);
  retryController.arm('drop_router_response_once');
  terminalController.arm('return_terminal_burned_once');

  const dropped = retryController.fetch(
    routerExecuteRequest('trace-retry', '{"request":"retry"}', false),
  );
  const terminal = await terminalController.fetch(
    routerExecuteRequest('trace-terminal', '{"request":"terminal"}', false),
  );

  await expect(dropped).rejects.toThrow('dropped the completed Router response');
  await expect(terminal.json()).resolves.toMatchObject({ status: 'burned' });

  const replay = await retryController.fetch(
    routerExecuteRequest('trace-retry', '{"request":"retry"}', true),
  );
  expect(replay.ok).toBe(true);
  expect(retryController.consumeOutcome()).toEqual({
    kind: 'proved',
    proof: 'exact_request_replayed',
  });
  expect(terminalController.consumeOutcome()).toEqual({
    kind: 'proved',
    proof: 'terminal_failure_not_retried',
  });
}

test(
  'overlapping intended faults retain independent request-scoped state',
  verifyOverlappingIntendedFaultIsolation,
);

function acceptManagedLocalRouterOrigin(): void {
  requireLocalIntendedYaoFaultRouterOrigin('http://127.0.0.1:4100');
}

function rejectStagingRouterOrigin(): void {
  requireLocalIntendedYaoFaultRouterOrigin('https://staging.seams.sh');
}

function rejectProductionRouterOrigin(): void {
  requireLocalIntendedYaoFaultRouterOrigin('https://seams.sh');
}

function verifyLocalRouterOriginGuard(): void {
  expect(acceptManagedLocalRouterOrigin).not.toThrow();
  expect(rejectStagingRouterOrigin).toThrow('requires http://127.0.0.1:4100');
  expect(rejectProductionRouterOrigin).toThrow('requires http://127.0.0.1:4100');
}

test(
  'intended Yao fault arming accepts only the managed local Router origin',
  verifyLocalRouterOriginGuard,
);

function verifyOpaqueFaultTokenBoundary(): void {
  expect(isLocalIntendedYaoFaultTokenV1('f9cecc2e-f8c2-4f58-944b-dd94b0727b95')).toBe(true);
  expect(isLocalIntendedYaoFaultTokenV1('wallet-id:alice')).toBe(false);
  expect(isLocalIntendedYaoFaultTokenV1('f9cecc2e-f8c2-1f58-744b-dd94b0727b95')).toBe(false);
}

test('intended Yao fault token accepts only opaque UUIDv4 values', verifyOpaqueFaultTokenBoundary);

async function rejectChangedReplayAndTerminalRetry(): Promise<void> {
  const replay = new LocalIntendedYaoFaultControllerV1(successfulRouterFetch);
  replay.arm('drop_router_response_once');
  await expect(replay.fetch(routerExecuteRequest('trace', 'original', false))).rejects.toThrow(
    'dropped the completed Router response',
  );
  await expect(replay.fetch(routerExecuteRequest('trace', 'changed', true))).rejects.toThrow(
    'changed the Router request body',
  );
  expect(replay.consumeOutcome()).toEqual({
    kind: 'violated',
    violation: 'router_retry_body_changed',
  });

  const terminal = new LocalIntendedYaoFaultControllerV1(successfulRouterFetch);
  terminal.arm('return_terminal_burned_once');
  await terminal.fetch(routerExecuteRequest('terminal', 'original', false));
  await expect(terminal.fetch(routerExecuteRequest('terminal', 'original', true))).rejects.toThrow(
    'additional Router execute',
  );
  expect(terminal.consumeOutcome()).toEqual({
    kind: 'violated',
    violation: 'unexpected_additional_execute',
  });
}

test(
  'fault proofs reject a changed replay or any retry after a terminal result',
  rejectChangedReplayAndTerminalRetry,
);
