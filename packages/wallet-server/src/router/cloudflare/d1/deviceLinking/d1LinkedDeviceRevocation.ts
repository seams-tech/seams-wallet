import type {
  LinkedDeviceRevokeRequestV1,
  LinkedDeviceRevokeResultV1,
} from '@shared/device-linking/contracts';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import { computeWalletAuthMethodRevokeOperationFingerprintV1 } from '@shared/utils/registrationIntent';
import type {
  LinkedDeviceManagementServiceV1,
  LinkedDeviceManagementSourceV1,
} from '../../../../core/deviceLinking/linkedDeviceManagement';
import type { D1WalletAuthMethodStore } from '../../../../core/d1WalletAuthMethodStore';
import type { DeviceLinkingAuthDeniedV1 } from '../../../transport/fetch/routes/deviceLinking';
import type {
  D1LinkedDeviceFreshRevokeProofV1,
  verifyD1LinkedDeviceFreshRevokeProofV1,
} from '../wallet/d1WalletAuthMethodBoundary';
import type { D1WalletAuthorityStore } from '../wallet/d1WalletAuthorityStore';
import {
  computeWalletAuthMethodRevocationProofDigestV1,
  type D1WalletAuthMethodRevocationReplayStoreV1,
  type WalletAuthMethodRevocationReplayIdentityV1,
} from '../wallet/d1WalletAuthMethodRevocationReplayStore';

/** Verifies a fresh proof without spending it; an Email OTP spend rides in the result. */
type FreshRevokeProofVerifierV1 = (input: {
  readonly walletId: WalletId;
  readonly targetWalletAuthMethodId: WalletAuthMethodId;
  readonly proof: D1LinkedDeviceFreshRevokeProofV1;
  readonly expectedOrigin: string;
  readonly verifiedAtMs: number;
  readonly operationFingerprintDigest: DigestB64u;
}) => ReturnType<typeof verifyD1LinkedDeviceFreshRevokeProofV1>;

type D1LinkedDeviceRevocationOutcomeV1 =
  | { readonly kind: 'answered'; readonly result: LinkedDeviceRevokeResultV1 }
  | DeviceLinkingAuthDeniedV1;

/**
 * Revokes one linked device on a fresh proof from another active full-owner
 * method, as an auth-method revocation does: the proof is spent, the method
 * revoked and the answer recorded in one batch.
 *
 * The record binds the answer to the operation fingerprint and to a digest
 * of the proof, never the proof or its code. An exact retry is answered from
 * the record before its proof is examined again, so a request whose answer
 * was lost receives what committed although its code is spent. An Email OTP
 * code is verified without being spent, and spent only in that batch, so a
 * batch that does not commit leaves it usable for the same request.
 */
export function createD1LinkedDeviceRevocationV1(deps: {
  readonly management: Pick<
    LinkedDeviceManagementServiceV1,
    'revokeLinkedDeviceV1' | 'finishLinkedDeviceRevocationV1'
  >;
  readonly replays: D1WalletAuthMethodRevocationReplayStoreV1;
  readonly verifyProofForBatch: FreshRevokeProofVerifierV1;
  readonly authMethodStore: Pick<
    D1WalletAuthMethodStore,
    'readByIdV2' | 'prepareActiveV2SourceGuardStatements'
  >;
  readonly authorityStore: Pick<D1WalletAuthorityStore, 'readById'>;
  readonly nowV1: () => number;
}): (input: {
  readonly request: LinkedDeviceRevokeRequestV1;
  readonly owner: LinkedDeviceManagementSourceV1;
  readonly proof: D1LinkedDeviceFreshRevokeProofV1;
  readonly expectedOrigin: string;
}) => Promise<D1LinkedDeviceRevocationOutcomeV1> {
  return async (input) => {
    const { walletId, walletAuthMethodId, requestedAtMs } = input.request;
    const operationFingerprintDigest = await computeWalletAuthMethodRevokeOperationFingerprintV1({
      walletId,
      targetWalletAuthMethodId: walletAuthMethodId,
      requestedAtMs,
    });
    const replay: WalletAuthMethodRevocationReplayIdentityV1 = {
      walletId,
      targetWalletAuthMethodId: walletAuthMethodId,
      operationFingerprintDigestB64u: String(operationFingerprintDigest),
      sourceProofDigestB64u: await computeWalletAuthMethodRevocationProofDigestV1(input.proof),
    };
    const answeredFromRecord = async (): Promise<D1LinkedDeviceRevocationOutcomeV1 | null> => {
      const recorded = await deps.replays.readExactLinkedDeviceAnswerV1(replay);
      if (!recorded) return null;
      await deps.management.finishLinkedDeviceRevocationV1({
        walletId,
        walletAuthMethodId,
        requestedAtMs,
      });
      return { kind: 'answered', result: recorded };
    };
    const committed = await answeredFromRecord();
    if (committed) return committed;

    const verified = await deps.verifyProofForBatch({
      walletId,
      targetWalletAuthMethodId: walletAuthMethodId,
      proof: input.proof,
      expectedOrigin: input.expectedOrigin,
      verifiedAtMs: requestedAtMs,
      operationFingerprintDigest,
    });
    if (verified.kind === 'denied') {
      // Another copy can commit and spend the proof after the first lookup.
      return (await answeredFromRecord().catch(() => null)) ?? verified;
    }
    const spend = verified.emailOtpConsumeInBatch ?? [];
    if (input.proof.kind === 'email_otp' && spend.length === 0) {
      return {
        kind: 'denied',
        code: 'invalid',
        message: 'Fresh Email OTP revocation proof cannot be spent with the revocation',
      };
    }
    /* The revocation checks that the approver is a different active method on
       an active full-owner authority. These rows only build the guard that
       holds that true until the commit. */
    const sourceMethod = await deps.authMethodStore.readByIdV2({
      walletAuthMethodId: verified.walletAuthMethodId,
    });
    const sourceAuthority = sourceMethod
      ? await deps.authorityStore.readById(sourceMethod.walletAuthorityId)
      : null;
    if (
      !sourceMethod ||
      sourceMethod.walletId !== walletId ||
      sourceAuthority?.state !== 'active' ||
      sourceAuthority.walletId !== walletId
    ) {
      return {
        kind: 'denied',
        code: 'unauthorized',
        message: 'Fresh revocation proof is not from an active wallet method',
      };
    }
    const result = await deps.management.revokeLinkedDeviceV1(
      input.request,
      {
        ...input.owner,
        freshProof: {
          walletAuthMethodId: verified.walletAuthMethodId,
          verifiedAtMs: verified.verifiedAtMs,
        },
      },
      {
        prerequisites: [
          // The approving method and authority are fenced at the commit.
          ...deps.authMethodStore.prepareActiveV2SourceGuardStatements({
            walletId,
            walletAuthMethodId: sourceMethod.walletAuthMethodId,
            walletAuthorityId: sourceMethod.walletAuthorityId,
            authorityDigestB64u: sourceAuthority.authorityDigestB64u,
            authorityRevocationEpoch: sourceAuthority.revocationEpoch,
          }),
          ...spend,
        ],
        recordAnswer: ({ authorityId }) =>
          deps.replays.prepareRecordLinkedDeviceAnswerStatements({
            identity: replay,
            sourceWalletAuthMethodId: verified.walletAuthMethodId,
            authorityId,
            committedAtMs: deps.nowV1(),
          }),
      },
    );
    /* A revocation this request committed is answered as recorded, exactly as
       a retry of it will be. A refusal can follow this same request
       committing first, as a concurrent copy; the record answers for it too.
       A method another request revoked is reported revoked, with nothing
       spent, since nothing this request proved was used. */
    return (
      (await deps.replays
        .readExactLinkedDeviceAnswerV1(replay)
        .then((recorded) => (recorded ? { kind: 'answered' as const, result: recorded } : null))
        .catch(() => null)) ?? { kind: 'answered', result }
    );
  };
}
