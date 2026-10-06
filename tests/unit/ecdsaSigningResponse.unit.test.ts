import { expect, test } from '@playwright/test';
import type { RouterApiAuthorizedOperationService } from '../../packages/wallet-server/src/router/framework/authServicePort';
import { finishRouterAbEcdsaSigningResponse } from '../../packages/wallet-server/src/router/domains/signingOperations/ecdsaSigningResponse';
import { buildClaimedSigningOperationFixture } from './helpers/authorizedOperation.fixtures';

type CompletionInput = Parameters<
  RouterApiAuthorizedOperationService['completeAuthorizedOperation']
>[0];
type ClaimedOperation = Awaited<ReturnType<typeof buildClaimedSigningOperationFixture>>;

async function unexpectedServiceCall(): Promise<never> {
  throw new Error('Response handling must not perform admission');
}

class CompletionService implements RouterApiAuthorizedOperationService {
  readonly readPinnedOwnerWalletScope = unexpectedServiceCall;
  readonly buildVerifiedOwnerProof = unexpectedServiceCall;
  readonly recordVerifiedWalletOperationFactorEvidenceSet = unexpectedServiceCall;
  readonly readAuthorizedOperationById = unexpectedServiceCall;
  readonly readAuthorizedOperation = unexpectedServiceCall;
  readonly admitAuthorizedOperation = unexpectedServiceCall;
  readonly completions: CompletionInput[] = [];
  rejectCompletion = false;

  constructor(readonly operation: ClaimedOperation) {}

  get tenantId() {
    return this.operation.tenantId;
  }

  async completeAuthorizedOperation(input: CompletionInput) {
    if (this.rejectCompletion) throw new Error('Durable completion failed');
    this.completions.push(input);
    return this.operation;
  }
}

async function fixture() {
  const operation = await buildClaimedSigningOperationFixture();
  return {
    operation,
    authorizedOperations: new CompletionService(operation),
    timing: { proxy: null as number | null, complete: null as number | null },
    proxyStartedAt: performance.now(),
  };
}

test('final signatures and errors retain their full durable replay response', async () => {
  for (const sample of [
    { status: 200, result: 'succeeded' },
    { status: 403, result: 'failed_before_side_effect' },
    { status: 503, result: 'failed_after_side_effect' },
  ]) {
    const input = await fixture();
    const bodyText = '{"fixture":"complete response"}';
    const upstream = new Response(bodyText, {
      status: sample.status,
      headers: { 'content-type': 'application/json' },
    });
    const response = await finishRouterAbEcdsaSigningResponse({
      ...input,
      upstream,
    });
    expect(input.authorizedOperations.completions).toHaveLength(1);
    expect(input.authorizedOperations.completions[0]).toMatchObject({
      operation: input.operation,
      result: sample.result,
      response: { status: sample.status, contentType: 'application/json', bodyText },
    });
    expect(await response.text()).toBe(bodyText);
  }
  const input = await fixture();
  input.authorizedOperations.rejectCompletion = true;
  await expect(
    finishRouterAbEcdsaSigningResponse({
      ...input,
      upstream: new Response('{"fixture":"signature"}'),
    }),
  ).rejects.toThrow('Durable completion failed');
});

test('an in-progress effect remains pending without durable completion', async () => {
  const input = await fixture();
  const upstream = new Response(
    'ReplayedLocalRequest: SigningWorker ECDSA effect is already in progress',
    { status: 409 },
  );
  const response = await finishRouterAbEcdsaSigningResponse({
    ...input,
    upstream,
  });
  expect(response).toBe(upstream);
  expect(input.authorizedOperations.completions).toHaveLength(0);
});
