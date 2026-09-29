import {
  parseRouterAbEd25519YaoRegistrationActivationExecuteRequestV1,
  type RouterAbEd25519YaoActivationAdmissionReceiptV1,
  type RouterAbEd25519YaoRegistrationAdmissionRequestV1,
} from '@shared/utils/routerAbEd25519Yao';
import {
  encodeRouterAbEd25519YaoRegistrationAdmissionFingerprintV1,
  InMemoryRouterAbEd25519YaoRegistrationService,
  InMemoryRouterAbEd25519YaoRegistrationStateV1,
  type RouterAbEd25519YaoRegistrationBackend,
  type RouterAbEd25519YaoRegistrationBackendResult,
  type RouterAbEd25519YaoRegistrationExecuteRequestV1,
  type RouterAbEd25519YaoRegistrationResultV1,
  type RouterAbEd25519YaoRegistrationServiceResult,
} from './routerAbEd25519YaoRegistration';
import type { InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationStateV1 } from './routerAbEd25519YaoRegistrationIntentAuthorization';
import type { RouterAbEd25519YaoTenantRootWireV1 } from '../routerAbEd25519YaoGatewayEnvelope';
import { routerAbEd25519YaoCredentialDigestHexV1 } from './routerAbEd25519YaoRegistrationIntentAuthorization';

type AdmissionReceipt = RouterAbEd25519YaoActivationAdmissionReceiptV1<'registration'>;

/**
 * What the Gateway checks a registration execute against before it asks the
 * Router to run it: the admission, the intent credential that bound it and
 * the tenant root pinned at admission, from the Gateway's ceremony record.
 * The execution itself (its claim, its recorded answer and the finalization
 * that consumes it) belongs to the Router's wallet object.
 */
export type RouterAbEd25519YaoRegistrationExecutionAuthorityV1 = {
  readonly lifecycleId: string;
  readonly admissionRequest: RouterAbEd25519YaoRegistrationAdmissionRequestV1;
  readonly admissionReceipt: AdmissionReceipt;
  readonly admissionBindingJson: string;
  readonly credentialDigestSha256Hex: string;
  readonly expiresAtMs: number;
  readonly dispatchRoot: RouterAbEd25519YaoTenantRootWireV1;
};

type MapValue<T> = T extends Map<string, infer Value> ? Value : never;
type RegistrationLifecycleState = MapValue<InMemoryRouterAbEd25519YaoRegistrationStateV1['states']>;
type AdmittedRegistration = Extract<RegistrationLifecycleState, { readonly kind: 'admitted' }>;
type BoundRegistrationIntentAuthority =
  InMemoryRouterAbEd25519YaoRegistrationIntentAuthorizationStateV1['authorities'][number];

/**
 * The authority of one admitted registration, or `null` if it is
 * inconsistent. The pinned tenant root must be the one the admission names:
 * its signing root and version.
 */
export function buildRouterAbEd25519YaoRegistrationExecutionAuthorityV1(input: {
  readonly lifecycleId: string;
  readonly registration: AdmittedRegistration;
  readonly authority: BoundRegistrationIntentAuthority;
  readonly dispatchRoot: RouterAbEd25519YaoTenantRootWireV1 | undefined;
}): RouterAbEd25519YaoRegistrationExecutionAuthorityV1 | null {
  const { lifecycleId, registration, authority, dispatchRoot } = input;
  if (
    dispatchRoot === undefined ||
    dispatchRoot.identity.signingRootId !==
      registration.admissionRequest.application_binding.signing_root_id ||
    dispatchRoot.identity.signingRootVersion !==
      registration.admissionRequest.scope.root_share_epoch ||
    registration.admissionRequest.scope.lifecycle_id !== lifecycleId ||
    registration.admissionReceipt.binding.lifecycle.lifecycle_id !== lifecycleId ||
    authority.admissionRequest.scope.lifecycle_id !== lifecycleId ||
    authority.admissionFingerprint !==
      encodeRouterAbEd25519YaoRegistrationAdmissionFingerprintV1(authority.admissionRequest) ||
    authority.admissionFingerprint !==
      encodeRouterAbEd25519YaoRegistrationAdmissionFingerprintV1(registration.admissionRequest) ||
    !Number.isSafeInteger(authority.expiresAtMs) ||
    authority.expiresAtMs <= 0
  ) {
    return null;
  }
  return {
    lifecycleId,
    admissionRequest: registration.admissionRequest,
    admissionReceipt: registration.admissionReceipt,
    admissionBindingJson: routerAbEd25519YaoRegistrationAdmissionBindingJsonV1(
      registration.admissionReceipt,
    ),
    credentialDigestSha256Hex: routerAbEd25519YaoCredentialDigestHexV1(
      authority.credentialDigestSha256,
    ),
    expiresAtMs: authority.expiresAtMs,
    dispatchRoot,
  };
}

/**
 * Pins the tenant root an admitted registration dispatches to, resolved once
 * at admission. Every execute and consumption of the lifecycle sends this
 * root, so the Router's record of a known execution answers them without a
 * fresh active-root lookup.
 */
export function pinRouterAbEd25519YaoRegistrationDispatchRootV1(
  registration: InMemoryRouterAbEd25519YaoRegistrationStateV1,
  lifecycleId: string,
  dispatchRoot: RouterAbEd25519YaoTenantRootWireV1,
): void {
  registration.dispatchRoots.set(lifecycleId, dispatchRoot);
}

function routerAbEd25519YaoRegistrationAdmissionBindingJsonV1(receipt: AdmissionReceipt): string {
  return JSON.stringify(receipt.binding);
}

/**
 * The registration result the Router's answer gives for one admitted
 * execution, verified as the in-memory service verifies a fresh one. The
 * Gateway derives it from the Router's answer each time: at execution, and
 * when finalization consumes the answer the Router recorded.
 */
export function routerAbEd25519YaoRegistrationResultFromRouterAnswerV1(input: {
  readonly backend: RouterAbEd25519YaoRegistrationBackend;
  readonly authority: RouterAbEd25519YaoRegistrationExecutionAuthorityV1;
  readonly request: RouterAbEd25519YaoRegistrationExecuteRequestV1;
  readonly answer: RouterAbEd25519YaoRegistrationBackendResult;
}): RouterAbEd25519YaoRegistrationServiceResult<RouterAbEd25519YaoRegistrationResultV1> {
  const state = new InMemoryRouterAbEd25519YaoRegistrationStateV1();
  const sessionKey = bytesToHex(input.authority.admissionReceipt.binding.session_id);
  state.states.set(sessionKey, {
    kind: 'admitted',
    admissionRequest: input.authority.admissionRequest,
    admissionReceipt: input.authority.admissionReceipt,
  });
  state.lifecycleSessions.set(input.authority.lifecycleId, sessionKey);
  const service = new InMemoryRouterAbEd25519YaoRegistrationService(input.backend, state);
  const prepared = service.prepareExecute(input.request);
  if (prepared.kind !== 'claimed') {
    throw new Error('Yao registration execution could not be reconstructed from its admission');
  }
  return service.commitExecute({
    request: input.request,
    claim: prepared.claim,
    outcome: { kind: 'backend_response', result: input.answer },
  });
}

/** The Gateway's execute request inside the Router request the Router recorded. */
export function routerAbEd25519YaoRegistrationExecuteRequestFromRouterRequestJsonV1(
  requestJson: string,
): RouterAbEd25519YaoRegistrationExecuteRequestV1 {
  const routerRequest: unknown = JSON.parse(requestJson);
  const target =
    typeof routerRequest === 'object' && routerRequest !== null && 'target' in routerRequest
      ? (routerRequest as { readonly target: unknown }).target
      : null;
  if (typeof target !== 'object' || target === null) {
    throw new Error('Router registration request has no target');
  }
  const { binding, deriver_a_input, deriver_b_input } = target as Record<string, unknown>;
  const parsed = parseRouterAbEd25519YaoRegistrationActivationExecuteRequestV1({
    binding,
    deriver_a_input,
    deriver_b_input,
  });
  if (!parsed.ok) throw new Error('Router registration request target is invalid');
  return parsed.value;
}

function bytesToHex(bytes: readonly number[]): string {
  let encoded = '';
  for (const byte of bytes) encoded += byte.toString(16).padStart(2, '0');
  return encoded;
}
