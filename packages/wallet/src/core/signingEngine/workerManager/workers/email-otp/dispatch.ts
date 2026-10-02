/**
 * Routes each parsed request to its operation and posts the reply, transferring secret buffers
 * rather than copying them.
 */
import { EMAIL_OTP_CHANNEL, WALLET_EMAIL_OTP_ACTIONS } from '@shared/utils/emailOtpDomain';
import { zeroizeBytes } from '@/core/signingEngine/session/emailOtp/zeroize';
import { openWalletCustodyEd25519ActiveClientV1 } from '@/core/signingEngine/walletCustody/openCustodyCache';
import type {
  EmailOtpWalletRegistrationEcdsaPrepareHandleResult,
  EmailOtpWorkerOperationMap,
  EmailOtpWorkerProgressCode,
} from '@/core/signingEngine/workerManager/workerTypes';
import { asWorkerErrorPayload, workerErrorReply } from '../workerErrorPayload';
import {
  bindEmailOtpEd25519YaoCapabilityWarmFactor,
  cloneEmailOtpEd25519YaoSigningShare,
  consumeEmailOtpWarmSessionUses,
  deleteEmailOtpEd25519YaoWarmFactor,
  deleteEmailOtpWarmMaterial,
  emailOtpEd25519YaoActiveClients,
  invalidSigningSessionSealTransport,
  issueEmailOtpEcdsaSessionHandle,
  parseSigningSessionSealTransport,
  readEmailOtpWarmSessionStatus,
  rehydrateEmailOtpEcdsaWarmSessionMaterial,
  removeEmailOtpEd25519YaoActiveClient,
  sealEmailOtpWarmSessionMaterial,
  storeEmailOtpEd25519YaoActiveClient,
} from './sessionState';
import {
  type EmailOtpEd25519ExportCustodyResolutionState,
  emailOtpEd25519YaoExportCapabilityV1,
  exportEmailOtpEd25519YaoSeed,
  resolveEmailOtpEd25519ExportCustodyEnvelope,
} from './ed25519YaoExport';
import {
  assertEmailOtpUnlockMaterialRouteAuth,
  emailOtpUnlockMaterialOrgId,
  loginWithEmailOtpAndUnlockWallet,
  unlockEmailOtpAuthorityWallet,
} from './unlock';
import { walletCustodyActivationFactsFromEmailOtpBootstrap } from './custodyRestore';
import {
  rehydrateActiveEmailOtpEd25519YaoSessionMaterial,
  rehydrateEmailOtpEd25519YaoOperationMaterial,
  releaseWalletRecoveryEmailOtpFactor,
  rotateEmailOtpWalletRecoverySet,
} from './recovery';
import {
  completeEmailOtpEnrollmentFromSecret32,
  emailOtpEnrollmentFacts,
  emailOtpWalletRegistrationEcdsaHandleResult,
  enrollmentClientSecret32,
} from './enrollment';
import { parseEmailOtpChallengeSignerSelection, requestEmailOtpChallenge } from './otpVerification';
import { getEmailOtpYaoClient } from './crypto';
import {
  assertNeverEmailOtpWorker,
  readEmailOtpAuthoritySelector,
  readRoutePlan,
  readString,
  requireWorkerWalletAuthMethodId,
} from './payloadParsing';
import { emailOtpCustodyMaterialMatchesLane } from './materialParsing';
import { parseEmailOtpWorkerRequest, workerRequestIdFromRawMessage } from './requestEnvelope';

export function postToMainThread(message: unknown, transfer?: Transferable[]): void {
  (
    self as unknown as { postMessage: (message: unknown, transfer?: Transferable[]) => void }
  ).postMessage(message, transfer);
}

function postEmailOtpWorkerProgress(id: string, code: EmailOtpWorkerProgressCode): void {
  postToMainThread({ id, progress: true, payload: { code } });
}

/** Answers one request posted to the Email OTP worker. */
export async function handleEmailOtpWorkerMessage(event: MessageEvent): Promise<void> {
  /* Parsing sat outside the try below, so a rejected field threw past the
     responder and the caller waited out its whole timeout with no error
     anywhere. A request that cannot be parsed still has to answer. */
  let msg: ReturnType<typeof parseEmailOtpWorkerRequest>;
  try {
    msg = parseEmailOtpWorkerRequest(event.data);
  } catch (error) {
    const err = asWorkerErrorPayload(error);
    const requestId = workerRequestIdFromRawMessage(event.data);
    console.error('[EmailOtpWorker] rejected an unparsable request', err.message);
    if (requestId !== null) postToMainThread(workerErrorReply(requestId, err));
    return;
  }
  if (!msg) return;

  try {
    switch (msg.type) {
      case 'prewarmEmailOtpRegistrationCrypto': {
        const startedAt = performance.now();
        try {
          await getEmailOtpYaoClient();
          postToMainThread({
            id: msg.id,
            ok: true,
            result: {
              kind: 'succeeded',
              elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
            },
          });
        } catch {
          postToMainThread({
            id: msg.id,
            ok: true,
            result: {
              kind: 'failed',
              elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
              failureStage: 'yao_wasm_init',
            },
          });
        }
        return;
      }
      case 'requestEmailOtpChallenge': {
        const routePlan = readRoutePlan(msg.payload.routePlan, 'requestEmailOtpChallenge');
        const { response, challenge, delivery, expiresAtMs } = await requestEmailOtpChallenge({
          relayUrl: readString(msg.payload.relayUrl, 'relayUrl'),
          routePlan,
          body: {
            walletId: readString(msg.payload.walletId, 'walletId'),
            ...(msg.payload.walletAuthMethodId
              ? {
                  walletAuthMethodId: readString(
                    msg.payload.walletAuthMethodId,
                    'walletAuthMethodId',
                  ),
                }
              : {}),
            otpChannel: EMAIL_OTP_CHANNEL,
            operation: routePlan.operation,
            ...(msg.payload.operationFingerprintDigest
              ? { operationFingerprintDigest: msg.payload.operationFingerprintDigest }
              : {}),
          },
          expectedAction: WALLET_EMAIL_OTP_ACTIONS.login,
          label: 'Email OTP login challenge',
        });
        const result: EmailOtpWorkerOperationMap['requestEmailOtpChallenge']['result'] = {
          challengeId: readString(challenge?.challengeId, 'challengeId'),
          otpChannel: EMAIL_OTP_CHANNEL,
          delivery,
          emailHint: delivery.emailHint,
          ownerProofBindingDigest: readString(
            challenge?.ownerProofBindingDigest,
            'ownerProofBindingDigest',
          ),
          walletAuthMethodId: readString(response.walletAuthMethodId, 'walletAuthMethodId'),
          signerSelection: parseEmailOtpChallengeSignerSelection(response.signerSelection),
          ...(Number.isFinite(expiresAtMs) ? { expiresAtMs } : {}),
        };
        postToMainThread({ id: msg.id, ok: true, result });
        return;
      }
      case 'requestEmailOtpEnrollmentChallenge': {
        const routePlan = readRoutePlan(
          msg.payload.routePlan,
          'requestEmailOtpEnrollmentChallenge',
        );
        const { challenge, delivery, expiresAtMs } = await requestEmailOtpChallenge({
          relayUrl: readString(msg.payload.relayUrl, 'relayUrl'),
          routePlan,
          body: {
            walletId: readString(msg.payload.walletId, 'walletId'),
            otpChannel: EMAIL_OTP_CHANNEL,
          },
          expectedAction: WALLET_EMAIL_OTP_ACTIONS.registration,
          label: 'Email OTP registration challenge',
        });
        const result: EmailOtpWorkerOperationMap['requestEmailOtpEnrollmentChallenge']['result'] = {
          challengeId: readString(challenge?.challengeId, 'challengeId'),
          otpChannel: EMAIL_OTP_CHANNEL,
          delivery,
          emailHint: delivery.emailHint,
          ...(Number.isFinite(expiresAtMs) ? { expiresAtMs } : {}),
        };
        postToMainThread({ id: msg.id, ok: true, result });
        return;
      }
      case 'enrollEmailOtpWallet': {
        const routePlan = readRoutePlan(msg.payload.routePlan, 'enrollEmailOtpWallet');
        const result = await completeEmailOtpEnrollmentFromSecret32({
          relayUrl: readString(msg.payload.relayUrl, 'relayUrl'),
          walletId: readString(msg.payload.walletId, 'walletId'),
          userId: msg.payload.userId,
          challengeId: msg.payload.challengeId,
          otpCode: readString(msg.payload.otpCode, 'otpCode'),
          groupId: readString(msg.payload.groupId, 'groupId'),
          routePlan,
          googleEmailOtpRegistrationAttemptId: msg.payload.googleEmailOtpRegistrationAttemptId,
          onProgress: (code) => postEmailOtpWorkerProgress(msg.id, code),
          ...enrollmentClientSecret32(msg.payload.clientSecret32),
        });
        postToMainThread({
          id: msg.id,
          ok: true,
          result: { challengeId: result.challengeId, ...emailOtpEnrollmentFacts(result) },
        });
        return;
      }
      case 'prepareEmailOtpRegistrationEnrollmentMaterial': {
        const routePlan = readRoutePlan(
          msg.payload.routePlan,
          'prepareEmailOtpRegistrationEnrollmentMaterial',
        );
        const result = await completeEmailOtpEnrollmentFromSecret32({
          relayUrl: readString(msg.payload.relayUrl, 'relayUrl'),
          walletId: readString(msg.payload.walletId, 'walletId'),
          userId: msg.payload.userId,
          groupId: readString(msg.payload.groupId, 'groupId'),
          routePlan,
          returnClientSecret32: false,
          skipServerFinalize: true,
          onProgress: (code) => postEmailOtpWorkerProgress(msg.id, code),
          ...enrollmentClientSecret32(msg.payload.clientSecret32),
        });
        try {
          readString(msg.payload.walletId, 'walletId');
          const emailOtpSessionHandle: EmailOtpWalletRegistrationEcdsaPrepareHandleResult =
            emailOtpWalletRegistrationEcdsaHandleResult(msg.payload.ecdsaSessionHandle);
          postToMainThread({
            id: msg.id,
            ok: true,
            result: {
              ...emailOtpEnrollmentFacts(result),
              emailOtpSessionHandle,
              emailOtpEnrollment: result.emailOtpEnrollment,
            },
          });
        } finally {
          zeroizeBytes(result.clientSecret32);
        }
        return;
      }
      case 'releaseWalletRecoveryEmailOtpFactor': {
        const result = await releaseWalletRecoveryEmailOtpFactor(msg.payload);
        postToMainThread(
          { id: msg.id, ok: true, result },
          result.kind === 'existing' ? [result.factorSecret32] : [],
        );
        return;
      }
      case 'createEmailOtpEd25519YaoSigningShare': {
        const entry = emailOtpEd25519YaoActiveClients.get(msg.payload.activeClientHandle);
        if (!entry || entry.activeClient.status().kind !== 'active') {
          if (entry) {
            emailOtpEd25519YaoActiveClients.delete(msg.payload.activeClientHandle);
          }
          throw new Error('Email OTP Ed25519 Yao active Client is unavailable');
        }
        const share = await entry.activeClient.createSigningShare(msg.payload.input);
        postToMainThread({
          id: msg.id,
          ok: true,
          result: cloneEmailOtpEd25519YaoSigningShare(share),
        });
        return;
      }
      case 'disposeEmailOtpEd25519YaoActiveClient': {
        const removed = removeEmailOtpEd25519YaoActiveClient(msg.payload.activeClientHandle);
        postToMainThread({ id: msg.id, ok: true, result: { removed } });
        return;
      }
      case 'rotateEmailOtpWalletRecoverySet': {
        const result = await rotateEmailOtpWalletRecoverySet(msg.payload);
        postToMainThread({ id: msg.id, ok: true, result });
        return;
      }
      case 'loginWithEmailOtpWallet': {
        const routePlan = readRoutePlan(msg.payload.routePlan, 'loginWithEmailOtpWallet');
        const material = msg.payload.material;
        const walletId = readString(msg.payload.walletId, 'walletId');
        assertEmailOtpUnlockMaterialRouteAuth({ walletId, routePlan, material });
        const orgId = emailOtpUnlockMaterialOrgId(material);
        const result = await loginWithEmailOtpAndUnlockWallet({
          relayUrl: readString(msg.payload.relayUrl, 'relayUrl'),
          walletId,
          authoritySelector: readEmailOtpAuthoritySelector(msg.payload.authoritySelector),
          ...(orgId ? { orgId } : {}),
          userId: msg.payload.userId,
          verification: msg.payload.verification,
          groupId: readString(msg.payload.groupId, 'groupId'),
          routePlan,
          material,
          onProgress: (code) => postEmailOtpWorkerProgress(msg.id, code),
        });
        const recovery = {
          challengeId: result.challengeId,
          enrollmentSealKeyVersion: result.enrollmentSealKeyVersion,
          unlockChallengeId: result.unlockChallengeId,
          unlockChallengeB64u: result.unlockChallengeB64u,
          clientUnlockPublicKeyB64u: result.clientUnlockPublicKeyB64u,
          unlockSignatureB64u: result.unlockSignatureB64u,
          verifiedAuthorityProjection: result.verifiedAuthorityProjection,
        };
        switch (result.kind) {
          case 'ecdsa':
            if (material.kind !== 'ecdsa') {
              throw new Error('Email OTP wallet unlock material branch changed');
            }
            postToMainThread({
              id: msg.id,
              ok: true,
              result: {
                kind: 'ecdsa',
                operation: material.ecdsaSessionHandleBinding.operation,
                recovery,
                emailOtpSessionHandle: issueEmailOtpEcdsaSessionHandle({
                  walletId,
                  binding: material.ecdsaSessionHandleBinding,
                }),
                ...(result.ecdsaSession ? { ecdsaSession: result.ecdsaSession } : {}),
                ...(result.ecdsaCustody ? { ecdsaCustody: result.ecdsaCustody } : {}),
              },
            });
            return;
          case 'wallet_unlock_capabilities': {
            if (material.kind !== 'wallet_unlock_capabilities') {
              result.clientSecret32.fill(0);
              if (result.ed25519Yao.kind === 'capability') {
                removeEmailOtpEd25519YaoActiveClient(result.ed25519Yao.activeClientHandle);
              }
              throw new Error('Email OTP capability wallet unlock material branch changed');
            }
            const emailOtpSessionHandle = issueEmailOtpEcdsaSessionHandle({
              walletId,
              binding: material.ecdsa.sessionHandleBinding,
            });
            try {
              const ecdsa = {
                emailOtpSessionHandle,
                session: result.ecdsa.session,
                custody: result.ecdsa.custody,
              };
              postToMainThread(
                {
                  id: msg.id,
                  ok: true,
                  result: {
                    kind: 'wallet_unlock_capabilities',
                    operation: 'wallet_unlock',
                    recovery,
                    ed25519ExportRootCustody: {
                      existingEnvelope: result.walletCustodyEnvelope,
                      factorSecret32: result.clientSecret32,
                    },
                    walletSessionAuthorization: result.walletSessionAuthorization,
                    ecdsa,
                    ed25519Yao: result.ed25519Yao,
                  },
                },
                [result.clientSecret32.buffer],
              );
            } catch (error) {
              if (result.clientSecret32.byteLength > 0) result.clientSecret32.fill(0);
              if (result.ed25519Yao.kind === 'capability') {
                removeEmailOtpEd25519YaoActiveClient(result.ed25519Yao.activeClientHandle);
                deleteEmailOtpEd25519YaoWarmFactor(
                  result.ed25519Yao.bootstrap.capability.materialActivation,
                );
              }
              throw error;
            }
            return;
          }
          case 'wallet_custody_cache_absent': {
            if (material.kind !== 'ed25519_yao_recovery') {
              throw new Error('Email OTP wallet unlock material branch changed');
            }
            postToMainThread({
              id: msg.id,
              ok: true,
              result: {
                kind: 'wallet_custody_cache_absent',
                recovery,
                ed25519YaoRecovery: result.ed25519YaoRecovery,
              },
            });
            return;
          }
          case 'ed25519_yao_capability':
            if (material.kind !== 'ed25519_yao_recovery') {
              removeEmailOtpEd25519YaoActiveClient(result.activeClientHandle);
              throw new Error('Email OTP wallet unlock material branch changed');
            }
            try {
              postToMainThread(
                {
                  id: msg.id,
                  ok: true,
                  result: {
                    kind: 'ed25519_yao_capability',
                    recovery,
                    activeClientHandle: result.activeClientHandle,
                    metadata: result.metadata,
                    ed25519YaoCapability: result.ed25519YaoCapability,
                    walletSessionAuthorization: result.walletSessionAuthorization,
                    ...(result.walletCustodyEd25519Material
                      ? { walletCustodyEd25519Material: result.walletCustodyEd25519Material }
                      : {}),
                    ed25519ExportRootCustody: {
                      existingEnvelope: result.walletCustodyEnvelope,
                      factorSecret32: result.clientSecret32,
                    },
                  },
                },
                [result.clientSecret32.buffer],
              );
            } catch (error) {
              if (result.clientSecret32.byteLength > 0) result.clientSecret32.fill(0);
              removeEmailOtpEd25519YaoActiveClient(result.activeClientHandle);
              deleteEmailOtpEd25519YaoWarmFactor(
                result.ed25519YaoCapability.capability.materialActivation,
              );
              throw error;
            }
            return;
          case 'ed25519_yao_export':
            throw new Error('Email OTP wallet unlock returned export-only material');
          default:
            return assertNeverEmailOtpWorker(result);
        }
      }
      case 'unlockEmailOtpAuthorityWallet': {
        const result = await unlockEmailOtpAuthorityWallet(msg.payload);
        try {
          postToMainThread({ id: msg.id, ok: true, result }, [result.factorSecret32.buffer]);
        } catch (error: unknown) {
          result.factorSecret32.fill(0);
          throw error;
        }
        return;
      }
      case 'getEmailOtpWarmSessionStatus': {
        postToMainThread({
          id: msg.id,
          ok: true,
          result: readEmailOtpWarmSessionStatus(msg.payload.target),
        });
        return;
      }
      case 'consumeEmailOtpWarmSessionUses': {
        postToMainThread({
          id: msg.id,
          ok: true,
          result: consumeEmailOtpWarmSessionUses({
            target: msg.payload.target,
            uses: msg.payload.uses,
          }),
        });
        return;
      }
      case 'sealEmailOtpWarmSessionMaterial': {
        const transport = parseSigningSessionSealTransport(msg.payload.transport);
        const result = transport
          ? await sealEmailOtpWarmSessionMaterial({
              target: msg.payload.target,
              transport,
            })
          : invalidSigningSessionSealTransport();
        postToMainThread({
          id: msg.id,
          ok: true,
          result,
        });
        return;
      }
      case 'rehydrateEmailOtpEcdsaWarmSessionMaterial': {
        const transport = parseSigningSessionSealTransport(msg.payload.transport);
        const result = transport
          ? await rehydrateEmailOtpEcdsaWarmSessionMaterial({
              target: msg.payload.target,
              sealedSecretB64u: readString(msg.payload.sealedSecretB64u, 'sealedSecretB64u'),
              remainingUses: Math.floor(Number(msg.payload.remainingUses) || 0),
              expiresAtMs: Math.floor(Number(msg.payload.expiresAtMs) || 0),
              transport,
              restore: msg.payload.restore,
            })
          : invalidSigningSessionSealTransport();
        postToMainThread({
          id: msg.id,
          ok: true,
          result,
        });
        return;
      }
      case 'rehydrateEmailOtpEd25519YaoOperationMaterial': {
        const result = await rehydrateEmailOtpEd25519YaoOperationMaterial(msg.payload);
        postToMainThread({ id: msg.id, ok: true, result });
        return;
      }
      case 'rehydrateActiveEmailOtpEd25519YaoSessionMaterial': {
        const result = await rehydrateActiveEmailOtpEd25519YaoSessionMaterial(msg.payload);
        postToMainThread({ id: msg.id, ok: true, result });
        return;
      }
      case 'activateEmailOtpEd25519YaoRegistrationMaterial': {
        const material = msg.payload.material;
        const bootstrap = msg.payload.bootstrap;
        const capability = bootstrap.capability;
        if (!emailOtpCustodyMaterialMatchesLane(material.binding, capability)) {
          throw new Error('Registration custody material changed the exact Ed25519 lane');
        }
        const factorSecret32 = new Uint8Array(msg.payload.factorSecret32);
        let activeClientHandle: string | null = null;
        try {
          const activeClient = await openWalletCustodyEd25519ActiveClientV1({
            material,
            activation: walletCustodyActivationFactsFromEmailOtpBootstrap(bootstrap),
            envelope: msg.payload.envelope,
            ownedFactorSecret: factorSecret32.slice(),
          });
          let transferred = false;
          try {
            const stored = storeEmailOtpEd25519YaoActiveClient(activeClient);
            transferred = true;
            activeClientHandle = stored.activeClientHandle;
            bindEmailOtpEd25519YaoCapabilityWarmFactor({
              bootstrap,
              factorSecret32,
              materialActivation: capability.materialActivation,
            });
            postToMainThread({ id: msg.id, ok: true, result: stored });
            activeClientHandle = null;
          } finally {
            if (!transferred) activeClient.dispose();
          }
        } finally {
          if (activeClientHandle) removeEmailOtpEd25519YaoActiveClient(activeClientHandle);
          zeroizeBytes(factorSecret32);
        }
        return;
      }
      case 'clearEmailOtpWarmSessionMaterial': {
        deleteEmailOtpWarmMaterial(msg.payload.target);
        postToMainThread({
          id: msg.id,
          ok: true,
          result: {
            ok: true,
            cleared: true,
          },
        });
        return;
      }
      case 'exportEmailOtpEd25519YaoSeed': {
        const capability = emailOtpEd25519YaoExportCapabilityV1(msg.payload.material);
        const exportOrgId = capability.runtimePolicyScope.orgId;
        const resolutionState: EmailOtpEd25519ExportCustodyResolutionState = {
          relayUrl: readString(msg.payload.relayUrl, 'relayUrl'),
          walletId: readString(msg.payload.lane.walletId, 'lane.walletId'),
          walletAuthMethodId: requireWorkerWalletAuthMethodId(msg.payload.lane.walletAuthMethodId),
          orgId: exportOrgId,
          providerSubjectId: readString(
            msg.payload.lane.providerSubjectId,
            'lane.providerSubjectId',
          ),
          material: msg.payload.material,
          activeClientHandle: null,
          warmFactorBound: false,
          rehydrated: null,
        };
        try {
          const artifact = await exportEmailOtpEd25519YaoSeed({
            relayUrl: resolutionState.relayUrl,
            walletId: resolutionState.walletId,
            providerSubjectId: resolutionState.providerSubjectId,
            walletAuthMethodId: msg.payload.lane.walletAuthMethodId,
            challengeId: msg.payload.challengeId,
            otpCode: msg.payload.otpCode,
            nearAccountId: msg.payload.lane.nearAccountId,
            nearEd25519SigningKeyId: msg.payload.lane.nearEd25519SigningKeyId,
            signerSlot: msg.payload.lane.signerSlot,
            runtimePolicyScope: capability.runtimePolicyScope,
            capability,
            resolveCustodyEnvelope: resolveEmailOtpEd25519ExportCustodyEnvelope.bind(
              undefined,
              resolutionState,
            ),
          });
          postToMainThread({
            id: msg.id,
            ok: true,
            result:
              msg.payload.material.kind === 'sealed_custody'
                ? {
                    kind: 'exported_and_rehydrated',
                    ...artifact,
                    activeClientHandle: resolutionState.rehydrated!.activeClientHandle,
                    metadata: resolutionState.rehydrated!.metadata,
                    bootstrap: msg.payload.material.bootstrap,
                  }
                : { kind: 'exported', ...artifact },
          });
          resolutionState.activeClientHandle = null;
          resolutionState.warmFactorBound = false;
        } finally {
          if (resolutionState.activeClientHandle) {
            removeEmailOtpEd25519YaoActiveClient(resolutionState.activeClientHandle);
            if (resolutionState.warmFactorBound) {
              deleteEmailOtpEd25519YaoWarmFactor(msg.payload.material.materialActivation);
            }
          }
        }
        return;
      }
      default:
        throw new Error('Unsupported emailOtp worker operation type');
    }
  } catch (error) {
    postToMainThread(workerErrorReply(msg.id, asWorkerErrorPayload(error)));
  }
}
