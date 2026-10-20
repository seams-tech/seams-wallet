import type { useSeams } from '@seams/wallet/react';
import {
  prepareMlDsaSignerInventory,
  fetchMlDsaSignerInventory,
  prepareMlDsaNearSigning,
  executeMlDsaNearSigning,
  serializeMlDsaWebAuthnApproval,
  restoreMlDsaNearSigner,
  parseWebAuthnRpId,
  toWalletId,
} from '@seams/wallet/advanced';
import type { AddedMlDsaSignerCapability } from '../../../packages/wallet/src/core/types/seams';

type Context = {
  wallet: Pick<ReturnType<typeof useSeams>['seams'], 'registration'>;
  walletId: string;
  nearAccountId: string;
};
export type MlDsaBrowserCommand =
  | { kind: 'context' }
  | { kind: 'publish' }
  | { kind: 'inventory'; credentialIdB64u: string }
  | { kind: 'restore'; recordedSigner: AddedMlDsaSignerCapability }
  | {
      kind: 'sign';
      signer: AddedMlDsaSignerCapability;
      unsignedTransactionBorshB64u: string;
      credentialIdB64u: string;
    };

declare global {
  interface Window {
    __seamsIntendedMlDsa?: IntendedMlDsaLifecycle['run'];
  }
}

export class IntendedMlDsaLifecycle {
  constructor(
    private readonly readContext: () => Context,
    private readonly readActor: () => Promise<{
      credentialIdB64u: string;
      walletAuthMethodId: string;
    }>,
  ) {}

  install(): void {
    window.__seamsIntendedMlDsa = this.run.bind(this);
  }

  async run(command: MlDsaBrowserCommand) {
    const context = this.readContext();
    const rpId = parseWebAuthnRpId(location.hostname);
    if (!rpId.ok) throw new Error('Invalid browser relying party');
    switch (command.kind) {
      case 'context': {
        const actor = await this.readActor();
        return {
          walletId: context.walletId,
          nearAccountId: context.nearAccountId,
          credentialIdB64u: actor.credentialIdB64u,
          walletAuthMethodId: actor.walletAuthMethodId,
        };
      }
      case 'publish': {
        const result = await context.wallet.registration.addSigner({
          walletId: toWalletId(context.walletId),
          rpId: rpId.value,
          signerSelection: {
            mode: 'ml_dsa_65',
            mlDsa: { signerSlot: 1, purpose: { kind: 'create' } },
          },
        });
        if (
          !result.success ||
          result.kind !== 'wallet_signer_added' ||
          result.capabilities[0].kind !== 'near_ml_dsa_65'
        )
          throw new Error(`ML-DSA publication failed: ${JSON.stringify(result)}`);
        return result.capabilities[0];
      }
      case 'restore':
        return restoreMlDsaNearSigner({
          wallet: context.wallet,
          walletId: toWalletId(context.walletId),
          rpId: rpId.value,
          signerSlot: 1,
          recordedSigner: command.recordedSigner,
        });
      case 'inventory': {
        const credentialIdB64u = command.credentialIdB64u;
        const prepared = await prepareMlDsaSignerInventory({
          relayerUrl: relayerUrl(),
          walletId: context.walletId,
          rpId: rpId.value,
          credentialIdB64u,
          origin: location.origin,
        });
        if (prepared.kind !== 'prepared') return prepared;
        return fetchMlDsaSignerInventory({
          relayerUrl: relayerUrl(),
          preparation: prepared.preparation,
          credential: serializeMlDsaWebAuthnApproval(
            await approval(prepared.challengeB64u, rpId.value, credentialIdB64u),
          ),
        });
      }
      case 'sign': {
        const credentialIdB64u = command.credentialIdB64u;
        const prepared = await prepareMlDsaNearSigning({
          relayerUrl: relayerUrl(),
          publicKeyB64u: command.signer.publicKeyB64u,
          request: {
            walletId: context.walletId,
            signingKeyId: command.signer.signingKeyId,
            operationIdB64u: randomChallenge(),
            unsignedTransactionBorshB64u: command.unsignedTransactionBorshB64u,
            rpId: rpId.value,
            credentialIdB64u,
          },
        });
        if (prepared.kind !== 'prepared') return prepared;
        const input = {
          relayerUrl: relayerUrl(),
          preparation: prepared.preparation,
          credential: serializeMlDsaWebAuthnApproval(
            await approval(prepared.preparation.challengeB64u, rpId.value, credentialIdB64u),
          ),
        };
        let result = await executeMlDsaNearSigning(input);
        while (result.kind === 'retry' && result.retryAtMs < prepared.preparation.expiresAtMs) {
          await pause(Math.max(100, result.retryAtMs - Date.now()));
          result = await executeMlDsaNearSigning(input);
        }
        return result;
      }
    }
  }
}

function relayerUrl(): string {
  return import.meta.env.VITE_RELAYER_URL;
}
function randomChallenge(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
function decode(encoded: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), characterCode);
}
function characterCode(character: string): number {
  return character.charCodeAt(0);
}
async function approval(
  challenge: string,
  rpId: string,
  credentialIdB64u: string,
): Promise<PublicKeyCredential> {
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: decode(challenge),
      rpId,
      userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: decode(credentialIdB64u) }],
    },
  });
  if (!(credential instanceof PublicKeyCredential))
    throw new Error('Browser approval was cancelled');
  if (credential.id !== credentialIdB64u)
    throw new Error('Browser selected a different owner credential');
  return credential;
}
function schedulePause(milliseconds: number, resolve: () => void): void {
  setTimeout(resolve, milliseconds);
}
function pause(milliseconds: number): Promise<void> {
  return new Promise(schedulePause.bind(undefined, milliseconds));
}
