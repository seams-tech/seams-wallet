import { parseLinkedDeviceListResultV1, type OwnerDeviceSummaryV1 } from '@shared/device-linking';
import type { WalletAuthMethodRecordV2 } from '@shared/utils/walletAuthMethodRecord';
import { IndexedDBManager } from '@/core/indexedDB';
import { decodeCBOR } from '@levischuck/tiny-cbor';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';
import { createRelayerExactWalletSessionStatusPort } from '@/core/rpcClients/relayer/walletSessionAuthorizationStatus';
import {
  buildWalletSessionAuthorizationHeaders,
  normalizeRelayerBaseUrl,
  fetchWithWalletHomeDiscovery,
} from '@/core/rpcClients/relayer/relayerHttp';
import { walletSessionAuthorizations } from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import {
  availabilityKey,
  parseStoredAuthMethodAvailability,
} from '@/core/authMethods/availability';
import type { RegistrationWebContext } from '@/SeamsWeb/signingSurface/types';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { requireRecord } from '@shared/utils/validation';
import { sha256DigestB64u } from '@shared/utils/canonicalPrimitives';
import {
  decodeCoseP256PublicKeyWasm,
  buildWebauthnP256SignatureWasm,
} from '@/core/signingEngine/chains/evm/evmCryptoWasm';
import {
  assertVoiceOwner,
  type VoiceEnrollmentScope,
  type VoiceEnrollmentSnapshot,
  type VoiceOwnerGuard,
  type VoiceChangeGuard,
  type VoiceActivationGuard,
} from '../browser/enrollmentStore';

type VoiceChangeAction = 'replace' | 'improve' | 'reset' | 'import';

export function prepareVoiceOwner(
  scope: VoiceEnrollmentScope,
  target: 'enrolled',
): Promise<VoiceChangeGuard>;
export function prepareVoiceOwner(
  scope: VoiceEnrollmentScope,
  target: 'activating',
): Promise<VoiceActivationGuard>;
export async function prepareVoiceOwner(
  scope: VoiceEnrollmentScope,
  target: VoiceOwnerGuard['target'],
): Promise<VoiceOwnerGuard> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(scope.walletId);
  if (
    selected.kind !== 'resolved' ||
    selected.selection.lockState !== 'unlocked' ||
    (target === 'activating' && selected.authMethod.kind === 'voiceid') ||
    selected.authMethod.status !== 'active' ||
    selected.authority.authorityId !== scope.authorityId
  ) {
    throw new Error('Unlock this wallet with an owner method before managing VoiceID.');
  }
  const session = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId: scope.walletId,
    authorityId: scope.authorityId,
    authMethodId: selected.authMethod.walletAuthMethodId,
  });
  if (session.kind !== 'found' || session.record.expiresAtMs <= Date.now())
    throw new Error('Unlock this wallet again before managing VoiceID.');
  const availability = parseStoredAuthMethodAvailability(
    await IndexedDBManager.getAppState(availabilityKey(scope.walletId, scope.walletAuthMethodId)),
  );
  let guard: VoiceOwnerGuard;
  if (target === 'activating') {
    guard = {
      target,
      sessionMethodId: selected.authMethod.walletAuthMethodId,
      walletSessionId: session.operationCredential.walletSessionId,
      lockGeneration: selected.selection.lockGeneration,
      expiresAtMs: Math.min(session.record.expiresAtMs, Date.now() + 5 * 60_000),
      availabilityRevision: availability.revision,
    };
  } else {
    const methods = await IndexedDBManager.listWalletAuthMethodsV2ForWallet(scope.walletId);
    const passkey = methods.find(isConfirmingPasskey.bind(null, scope));
    if (!passkey)
      throw new Error('Add a passkey to this authority before changing your voice enrollment.');
    guard = {
      target,
      sessionMethodId: selected.authMethod.walletAuthMethodId,
      confirmationMethodId: passkey.walletAuthMethodId,
      walletSessionId: session.operationCredential.walletSessionId,
      lockGeneration: selected.selection.lockGeneration,
      expiresAtMs: Math.min(session.record.expiresAtMs, Date.now() + 5 * 60_000),
      availabilityRevision: availability.revision,
    };
  }
  await assertVoiceOwner(scope, guard);
  return guard;
}

function isConfirmingPasskey(
  scope: VoiceEnrollmentScope,
  method: WalletAuthMethodRecordV2,
): boolean {
  return (
    method.kind === 'passkey' &&
    method.status === 'active' &&
    method.walletId === scope.walletId &&
    method.walletAuthorityId === scope.authorityId
  );
}

function matchesConfirmingPasskey(
  scope: VoiceEnrollmentScope,
  guard: VoiceChangeGuard,
  credentialId: string,
  owner: OwnerDeviceSummaryV1,
): boolean {
  return (
    owner.walletId === scope.walletId &&
    owner.walletAuthorityId === scope.authorityId &&
    owner.credential.kind === 'passkey' &&
    owner.credential.walletAuthMethodId === guard.confirmationMethodId &&
    owner.credential.credentialIdB64u === credentialId
  );
}

function changeBinding(
  scope: VoiceEnrollmentScope,
  guard: VoiceChangeGuard,
  snapshot: VoiceEnrollmentSnapshot,
  action: VoiceChangeAction,
): string {
  return JSON.stringify([
    'seams-voiceid-enrollment-change-v1',
    location.origin,
    scope.walletId,
    scope.authorityId,
    scope.walletAuthMethodId,
    scope.deviceKeyId,
    guard.sessionMethodId,
    guard.confirmationMethodId,
    guard.walletSessionId,
    guard.lockGeneration,
    guard.availabilityRevision,
    guard.expiresAtMs,
    action,
    snapshot.kind === 'present' ? snapshot.enrollment.generation : null,
    snapshot.kind === 'present' ? snapshot.enrollment.revision : null,
  ]);
}

/** A verified, single-use permission for one enrollment change, never for signing or unlock. */
export class ConfirmedVoiceChange {
  private consumed = false;
  private constructor(
    private readonly binding: string,
    private readonly expiresAtMs: number,
    private readonly assertCurrentOwner: (signal: AbortSignal) => Promise<void>,
  ) {}

  static async request(
    context: RegistrationWebContext,
    scope: VoiceEnrollmentScope,
    guard: VoiceChangeGuard,
    snapshot: VoiceEnrollmentSnapshot,
    action: VoiceChangeAction,
    signal: AbortSignal,
  ): Promise<ConfirmedVoiceChange> {
    await assertVoiceOwner(scope, guard);
    const assertCurrentOwner = assertServerOwner.bind(
      null,
      context.configs.network.relayer.url,
      scope,
      guard,
    );
    await assertCurrentOwner(signal);
    const owner = await IndexedDBManager.getWalletAuthMethodV2(guard.confirmationMethodId);
    if (
      !owner ||
      owner.kind !== 'passkey' ||
      owner.status !== 'active' ||
      owner.walletId !== scope.walletId ||
      owner.walletAuthorityId !== scope.authorityId ||
      owner.rpId !== context.signingEngine.getRpId()
    ) {
      throw new Error('The confirming passkey is unavailable for this wallet.');
    }
    const binding = changeBinding(scope, guard, snapshot, action);
    const challenge = await sha256DigestB64u(
      new TextEncoder().encode(
        JSON.stringify({
          binding,
          nonce: crypto.randomUUID(),
          expiresAtMs: guard.expiresAtMs,
        }),
      ),
    );
    signal.throwIfAborted();
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: base64UrlDecode(challenge),
        rpId: owner.rpId,
        allowCredentials: [{ type: 'public-key', id: base64UrlDecode(owner.credentialIdB64u) }],
        userVerification: 'required',
        timeout: Math.min(60_000, guard.expiresAtMs - Date.now()),
      },
      signal,
    });
    if (
      !(credential instanceof PublicKeyCredential) ||
      !(credential.response instanceof AuthenticatorAssertionResponse) ||
      base64UrlEncode(new Uint8Array(credential.rawId)) !== owner.credentialIdB64u
    ) {
      throw new Error('The passkey did not confirm this wallet.');
    }
    const response = credential.response;
    const clientBytes = new Uint8Array(response.clientDataJSON);
    const client = requireRecord(
      JSON.parse(new TextDecoder().decode(clientBytes)),
      'Passkey client data',
    );
    if (
      client.type !== 'webauthn.get' ||
      client.challenge !== challenge ||
      client.origin !== location.origin
    ) {
      throw new Error('The passkey confirmation belongs to another operation.');
    }
    const authenticatorData = new Uint8Array(response.authenticatorData);
    const rpHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(owner.rpId)),
    );
    if (
      authenticatorData.length < 37 ||
      (authenticatorData[32] & 5) !== 5 ||
      base64UrlEncode(authenticatorData.slice(0, 32)) !== base64UrlEncode(rpHash)
    ) {
      throw new Error('Passkey user verification is required for this Wallet origin.');
    }
    const verified = await verifyPasskeySignature({
      cosePublicKey: base64UrlDecode(owner.credentialPublicKeyB64u),
      challenge: base64UrlDecode(challenge),
      authenticatorData,
      clientBytes,
      signature: new Uint8Array(response.signature),
      workerCtx: context.signingEngine.getSignerWorkerContext(),
    });
    if (!verified) throw new Error('Passkey confirmation signature is invalid.');
    signal.throwIfAborted();
    await assertVoiceOwner(scope, guard);
    return new ConfirmedVoiceChange(binding, guard.expiresAtMs, assertCurrentOwner);
  }

  async consume(
    scope: VoiceEnrollmentScope,
    guard: VoiceChangeGuard,
    snapshot: VoiceEnrollmentSnapshot,
    action: VoiceChangeAction,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      this.consumed ||
      this.expiresAtMs <= Date.now() ||
      this.binding !== changeBinding(scope, guard, snapshot, action)
    ) {
      throw new Error('Passkey confirmation expired or was already used. Start again.');
    }
    this.consumed = true;
    await this.assertCurrentOwner(signal);
    signal.throwIfAborted();
    if (this.expiresAtMs <= Date.now())
      throw new Error('Passkey confirmation expired. Start again.');
  }
}

async function assertServerOwner(
  relayerUrl: string,
  scope: VoiceEnrollmentScope,
  guard: VoiceChangeGuard,
  signal: AbortSignal,
): Promise<void> {
  const session = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId: scope.walletId,
    authorityId: scope.authorityId,
    authMethodId: guard.sessionMethodId,
  });
  if (
    session.kind !== 'found' ||
    session.operationCredential.walletSessionId !== guard.walletSessionId
  ) {
    throw new Error('The owner session changed. Unlock this wallet and try again.');
  }
  signal.throwIfAborted();
  const status = await createRelayerExactWalletSessionStatusPort({
    relayerUrl,
    operationCredential: session.operationCredential,
    fetchImpl: fetchOwnerStatus.bind(null, signal),
  }).read({ walletSessionId: guard.walletSessionId, quotaId: session.record.quotaId });
  if (
    (status.status !== 'active' && status.status !== 'exhausted') ||
    status.authorization.walletId !== scope.walletId ||
    status.authorization.authorityId !== scope.authorityId ||
    status.authorization.authMethodId !== guard.sessionMethodId
  ) {
    throw new Error('The owner session is unavailable. Unlock this wallet and try again.');
  }
  const confirmer = await IndexedDBManager.getWalletAuthMethodV2(guard.confirmationMethodId);
  if (!confirmer || confirmer.kind !== 'passkey' || !isConfirmingPasskey(scope, confirmer)) {
    throw new Error('The confirming passkey is unavailable.');
  }
  const query = new URLSearchParams({ walletId: scope.walletId, limit: '50', cursor: '' });
  const response = await fetchOwnerStatus(
    signal,
    `${normalizeRelayerBaseUrl(relayerUrl)}/wallet/device-linking/v1/devices?${query}`,
    {
      headers: buildWalletSessionAuthorizationHeaders(session.operationCredential),
    },
  );
  if (!response.ok)
    throw new Error('Could not verify the confirming passkey with the wallet service.');
  const { ok, ...inventoryFields } = requireRecord(
    await response.json(),
    'Wallet method inventory',
  );
  if (ok !== true)
    throw new Error('Could not verify the confirming passkey with the wallet service.');
  const inventory = parseLinkedDeviceListResultV1(inventoryFields);
  if (
    !inventory.ownerDevices.some(
      matchesConfirmingPasskey.bind(null, scope, guard, confirmer.credentialIdB64u),
    )
  ) {
    throw new Error('The confirming passkey was removed or belongs to another authority.');
  }
  signal.throwIfAborted();
}

function fetchOwnerStatus(
  signal: AbortSignal,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  return fetchWithWalletHomeDiscovery(
    new Request(input, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) }),
  );
}

async function verifyPasskeySignature(input: {
  cosePublicKey: Uint8Array;
  challenge: Uint8Array;
  authenticatorData: Uint8Array;
  clientBytes: Uint8Array;
  signature: Uint8Array;
  workerCtx: WorkerOperationContext;
}): Promise<boolean> {
  const cose = decodeCBOR(input.cosePublicKey);
  if (!(cose instanceof Map)) throw new Error('Passkey public key is invalid.');
  const clientHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new Uint8Array(input.clientBytes)),
  );
  const signed = new Uint8Array(input.authenticatorData.length + clientHash.length);
  signed.set(input.authenticatorData);
  signed.set(clientHash, input.authenticatorData.length);
  if (cose.get(1) === 3 && cose.get(3) === -257) {
    const modulus = cose.get(-1);
    const exponent = cose.get(-2);
    if (!(modulus instanceof Uint8Array) || !(exponent instanceof Uint8Array)) {
      throw new Error('RSA passkey public key is invalid.');
    }
    const key = await crypto.subtle.importKey(
      'jwk',
      {
        kty: 'RSA',
        n: base64UrlEncode(modulus),
        e: base64UrlEncode(exponent),
      },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, new Uint8Array(input.signature), signed);
  }
  if (cose.get(1) !== 2 || cose.get(3) !== -7)
    throw new Error('This passkey type cannot confirm VoiceID changes.');
  const publicKey = await decodeCoseP256PublicKeyWasm({
    cosePublicKey: input.cosePublicKey,
    workerCtx: input.workerCtx,
  });
  const packed = await buildWebauthnP256SignatureWasm({
    challenge32: input.challenge,
    authenticatorData: input.authenticatorData,
    clientDataJSON: input.clientBytes,
    signatureDer: input.signature,
    pubKeyX32: publicKey.pubKeyX32,
    pubKeyY32: publicKey.pubKeyY32,
    workerCtx: input.workerCtx,
  });
  // The existing packer appends r, s, public-key x, and public-key y, each 32 bytes.
  const scalarBytes = 32;
  const signature = packed.slice(-4 * scalarBytes, -2 * scalarBytes);
  const key = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(publicKey.pubKeyX32),
      y: base64UrlEncode(publicKey.pubKeyY32),
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed);
}
