import { readVoiceIdAvailability } from '@/core/authMethods/availability';
import { loadWalletAuthMethodHostPlugin } from '@/core/authMethods/hostRegistry';
import type { WalletAuthMethodPlugin } from '@/core/authMethods/plugins';
import { IndexedDBManager, walletSessionAuthorizations } from '@/core/indexedDB';
import { buildThresholdEd25519NearTxUnsignedBorshWasm } from '@/core/signingEngine/chains/near/nearSignerWasm';
import type { WorkerOperationContext } from '@/core/signingEngine/workerManager/executeWorkerOperation';
import { loadSpeakToSignHost } from '@/core/transactionFeatures/hostRegistry';
import { toActionArgsWasm, type TransactionInput } from '@/core/types/actions';
import type { TransactionContext } from '@/core/types/rpc';
import { nearTransactionActionsBorsh } from '@shared/speakToSign/spokenRequest';
import { base64UrlDecode } from '@shared/utils/base64';
import type { WalletId } from '@shared/utils/domainIds';
import type { SpeakToSignWalletPorts } from './speakToSign';

/** The Wallet iframe's own stores. The verify route admits this credential as the session. */
export const browserSpeakToSignPorts: SpeakToSignWalletPorts = {
  readVoiceIdAvailability,
  readOperationCredential,
  loadHost: loadSpeakToSignHost,
  loadVoiceIdHost,
  nearActionsBorsh,
  fetch: fetchFromWindow,
};

/** base58 of 32 zero bytes: a placeholder key and block hash. */
const ZERO_32_BASE58 = '1'.repeat(32);
/**
 * The action bytes do not depend on the key, the nonce or the block hash, so the signer worker
 * builds the transaction with placeholders. The signing path fills the real values later.
 */
const PLACEHOLDER_CONTEXT: TransactionContext = {
  nearPublicKeyStr: `ed25519:${ZERO_32_BASE58}`,
  accessKeyInfo: { nonce: 0n, permission: 'FullAccess', block_height: 0, block_hash: ZERO_32_BASE58 },
  nextNonce: '1',
  txBlockHeight: '0',
  txBlockHash: ZERO_32_BASE58,
};

async function nearActionsBorsh(
  workerContext: () => WorkerOperationContext,
  ownerAccountId: string,
  transaction: TransactionInput,
): Promise<Uint8Array<ArrayBuffer>> {
  const unsigned = await buildThresholdEd25519NearTxUnsignedBorshWasm({
    txSigningRequest: {
      nearAccountId: ownerAccountId,
      receiverId: transaction.receiverId,
      actions: transaction.actions.map(toActionArgsWasm),
    },
    transactionContext: PLACEHOLDER_CONTEXT,
    workerCtx: workerContext(),
  });
  const actions = nearTransactionActionsBorsh(base64UrlDecode(unsigned.unsignedTransactionBorshB64u));
  return new Uint8Array(actions);
}

function loadVoiceIdHost(methods: readonly WalletAuthMethodPlugin[]) {
  return loadWalletAuthMethodHostPlugin(methods, 'voiceid');
}

async function readOperationCredential(walletId: WalletId): Promise<string> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(walletId);
  if (selected.kind !== 'resolved') throw new Error('Unlock this wallet before a spoken payment.');
  const session = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId,
    authorityId: selected.authority.authorityId,
    authMethodId: selected.authMethod.walletAuthMethodId,
  });
  if (session.kind !== 'found') throw new Error('Unlock this wallet before a spoken payment.');
  return session.operationCredential.token;
}

function fetchFromWindow(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}
