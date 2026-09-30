// The Device 2 linking flow: its QR session, target-factor activation, committed authority
// installation, and recovery when a committed delivery fails.
import type {
  DeviceLinkingSession,
  StartDevice2LinkingFlowArgs,
  StartDevice2LinkingFlowResults,
  LinkedDeviceTargetEmailOtpActivationV1,
  LinkedDeviceTargetPasskeyActivationV1,
} from '@/core/types/linkDevice';
import { DeviceLinkingError, DeviceLinkingErrorCode } from '@/core/types/linkDevice';
import {
  buildLinkedDeviceSessionCancelClaimedRequestV1,
  buildLinkedDeviceSessionCancelUnclaimedRequestV1,
  buildLinkedDeviceTargetCredentialRegistrationV1,
  assertNeverLinkSessionStateV1,
  serializeQrLinkedDeviceSessionPayloadV5,
} from '@shared/device-linking';
import { computeLinkedDeviceTargetPreparationDigestV1 } from '@shared/device-linking';
import {
  computeWalletSessionInstallationReceiptDigestB64u,
  computeWalletSessionOperationCredentialDigestB64u,
} from '@shared/device-linking/digests';
import type {
  LinkedDeviceTargetCredentialRegistrationResultV1,
  LinkSessionStateV1,
  LinkSessionTransportEventV1,
  LinkedDeviceTargetPreparationV1,
  LinkedDeviceEmailOtpChallengeResultV1,
  ActiveWalletSessionV1,
  CommittedAuthorityPackagesV1,
  QrLinkedDeviceSessionPayloadV5,
  LocalAuthorityActivationFinalAckV1,
  WalletSessionOperationCredentialV1,
} from '@shared/device-linking';
import type { WalletEmailOtpEnrollmentMaterialV1 } from '@shared/utils/registrationAuthMethodInput';
import { errorMessage } from '@shared/utils/errors';
import type {
  Device2LinkingFlowPortsV1,
  DeviceLinkingAuthenticatedTransportPortV1,
  DeviceLinkingKeyMaterialHandleV1,
  DeviceLinkingTargetCredentialPortV1,
  LinkSessionSubscriptionV1,
} from './deviceLinkingPorts';
import { LinkDeviceEventPhase, createLinkDeviceFlowEvent } from '@/core/types/sdkSentEvents';
import {
  acceptLinkedDeviceEd25519ExportRootV1,
  discardLinkedDeviceEd25519ExportRootRecipientV1,
  publishLinkedDeviceEd25519ExportRootRecipientV1,
} from './deviceLinkingTargetEd25519ExportRoot';
import {
  buildDeviceLinkingEd25519ExportRootReplacementEnvelopeV1,
  type DeviceLinkingEd25519ExportRootRecipientHandleV1,
} from './deviceLinkingEd25519ExportRoot';
import type { DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 } from './deviceLinkingOrdinaryMaterialWorker';
import { activateLinkedAuthorityV1 } from './deviceLinkingAuthorityInstallation';
import {
  buildEmailOtpEnvelopeFactor,
  buildMethodBoundEnvelopeOwnership,
  buildEd25519YaoClientRootBinding,
  buildPasskeyEnvelopeFactor,
} from '@shared/passkey-custody';
import type { PasskeyEnvelopeId } from '@shared/utils/domainIds';
import { activateLinkedDeviceSignerRuntimesAfterLink } from '../auth/login';
import {
  buildDevice2QrSessionPayloadV1,
  classifyLinkedDeviceDeliveryFailureV1,
  createFlowId,
  createLinkSessionId,
  type EmitLinkDeviceEventInput,
  errorForFailure,
  generateQrCodeDataUrlV1,
  type GetLinkedDeviceAuthenticationContext,
  LinkDeviceFlowSupersededError,
  linkedDeviceDeliveryRecoveryMessageV1,
  type LinkedDeviceDeliveryRecoveryReasonV1,
  linkedDeviceWalletAuthenticationState,
  logDevice2LinkingFailureV1,
  logDevice2LinkingStageV1,
  notifyError,
  phaseForState,
  waitForSessionStateRetry,
} from './linkDeviceFlowSupport';
import {
  assertNeverEmailOtpTargetActivationState,
  assertNeverTargetCredentialActivationState,
  type AwaitingTargetEmailOtpStateV1,
  type AwaitingTargetFactorStateV1,
  type AwaitingTargetPasskeyStateV1,
  createEmailOtpFactorSecretV1,
  createExportRootEnvelopeIdV1,
  emailOtpTargetActivationBaseContextV1,
  type EmailOtpTargetActivationBaseContextV1,
  type EmailOtpTargetActivationContextV1,
  type EmailOtpTargetActivationStateV1,
  isEmailOtpTargetPreparation,
  isPasskeyTargetPreparation,
  type PasskeyTargetPreparationV1,
  prepareNewEmailOtpEnrollmentMaterialV1,
  requireCompletedEmailOtpTargetActivationStateV1,
  requireEmailOtpTargetPreparationV1,
  requireNewEmailOtpEnrollmentMaterialV1,
  requireTargetRpIdV1,
  resolvePostLinkActivationV1,
  type TargetCredentialActivationState,
  zeroizeLiveBytes,
} from './linkDeviceTargetActivation';

export class LinkDeviceFlow {
  private readonly options: StartDevice2LinkingFlowArgs;
  private readonly ports: Device2LinkingFlowPortsV1;
  private readonly getAuthenticationContext: GetLinkedDeviceAuthenticationContext | null;
  private readonly flowId: string;
  private session: DeviceLinkingSession | null = null;
  private keyMaterialHandle: DeviceLinkingKeyMaterialHandleV1 | null = null;
  private deliveryRecipientPublicKey65B64u: string | null = null;
  private resealedExportRoot:
    | import('./deviceLinkingEd25519ExportRoot').DeviceLinkingResealedEd25519ExportRootV1
    | null = null;
  private targetCredentialRegistrationResult: LinkedDeviceTargetCredentialRegistrationResultV1 | null =
    null;
  // This boundary is the server commit. Cleanup and retry keep its exact identity intact.
  private committedAuthorityPackages: CommittedAuthorityPackagesV1 | null = null;
  private deliveryRecoveryReason: LinkedDeviceDeliveryRecoveryReasonV1 | null = null;
  private ordinarySignerMaterialRecipientPreparation: DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 | null =
    null;
  private authenticatedTransport: DeviceLinkingAuthenticatedTransportPortV1 | null = null;
  private subscription: LinkSessionSubscriptionV1 | null = null;
  private error?: Error;
  private cancelled = false;
  private runEpoch = 0;
  private generationInProgress = false;
  private discardInProgress: Promise<void> | null = null;
  private targetCredentialActivationState: TargetCredentialActivationState = { kind: 'idle' };
  private emailOtpTargetActivationState: EmailOtpTargetActivationStateV1 = { kind: 'idle' };
  private readonly handledStates = new Set<LinkSessionStateV1['state']>();
  private sessionEventQueue: Promise<void> = Promise.resolve();

  constructor(
    options: StartDevice2LinkingFlowArgs,
    ports: Device2LinkingFlowPortsV1,
    getAuthenticationContext: GetLinkedDeviceAuthenticationContext | null = null,
  ) {
    this.options = options;
    this.flowId = createFlowId();
    this.ports = ports;
    this.getAuthenticationContext = getAuthenticationContext;
  }

  async generateQR(): Promise<StartDevice2LinkingFlowResults> {
    if (
      this.generationInProgress ||
      this.keyMaterialHandle ||
      this.subscription ||
      (this.session && !this.cancelled)
    ) {
      throw new Error('Device-link QR flow is already running');
    }
    const runEpoch = this.startRun();
    const ports = this.ports;
    this.emit({
      phase: LinkDeviceEventPhase.STEP_01_QR_PREPARE_STARTED,
      status: 'started',
      message: 'Preparing device link',
      data: { role: 'display' },
      interaction: { kind: 'qr_display', overlay: 'show' },
    });

    try {
      const keyMaterial = await ports.keyMaterial.createBootstrapKeyMaterialV1();
      if (!this.isCurrentRun(runEpoch)) {
        this.keyMaterialHandle = keyMaterial.handle;
        await this.discardKeyMaterial();
        throw new LinkDeviceFlowSupersededError();
      }
      this.keyMaterialHandle = keyMaterial.handle;
      this.deliveryRecipientPublicKey65B64u = keyMaterial.deliveryRecipientPublicKey65B64u;
      const issuedAtMs = Date.now();
      const linkSessionId = createLinkSessionId();
      const qrData = buildDevice2QrSessionPayloadV1({
        linkSessionId,
        linkPublicKeyB64u: keyMaterial.linkPublicKeyB64u,
        devicePublicKeyB64u: keyMaterial.devicePublicKeyB64u,
        target: this.options,
        issuedAtMs,
        expiresAtMs: issuedAtMs + 15 * 60 * 1000,
      });
      const state: Extract<LinkSessionStateV1, { readonly state: 'displaying_qr' }> = {
        state: 'displaying_qr',
      };
      const authenticatedTransport = ports.transport.createAuthenticatedSessionTransportV1({
        keyMaterial: keyMaterial.handle,
        devicePublicKeyB64u: keyMaterial.devicePublicKeyB64u,
      });
      this.authenticatedTransport = authenticatedTransport;
      this.session = { linkSessionId, state, qrData };
      logDevice2LinkingStageV1({
        flowId: this.flowId,
        linkSessionId,
        stage: 'session_create_started',
      });
      await authenticatedTransport.createUnclaimedSessionV1({
        payload: qrData,
        state,
      });
      this.assertCurrentRun(runEpoch);
      const subscription = await authenticatedTransport.subscribeSessionV1({
        linkSessionId,
        onEvent: this.handleSessionTransportEvent.bind(this),
      });
      if (!this.isCurrentRun(runEpoch)) {
        await subscription.close();
        throw new LinkDeviceFlowSupersededError();
      }
      this.subscription = subscription;
      logDevice2LinkingStageV1({
        flowId: this.flowId,
        linkSessionId,
        stage: 'session_subscription_ready',
      });
      const qrCodeDataURL = await generateQrCodeDataUrlV1(
        serializeQrLinkedDeviceSessionPayloadV5(qrData),
      );
      this.assertCurrentRun(runEpoch);
      const result = { qrData, qrCodeDataURL } satisfies StartDevice2LinkingFlowResults;
      this.emit({
        phase: LinkDeviceEventPhase.STEP_01_QR_PREPARE_STARTED,
        status: 'succeeded',
        message: 'Device-link QR ready',
        data: { role: 'display' },
        interaction: { kind: 'qr_display', overlay: 'show' },
      });
      await this.options.options?.afterCall?.(true, result);
      return result;
    } catch (error: unknown) {
      try {
        await this.cleanupLocalResources();
      } catch {
        // The retained handle lets cancel/reset retry cleanup.
      }
      if (error instanceof LinkDeviceFlowSupersededError) throw error;
      this.session = null;
      this.authenticatedTransport = null;
      this.handledStates.clear();
      const failure = errorForFailure(error, 'generation');
      this.error = failure;
      this.emitFailure(failure, 'generation');
      notifyError(this.options.options?.onError, failure);
      await this.options.options?.afterCall?.(false, undefined, failure);
      throw failure;
    } finally {
      this.generationInProgress = false;
    }
  }

  getState(): {
    readonly phase: LinkDeviceEventPhase;
    readonly session: DeviceLinkingSession | null;
    readonly error?: Error;
    readonly cancelled: boolean;
  } {
    return {
      phase: this.session
        ? phaseForState(this.session.state)
        : LinkDeviceEventPhase.STEP_01_QR_PREPARE_STARTED,
      session: this.session,
      ...(this.error ? { error: this.error } : {}),
      cancelled: this.cancelled,
    };
  }

  async cancel(): Promise<void> {
    if (this.hasCommittedDeliveryState()) {
      throw new Error('Device-link authority delivery is committed and must be resumed');
    }
    if (this.cancelled) {
      await this.cleanupLocalResources();
      return;
    }
    this.cancelled = true;
    this.runEpoch += 1;
    const session = this.session;
    const keyMaterialHandle = this.keyMaterialHandle;
    const authenticatedTransport = this.authenticatedTransport;
    try {
      if (session && keyMaterialHandle && authenticatedTransport) {
        const now = Date.now();
        switch (session.state.state) {
          case 'displaying_qr':
            await authenticatedTransport.cancelSessionV1({
              request: buildLinkedDeviceSessionCancelUnclaimedRequestV1({
                linkSessionId: session.linkSessionId,
                requestedAtMs: now,
              }),
            });
            this.session = {
              ...session,
              state: { state: 'cancelled', cancelledAtMs: now },
            };
            break;
          case 'claimed':
          case 'awaiting_target_factor':
          case 'awaiting_source_contribution':
          case 'provisioning': {
            await this.cancelClaimedSessionV1(authenticatedTransport, session.linkSessionId, now);
            this.session = {
              ...session,
              state: { state: 'cancelled', cancelledAtMs: now },
            };
            break;
          }
          case 'authority_pending_local_install':
            break;
          case 'active':
          case 'expired':
          case 'cancelled':
          case 'failed_before_commit':
            break;
          default:
            assertNeverLinkSessionStateV1(session.state);
        }
      }
    } finally {
      await this.cleanupLocalResources();
    }
    this.emit({
      phase: LinkDeviceEventPhase.CANCELLED,
      status: 'cancelled',
      message: 'Device-link flow cancelled',
      interaction: { kind: 'qr_display', overlay: 'hide' },
    });
  }

  private async resolveLinkIdentityV1(
    linkSessionId: import('@shared/signing-lanes/ids').LinkDeviceSessionId,
  ): Promise<{
    readonly walletId: LinkedDeviceTargetPreparationV1['walletId'];
    readonly enrollmentId: LinkedDeviceTargetPreparationV1['enrollmentId'];
    readonly deviceId: LinkedDeviceTargetPreparationV1['deviceId'];
  }> {
    const cached = this.targetCredentialRegistrationResult;
    if (cached && cached.linkSessionId === linkSessionId) {
      return {
        walletId: cached.walletId,
        enrollmentId: cached.enrollmentId,
        deviceId: cached.deviceId,
      };
    }
    const preparation = await this.requireAuthenticatedTransport().getTargetPreparationV1({
      linkSessionId,
      deliveryRecipientPublicKey65B64u: this.requireDeliveryRecipientPublicKey65B64u(),
    });
    return {
      walletId: preparation.walletId,
      enrollmentId: preparation.enrollmentId,
      deviceId: preparation.deviceId,
    };
  }

  private async cancelClaimedSessionV1(
    transport: DeviceLinkingAuthenticatedTransportPortV1,
    linkSessionId: import('@shared/signing-lanes/ids').LinkDeviceSessionId,
    requestedAtMs: number,
  ): Promise<void> {
    const identity = await this.resolveLinkIdentityV1(linkSessionId);
    await transport.cancelSessionV1({
      request: buildLinkedDeviceSessionCancelClaimedRequestV1({
        linkSessionId,
        enrollmentId: identity.enrollmentId,
        deviceId: identity.deviceId,
        reason: 'user_cancelled',
        requestedAtMs,
      }),
    });
  }

  private async handleSessionEvent(event: LinkSessionTransportEventV1): Promise<void> {
    if (
      this.cancelled ||
      this.deliveryRecoveryReason !== null ||
      !this.session ||
      event.linkSessionId !== this.session.linkSessionId
    )
      return;
    logDevice2LinkingStageV1({
      flowId: this.flowId,
      linkSessionId: event.linkSessionId,
      stage: 'session_event_received',
      details: {
        state: event.state.state,
        emittedAtMs: event.emittedAtMs,
        runEpoch: this.runEpoch,
      },
    });
    const runEpoch = this.runEpoch;
    if (this.handledStates.has(event.state.state)) {
      /* A replayed event for an already-handled state must not regress the
         linear local session state, so the handled check precedes the write. */
      logDevice2LinkingStageV1({
        flowId: this.flowId,
        linkSessionId: event.linkSessionId,
        stage: 'session_event_already_handled',
        details: { state: event.state.state },
      });
      return;
    }
    this.session = { ...this.session, state: event.state };
    this.handledStates.add(event.state.state);
    switch (event.state.state) {
      case 'displaying_qr':
        return;
      case 'claimed':
        this.emit({
          phase: LinkDeviceEventPhase.STEP_02_QR_SCAN_STARTED,
          status: 'running',
          message: 'Device link claimed by owner',
          data: { role: 'display' },
          interaction: { kind: 'qr_display', overlay: 'show' },
        });
        return;
      case 'awaiting_target_factor':
        await this.prepareTargetCredentialActivation(event, runEpoch);
        return;
      case 'awaiting_source_contribution':
        return;
      case 'provisioning':
      case 'authority_pending_local_install': {
        const result = await this.activateAuthorityForStateV1(event.state, runEpoch);
        if (result.kind === 'pending_local_install') return;
        if (result.kind === 'integrity_error') {
          throw new DeviceLinkingError(
            `Linked-device authority installation failed: ${result.reason}`,
            DeviceLinkingErrorCode.REGISTRATION_FAILED,
            'registration',
          );
        }
        if (result.kind === 'failed_before_commit' || result.kind === 'relink_required') {
          throw new DeviceLinkingError(
            'Linked-device authority activation cannot continue',
            DeviceLinkingErrorCode.REGISTRATION_FAILED,
            'registration',
          );
        }
        await this.finishActiveAuthorityV1(
          event.state,
          result.session,
          result.operationCredential,
          runEpoch,
        );
        return;
      }
      case 'active':
        await this.replayCommittedAuthorityV1(event.state, runEpoch);
        return;
      case 'expired': {
        const error = new DeviceLinkingError(
          'Device-link session expired',
          DeviceLinkingErrorCode.SESSION_EXPIRED,
          'registration',
        );
        this.error = error;
        this.emitFailure(error, 'registration');
        notifyError(this.options.options?.onError, error);
        this.runEpoch += 1;
        await this.cleanupLocalResources();
        return;
      }
      case 'cancelled':
        this.cancelled = true;
        this.emit({
          phase: LinkDeviceEventPhase.CANCELLED,
          status: 'cancelled',
          message: 'The other device cancelled this linking request.',
          interaction: { kind: 'qr_display', overlay: 'show' },
        });
        this.runEpoch += 1;
        await this.cleanupLocalResources();
        return;
      case 'failed_before_commit':
        this.cancelled = true;
        this.runEpoch += 1;
        await this.cleanupLocalResources();
        return;
      default:
        return assertNeverLinkSessionStateV1(event.state);
    }
  }

  private async prepareTargetCredentialActivation(
    event: LinkSessionTransportEventV1,
    runEpoch: number,
  ): Promise<void> {
    if (event.state.state !== 'awaiting_target_factor') {
      throw new Error('target passkey activation requires an awaiting session');
    }
    const state = event.state;
    if (!this.keyMaterialHandle || !this.session)
      throw new Error('device-link key material is unavailable');
    const authenticatedTransport = this.requireAuthenticatedTransport();
    this.assertCurrentRun(runEpoch);
    const preparation = await authenticatedTransport.getTargetPreparationV1({
      linkSessionId: event.linkSessionId,
      deliveryRecipientPublicKey65B64u: this.requireDeliveryRecipientPublicKey65B64u(),
    });
    this.assertCurrentRun(runEpoch);
    this.assertTargetPreparationMatchesSession({
      preparation,
      state,
      linkSessionId: event.linkSessionId,
    });
    const deviceId = preparation.deviceId;
    this.ordinarySignerMaterialRecipientPreparation =
      await this.ports.keyMaterial.createOrdinarySignerMaterialRecipientRequestsV1({
        keyMaterial: this.keyMaterialHandle,
        requirements: preparation.ordinarySignerMaterialRecipientRequirements,
      });
    this.assertCurrentRun(runEpoch);
    if (this.requireSessionTargetFactorV1().kind === 'email_otp') {
      await this.prepareTargetEmailOtpActivation({
        event,
        state,
        runEpoch,
        deviceId,
        preparation,
      });
      return;
    }
    if (!isPasskeyTargetPreparation(preparation)) {
      throw new Error('Passkey session returned a non-Passkey target preparation');
    }
    const onTargetFactorRequired = this.options.options?.onTargetFactorRequired;
    if (!onTargetFactorRequired) {
      throw new DeviceLinkingError(
        'Confirm passkey creation on Device 2 to continue linking',
        DeviceLinkingErrorCode.UNSUPPORTED,
        'registration',
      );
    }
    const activation: LinkedDeviceTargetPasskeyActivationV1 = {
      kind: 'linked_device_target_passkey_activation_v1',
      createPasskey: this.activateTargetCredential.bind(this, {
        event,
        state,
        runEpoch,
        deviceId,
        preparation,
      }),
    };
    onTargetFactorRequired(activation);
  }

  private async prepareTargetEmailOtpActivation(input: {
    readonly event: LinkSessionTransportEventV1;
    readonly state: AwaitingTargetEmailOtpStateV1;
    readonly runEpoch: number;
    readonly deviceId: import('@shared/signing-lanes/ids').LinkedDeviceId;
    readonly preparation: LinkedDeviceTargetPreparationV1;
  }): Promise<void> {
    if (!isEmailOtpTargetPreparation(input.preparation)) {
      throw new Error('Email OTP session returned a non-Email OTP target preparation');
    }
    if (!this.keyMaterialHandle || !this.session || !this.deliveryRecipientPublicKey65B64u) {
      throw new Error('Email OTP target key material is unavailable');
    }
    if (!this.options.options?.onTargetFactorRequired) {
      throw new DeviceLinkingError(
        'Enter the Email OTP on Device 2 to continue linking',
        DeviceLinkingErrorCode.UNSUPPORTED,
        'registration',
      );
    }
    const authenticatedTransport = this.requireAuthenticatedTransport();
    const exportRoot = input.preparation.ed25519ExportRoot;
    const exportRootContext: EmailOtpTargetActivationBaseContextV1['exportRoot'] =
      exportRoot === null
        ? { kind: 'not_required' }
        : {
            kind: 'required',
            recipient: await publishLinkedDeviceEd25519ExportRootRecipientV1({
              ed25519ExportRoot: this.ports.ed25519ExportRoot,
              transport: authenticatedTransport,
              identity: {
                linkSessionId: input.event.linkSessionId,
                walletId: input.preparation.walletId,
                walletKeyId: exportRoot.walletKeyId,
                enrollmentId: input.preparation.enrollmentId,
                deviceId: input.deviceId,
                applicationBindingDigestB64u: exportRoot.applicationBindingDigestB64u,
                registeredPublicKeyB64u: exportRoot.registeredPublicKeyB64u,
                targetFactor: input.preparation.targetFactor,
                revocationEpoch: exportRoot.revocationEpoch,
              },
              registeredAtMs: Date.now(),
            }),
          };
    this.assertCurrentRun(input.runEpoch);
    const baseContext: EmailOtpTargetActivationBaseContextV1 = {
      event: input.event,
      state: input.state,
      runEpoch: input.runEpoch,
      deviceId: input.deviceId,
      preparation: input.preparation,
      ordinarySignerMaterialRecipientRequests:
        this.requireOrdinarySignerMaterialRecipientPreparationV1().recipientRequests,
      exportRoot: exportRootContext,
    };
    this.emailOtpTargetActivationState = { kind: 'available', context: baseContext };
    await this.startTargetEmailOtpChallengeV1(baseContext);
  }

  private notifyEmailOtpActivationV1(state: LinkedDeviceTargetEmailOtpActivationV1['state']): void {
    const onTargetFactorRequired = this.options.options?.onTargetFactorRequired;
    if (!onTargetFactorRequired) return;
    onTargetFactorRequired({
      kind: 'linked_device_target_email_otp_activation_v1',
      state,
      sendCode: this.sendTargetEmailOtpCodeV1.bind(this),
      submitCode: this.submitTargetEmailOtpCodeV1.bind(this),
      resendCode: this.resendTargetEmailOtpCodeV1.bind(this),
    });
  }

  private sendTargetEmailOtpCodeV1(): Promise<void> {
    const state = this.emailOtpTargetActivationState;
    switch (state.kind) {
      case 'available': {
        const promise = this.startTargetEmailOtpChallengeV1(state.context);
        this.emailOtpTargetActivationState = {
          kind: 'starting',
          context: state.context,
          promise,
        };
        return promise;
      }
      case 'starting':
        return state.promise;
      case 'resending':
        return state.promise;
      case 'awaiting_code':
      case 'submitting':
      case 'completed':
        return Promise.resolve();
      case 'failed':
        return Promise.reject(new Error(state.message));
      case 'idle':
        return Promise.reject(new Error('Email OTP activation is unavailable'));
      default:
        return assertNeverEmailOtpTargetActivationState(state);
    }
  }

  private async startTargetEmailOtpChallengeV1(
    context: EmailOtpTargetActivationBaseContextV1,
  ): Promise<void> {
    try {
      this.assertCurrentRun(context.runEpoch);
      const workerEphemeralPublicKey65B64u = this.deliveryRecipientPublicKey65B64u;
      if (!workerEphemeralPublicKey65B64u) {
        throw new Error('Email OTP factor-release recipient is unavailable');
      }
      const challenge = await this.requireAuthenticatedTransport().startTargetEmailOtpChallengeV1({
        request: {
          kind: 'linked_device_email_otp_challenge_start_request_v1',
          linkSessionId: context.event.linkSessionId,
          workerEphemeralPublicKey65B64u,
        },
      });
      this.assertCurrentRun(context.runEpoch);
      this.awaitTargetEmailOtpCodeV1(context, challenge);
    } catch (error: unknown) {
      if (this.isCurrentRun(context.runEpoch)) {
        this.emailOtpTargetActivationState = { kind: 'available', context };
        this.notifyEmailOtpActivationV1({
          kind: 'unavailable',
          message: errorMessage(error),
        });
      }
      throw error;
    }
  }

  private awaitTargetEmailOtpCodeV1(
    context: EmailOtpTargetActivationBaseContextV1,
    challenge: LinkedDeviceEmailOtpChallengeResultV1,
  ): void {
    this.emailOtpTargetActivationState = {
      kind: 'awaiting_code',
      context: { ...emailOtpTargetActivationBaseContextV1(context), challenge },
    };
    this.notifyEmailOtpActivationV1({
      kind: 'code_input',
      maskedEmailHint: challenge.maskedEmailHint,
      expiresAtMs: challenge.expiresAtMs,
      resendAvailableAtMs: challenge.resendAvailableAtMs,
    });
  }

  private resendTargetEmailOtpCodeV1(): Promise<void> {
    const state = this.emailOtpTargetActivationState;
    if (state.kind === 'resending') return state.promise;
    if (state.kind !== 'awaiting_code') {
      return Promise.reject(new Error('Email OTP challenge is not ready to resend'));
    }
    try {
      this.assertCurrentRun(state.context.runEpoch);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    const promise = this.runTargetEmailOtpResendV1(state.context);
    this.emailOtpTargetActivationState = {
      kind: 'resending',
      context: state.context,
      promise,
    };
    this.notifyEmailOtpActivationV1({
      kind: 'resending',
      maskedEmailHint: state.context.challenge.maskedEmailHint,
    });
    return promise;
  }

  private async runTargetEmailOtpResendV1(
    context: EmailOtpTargetActivationContextV1,
  ): Promise<void> {
    try {
      const challenge = await this.requireAuthenticatedTransport().resendTargetEmailOtpChallengeV1({
        request: {
          kind: 'linked_device_email_otp_challenge_resend_request_v1',
          linkSessionId: context.event.linkSessionId,
          challengeId: context.challenge.challengeId,
        },
      });
      this.assertCurrentRun(context.runEpoch);
      this.awaitTargetEmailOtpCodeV1(context, challenge);
    } catch (error: unknown) {
      if (this.isCurrentRun(context.runEpoch)) {
        const message = errorMessage(error) || 'Email OTP resend is unavailable';
        this.emailOtpTargetActivationState = {
          kind: 'available',
          context: emailOtpTargetActivationBaseContextV1(context),
        };
        this.notifyEmailOtpActivationV1({ kind: 'unavailable', message });
      }
      throw error;
    }
  }

  private submitTargetEmailOtpCodeV1(otpCode: string): Promise<void> {
    const state = this.emailOtpTargetActivationState;
    if (state.kind !== 'awaiting_code') {
      return Promise.reject(new Error('Email OTP challenge is not ready for verification'));
    }
    this.assertCurrentRun(state.context.runEpoch);
    const promise = this.completeTargetEmailOtpActivationV1(state.context, otpCode);
    this.emailOtpTargetActivationState = {
      kind: 'submitting',
      context: state.context,
      promise,
    };
    this.notifyEmailOtpActivationV1({
      kind: 'submitting',
      maskedEmailHint: state.context.challenge.maskedEmailHint,
      expiresAtMs: state.context.challenge.expiresAtMs,
      resendAvailableAtMs: state.context.challenge.resendAvailableAtMs,
    });
    return promise;
  }

  private async completeTargetEmailOtpActivationV1(
    context: EmailOtpTargetActivationContextV1,
    otpCode: string,
  ): Promise<void> {
    let verification: Awaited<
      ReturnType<DeviceLinkingAuthenticatedTransportPortV1['verifyTargetEmailOtpChallengeV1']>
    >;
    try {
      verification = await this.requireAuthenticatedTransport().verifyTargetEmailOtpChallengeV1({
        request: {
          kind: 'linked_device_email_otp_challenge_verify_request_v1',
          linkSessionId: context.event.linkSessionId,
          challengeId: context.challenge.challengeId,
          otpCode,
        },
      });
    } catch (error: unknown) {
      if (this.isCurrentRun(context.runEpoch)) {
        this.emailOtpTargetActivationState = { kind: 'awaiting_code', context };
        if (Date.now() >= context.challenge.expiresAtMs) {
          this.notifyEmailOtpActivationV1({
            kind: 'expired',
            maskedEmailHint: context.challenge.maskedEmailHint,
            message: errorMessage(error),
          });
        } else {
          this.notifyEmailOtpActivationV1({
            kind: 'incorrect',
            maskedEmailHint: context.challenge.maskedEmailHint,
            expiresAtMs: context.challenge.expiresAtMs,
            resendAvailableAtMs: context.challenge.resendAvailableAtMs,
            message: errorMessage(error),
          });
        }
      }
      throw error;
    }
    this.assertCurrentRun(context.runEpoch);
    const preparation = requireEmailOtpTargetPreparationV1(context.preparation);
    let recipient = context.exportRoot.kind === 'required' ? context.exportRoot.recipient : null;
    let factorSecret: ArrayBuffer | null = null;
    let retainedFactorSecret: Uint8Array | null = null;
    let verificationGrant:
      | Awaited<
          ReturnType<DeviceLinkingAuthenticatedTransportPortV1['verifyTargetEmailOtpChallengeV1']>
        >['verificationGrant']
      | null = null;
    let emailOtpEnrollmentId: string | null = null;
    let emailOtpEnrollmentSealKeyVersion: string | null = null;
    let emailOtpEnrollmentMaterial: WalletEmailOtpEnrollmentMaterialV1 | null = null;
    const existingEnrollment = preparation.enrollment.kind === 'existing_enrollment';
    try {
      const targetPreparationDigestB64u =
        await computeLinkedDeviceTargetPreparationDigestV1(preparation);
      if (verification.verificationGrant.targetEmail !== preparation.targetEmail) {
        throw new Error('linked-device Email OTP verification target email changed');
      }
      if (existingEnrollment) {
        const existingVerificationGrant = verification.verificationGrant;
        if (existingVerificationGrant.enrollment.kind !== 'existing_enrollment') {
          throw new Error('linked-device Email OTP verification enrollment changed');
        }
        const baseWalletAuthMethodId = existingVerificationGrant.baseWalletAuthMethodId;
        if (!baseWalletAuthMethodId) {
          throw new Error('linked-device Email OTP base auth method is unavailable');
        }
        const factorRelease = verification.factorRelease;
        if (!factorRelease) {
          throw new Error('linked-device Email OTP factor release is unavailable');
        }
        const opened = await this.ports.keyMaterial.openEmailOtpFactorReleaseV1({
          keyMaterial: this.requireKeyMaterialHandleV1(),
          walletId: preparation.walletId,
          linkSessionId: preparation.linkSessionId,
          enrollmentId: preparation.enrollmentId,
          deviceId: preparation.deviceId,
          walletAuthMethodId: preparation.walletAuthMethodId,
          baseWalletAuthMethodId,
          targetPreparationDigestB64u,
          expectedChallengeId: context.challenge.challengeId,
          verificationGrant: existingVerificationGrant,
          factorRelease,
        });
        factorSecret = opened.factorSecret;
        verificationGrant = opened.verificationGrant;
        emailOtpEnrollmentId = factorRelease.enrollmentId;
        emailOtpEnrollmentSealKeyVersion = factorRelease.enrollmentSealKeyVersion;
      } else {
        const newVerificationGrant = verification.verificationGrant;
        if (newVerificationGrant.enrollment.kind !== 'new_enrollment') {
          throw new Error('linked-device Email OTP verification enrollment changed');
        }
        if (verification.factorRelease !== null) {
          throw new Error('new linked-device Email OTP enrollment returned a factor release');
        }
        const authenticationContext = this.getAuthenticationContext?.();
        if (!authenticationContext) {
          throw new Error('linked-device authentication context is unavailable');
        }
        const freshFactorSecret = createEmailOtpFactorSecretV1();
        factorSecret = freshFactorSecret.buffer;
        const enrollment = await prepareNewEmailOtpEnrollmentMaterialV1({
          context: authenticationContext,
          walletId: preparation.walletId,
          targetEmail: preparation.targetEmail,
          factorSecret: freshFactorSecret,
        });
        emailOtpEnrollmentId = enrollment.enrollmentId;
        emailOtpEnrollmentSealKeyVersion = enrollment.enrollment.enrollmentSealKeyVersion;
        emailOtpEnrollmentMaterial = enrollment.enrollment;
        verificationGrant = newVerificationGrant;
      }
      if (
        !factorSecret ||
        !verificationGrant ||
        !emailOtpEnrollmentId ||
        !emailOtpEnrollmentSealKeyVersion
      ) {
        throw new Error('linked-device Email OTP factor material is unavailable');
      }
      this.assertCurrentRun(context.runEpoch);
      if (context.exportRoot.kind === 'required') {
        if (!recipient) {
          throw new Error('linked-device Ed25519 export-root recipient is unavailable');
        }
        const exportRoot = preparation.ed25519ExportRoot;
        if (!exportRoot) {
          throw new Error('linked-device Ed25519 export-root preparation is unavailable');
        }
        const envelopeId = createExportRootEnvelopeIdV1();
        const factor = buildEmailOtpEnvelopeFactor({
          enrollmentId: emailOtpEnrollmentId,
          enrollmentSealKeyVersion: emailOtpEnrollmentSealKeyVersion,
        });
        const resealed = await this.acceptTargetExportRootV1({
          preparation,
          exportRoot,
          recipient,
          envelopeId,
          factor,
          replacementFactorSecret: new Uint8Array(factorSecret),
          runEpoch: context.runEpoch,
        });
        this.resealedExportRoot = resealed;
        recipient = null;
      }
      const registration = existingEnrollment
        ? buildLinkedDeviceTargetCredentialRegistrationV1({
            linkSessionId: preparation.linkSessionId,
            walletId: preparation.walletId,
            enrollmentId: preparation.enrollmentId,
            deviceId: preparation.deviceId,
            walletAuthMethodId: preparation.walletAuthMethodId,
            targetFactor: { kind: 'email_otp' },
            targetEmail: preparation.targetEmail,
            emailOtpVerificationGrant: verificationGrant,
            targetPreparationDigestB64u,
            ordinarySignerMaterialRecipientRequests:
              context.ordinarySignerMaterialRecipientRequests,
            registeredAtMs: Date.now(),
          })
        : buildLinkedDeviceTargetCredentialRegistrationV1({
            linkSessionId: preparation.linkSessionId,
            walletId: preparation.walletId,
            enrollmentId: preparation.enrollmentId,
            deviceId: preparation.deviceId,
            walletAuthMethodId: preparation.walletAuthMethodId,
            targetFactor: { kind: 'email_otp' },
            targetEmail: preparation.targetEmail,
            emailOtpVerificationGrant: verificationGrant,
            emailOtpEnrollment: requireNewEmailOtpEnrollmentMaterialV1(emailOtpEnrollmentMaterial),
            targetPreparationDigestB64u,
            ordinarySignerMaterialRecipientRequests:
              context.ordinarySignerMaterialRecipientRequests,
            registeredAtMs: Date.now(),
          });
      const registrationResult =
        await this.requireAuthenticatedTransport().registerTargetCredentialV1({ registration });
      this.assertCurrentRun(context.runEpoch);
      this.targetCredentialRegistrationResult = registrationResult;
      retainedFactorSecret = new Uint8Array(factorSecret).slice();
      await this.ports.keyMaterial.prepareOrdinarySignerMaterialV1({
        keyMaterial: this.requireKeyMaterialHandleV1(),
        targetFactor: registrationResult.targetFactor,
        preparations: registrationResult.ordinarySignerMaterialPreparations,
        recipientRequests: registrationResult.ordinarySignerMaterialRecipientRequests,
        recipientInputs: this.requireOrdinarySignerMaterialRecipientPreparationV1().recipientInputs,
        factorSecret,
      });
      factorSecret = null;
      this.assertCurrentRun(context.runEpoch);
      logDevice2LinkingStageV1({
        flowId: this.flowId,
        linkSessionId: context.preparation.linkSessionId,
        stage: 'ordinary_signer_material_prepared',
      });
      if (!retainedFactorSecret) {
        throw new Error('linked-device Email OTP factor runtime is unavailable');
      }
      this.emailOtpTargetActivationState = {
        kind: 'completed',
        runEpoch: context.runEpoch,
        enrollment: existingEnrollment
          ? { kind: 'existing_enrollment' }
          : { kind: 'new_enrollment' },
        factorSecret: retainedFactorSecret,
        providerUserId: verificationGrant.providerUserId,
      };
      retainedFactorSecret = null;
      this.notifyEmailOtpActivationV1({
        kind: 'completed',
        maskedEmailHint: context.challenge.maskedEmailHint,
      });
    } catch (error: unknown) {
      if (factorSecret && factorSecret.byteLength > 0) {
        new Uint8Array(factorSecret).fill(0);
      }
      retainedFactorSecret?.fill(0);
      if (recipient) {
        await discardLinkedDeviceEd25519ExportRootRecipientV1(
          this.ports.ed25519ExportRoot,
          recipient,
        );
      }
      if (this.isCurrentRun(context.runEpoch)) {
        const message = errorMessage(error) || 'Email OTP activation is unavailable';
        this.emailOtpTargetActivationState = {
          kind: 'failed',
          runEpoch: context.runEpoch,
          message,
        };
        this.notifyEmailOtpActivationV1({ kind: 'unavailable', message });
        await this.cancelFailedPrecommitSession(context.event).catch(() => undefined);
      }
      throw error;
    }
  }

  private activateTargetCredential(input: {
    readonly event: LinkSessionTransportEventV1;
    readonly state: AwaitingTargetPasskeyStateV1;
    readonly runEpoch: number;
    readonly deviceId: import('@shared/signing-lanes/ids').LinkedDeviceId;
    readonly preparation: PasskeyTargetPreparationV1;
  }): Promise<void> {
    if (!this.isCurrentRun(input.runEpoch)) {
      return Promise.reject(new LinkDeviceFlowSupersededError());
    }
    switch (this.targetCredentialActivationState.kind) {
      case 'idle':
        break;
      case 'in_progress':
        if (this.targetCredentialActivationState.runEpoch === input.runEpoch) {
          return this.targetCredentialActivationState.promise;
        }
        return Promise.reject(new LinkDeviceFlowSupersededError());
      case 'factor_ready':
        if (this.targetCredentialActivationState.runEpoch === input.runEpoch) {
          return Promise.reject(
            new Error('Device-link target passkey activation has already completed'),
          );
        }
        return Promise.reject(new LinkDeviceFlowSupersededError());
      default:
        return assertNeverTargetCredentialActivationState(this.targetCredentialActivationState);
    }
    const activation = this.runTargetCredentialActivation(input);
    this.targetCredentialActivationState = {
      kind: 'in_progress',
      runEpoch: input.runEpoch,
      promise: activation,
    };
    return activation;
  }

  private async runTargetCredentialActivation(input: {
    readonly event: LinkSessionTransportEventV1;
    readonly state: AwaitingTargetPasskeyStateV1;
    readonly runEpoch: number;
    readonly deviceId: import('@shared/signing-lanes/ids').LinkedDeviceId;
    readonly preparation: PasskeyTargetPreparationV1;
  }): Promise<void> {
    try {
      const factorSecret = await this.createTargetCredential(input);
      const state = this.targetCredentialActivationState;
      if (
        !this.isCurrentRun(input.runEpoch) ||
        state.kind !== 'in_progress' ||
        state.runEpoch !== input.runEpoch
      ) {
        zeroizeLiveBytes(factorSecret);
        throw new LinkDeviceFlowSupersededError();
      }
      this.targetCredentialActivationState = {
        kind: 'factor_ready',
        runEpoch: input.runEpoch,
        factorSecret,
      };
    } catch (error: unknown) {
      if (this.isCurrentRun(input.runEpoch)) {
        await this.handleSessionTransportFailure(input.event, error);
      }
      throw error;
    } finally {
      const state = this.targetCredentialActivationState;
      if (state.kind === 'in_progress' && state.runEpoch === input.runEpoch) {
        this.targetCredentialActivationState = { kind: 'idle' };
      }
    }
  }

  private async waitForTargetCredentialActivation(): Promise<void> {
    const targetFactor = this.requireSessionTargetFactorV1();
    switch (targetFactor.kind) {
      case 'passkey_prf': {
        const state = this.targetCredentialActivationState;
        if (state.kind === 'in_progress') await state.promise;
        if (this.targetCredentialActivationState.kind !== 'factor_ready') {
          throw new Error('linked-device target Passkey activation is incomplete');
        }
        return;
      }
      case 'email_otp': {
        const state = this.emailOtpTargetActivationState;
        if (state.kind === 'submitting') await state.promise;
        if (this.emailOtpTargetActivationState.kind !== 'completed') {
          throw new Error('linked-device target Email OTP activation is incomplete');
        }
        return;
      }
      default:
        targetFactor satisfies never;
        throw new Error('linked-device target factor is unsupported');
    }
  }

  private clearTargetCredentialActivationState(): void {
    const state = this.targetCredentialActivationState;
    if (state.kind === 'factor_ready') {
      zeroizeLiveBytes(state.factorSecret);
    }
    this.targetCredentialActivationState = { kind: 'idle' };
  }

  private async createTargetCredential(input: {
    readonly state: AwaitingTargetPasskeyStateV1;
    readonly runEpoch: number;
    readonly deviceId: import('@shared/signing-lanes/ids').LinkedDeviceId;
    readonly preparation: PasskeyTargetPreparationV1;
  }): Promise<Uint8Array> {
    const { runEpoch, deviceId, preparation } = input;
    if (!this.keyMaterialHandle || !this.session)
      throw new Error('device-link key material is unavailable');
    const authenticatedTransport = this.requireAuthenticatedTransport();
    logDevice2LinkingStageV1({
      flowId: this.flowId,
      linkSessionId: preparation.linkSessionId,
      stage: 'target_passkey_prompt_started',
    });
    const exportRoot = preparation.ed25519ExportRoot;
    // Started, not awaited. Device 1 can seal the export root as soon as
    // a recipient exists, and the owner is already waiting there, so publishing
    // one now lets that seal happen while this device's user is still at the
    // passkey prompt. Awaiting it here would spend the click's transient user
    // activation on a worker call and a POST before WebAuthn ever sees it.
    const recipientPublish =
      exportRoot === null
        ? Promise.resolve<DeviceLinkingEd25519ExportRootRecipientHandleV1 | null>(null)
        : publishLinkedDeviceEd25519ExportRootRecipientV1({
            ed25519ExportRoot: this.ports.ed25519ExportRoot,
            transport: authenticatedTransport,
            identity: {
              linkSessionId: preparation.linkSessionId,
              walletId: preparation.walletId,
              walletKeyId: exportRoot.walletKeyId,
              enrollmentId: preparation.enrollmentId,
              deviceId,
              applicationBindingDigestB64u: exportRoot.applicationBindingDigestB64u,
              registeredPublicKeyB64u: exportRoot.registeredPublicKeyB64u,
              targetFactor: preparation.targetFactor,
              revocationEpoch: exportRoot.revocationEpoch,
            },
            registeredAtMs: Date.now(),
          });
    // Nothing awaits it until after the prompt; this keeps an early rejection
    // from being reported as unhandled. It is re-raised at the await below.
    recipientPublish.catch(() => undefined);
    let credential: Awaited<
      ReturnType<DeviceLinkingTargetCredentialPortV1['createTargetCredentialV1']>
    > | null = null;
    let recipient: DeviceLinkingEd25519ExportRootRecipientHandleV1 | null = null;
    try {
      // This is the first operation after the UI click so WebAuthn receives transient user activation.
      credential = await this.ports.targetCredential.createTargetCredentialV1({
        preparation,
        keyMaterial: this.keyMaterialHandle,
      });
      if (credential.walletAuthMethodId !== preparation.walletAuthMethodId) {
        throw new Error('linked-device target credential returned a different auth method');
      }
      logDevice2LinkingStageV1({
        flowId: this.flowId,
        linkSessionId: preparation.linkSessionId,
        stage: 'target_passkey_created',
      });
      this.emit({
        phase: LinkDeviceEventPhase.STEP_02_QR_SCAN_STARTED,
        status: 'running',
        message: 'Finishing linked-device setup',
        data: { role: 'display' },
        interaction: { kind: 'qr_display', overlay: 'show' },
      });
      recipient = await recipientPublish;
      if (recipient) {
        logDevice2LinkingStageV1({
          flowId: this.flowId,
          linkSessionId: preparation.linkSessionId,
          stage: 'export_root_recipient_published',
        });
      }
      this.assertCurrentRun(runEpoch);
      if (exportRoot !== null) {
        if (!recipient) {
          throw new Error('linked-device Ed25519 export-root recipient is unavailable');
        }
        const envelopeId = createExportRootEnvelopeIdV1();
        const factor = buildPasskeyEnvelopeFactor({
          rpId: requireTargetRpIdV1(preparation),
          credentialIdB64u: credential.webauthnRegistration.credentialIdB64u,
        });
        const resealed = await this.acceptTargetExportRootV1({
          preparation,
          exportRoot,
          recipient,
          envelopeId,
          factor,
          replacementFactorSecret: credential.factorSecret,
          runEpoch,
        });
        logDevice2LinkingStageV1({
          flowId: this.flowId,
          linkSessionId: preparation.linkSessionId,
          stage: 'export_root_accepted',
        });
        this.resealedExportRoot = resealed;
        // The worker consumes and frees the recipient during every accept attempt.
        recipient = null;
      }
      this.assertCurrentRun(runEpoch);
      const targetPreparationDigestB64u =
        await computeLinkedDeviceTargetPreparationDigestV1(preparation);
      const registration = buildLinkedDeviceTargetCredentialRegistrationV1({
        linkSessionId: preparation.linkSessionId,
        walletId: preparation.walletId,
        enrollmentId: preparation.enrollmentId,
        deviceId: preparation.deviceId,
        walletAuthMethodId: credential.walletAuthMethodId,
        targetFactor: { kind: 'passkey_prf' },
        targetPreparationDigestB64u,
        webauthnRegistration: credential.webauthnRegistration,
        ordinarySignerMaterialRecipientRequests:
          this.requireOrdinarySignerMaterialRecipientPreparationV1().recipientRequests,
        registeredAtMs: Date.now(),
      });
      const registrationResult = await authenticatedTransport.registerTargetCredentialV1({
        registration,
      });
      this.assertCurrentRun(runEpoch);
      this.targetCredentialRegistrationResult = registrationResult;
      await this.ports.keyMaterial.prepareOrdinarySignerMaterialV1({
        keyMaterial: this.requireKeyMaterialHandleV1(),
        targetFactor: registrationResult.targetFactor,
        preparations: registrationResult.ordinarySignerMaterialPreparations,
        recipientRequests: registrationResult.ordinarySignerMaterialRecipientRequests,
        recipientInputs: this.requireOrdinarySignerMaterialRecipientPreparationV1().recipientInputs,
        factorSecret: credential.factorSecret.slice().buffer,
      });
      this.assertCurrentRun(runEpoch);
      logDevice2LinkingStageV1({
        flowId: this.flowId,
        linkSessionId: preparation.linkSessionId,
        stage: 'ordinary_signer_material_prepared',
      });
      return credential.factorSecret;
    } catch (error: unknown) {
      if (credential) zeroizeLiveBytes(credential.factorSecret);
      // If WebAuthn rejected before returning a credential, the publication
      // still owns a worker recipient. Await it so that cancellation cannot
      // strand that handle after this method exits.
      if (!recipient) {
        try {
          recipient = await recipientPublish;
        } catch {
          // Publication failure already discards its own worker recipient.
        }
      }
      // A recipient nobody will seal to is a live private key in the worker.
      if (recipient) {
        await discardLinkedDeviceEd25519ExportRootRecipientV1(
          this.ports.ed25519ExportRoot,
          recipient,
        );
      }
      throw error;
    }
  }

  // The target factor's new envelope replaces the export root Device 1 sealed to this device.
  private async acceptTargetExportRootV1(input: {
    readonly preparation: LinkedDeviceTargetPreparationV1;
    readonly exportRoot: NonNullable<LinkedDeviceTargetPreparationV1['ed25519ExportRoot']>;
    readonly recipient: DeviceLinkingEd25519ExportRootRecipientHandleV1;
    readonly envelopeId: PasskeyEnvelopeId;
    readonly factor: Parameters<
      typeof buildDeviceLinkingEd25519ExportRootReplacementEnvelopeV1
    >[0]['factor'];
    readonly replacementFactorSecret: Uint8Array;
    readonly runEpoch: number;
  }): ReturnType<typeof acceptLinkedDeviceEd25519ExportRootV1> {
    const { preparation, exportRoot } = input;
    const binding = buildEd25519YaoClientRootBinding({
      linkSessionId: preparation.linkSessionId,
      walletKeyId: exportRoot.walletKeyId,
      targetFactor: preparation.targetFactor,
      applicationBindingDigestB64u: exportRoot.applicationBindingDigestB64u,
      registeredPublicKeyB64u: exportRoot.registeredPublicKeyB64u,
      enrollmentId: preparation.enrollmentId,
      deviceId: preparation.deviceId,
      revocationEpoch: exportRoot.revocationEpoch,
    });
    return await acceptLinkedDeviceEd25519ExportRootV1({
      ed25519ExportRoot: this.ports.ed25519ExportRoot,
      transport: this.requireAuthenticatedTransport(),
      recipient: input.recipient,
      replacementEnvelope: buildDeviceLinkingEd25519ExportRootReplacementEnvelopeV1({
        walletId: preparation.walletId,
        ownership: buildMethodBoundEnvelopeOwnership(preparation.walletAuthMethodId),
        envelopeId: input.envelopeId,
        factor: input.factor,
        binding,
        createdAtMs: Date.now(),
      }),
      replacementFactorSecret: input.replacementFactorSecret,
      expiresAtMs: Math.min(preparation.expiresAtMs, this.requireSessionV1().qrData.expiresAtMs),
      assertCurrentRun: () => this.assertCurrentRun(input.runEpoch),
      waitForPollV1: waitForSessionStateRetry,
    });
  }

  private assertTargetPreparationMatchesSession(input: {
    readonly preparation: import('@shared/device-linking').LinkedDeviceTargetPreparationV1;
    readonly state: AwaitingTargetFactorStateV1;
    readonly linkSessionId: import('@shared/signing-lanes/ids').LinkDeviceSessionId;
  }): void {
    const sessionTargetFactor = this.requireSessionTargetFactorV1();
    const qrData = this.requireSessionV1().qrData;
    if (
      input.preparation.linkSessionId !== input.linkSessionId ||
      String(input.preparation.deviceId) !== String(input.state.deviceId) ||
      input.preparation.targetFactor.kind !== sessionTargetFactor.kind ||
      input.preparation.deliveryRecipientPublicKey65B64u !==
        this.requireDeliveryRecipientPublicKey65B64u() ||
      input.preparation.expiresAtMs <= Date.now()
    ) {
      throw new Error('linked-device target preparation does not match the claimed session');
    }
    if (
      sessionTargetFactor.kind === 'email_otp' &&
      qrData.targetFactor.kind === 'email_otp' &&
      input.preparation.targetFactor.kind === 'email_otp' &&
      input.preparation.targetEmail !== qrData.targetEmail
    ) {
      throw new Error('linked-device target preparation email does not match the QR session');
    }
  }

  private async activateAuthorityForStateV1(
    state: Extract<
      LinkSessionStateV1,
      { readonly state: 'provisioning' | 'authority_pending_local_install' | 'active' }
    >,
    runEpoch: number,
  ): Promise<Awaited<ReturnType<typeof activateLinkedAuthorityV1>>> {
    this.assertCurrentRun(runEpoch);
    await this.waitForTargetCredentialActivation();
    this.assertCurrentRun(runEpoch);
    const registration = this.targetCredentialRegistrationResult;
    if (!registration) {
      throw new Error('linked-device target credential registration is unavailable');
    }
    const keyMaterial = this.requireKeyMaterialHandleV1();
    const transport = this.requireAuthenticatedTransport();
    const expectedLockGeneration = await this.ports.readExpectedLockGenerationV1(
      registration.walletId,
    );
    this.assertCurrentRun(runEpoch);
    const committed =
      this.committedAuthorityPackages ||
      (await transport.receiveCommittedAuthorityPackagesV1({
        linkSessionId: this.requireSessionV1().linkSessionId,
      }));
    this.committedAuthorityPackages = committed;
    await this.ports.authorityInstallation.persistCommittedDeliveryResumeV1({
      linkSessionId: this.requireSessionV1().linkSessionId,
      committed,
      targetFactor: registration.targetFactor,
      committedAtMs: Date.now(),
    });
    this.assertCurrentRun(runEpoch);
    const activationDeadlineMs = this.requireSessionV1().qrData.expiresAtMs;
    let attempt = 0;
    while (Date.now() < activationDeadlineMs) {
      const result = await activateLinkedAuthorityV1({
        transport,
        committed,
        installation: this.ports.authorityInstallation,
        sessionState: state,
        linkSessionId: this.requireSessionV1().linkSessionId,
        targetFactor: registration.targetFactor,
        keyMaterialPort: this.ports.keyMaterial,
        keyMaterial,
        deliveryRecipientPublicKey65B64u: this.requireDeliveryRecipientPublicKey65B64u(),
        resealedExportRoot: this.resealedExportRoot,
        expectedLockGeneration,
        nowMs: () => Date.now(),
      });
      if (result.kind !== 'pending_local_install') return result;
      await waitForSessionStateRetry(attempt);
      this.assertCurrentRun(runEpoch);
      attempt += 1;
    }
    throw new DeviceLinkingError(
      'Linked-device authority activation did not complete before the link session expired',
      DeviceLinkingErrorCode.REGISTRATION_FAILED,
      'registration',
    );
  }

  private async finishActiveAuthorityV1(
    state: Extract<
      LinkSessionStateV1,
      { readonly state: 'provisioning' | 'authority_pending_local_install' | 'active' }
    >,
    walletSession: ActiveWalletSessionV1,
    operationCredential: WalletSessionOperationCredentialV1,
    runEpoch: number,
  ): Promise<void> {
    this.assertCurrentRun(runEpoch);
    const session = this.requireSessionV1();
    const registration = this.targetCredentialRegistrationResult;
    if (!registration || registration.walletId !== walletSession.walletId) {
      throw new Error('linked-device activation identity is unavailable');
    }
    const activeSession: DeviceLinkingSession = {
      ...session,
      state: {
        state: 'active',
        deviceId: state.deviceId,
        authorityId: walletSession.authorityId,
        activatedAtMs: walletSession.issuedAtMs,
      },
    };
    /* Activation can complete from any delivery-state event; the transport may
       still deliver the remaining queued transitions afterwards. Those events
       must acknowledge the finished activation instead of re-entering it
       against the consumed one-shot factor state. */
    this.handledStates.add('provisioning');
    this.handledStates.add('authority_pending_local_install');
    this.handledStates.add('active');
    const authenticationContext = this.getAuthenticationContext?.();
    if (!authenticationContext) {
      throw new Error('linked-device authentication context is unavailable');
    }
    const postLinkActivation = resolvePostLinkActivationV1({
      targetFactor: registration.targetFactor,
      walletAuthMethodId: registration.walletAuthMethodId,
      targetCredentialActivationState: this.targetCredentialActivationState,
      emailOtpTargetActivationState: this.emailOtpTargetActivationState,
      walletId: walletSession.walletId,
      runEpoch,
    });
    await activateLinkedDeviceSignerRuntimesAfterLink({
      context: authenticationContext,
      factor: postLinkActivation.factor,
      walletSession,
      operationCredential,
      factorSecret32: postLinkActivation.factorSecret32,
    });
    const committed = this.committedAuthorityPackages;
    if (!committed) {
      throw new Error(
        'linked-device committed authority packages are unavailable for acknowledgement',
      );
    }
    const installationReceipt =
      await this.ports.authorityInstallation.readLocalAuthorityInstallationReceiptV1({
        authorityId: walletSession.authorityId,
      });
    if (!installationReceipt) {
      throw new Error('linked-device installation receipt is unavailable for acknowledgement');
    }
    const acknowledgement: LocalAuthorityActivationFinalAckV1 = {
      kind: 'local_authority_activation_final_ack_v1',
      linkSessionId: session.qrData.linkSessionId,
      authorityId: walletSession.authorityId,
      packageSetDigestB64u: committed.packageSetDigestB64u,
      authorizationId: walletSession.authorizationId,
      walletSessionId: operationCredential.walletSessionId,
      credentialDigestB64u:
        await computeWalletSessionOperationCredentialDigestB64u(operationCredential),
      installationReceiptDigestB64u:
        await computeWalletSessionInstallationReceiptDigestB64u(installationReceipt),
      acknowledgedAtMs: Date.now(),
    };
    await this.ports.authorityInstallation.persistPendingActivationAcknowledgementV1({
      acknowledgement,
    });
    await this.sendActivationAcknowledgementV1(acknowledgement);
    this.session = activeSession;
    authenticationContext.signingEngine.setWalletAuthenticated(
      linkedDeviceWalletAuthenticationState(walletSession, registration),
    );
    await this.cleanupCompletedLocalResources();
    logDevice2LinkingStageV1({
      flowId: this.flowId,
      linkSessionId: session.qrData.linkSessionId,
      stage: 'post_link_runtime_ready',
    });
    this.emit({
      phase: LinkDeviceEventPhase.STEP_02_QR_SCAN_STARTED,
      status: 'succeeded',
      message: 'Device link active',
      walletId: String(walletSession.walletId),
      data: {
        role: 'display',
        enrollmentId: String(registration.enrollmentId),
      },
      interaction: { kind: 'qr_display', overlay: 'hide' },
    });
  }

  private requireAuthenticatedTransport(): DeviceLinkingAuthenticatedTransportPortV1 {
    if (!this.authenticatedTransport) {
      throw new DeviceLinkingError(
        'Authenticated link-session transport is unavailable',
        DeviceLinkingErrorCode.UNSUPPORTED,
        'registration',
      );
    }
    return this.authenticatedTransport;
  }

  private requireSessionTargetFactorV1(): QrLinkedDeviceSessionPayloadV5['targetFactor'] {
    if (!this.session) throw new Error('device-link session is unavailable');
    return this.session.qrData.targetFactor;
  }

  private requireSessionV1(): DeviceLinkingSession {
    if (!this.session) throw new Error('device-link session is unavailable');
    return this.session;
  }

  private requireKeyMaterialHandleV1(): DeviceLinkingKeyMaterialHandleV1 {
    if (!this.keyMaterialHandle) throw new Error('device-link key material is unavailable');
    return this.keyMaterialHandle;
  }

  private requireDeliveryRecipientPublicKey65B64u(): string {
    if (!this.deliveryRecipientPublicKey65B64u) {
      throw new Error('device-link delivery recipient is unavailable');
    }
    return this.deliveryRecipientPublicKey65B64u;
  }

  private requireOrdinarySignerMaterialRecipientPreparationV1(): DeviceLinkingOrdinarySignerMaterialRecipientPreparationV1 {
    const preparation = this.ordinarySignerMaterialRecipientPreparation;
    if (!preparation) {
      throw new Error('ordinary signer material recipient preparation is unavailable');
    }
    return preparation;
  }

  private startRun(): number {
    this.clearRunActivationStateV1();
    this.committedAuthorityPackages = null;
    this.deliveryRecoveryReason = null;
    this.runEpoch += 1;
    this.generationInProgress = true;
    this.cancelled = false;
    this.error = undefined;
    this.handledStates.clear();
    return this.runEpoch;
  }

  private isCurrentRun(runEpoch: number): boolean {
    return !this.cancelled && this.runEpoch === runEpoch;
  }

  private assertCurrentRun(runEpoch: number): void {
    if (!this.isCurrentRun(runEpoch)) throw new LinkDeviceFlowSupersededError();
  }

  private handleSessionTransportEvent(event: LinkSessionTransportEventV1): void {
    const processing = this.sessionEventQueue.then(this.handleSessionEvent.bind(this, event));
    this.sessionEventQueue = processing.catch(this.handleSessionTransportFailure.bind(this, event));
  }

  private async handleSessionTransportFailure(
    event: LinkSessionTransportEventV1,
    error: unknown,
  ): Promise<void> {
    if (error instanceof LinkDeviceFlowSupersededError) return;
    if (this.hasCommittedDeliveryState()) {
      await this.handleCommittedDeliveryFailureV1(event, error);
      return;
    }
    logDevice2LinkingFailureV1({
      flowId: this.flowId,
      linkSessionId: event.linkSessionId,
      state: event.state.state,
      error,
    });
    this.handledStates.delete(event.state.state);
    const failure = errorForFailure(error, 'registration');
    this.error = failure;
    this.emitFailure(failure, 'registration');
    notifyError(this.options.options?.onError, failure);
    await this.cancelFailedPrecommitSession(event).catch(() => undefined);
    this.runEpoch += 1;
    try {
      await this.cleanupLocalResources();
    } catch {
      // A later cancel/reset retries any retained subscription or key handle.
    }
  }

  private async handleCommittedDeliveryFailureV1(
    event: LinkSessionTransportEventV1,
    error: unknown,
  ): Promise<void> {
    const recoveryReason = classifyLinkedDeviceDeliveryFailureV1(error);
    if (recoveryReason) {
      await this.requireExactMethodUnlockForCommittedDeliveryV1(event, recoveryReason);
      return;
    }
    logDevice2LinkingStageV1({
      flowId: this.flowId,
      linkSessionId: event.linkSessionId,
      stage: 'committed_delivery_retry_started',
      details: { state: event.state.state, error: errorMessage(error) },
    });
    this.handledStates.delete(event.state.state);
    try {
      await this.retryCommittedDeliveryV1(event);
    } catch (retryError: unknown) {
      const retryRecoveryReason = classifyLinkedDeviceDeliveryFailureV1(retryError);
      if (retryRecoveryReason) {
        await this.requireExactMethodUnlockForCommittedDeliveryV1(event, retryRecoveryReason);
        return;
      }
      logDevice2LinkingFailureV1({
        flowId: this.flowId,
        linkSessionId: event.linkSessionId,
        state: event.state.state,
        error: retryError,
      });
    }
  }

  private async requireExactMethodUnlockForCommittedDeliveryV1(
    event: LinkSessionTransportEventV1,
    reason: LinkedDeviceDeliveryRecoveryReasonV1,
  ): Promise<void> {
    this.deliveryRecoveryReason = reason;
    this.handledStates.clear();
    this.runEpoch += 1;
    const failure = new DeviceLinkingError(
      linkedDeviceDeliveryRecoveryMessageV1(reason),
      DeviceLinkingErrorCode.DELIVERY_RECOVERY_REQUIRED,
      'registration',
    );
    this.error = failure;
    try {
      await this.cleanupCompletedLocalResources();
    } catch (cleanupError: unknown) {
      logDevice2LinkingFailureV1({
        flowId: this.flowId,
        linkSessionId: event.linkSessionId,
        state: event.state.state,
        error: cleanupError,
      });
    }
    this.clearRunActivationStateV1();
    this.committedAuthorityPackages = null;
    this.keyMaterialHandle = null;
    this.deliveryRecipientPublicKey65B64u = null;
    this.authenticatedTransport = null;
    this.subscription = null;
    this.emitFailure(failure, 'registration');
    notifyError(this.options.options?.onError, failure);
  }

  private async retryCommittedDeliveryV1(event: LinkSessionTransportEventV1): Promise<void> {
    if (await this.replayPendingActivationAcknowledgementV1()) return;
    switch (event.state.state) {
      case 'provisioning':
      case 'authority_pending_local_install':
      case 'active':
        await this.replayCommittedAuthorityV1(event.state, this.runEpoch);
        return;
      default:
        throw new Error(`committed link delivery cannot resume from ${event.state.state}`);
    }
  }

  private async replayCommittedAuthorityV1(
    state: Extract<
      LinkSessionStateV1,
      { readonly state: 'provisioning' | 'authority_pending_local_install' | 'active' }
    >,
    runEpoch: number,
  ): Promise<void> {
    const result = await this.activateAuthorityForStateV1(state, runEpoch);
    if (result.kind === 'pending_local_install') return;
    if (result.kind === 'integrity_error') {
      throw new DeviceLinkingError(
        `Linked-device authority replay failed: ${result.reason}`,
        DeviceLinkingErrorCode.REGISTRATION_FAILED,
        'registration',
      );
    }
    if (result.kind === 'failed_before_commit' || result.kind === 'relink_required') {
      throw new DeviceLinkingError(
        'Linked-device authority replay cannot continue',
        DeviceLinkingErrorCode.REGISTRATION_FAILED,
        'registration',
      );
    }
    await this.finishActiveAuthorityV1(state, result.session, result.operationCredential, runEpoch);
  }

  private async replayPendingActivationAcknowledgementV1(): Promise<boolean> {
    const committed = this.committedAuthorityPackages;
    if (!committed) return false;
    const pending = await this.ports.authorityInstallation.readPendingActivationAcknowledgementV1({
      authorityId: committed.authority.authorityId,
    });
    if (!pending) return false;
    const session = this.requireSessionV1();
    if (
      pending.linkSessionId !== session.qrData.linkSessionId ||
      pending.authorityId !== committed.authority.authorityId ||
      pending.packageSetDigestB64u !== committed.packageSetDigestB64u
    ) {
      throw new Error('pending linked-device acknowledgement identity is inconsistent');
    }
    await this.sendActivationAcknowledgementV1(pending);
    return true;
  }

  private async sendActivationAcknowledgementV1(
    acknowledgement: LocalAuthorityActivationFinalAckV1,
  ): Promise<void> {
    /* The acknowledgement commits the server's cleanup batch, which deletes
       the link session. The poller must already be closed by then, or its next
       tick reads the deleted session as a spurious not_found. The durable
       pending acknowledgement keeps replay possible without it. */
    await this.closeSessionSubscriptionV1();
    await this.requireAuthenticatedTransport().acknowledgeLocalAuthorityActivationV1({
      acknowledgement,
    });
    await this.ports.authorityInstallation.clearPendingActivationAcknowledgementV1({
      authorityId: acknowledgement.authorityId,
    });
    await this.ports.authorityInstallation.clearCommittedDeliveryResumeV1({
      authorityId: acknowledgement.authorityId,
    });
  }

  private async cancelFailedPrecommitSession(event: LinkSessionTransportEventV1): Promise<void> {
    const transport = this.authenticatedTransport;
    if (!transport) return;
    switch (event.state.state) {
      case 'claimed':
      case 'awaiting_target_factor':
      case 'awaiting_source_contribution':
      case 'provisioning': {
        const cancelledAtMs = Date.now();
        await this.cancelClaimedSessionV1(transport, event.linkSessionId, cancelledAtMs);
        if (this.session?.linkSessionId === event.linkSessionId) {
          this.session = {
            ...this.session,
            state: { state: 'cancelled', cancelledAtMs },
          };
        }
        return;
      }
      case 'displaying_qr':
      case 'authority_pending_local_install':
      case 'active':
      case 'expired':
      case 'cancelled':
      case 'failed_before_commit':
        return;
      default:
        assertNeverLinkSessionStateV1(event.state);
    }
  }

  private async cleanupLocalResources(force = false): Promise<void> {
    if (!force && this.hasCommittedDeliveryState()) return;
    const preserveCommittedState = force && this.hasCommittedDeliveryState();
    if (!preserveCommittedState) this.clearRunActivationStateV1();
    let failure: unknown;
    const subscription = this.subscription;
    if (subscription) {
      try {
        await subscription.close();
        if (this.subscription === subscription) this.subscription = null;
      } catch (error: unknown) {
        failure = error;
      }
    }
    if (!failure) {
      try {
        await this.discardKeyMaterial();
      } catch (error: unknown) {
        failure = error;
      }
    }
    if (failure) throw failure;
    if (preserveCommittedState) {
      this.clearRunActivationStateV1();
      this.committedAuthorityPackages = null;
    }
  }

  private clearRunActivationStateV1(): void {
    this.clearTargetCredentialActivationState();
    this.clearEmailOtpTargetActivationState();
    this.resealedExportRoot = null;
    this.targetCredentialRegistrationResult = null;
    this.ordinarySignerMaterialRecipientPreparation = null;
  }

  private async closeSessionSubscriptionV1(): Promise<void> {
    const subscription = this.subscription;
    if (!subscription) return;
    await subscription.close();
    if (this.subscription === subscription) this.subscription = null;
  }

  private async cleanupCompletedLocalResources(): Promise<void> {
    await this.cleanupLocalResources(true);
  }

  private clearEmailOtpTargetActivationState(): void {
    const state = this.emailOtpTargetActivationState;
    if (state.kind === 'completed') {
      const completedState = requireCompletedEmailOtpTargetActivationStateV1(state);
      completedState.factorSecret.fill(0);
    }
    this.emailOtpTargetActivationState = { kind: 'idle' };
  }

  private hasCommittedDeliveryState(): boolean {
    return (
      this.committedAuthorityPackages !== null ||
      (this.keyMaterialHandle !== null &&
        (this.session?.state.state === 'authority_pending_local_install' ||
          this.session?.state.state === 'active'))
    );
  }

  private async discardKeyMaterial(): Promise<void> {
    const handle = this.keyMaterialHandle;
    if (!handle) return;
    if (this.discardInProgress) return await this.discardInProgress;
    const discard = this.ports.keyMaterial.discardKeyMaterialV1({ handle });
    this.discardInProgress = discard;
    try {
      await discard;
      if (this.keyMaterialHandle === handle) {
        this.keyMaterialHandle = null;
        this.deliveryRecipientPublicKey65B64u = null;
        this.authenticatedTransport = null;
      }
    } finally {
      if (this.discardInProgress === discard) this.discardInProgress = null;
    }
  }

  private emitFailure(error: DeviceLinkingError, phase: DeviceLinkingError['phase']): void {
    this.emit({
      phase:
        phase === 'generation'
          ? LinkDeviceEventPhase.STEP_01_QR_PREPARE_STARTED
          : LinkDeviceEventPhase.FAILED,
      status: 'failed',
      message: error.message,
      data: { role: 'display' },
      interaction: { kind: 'qr_display', overlay: 'hide' },
      error: {
        code: error.code,
        message: error.message,
        retryable:
          error.code !== DeviceLinkingErrorCode.UNSUPPORTED &&
          error.code !== DeviceLinkingErrorCode.DELIVERY_RECOVERY_REQUIRED,
      },
    });
  }

  private emit(event: EmitLinkDeviceEventInput): void {
    this.options.options?.onEvent?.(createLinkDeviceFlowEvent({ flowId: this.flowId, ...event }));
  }
}
