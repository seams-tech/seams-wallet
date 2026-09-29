/** The worker's request protocol: turns a posted message into a typed request, or rejects it. */
import { parseMpcMaterialActivationRef, parseWebAuthnRpId } from '@shared/utils/domainIds';
import { parsePasskeyCustodyEnvelopeRecord } from '@shared/passkey-custody';
import {
  asRecord,
  asRecordOrArray,
  toOptionalTrimmedNonEmptyString,
} from '@shared/utils/validation';
import {
  normalizeNonNegativeInteger,
  normalizeOptionalTrimmedString,
  normalizePositiveInteger,
} from '@shared/utils/normalize';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseWalletSessionOperationCredentialV1 } from '@shared/device-linking';
import type {
  EmailOtpWorkerOperationRequestEnvelope,
  EmailOtpWorkerOperationMap,
} from '@/core/signingEngine/workerManager/workerTypes';
import { parseRouterAbEcdsaPostRegistrationSessionActivationPolicyV1 } from '@shared/utils/routerAbEcdsaDerivation';
import { normalizeRegistrationCredential } from '../../../webauthnAuth/credentials/helpers';
import {
  optionalWorkerPositiveInteger,
  parseEmailOtpWarmMaterialTarget,
  parseOptionalEmailOtpChannel,
  parseOptionalWorkerEcdsaSessionBootstrapHandleBinding,
  parseWorkerChainTarget,
  parseWorkerRuntimePolicyScope,
  parseWorkerSealTransport,
  parseWorkerWalletRegistrationEcdsaPrepareHandleRequest,
  readEmailOtpAuthoritySelector,
  readNumber,
  readRegistrationRoutePlan,
  readRoutePlan,
  readString,
  readThresholdEd25519SessionId,
  rejectUnknownEmailOtpYaoFields,
  requireFixed32ArrayBuffer,
  requireWorkerWalletAuthMethodId,
} from './payloadParsing';
import {
  EMAIL_OTP_ED25519_RECOVERY_LANE_FIELDS,
  parseEmailOtpEd25519RecoveryLane,
  parseEmailOtpEd25519YaoExportMaterial,
  parseEmailOtpEd25519YaoRecoveryAugmentation,
  parseEmailOtpEd25519YaoRecoveryBootstrap,
  parseEmailOtpEd25519YaoSigningInput,
  parseEmailOtpWalletUnlockMaterialRequest,
  parseWalletCustodyCacheEnvelope,
  parseWalletCustodyEd25519MaterialRequest,
} from './materialParsing';
import {
  parseEmailOtpOperationNormalSigningRequest,
  parseEmailOtpOperationStepUpProof,
} from './operationRequestParsing';
import type { EmailOtpWalletCustodySeedUnlock, EmailOtpWalletUnlockVerification } from './unlock';

type EmailOtpWorkerRequest = EmailOtpWorkerOperationRequestEnvelope;

function parseEmailOtpWalletUnlockVerification(value: unknown): EmailOtpWalletUnlockVerification {
  const verification = asRecord(value);
  if (!verification) throw new Error('loginWithEmailOtpWallet.verification is required');
  const kind = readString(verification.kind, 'verification.kind');
  switch (kind) {
    case 'otp': {
      rejectUnknownEmailOtpYaoFields(
        verification,
        ['kind', 'challengeId', 'otpCode'],
        'loginWithEmailOtpWallet.verification',
      );
      const challengeId = toOptionalTrimmedNonEmptyString(verification.challengeId);
      const otpCode = readString(verification.otpCode, 'verification.otpCode');
      if (challengeId) {
        return { kind: 'otp', challengeId, otpCode };
      }
      return {
        kind: 'otp',
        otpCode,
      };
    }
    case 'email_otp_unseal_grant': {
      rejectUnknownEmailOtpYaoFields(
        verification,
        ['kind', 'grant', 'challengeId'],
        'loginWithEmailOtpWallet.verification',
      );
      return {
        kind: 'email_otp_unseal_grant',
        grant: readString(verification.grant, 'verification.grant'),
        challengeId: readString(verification.challengeId, 'verification.challengeId'),
      };
    }
    default:
      throw new Error('loginWithEmailOtpWallet.verification.kind is invalid');
  }
}

const EMAIL_OTP_CUSTODY_SEED_UNLOCK_FIELDS = [
  'relayUrl',
  'walletId',
  'userId',
  'groupId',
  'routePlan',
  'verification',
] as const;

const EMAIL_OTP_ED25519_REHYDRATE_LANE_FIELDS = [
  'relayUrl',
  'walletId',
  'walletAuthMethodId',
  'orgId',
  'providerSubjectId',
  'nearAccountId',
  'signerSlot',
] as const;

function parseEmailOtpWalletCustodySeedUnlock(
  payload: Record<string, unknown>,
  type: string,
  missingOtpMessage: string,
): EmailOtpWalletCustodySeedUnlock {
  const verification = asRecord(payload.verification);
  if (!verification || verification.kind !== 'otp') throw new Error(missingOtpMessage);
  rejectUnknownEmailOtpYaoFields(
    verification,
    ['kind', 'challengeId', 'otpCode'],
    `${type}.verification`,
  );
  return {
    relayUrl: readString(payload.relayUrl, 'relayUrl'),
    walletId: readString(payload.walletId, 'walletId'),
    userId: readString(payload.userId, 'userId'),
    groupId: readString(payload.groupId, 'groupId'),
    routePlan: readRoutePlan(payload.routePlan, type),
    verification: {
      kind: 'otp',
      challengeId: readString(verification.challengeId, 'verification.challengeId'),
      otpCode: readString(verification.otpCode, 'verification.otpCode'),
    },
  };
}

function parseEmailOtpPasskeyRegistrationSummary(
  raw: unknown,
): EmailOtpWorkerOperationMap['completeEmailOtpPasskeyCustodyLink']['payload']['registration'] {
  const value = asRecord(raw);
  if (!value || value.kind !== 'webauthn_add_auth_method_registration_v1') {
    throw new Error('Email OTP passkey linking requires registration options');
  }
  rejectUnknownEmailOtpYaoFields(value, ['kind', 'rpId'], 'registration');
  const rpId = parseWebAuthnRpId(readString(value.rpId, 'registration.rpId'));
  if (!rpId.ok) throw new Error(rpId.error.message);
  return { kind: 'webauthn_add_auth_method_registration_v1', rpId: rpId.value };
}

/**
 * The request id alone, recovered from a message this worker refused to parse,
 * so a rejected request can be answered instead of leaving its caller to time
 * out with nothing to report.
 */
export function workerRequestIdFromRawMessage(raw: unknown): string | null {
  const obj = asRecordOrArray(raw);
  if (!obj) return null;
  return normalizeOptionalTrimmedString(obj.id) || null;
}

export function parseEmailOtpWorkerRequest(raw: unknown): EmailOtpWorkerRequest | null {
  const obj = asRecordOrArray(raw);
  if (!obj) return null;
  const id = normalizeOptionalTrimmedString(obj.id);
  const type = normalizeOptionalTrimmedString(obj.type);
  const payload = asRecord(obj.payload);
  if (!id || !type || !payload) return null;
  rejectUnknownEmailOtpYaoFields(obj, ['id', 'type', 'payload'], 'Email OTP worker request');

  switch (type) {
    case 'prewarmEmailOtpRegistrationCrypto':
      rejectUnknownEmailOtpYaoFields(payload, [], type);
      return { id, type, payload: {} };
    case 'requestEmailOtpChallenge': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          'relayUrl',
          'walletId',
          'walletAuthMethodId',
          'routePlan',
          'otpChannel',
          'operationFingerprintDigest',
        ],
        type,
      );
      const otpChannel = parseOptionalEmailOtpChannel(payload.otpChannel, `${type}.otpChannel`);
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          ...(toOptionalTrimmedNonEmptyString(payload.walletAuthMethodId)
            ? { walletAuthMethodId: toOptionalTrimmedNonEmptyString(payload.walletAuthMethodId)! }
            : {}),
          routePlan: readRoutePlan(payload.routePlan, type),
          ...(otpChannel === undefined ? {} : { otpChannel }),
          ...(toOptionalTrimmedNonEmptyString(payload.operationFingerprintDigest)
            ? {
                operationFingerprintDigest: parseDigestB64u(
                  toOptionalTrimmedNonEmptyString(payload.operationFingerprintDigest)!,
                ),
              }
            : {}),
        },
      };
    }
    case 'requestEmailOtpEnrollmentChallenge': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        ['relayUrl', 'walletId', 'routePlan', 'otpChannel'],
        type,
      );
      const otpChannel = parseOptionalEmailOtpChannel(payload.otpChannel, `${type}.otpChannel`);
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          routePlan: readRegistrationRoutePlan(payload.routePlan, type),
          ...(otpChannel === undefined ? {} : { otpChannel }),
        },
      };
    }
    case 'enrollEmailOtpWallet': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          'relayUrl',
          'walletId',
          'userId',
          'challengeId',
          'otpCode',
          'groupId',
          'routePlan',
          'googleEmailOtpRegistrationAttemptId',
          'otpChannel',
          'clientSecret32',
        ],
        type,
      );
      const otpChannel = parseOptionalEmailOtpChannel(payload.otpChannel, `${type}.otpChannel`);
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          userId: readString(payload.userId, 'userId'),
          ...(toOptionalTrimmedNonEmptyString(payload.challengeId)
            ? { challengeId: toOptionalTrimmedNonEmptyString(payload.challengeId)! }
            : {}),
          otpCode: readString(payload.otpCode, 'otpCode'),
          groupId: readString(payload.groupId, 'groupId'),
          routePlan: readRegistrationRoutePlan(payload.routePlan, type),
          ...(toOptionalTrimmedNonEmptyString(payload.googleEmailOtpRegistrationAttemptId)
            ? {
                googleEmailOtpRegistrationAttemptId: toOptionalTrimmedNonEmptyString(
                  payload.googleEmailOtpRegistrationAttemptId,
                )!,
              }
            : {}),
          ...(otpChannel === undefined ? {} : { otpChannel }),
          ...(payload.clientSecret32 instanceof ArrayBuffer
            ? { clientSecret32: payload.clientSecret32 }
            : {}),
        },
      };
    }
    case 'prepareEmailOtpRegistrationEnrollmentMaterial': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          'relayUrl',
          'walletId',
          'userId',
          'groupId',
          'routePlan',
          'otpChannel',
          'clientSecret32',
          'ecdsaSessionHandle',
        ],
        type,
      );
      const handleRequest = parseWorkerWalletRegistrationEcdsaPrepareHandleRequest(
        payload.ecdsaSessionHandle,
      );
      const otpChannel = parseOptionalEmailOtpChannel(payload.otpChannel, `${type}.otpChannel`);
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          userId: readString(payload.userId, 'userId'),
          groupId: readString(payload.groupId, 'groupId'),
          routePlan: readRegistrationRoutePlan(payload.routePlan, type),
          ...(otpChannel === undefined ? {} : { otpChannel }),
          ...(payload.clientSecret32 instanceof ArrayBuffer
            ? { clientSecret32: payload.clientSecret32 }
            : {}),
          ecdsaSessionHandle: handleRequest,
        },
      };
    }
    case 'releaseWalletRecoveryEmailOtpFactor':
      rejectUnknownEmailOtpYaoFields(
        payload,
        ['relayUrl', 'walletId', 'recoveryOperationId', 'reservationId'],
        type,
      );
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          recoveryOperationId: readString(payload.recoveryOperationId, 'recoveryOperationId'),
          reservationId: readString(payload.reservationId, 'reservationId'),
        },
      };
    case 'createEmailOtpEd25519YaoSigningShare':
      rejectUnknownEmailOtpYaoFields(payload, ['activeClientHandle', 'input'], type);
      return {
        id,
        type,
        payload: {
          activeClientHandle: readString(payload.activeClientHandle, 'activeClientHandle'),
          input: parseEmailOtpEd25519YaoSigningInput(payload.input),
        },
      };
    case 'disposeEmailOtpEd25519YaoActiveClient':
      rejectUnknownEmailOtpYaoFields(payload, ['activeClientHandle'], type);
      return {
        id,
        type,
        payload: {
          activeClientHandle: readString(payload.activeClientHandle, 'activeClientHandle'),
        },
      };
    case 'prepareEmailOtpPasskeyCustodyLink': {
      rejectUnknownEmailOtpYaoFields(payload, EMAIL_OTP_CUSTODY_SEED_UNLOCK_FIELDS, type);
      return {
        id,
        type,
        payload: parseEmailOtpWalletCustodySeedUnlock(
          payload,
          type,
          'Email OTP passkey linking requires OTP verification',
        ),
      };
    }
    case 'completeEmailOtpPasskeyCustodyLink':
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          'pendingHandleId',
          'existingEnvelope',
          'walletAuthMethodId',
          'registration',
          'registrationCredential',
        ],
        type,
      );
      return {
        id,
        type,
        payload: {
          pendingHandleId: readString(payload.pendingHandleId, 'pendingHandleId'),
          existingEnvelope: parsePasskeyCustodyEnvelopeRecord(payload.existingEnvelope),
          /* Part of the request allow-list, not an afterthought: a field the
             parser does not name is rejected, and a rejection here used to
             escape the responder and hang the caller for its full timeout. */
          walletAuthMethodId: requireWorkerWalletAuthMethodId(payload.walletAuthMethodId),
          registration: parseEmailOtpPasskeyRegistrationSummary(payload.registration),
          registrationCredential: normalizeRegistrationCredential(payload.registrationCredential),
        },
      };
    case 'discardEmailOtpPasskeyCustodyLink':
      rejectUnknownEmailOtpYaoFields(payload, ['pendingHandleId'], type);
      return {
        id,
        type,
        payload: {
          pendingHandleId: readString(payload.pendingHandleId, 'pendingHandleId'),
        },
      };
    case 'rotateEmailOtpWalletRecoverySet': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [...EMAIL_OTP_CUSTODY_SEED_UNLOCK_FIELDS, 'recoveryCodesJson'],
        type,
      );
      return {
        id,
        type,
        payload: {
          ...parseEmailOtpWalletCustodySeedUnlock(
            payload,
            type,
            'Email OTP recovery rotation requires OTP verification',
          ),
          recoveryCodesJson: readString(payload.recoveryCodesJson, 'recoveryCodesJson'),
        },
      };
    }
    case 'loginWithEmailOtpWallet': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          'relayUrl',
          'walletId',
          'authoritySelector',
          'userId',
          'groupId',
          'routePlan',
          'otpChannel',
          'verification',
          'material',
        ],
        type,
      );
      const otpChannel = parseOptionalEmailOtpChannel(payload.otpChannel, `${type}.otpChannel`);
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          authoritySelector: readEmailOtpAuthoritySelector(payload.authoritySelector),
          userId: readString(payload.userId, 'userId'),
          groupId: readString(payload.groupId, 'groupId'),
          routePlan: readRoutePlan(payload.routePlan, type),
          ...(otpChannel === undefined ? {} : { otpChannel }),
          verification: parseEmailOtpWalletUnlockVerification(payload.verification),
          material: parseEmailOtpWalletUnlockMaterialRequest(payload.material),
        },
      };
    }
    case 'unlockEmailOtpAuthorityWallet': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        ['relayUrl', 'walletId', 'walletAuthMethodId', 'challengeId', 'otpCode', 'ed25519'],
        type,
      );
      const ed25519Payload = asRecord(payload.ed25519);
      if (!ed25519Payload) throw new Error(`${type}.ed25519 is required`);
      const branch = readString(ed25519Payload.kind, `${type}.ed25519.kind`);
      const parsedEd25519 = (() => {
        switch (branch) {
          case 'no_ed25519':
            rejectUnknownEmailOtpYaoFields(ed25519Payload, ['kind'], `${type}.ed25519`);
            return { kind: 'no_ed25519' as const };
          case 'linked_device': {
            rejectUnknownEmailOtpYaoFields(
              ed25519Payload,
              ['kind', 'signerSlot', 'remainingUses'],
              `${type}.ed25519`,
            );
            return {
              kind: 'linked_device' as const,
              signerSlot: normalizePositiveInteger(ed25519Payload.signerSlot) || 0,
              remainingUses: normalizePositiveInteger(ed25519Payload.remainingUses) || 0,
            };
          }
          case 'owner_authority': {
            rejectUnknownEmailOtpYaoFields(
              ed25519Payload,
              ['kind', 'signerSlot', 'remainingUses', 'recovery'],
              `${type}.ed25519`,
            );
            const recovery = asRecord(ed25519Payload.recovery);
            if (!recovery) throw new Error(`${type}.ed25519.recovery is required`);
            rejectUnknownEmailOtpYaoFields(
              recovery,
              ['ed25519YaoRecovery', ...EMAIL_OTP_ED25519_RECOVERY_LANE_FIELDS],
              `${type}.ed25519.recovery`,
            );
            return {
              kind: 'owner_authority' as const,
              signerSlot: normalizePositiveInteger(ed25519Payload.signerSlot) || 0,
              remainingUses: normalizePositiveInteger(ed25519Payload.remainingUses) || 0,
              recovery: {
                ed25519YaoRecovery: parseEmailOtpEd25519YaoRecoveryAugmentation(
                  recovery.ed25519YaoRecovery,
                ),
                ...parseEmailOtpEd25519RecoveryLane(recovery, `${type}.ed25519.recovery`),
              },
            };
          }
          default:
            return null;
        }
      })();
      if (
        !parsedEd25519 ||
        (parsedEd25519.kind !== 'no_ed25519' &&
          (parsedEd25519.signerSlot <= 0 || parsedEd25519.remainingUses <= 0))
      ) {
        throw new Error(`${type}.ed25519 is invalid`);
      }
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          walletAuthMethodId: readString(payload.walletAuthMethodId, 'walletAuthMethodId'),
          challengeId: readString(payload.challengeId, 'challengeId'),
          otpCode: readString(payload.otpCode, 'otpCode'),
          ed25519: parsedEd25519,
        },
      };
    }
    case 'getEmailOtpWarmSessionStatus':
    case 'clearEmailOtpWarmSessionMaterial':
      rejectUnknownEmailOtpYaoFields(payload, ['target'], type);
      return {
        id,
        type,
        payload: { target: parseEmailOtpWarmMaterialTarget(payload.target) },
      };
    case 'consumeEmailOtpWarmSessionUses':
      rejectUnknownEmailOtpYaoFields(payload, ['target', 'uses'], type);
      return {
        id,
        type,
        payload: {
          target: parseEmailOtpWarmMaterialTarget(payload.target),
          ...(optionalWorkerPositiveInteger(payload.uses)
            ? { uses: optionalWorkerPositiveInteger(payload.uses)! }
            : {}),
        },
      };
    case 'sealEmailOtpWarmSessionMaterial':
      rejectUnknownEmailOtpYaoFields(payload, ['target', 'transport'], type);
      return {
        id,
        type,
        payload: {
          target: parseEmailOtpWarmMaterialTarget(payload.target),
          transport: parseWorkerSealTransport(payload.transport),
        },
      };
    case 'rehydrateEmailOtpEcdsaWarmSessionMaterial': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        ['target', 'sealedSecretB64u', 'remainingUses', 'expiresAtMs', 'transport', 'restore'],
        type,
      );
      const restore = asRecord(payload.restore);
      if (!restore) throw new Error('Email OTP ECDSA rehydrate requires restore payload');
      rejectUnknownEmailOtpYaoFields(
        restore,
        ['thresholdSessionId', 'walletId', 'keyHandle', 'chainTarget', 'authSubjectId'],
        `${type}.restore`,
      );
      const target = parseEmailOtpWarmMaterialTarget(payload.target);
      if (target.kind !== 'ecdsa') {
        throw new Error('Email OTP ECDSA rehydrate requires an ECDSA target');
      }
      return {
        id,
        type,
        payload: {
          target,
          sealedSecretB64u: readString(payload.sealedSecretB64u, 'sealedSecretB64u'),
          remainingUses: normalizeNonNegativeInteger(payload.remainingUses) ?? 0,
          expiresAtMs: readNumber(payload.expiresAtMs, 'expiresAtMs'),
          transport: parseWorkerSealTransport(payload.transport),
          restore: {
            thresholdSessionId: readString(
              restore.thresholdSessionId,
              'restore.thresholdSessionId',
            ),
            walletId: readString(restore.walletId, 'restore.walletId'),
            keyHandle: readString(restore.keyHandle, 'restore.keyHandle'),
            chainTarget: parseWorkerChainTarget(restore.chainTarget),
            authSubjectId: readString(restore.authSubjectId, 'restore.authSubjectId'),
          },
        },
      };
    }
    case 'rehydrateEmailOtpEd25519YaoOperationMaterial': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          ...EMAIL_OTP_ED25519_REHYDRATE_LANE_FIELDS,
          'expectedOperationalPublicKey',
          'expectedThresholdSessionId',
          'expectedMaterialActivation',
          'ed25519YaoRecovery',
          'walletCustodyEd25519Material',
          'normalSigningRequest',
          'displayDigest',
          'proof',
          'operationCredential',
          'bootstrap',
        ],
        type,
      );
      const activation = parseMpcMaterialActivationRef(payload.expectedMaterialActivation);
      if (!activation.ok) throw new Error(activation.error.message);
      const recovery = parseEmailOtpEd25519YaoRecoveryAugmentation(payload.ed25519YaoRecovery);
      const orgId = readString(payload.orgId, 'orgId');
      if (recovery.orgId !== orgId) {
        throw new Error('Email OTP operation material orgId does not match recovery facts');
      }
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          orgId,
          providerSubjectId: readString(payload.providerSubjectId, 'providerSubjectId'),
          nearAccountId: readString(payload.nearAccountId, 'nearAccountId'),
          signerSlot: normalizePositiveInteger(payload.signerSlot) || 0,
          expectedOperationalPublicKey: readString(
            payload.expectedOperationalPublicKey,
            'expectedOperationalPublicKey',
          ),
          expectedThresholdSessionId: readThresholdEd25519SessionId(
            payload.expectedThresholdSessionId,
            'expectedThresholdSessionId',
          ),
          expectedMaterialActivation: activation.value,
          ed25519YaoRecovery: recovery,
          walletCustodyEd25519Material: parseWalletCustodyEd25519MaterialRequest(
            payload.walletCustodyEd25519Material,
          ),
          normalSigningRequest: parseEmailOtpOperationNormalSigningRequest(
            payload.normalSigningRequest,
          ),
          displayDigest: readString(payload.displayDigest, 'displayDigest'),
          proof: parseEmailOtpOperationStepUpProof(payload.proof),
          operationCredential: parseWalletSessionOperationCredentialV1(payload.operationCredential),
          bootstrap: parseEmailOtpEd25519YaoRecoveryBootstrap(payload.bootstrap, {
            kind: 'operation_step_up_payload',
          }),
        },
      };
    }
    case 'rehydrateActiveEmailOtpEd25519YaoSessionMaterial': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        [
          ...EMAIL_OTP_ED25519_REHYDRATE_LANE_FIELDS,
          'remainingUses',
          'expectedOperationalPublicKey',
          'expectedThresholdSessionId',
          'operationCredential',
          'ecdsa',
          'walletCustodyEd25519Material',
        ],
        type,
      );
      const ecdsa = asRecord(payload.ecdsa);
      if (!ecdsa) {
        throw new Error('Active Email OTP restore requires exact ECDSA session input');
      }
      rejectUnknownEmailOtpYaoFields(
        ecdsa,
        ['sessionHandleBinding', 'runtimePolicyScope', 'sessionPolicy'],
        `${type}.ecdsa`,
      );
      const ecdsaBinding = parseOptionalWorkerEcdsaSessionBootstrapHandleBinding(
        ecdsa.sessionHandleBinding,
      );
      if (!ecdsaBinding || ecdsaBinding.operation !== 'wallet_unlock') {
        throw new Error('Active Email OTP restore requires wallet-unlock ECDSA binding');
      }
      const material = parseWalletCustodyEd25519MaterialRequest(
        payload.walletCustodyEd25519Material,
      );
      if (material.kind !== 'found') {
        throw new Error('Active Email OTP restore requires wallet custody Ed25519 material');
      }
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          walletId: readString(payload.walletId, 'walletId'),
          walletAuthMethodId: readString(payload.walletAuthMethodId, 'walletAuthMethodId'),
          orgId: readString(payload.orgId, 'orgId'),
          providerSubjectId: readString(payload.providerSubjectId, 'providerSubjectId'),
          nearAccountId: readString(payload.nearAccountId, 'nearAccountId'),
          signerSlot: normalizePositiveInteger(payload.signerSlot) || 0,
          remainingUses: normalizeNonNegativeInteger(payload.remainingUses) ?? 0,
          expectedOperationalPublicKey: readString(
            payload.expectedOperationalPublicKey,
            'expectedOperationalPublicKey',
          ),
          expectedThresholdSessionId: readThresholdEd25519SessionId(
            payload.expectedThresholdSessionId,
            'expectedThresholdSessionId',
          ),
          operationCredential: parseWalletSessionOperationCredentialV1(payload.operationCredential),
          ecdsa: {
            sessionHandleBinding: { ...ecdsaBinding, operation: 'wallet_unlock' },
            runtimePolicyScope: parseWorkerRuntimePolicyScope(
              ecdsa.runtimePolicyScope,
              'Active Email OTP restore',
            ),
            sessionPolicy: parseRouterAbEcdsaPostRegistrationSessionActivationPolicyV1(
              ecdsa.sessionPolicy,
            ),
          },
          walletCustodyEd25519Material: material,
        },
      };
    }
    case 'activateEmailOtpEd25519YaoRegistrationMaterial': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        ['material', 'bootstrap', 'envelope', 'factorSecret32'],
        type,
      );
      const material = parseWalletCustodyEd25519MaterialRequest({
        kind: 'found',
        material: payload.material,
      });
      if (material.kind !== 'found') {
        throw new Error('Registration activation requires wallet custody Ed25519 material');
      }
      return {
        id,
        type,
        payload: {
          material: material.material,
          bootstrap: parseEmailOtpEd25519YaoRecoveryBootstrap(payload.bootstrap, {
            kind: 'resolved_worker_payload',
          }),
          envelope: parseWalletCustodyCacheEnvelope(payload.envelope),
          factorSecret32: requireFixed32ArrayBuffer(payload.factorSecret32, 'factorSecret32'),
        },
      };
    }
    case 'exportEmailOtpEd25519YaoSeed': {
      rejectUnknownEmailOtpYaoFields(
        payload,
        ['relayUrl', 'challengeId', 'otpCode', 'lane', 'material'],
        type,
      );
      const lane = asRecord(payload.lane);
      const material = asRecord(payload.material);
      if (!lane || !material) {
        throw new Error(`${type} requires canonical lane and material`);
      }
      rejectUnknownEmailOtpYaoFields(
        lane,
        [
          'walletId',
          'providerSubjectId',
          'walletAuthMethodId',
          'nearAccountId',
          'nearEd25519SigningKeyId',
          'signerSlot',
        ],
        `${type}.lane`,
      );
      rejectUnknownEmailOtpYaoFields(
        material,
        [
          'kind',
          'materialActivation',
          'capability',
          'walletCustodyEd25519Material',
          'bootstrap',
          'exportRootEnvelope',
        ],
        `${type}.material`,
      );
      return {
        id,
        type,
        payload: {
          relayUrl: readString(payload.relayUrl, 'relayUrl'),
          challengeId: readString(payload.challengeId, 'challengeId'),
          otpCode: readString(payload.otpCode, 'otpCode'),
          lane: {
            walletId: readString(lane.walletId, `${type}.lane.walletId`),
            providerSubjectId: readString(lane.providerSubjectId, `${type}.lane.providerSubjectId`),
            walletAuthMethodId: readString(
              lane.walletAuthMethodId,
              `${type}.lane.walletAuthMethodId`,
            ),
            nearAccountId: readString(lane.nearAccountId, `${type}.lane.nearAccountId`),
            nearEd25519SigningKeyId: readString(
              lane.nearEd25519SigningKeyId,
              `${type}.lane.nearEd25519SigningKeyId`,
            ),
            signerSlot: normalizePositiveInteger(lane.signerSlot) || 0,
          },
          material: parseEmailOtpEd25519YaoExportMaterial(material),
        },
      };
    }
    default:
      return null;
  }
}
