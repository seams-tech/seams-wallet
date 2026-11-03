import { IndexedDBManager } from '@/core/indexedDB';
import {
  buildVoiceIdOperationStatement,
  type VoiceIdOperationAssertion,
  type VoiceIdOperationKind,
  type VoiceIdOperationStatement,
} from '@shared/authorization/voiceIdDeviceAssertion';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import { alphabetizeStringify } from '@shared/utils/digests';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import type { ActiveVoiceIdWalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import { readAuthMethodEnabled } from '../availability';
import type { VoiceIdOperationChallenge, VoiceIdOperationPreparation } from './boundary';
import type { VoiceIdOperationCapture } from './contracts';
import { resolveVoiceEnrollmentScope } from './enrollmentStorage';

const MAXIMUM_STATEMENT_MS = 60_000;

/** A fresh voice check for one operation. The caller owns and zeroes the factor secret. */
export type VoiceIdOperationProof = Readonly<{
  assertion: VoiceIdOperationAssertion;
  factorSecret32: Uint8Array;
}>;

export type VoiceIdOperationRequest = Readonly<{
  walletId: WalletId;
  walletAuthMethodId: WalletAuthMethodId;
  operationKind: VoiceIdOperationKind;
  /**
   * Opens the operation after the voice models load, so its validity window
   * starts just before the recording. It returns the digest a passkey would sign.
   */
  begin: (signal: AbortSignal) => Promise<
    Readonly<{ operationChallenge: DigestB64u; expiresAtMs: number }>
  >;
}>;

/** The Wallet host runs the VoiceID plugin's operation surface for this request. */
export type VoiceIdOperationConfirm = (
  request: VoiceIdOperationRequest,
) => Promise<VoiceIdOperationProof>;

export async function prepareVoiceIdOperation(
  request: VoiceIdOperationRequest,
  signal: AbortSignal,
): Promise<VoiceIdOperationPreparation> {
  if (!(await readAuthMethodEnabled(request.walletId, request.walletAuthMethodId))) {
    throw new Error('VoiceID is turned off in this browser. Enable it in Authentication methods.');
  }
  signal.throwIfAborted();
  const authMethod = await IndexedDBManager.getWalletAuthMethodV2(request.walletAuthMethodId);
  if (
    !authMethod ||
    authMethod.kind !== 'voiceid' ||
    authMethod.status !== 'active' ||
    authMethod.walletId !== request.walletId
  ) {
    throw new Error('Activate VoiceID on this device before exporting keys.');
  }
  const scope = await resolveVoiceEnrollmentScope(request.walletId, request.walletAuthMethodId);
  return { scope, challenge: issueOperationChallenge.bind(null, authMethod, request) };
}

async function issueOperationChallenge(
  authMethod: ActiveVoiceIdWalletAuthMethodRecordV2,
  request: VoiceIdOperationRequest,
  signal: AbortSignal,
): Promise<VoiceIdOperationChallenge> {
  signal.throwIfAborted();
  const operation = await request.begin(signal);
  signal.throwIfAborted();
  const issuedAtMs = Date.now();
  const statement = buildVoiceIdOperationStatement({
    walletId: authMethod.walletId,
    walletAuthMethodId: authMethod.walletAuthMethodId,
    walletAuthorityId: authMethod.walletAuthorityId,
    deviceKeyId: authMethod.deviceKeyId,
    operationKind: request.operationKind,
    operationChallenge: operation.operationChallenge,
    requestOrigin: location.origin,
    issuedAtMs,
    expiresAtMs: Math.min(operation.expiresAtMs, issuedAtMs + MAXIMUM_STATEMENT_MS),
  });
  return {
    expiresAtMs: statement.expiresAtMs,
    complete: completeOperation.bind(null, statement),
  };
}

async function completeOperation(
  statement: VoiceIdOperationStatement,
  capture: VoiceIdOperationCapture,
  signal: AbortSignal,
): Promise<VoiceIdOperationProof> {
  const captured = await capture({ statement, signal });
  if (
    signal.aborted ||
    alphabetizeStringify(captured.assertion.statement) !== alphabetizeStringify(statement)
  ) {
    captured.factorSecret32.fill(0);
    throw new Error('VoiceID signed a different operation, or the check was cancelled.');
  }
  return { assertion: captured.assertion, factorSecret32: captured.factorSecret32 };
}
