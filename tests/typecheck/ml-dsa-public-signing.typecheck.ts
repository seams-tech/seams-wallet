import type {
  MlDsaSigningRequest,
  MlDsaSigningOutcome,
} from '../../packages/shared-ts/src/near/mlDsaSigning';
import type { MlDsaSigningRecord } from '../../packages/wallet-server/src/router/cloudflare/d1/wallet/mlDsaSigningRecord';
import type { Variant } from '../../packages/shared-ts/src/utils/variant';
import type { MlDsaNearTransactionInput } from '../../packages/wallet/src/core/signingEngine/flows/signNear/mlDsaTransaction';

declare const request: MlDsaSigningRequest;
// @ts-expect-error The caller cannot select a material epoch, including through a spread.
const callerEpoch: MlDsaSigningRequest = { ...request, materialEpoch: 2 };
void callerEpoch;
declare const requestWithSeed: Omit<MlDsaSigningRequest, 'walletCustodySeed'> & {
  readonly walletCustodySeed: Uint8Array;
};
// @ts-expect-error Secret custody material cannot enter the signing request by structural assignment.
const seedRequest: MlDsaSigningRequest = requestWithSeed;
void seedRequest;
declare const approved: Variant<MlDsaSigningRecord['phase'], 'kind', 'approved'>;
// @ts-expect-error An awaiting operation cannot retain verified-approval fields through a spread.
const unapproved: MlDsaSigningRecord['phase'] = { ...approved, kind: 'awaiting_approval' };
void unapproved;
// @ts-expect-error Pool retry requires an explicit retry time.
const missingRetry: MlDsaSigningOutcome = { kind: 'retry', reason: 'unavailable' };
void missingRetry;
declare const signed: Variant<MlDsaSigningOutcome, 'kind', 'signed'>;
// @ts-expect-error A retry cannot retain a completed transaction through a spread.
const mixed: MlDsaSigningOutcome = { ...signed, kind: 'retry', reason: 'running', retryAfterMs: 1 };
void mixed;

declare const withoutCancellation: Omit<MlDsaNearTransactionInput, 'shouldAbort'>;
// @ts-expect-error Core signing requires the request-scoped cancellation callback.
const missingCancellation: MlDsaNearTransactionInput = { ...withoutCancellation };
void missingCancellation;

const optionalCancellation: MlDsaNearTransactionInput = {
  ...withoutCancellation,
  // @ts-expect-error A spread cannot replace the required callback with undefined.
  shouldAbort: undefined,
};
void optionalCancellation;
