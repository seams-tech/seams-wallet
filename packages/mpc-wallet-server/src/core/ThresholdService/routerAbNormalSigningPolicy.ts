import type { RouterAbEd25519NormalSigningState } from '@shared/utils/signingSessionSeal';
import { failure } from '@shared/utils/failure';

export type ParseOk<T> = { ok: true; value: T };
export type ParseErr = { ok: false; code: string; message: string };
export type ParseResult<T> = ParseOk<T> | ParseErr;

export type RouterAbNormalSigningServerPolicy =
  {
    mode: 'enabled';
    signingWorkerId: string;
  };

export function validateRouterAbNormalSigningServerPolicy(args: {
  requested: RouterAbEd25519NormalSigningState | undefined;
  policy: RouterAbNormalSigningServerPolicy;
}): ParseResult<null> {
  if (!args.requested) {
    return failure(
      'unauthorized',
      'sessionPolicy.routerAbNormalSigning is required for Router A/B normal signing',
    );
  }

  if (args.requested.signingWorkerId !== args.policy.signingWorkerId) {
    return failure(
      'unauthorized',
      'sessionPolicy.routerAbNormalSigning.signingWorkerId is not allowed for this threshold server',
    );
  }
  return { ok: true, value: null };
}
