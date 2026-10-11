import type { AuthorizedOperation } from '../../../authorization/domain';
import type { RouterApiAuthorizedOperationService } from '../../framework/authServicePort';
import { completeRouterAbEcdsaOperation } from './routerAbEcdsaDerivationNormalSigningRoute';

export async function finishRouterAbEcdsaSigningResponse(input: {
  readonly upstream: Response;
  readonly operation: AuthorizedOperation;
  readonly authorizedOperations: RouterApiAuthorizedOperationService;
  readonly timing: { proxy: number | null; complete: number | null };
  readonly proxyStartedAt: number;
}): Promise<Response> {
  const upstream = input.upstream;
  const upstreamBodyText = await upstream
    .clone()
    .text()
    .catch(() => '');
  input.timing.proxy = performance.now() - input.proxyStartedAt;
  if (
    isRouterAbEcdsaOperationInProgressResponse({
      status: upstream.status,
      bodyText: upstreamBodyText,
    })
  ) {
    return upstream;
  }
  const completionStartedAt = performance.now();
  await completeRouterAbEcdsaOperation({
    authorizedOperations: input.authorizedOperations,
    operation: input.operation,
    result: upstream.ok
      ? 'succeeded'
      : upstream.status < 500
        ? 'failed_before_side_effect'
        : 'failed_after_side_effect',
    response: {
      status: upstream.status,
      contentType: upstream.headers.get('content-type') || 'application/json',
      bodyText: upstreamBodyText,
    },
  });
  input.timing.complete = performance.now() - completionStartedAt;
  return upstream;
}

function isRouterAbEcdsaOperationInProgressResponse(input: {
  readonly status: number;
  readonly bodyText: string;
}): boolean {
  return (
    input.status === 409 &&
    input.bodyText.includes('ReplayedLocalRequest:') &&
    input.bodyText.includes('SigningWorker ECDSA effect is already in progress')
  );
}
