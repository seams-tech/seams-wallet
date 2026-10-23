import {
  parseVoiceIdWalletSessionChallenge,
  type VoiceIdDeviceAssertion,
  type VoiceIdDevicePublicKeyB64u,
  type VoiceIdWalletSessionChallenge,
} from '@shared/authorization/voiceIdDeviceAssertion';
import {
  isVoiceIdSeedEnvelope,
  parsePasskeyCustodyEnvelopeRecord,
  type VoiceIdSeedEnvelope,
} from '@shared/passkey-custody';
import {
  parseActiveWalletSessionV1,
  parseWalletSessionOperationCredentialV1,
} from '@shared/device-linking/activeWalletSession';
import type {
  ActiveWalletSessionV1,
  WalletSessionOperationCredentialV1,
} from '@shared/device-linking/contracts';
import type { DigestB64u } from '@shared/utils/canonicalPrimitives';
import type { WalletAuthMethodId, WalletId } from '@shared/utils/domainIds';
import {
  parseWalletAuthMethodRecordV2,
  type ActiveVoiceIdWalletAuthMethodRecordV2,
} from '@shared/utils/walletAuthMethodRecord';
import { rejectUnknownFields } from '@shared/utils/exactRecord';
import { joinNormalizedUrl } from '@shared/utils/normalize';
import { requireRecord } from '@shared/utils/validation';
import {
  buildRelayerJsonPostRequestInit,
  buildWalletSessionAuthorizationHeaders,
} from '@/core/rpcClients/relayer/relayerHttp';

export type VoiceIdHttpSend = (request: Request) => Promise<Response>;

export type VoiceIdVerifiedSession = Readonly<{
  walletSession: ActiveWalletSessionV1;
  operationCredential: WalletSessionOperationCredentialV1;
  custodyEnvelope: VoiceIdSeedEnvelope;
}>;

async function requireSuccessfulResponse(response: Response): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error('VoiceID server returned an invalid response.');
  }
  const body = requireRecord(raw, 'VoiceID server response');
  if (!response.ok || body.ok !== true) {
    throw new Error(`VoiceID server request failed (HTTP ${response.status}).`);
  }
  return body;
}

export class VoiceIdHttpClient {
  private readonly walletOrigin: string;

  constructor(
    private readonly relayerUrl: string,
    walletOrigin: string,
    private readonly send: VoiceIdHttpSend,
  ) {
    const parsed = new URL(walletOrigin);
    if (parsed.origin !== walletOrigin || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      throw new Error('VoiceID Wallet origin is invalid.');
    }
    this.walletOrigin = walletOrigin;
  }

  async activate(input: {
    readonly ownerCredential: WalletSessionOperationCredentialV1;
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly devicePublicKeyB64u: VoiceIdDevicePublicKeyB64u;
    readonly deviceKeyId: DigestB64u;
    readonly custodyEnvelope: VoiceIdSeedEnvelope;
    readonly signal: AbortSignal;
  }): Promise<ActiveVoiceIdWalletAuthMethodRecordV2> {
    if (
      input.custodyEnvelope.walletId !== input.walletId ||
      input.custodyEnvelope.ownership.walletAuthMethodId !== input.walletAuthMethodId ||
      input.custodyEnvelope.factor.deviceKeyId !== input.deviceKeyId
    ) {
      throw new Error('VoiceID activation envelope does not match the device method.');
    }
    const request = new Request(joinNormalizedUrl(this.relayerUrl, '/wallet/voiceid/activate'), {
      ...buildRelayerJsonPostRequestInit({
        body: {
          targetWalletAuthMethodId: input.walletAuthMethodId,
          devicePublicKeyB64u: input.devicePublicKeyB64u,
          custodyEnvelope: input.custodyEnvelope,
        },
        headers: buildWalletSessionAuthorizationHeaders(input.ownerCredential),
      }),
      signal: input.signal,
    });
    const body = await requireSuccessfulResponse(await this.send(request));
    rejectUnknownFields(body, ['ok', 'authMethod'], 'VoiceID activation response');
    const method = parseWalletAuthMethodRecordV2(body.authMethod);
    if (
      !method ||
      method.kind !== 'voiceid' ||
      method.status !== 'active' ||
      method.walletId !== input.walletId ||
      method.walletAuthMethodId !== input.walletAuthMethodId ||
      method.devicePublicKeyB64u !== input.devicePublicKeyB64u ||
      method.deviceKeyId !== input.deviceKeyId
    ) {
      throw new Error('VoiceID server activated a different device method.');
    }
    return method;
  }

  async challenge(input: {
    readonly walletId: WalletId;
    readonly walletAuthMethodId: WalletAuthMethodId;
    readonly signal: AbortSignal;
  }): Promise<VoiceIdWalletSessionChallenge> {
    const request = new Request(joinNormalizedUrl(this.relayerUrl, '/wallet/voiceid/challenge'), {
      ...buildRelayerJsonPostRequestInit({
        body: {
          walletId: input.walletId,
          walletAuthMethodId: input.walletAuthMethodId,
        },
      }),
      signal: input.signal,
    });
    const body = await requireSuccessfulResponse(await this.send(request));
    rejectUnknownFields(body, ['ok', 'challenge'], 'VoiceID challenge response');
    const challenge = parseVoiceIdWalletSessionChallenge(body.challenge);
    if (
      challenge.walletId !== input.walletId ||
      challenge.walletAuthMethodId !== input.walletAuthMethodId ||
      challenge.requestOrigin !== this.walletOrigin ||
      challenge.audience !== this.walletOrigin
    ) {
      throw new Error('VoiceID server challenge belongs to a different Wallet method or origin.');
    }
    return challenge;
  }

  async verify(input: {
    readonly assertion: VoiceIdDeviceAssertion;
    readonly signal: AbortSignal;
  }): Promise<VoiceIdVerifiedSession> {
    if (
      input.assertion.challenge.requestOrigin !== this.walletOrigin ||
      input.assertion.challenge.audience !== this.walletOrigin
    ) {
      throw new Error('VoiceID assertion belongs to a different Wallet origin.');
    }
    const request = new Request(joinNormalizedUrl(this.relayerUrl, '/wallet/voiceid/verify'), {
      ...buildRelayerJsonPostRequestInit({ body: { assertion: input.assertion } }),
      signal: input.signal,
    });
    const body = await requireSuccessfulResponse(await this.send(request));
    rejectUnknownFields(
      body,
      ['ok', 'walletSession', 'operationCredential', 'custodyEnvelope'],
      'VoiceID verification response',
    );
    const walletSession = parseActiveWalletSessionV1(body.walletSession);
    const operationCredential = parseWalletSessionOperationCredentialV1(body.operationCredential);
    const custodyEnvelope = parsePasskeyCustodyEnvelopeRecord(body.custodyEnvelope);
    const challenge = input.assertion.challenge;
    if (
      !isVoiceIdSeedEnvelope(custodyEnvelope) ||
      walletSession.walletId !== challenge.walletId ||
      walletSession.authMethodId !== challenge.walletAuthMethodId ||
      walletSession.authorityId !== challenge.walletAuthorityId ||
      custodyEnvelope.walletId !== challenge.walletId ||
      custodyEnvelope.ownership.walletAuthMethodId !== challenge.walletAuthMethodId ||
      custodyEnvelope.factor.deviceKeyId !== challenge.deviceKeyId
    ) {
      throw new Error('VoiceID server returned a different Wallet Session or custody envelope.');
    }
    return { walletSession, operationCredential, custodyEnvelope };
  }
}
