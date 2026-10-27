import { base58Encode } from '@shared/utils/base58';
import { isPlainObject } from '@shared/utils/validation';
import { isValidAccountId } from '@shared/utils/near';
import type { TransactionInput } from '../core/types/actions';
import { externalNearAction } from './actions';
import { INTEAR_ORIGIN, IntearPopup } from './intearPopup';
import type { ExternalNearConnection, ExternalNearNetwork } from './types';

type IntearSession = {
  accountId: string;
  network: ExternalNearNetwork;
  key: CryptoKeyPair;
  publicKey: string;
};

/** The ephemeral key authenticates requests only. It is never installed on chain. */
async function authenticate(key: CryptoKeyPair, payload: string) {
  const nonce = Date.now();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${nonce}|${payload}`),
  );
  const signature = await crypto.subtle.sign('Ed25519', key.privateKey, digest);
  return { nonce, signature: `ed25519:${base58Encode(signature)}` };
}

export class IntearWalletProvider {
  readonly messageSigning = 'unsupported';
  private lifecycle: 'active' | 'disposed' = 'active';
  private popup: IntearPopup | null = null;
  private session: IntearSession | null = null;
  async connect(network: ExternalNearNetwork): Promise<unknown> {
    if (this.lifecycle !== 'active') throw new Error('Intear connection disposed.');
    const popup = new IntearPopup('/connect', 'connected');
    this.popup = popup;
    // Observe failure immediately while Web Crypto prepares the request.
    const response = popup.result;
    void response.catch(ignorePopupFailure);
    try {
      const key = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
      const publicKey = `ed25519:${base58Encode(await crypto.subtle.exportKey('raw', key.publicKey))}`;
      const message = '{}';
      const proof = await authenticate(key, message);
      popup.send({
        type: 'signIn',
        data: {
          publicKey,
          networkId: network,
          message,
          nonce: proof.nonce,
          signature: proof.signature,
          version: 'V3',
          actualOrigin: location.origin,
        },
      });
      const result = await response;
      if (
        !isPlainObject(result) ||
        !isValidAccountId(result.accountId) ||
        result.functionCallKeyAdded !== false ||
        result.useBridge !== false ||
        result.walletUrl !== INTEAR_ORIGIN
      ) {
        throw new Error('Unsupported Intear connection response.');
      }
      this.session = { accountId: result.accountId, network, key, publicKey };
      return [result.accountId];
    } catch (error) {
      popup.fail(new Error('Intear connection failed.'));
      throw error;
    } finally {
      if (this.popup === popup) this.popup = null;
    }
  }
  async accounts(network: ExternalNearNetwork): Promise<unknown> {
    return this.session?.network === network ? [this.session.accountId] : [];
  }
  async send(connection: ExternalNearConnection, transaction: TransactionInput): Promise<unknown> {
    const session = this.session;
    if (
      !session ||
      session.network !== connection.network ||
      session.accountId !== connection.accountId
    )
      throw new Error('Reconnect Intear.');
    if (this.lifecycle !== 'active') throw new Error('Intear connection disposed.');
    const popup = new IntearPopup('/send-transactions', 'sent');
    this.popup = popup;
    const response = popup.result;
    void response.catch(ignorePopupFailure);
    try {
      const transactions = JSON.stringify([
        {
          signerId: session.accountId,
          receiverId: transaction.receiverId,
          actions: transaction.actions.map(externalNearAction),
        },
      ]);
      const proof = await authenticate(session.key, transactions);
      popup.send({
        type: 'signAndSendTransactions',
        data: {
          accountId: session.accountId,
          publicKey: session.publicKey,
          nonce: proof.nonce,
          signature: proof.signature,
          transactions,
          mode: 'Send',
        },
      });
      const result = await response;
      if (!isPlainObject(result)) throw new Error('Invalid Intear outcome.');
      return result.outcomes;
    } catch (error) {
      popup.fail(new Error('Intear transaction outcome is unknown.'));
      throw error;
    } finally {
      if (this.popup === popup) this.popup = null;
    }
  }
  dispose(): void {
    this.lifecycle = 'disposed';
    this.popup?.fail(
      new Error('Intear disconnected. Check wallet activity for pending submissions.'),
    );
    this.popup = null;
    this.session = null;
  }
}
function ignorePopupFailure(): void {}
