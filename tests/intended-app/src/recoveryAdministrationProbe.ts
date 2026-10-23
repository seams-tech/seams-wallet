import type { SeamsWeb } from '@seams/wallet';
import { toWalletId } from '@seams/wallet/advanced';
import { computeWalletCustodyAdminChallengeDigest } from '../../../packages/shared-ts/src/authorization/walletCustodyOperation';
import { base64UrlDecode, base64UrlEncode } from '../../../packages/shared-ts/src/utils/base64';

type RecoveryProbeResponse = {
  readonly status: number;
  readonly code: string;
};

export type RecoveryAdministrationProbe = {
  readonly kind: 'recovery_administration_probe_v1';
  readonly missingStatus: RecoveryProbeResponse;
  readonly missingAcknowledgement: RecoveryProbeResponse;
  readonly unredactedProof: RecoveryProbeResponse;
  readonly nestedUnredactedProof: RecoveryProbeResponse;
  readonly staleAcknowledgement: RecoveryProbeResponse;
  readonly initialIssuedAtMs: number;
  readonly rotatedIssuedAtMs: number;
  readonly finalIssuedAtMs: number;
  readonly backupOutstanding: boolean;
};

export const TEST_PRF_OUTPUT = 'dummy-recovery-prf-output';

async function postRecoveryProbe(
  url: URL,
  body: Record<string, unknown>,
): Promise<RecoveryProbeResponse> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Recovery administration probe received an invalid response');
  }
  const code = Reflect.get(payload, 'code');
  if (typeof code !== 'string') {
    throw new Error('Recovery administration probe response omitted its code');
  }
  return { status: response.status, code };
}

async function createStaleAcknowledgementPasskeyProof(input: {
  readonly walletId: string;
  readonly rpId: string;
  readonly requestId: string;
  readonly expectedIssuedAtMs: number;
  readonly devices: SeamsWeb['devices'];
}): Promise<Record<string, unknown>> {
  const inventory = await input.devices.list({
    walletId: toWalletId(input.walletId),
    limit: 50,
    cursor: null,
  });
  let credentialIdB64u: string | null = null;
  for (const owner of inventory.ownerDevices) {
    if (owner.credential.kind !== 'passkey') continue;
    credentialIdB64u = String(owner.credential.credentialIdB64u);
    break;
  }
  if (!credentialIdB64u) throw new Error('Recovery probe needs one owner passkey');

  const challengeDigest = await computeWalletCustodyAdminChallengeDigest({
    walletId: input.walletId,
    operation: 'recovery_backup_acknowledge',
    payload: {
      walletId: input.walletId,
      requestId: input.requestId,
      expectedIssuedAtMs: input.expectedIssuedAtMs,
    },
    requestOrigin: window.location.origin,
  });
  const credential = await navigator.credentials.get({
    publicKey: {
      rpId: input.rpId,
      challenge: base64UrlDecode(challengeDigest),
      allowCredentials: [{ id: base64UrlDecode(credentialIdB64u), type: 'public-key' }],
      userVerification: 'preferred',
      timeout: 60_000,
    },
  });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error('Recovery probe did not receive a passkey assertion');
  }
  const response = credential.response;
  if (!(response instanceof AuthenticatorAssertionResponse)) {
    throw new Error('Recovery probe passkey response is invalid');
  }

  return {
    kind: 'passkey',
    walletId: input.walletId,
    rpId: input.rpId,
    credentialIdB64u,
    challenge_digest: challengeDigest,
    webauthn_authentication: {
      id: credential.id,
      rawId: base64UrlEncode(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment ?? null,
      response: {
        clientDataJSON: base64UrlEncode(response.clientDataJSON),
        authenticatorData: base64UrlEncode(response.authenticatorData),
        signature: base64UrlEncode(response.signature),
        userHandle: response.userHandle ? base64UrlEncode(response.userHandle) : null,
      },
      clientExtensionResults: null,
    },
  };
}

export async function probeRecoveryAdministration(input: {
  readonly walletId: string;
  readonly relayerUrl: string;
  readonly rpId: string;
  readonly recovery: SeamsWeb['recovery'];
  readonly devices: SeamsWeb['devices'];
}): Promise<RecoveryAdministrationProbe> {
  const walletId = input.walletId;
  const statusUrl = new URL(
    `/wallets/${encodeURIComponent(walletId)}/recovery/status`,
    input.relayerUrl,
  );
  const acknowledgementUrl = new URL('/wallets/recovery/acknowledge-backup', input.relayerUrl);
  const initial = await input.recovery.getCodeStatus({
    walletId,
    authorization: { kind: 'passkey' },
  });
  if (initial.kind !== 'ready') throw new Error(`Initial recovery status is ${initial.kind}`);

  const missingStatus = await postRecoveryProbe(statusUrl, {
    requestId: crypto.randomUUID(),
    factorProof: null,
  });
  const missingAcknowledgement = await postRecoveryProbe(acknowledgementUrl, {
    walletId,
    requestId: crypto.randomUUID(),
    expectedIssuedAtMs: initial.issuedAtMs,
    factorProof: null,
  });

  const rotated = await input.recovery.rotateCodes({
    walletId,
    authorization: { kind: 'existing_passkey' },
  });
  if (rotated.kind !== 'rotated') throw new Error(`Recovery rotation is ${rotated.kind}`);

  const requestId = crypto.randomUUID();
  const proof = await createStaleAcknowledgementPasskeyProof({
    walletId,
    rpId: input.rpId,
    requestId,
    expectedIssuedAtMs: initial.issuedAtMs,
    devices: input.devices,
  });
  const credential = proof.webauthn_authentication;
  if (credential === null || typeof credential !== 'object' || Array.isArray(credential)) {
    throw new Error('Recovery probe passkey assertion is invalid');
  }
  const response = Reflect.get(credential, 'response');
  if (response === null || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('Recovery probe passkey response is invalid');
  }
  const unredactedProof = await postRecoveryProbe(acknowledgementUrl, {
    walletId,
    requestId,
    expectedIssuedAtMs: initial.issuedAtMs,
    factorProof: {
      ...proof,
      webauthn_authentication: {
        ...credential,
        clientExtensionResults: { prf: { results: { first: TEST_PRF_OUTPUT } } },
      },
    },
  });
  const nestedUnredactedProof = await postRecoveryProbe(acknowledgementUrl, {
    walletId,
    requestId,
    expectedIssuedAtMs: initial.issuedAtMs,
    factorProof: {
      ...proof,
      webauthn_authentication: {
        ...credential,
        response: {
          ...response,
          clientExtensionResults: { prf: { results: { first: TEST_PRF_OUTPUT } } },
        },
      },
    },
  });
  const staleAcknowledgement = await postRecoveryProbe(acknowledgementUrl, {
    walletId,
    requestId,
    expectedIssuedAtMs: initial.issuedAtMs,
    factorProof: proof,
  });
  const final = await input.recovery.getCodeStatus({
    walletId,
    authorization: { kind: 'passkey' },
  });
  if (final.kind !== 'ready') throw new Error(`Final recovery status is ${final.kind}`);

  return {
    kind: 'recovery_administration_probe_v1',
    missingStatus,
    missingAcknowledgement,
    unredactedProof,
    nestedUnredactedProof,
    staleAcknowledgement,
    initialIssuedAtMs: initial.issuedAtMs,
    rotatedIssuedAtMs: rotated.issuedAtMs,
    finalIssuedAtMs: final.issuedAtMs,
    backupOutstanding: final.backupOutstanding,
  };
}
