import { base64UrlDecode } from '@shared/utils/encoders';
import type { NearTransactionActionArgsWasm } from '@shared/near/actions';
import { SignedTransaction } from '../rpcClients/near/NearClient';
import { toPublicKeyStringFromSecretKey } from '../nearKeys';
import {
  requireFinalizeNearTxFromSignatureOutput,
  requireSingleUnsignedNearTxBorshOutput,
  signNearDigestWithSecretKey,
} from './nearPrivateKeySigning';
import {
  threshold_ed25519_build_near_tx_unsigned_borsh,
  threshold_ed25519_finalize_near_tx_from_signature,
} from '../../../../../wasm/near_signer/pkg/wasm_signer_worker.js';

export async function signGasRelayerNearTransactionWithDeps(input: {
  readonly ensureSignerWasm: () => Promise<void>;
  readonly relayerAccount: string;
  readonly relayerPrivateKey: string;
  readonly receiverId: string;
  readonly nonce: string;
  readonly blockHash: string;
  readonly actions: readonly NearTransactionActionArgsWasm[];
}): Promise<SignedTransaction> {
  await input.ensureSignerWasm();
  const signerPublicKey = toPublicKeyStringFromSecretKey(input.relayerPrivateKey);
  const unsignedTx = requireSingleUnsignedNearTxBorshOutput(
    threshold_ed25519_build_near_tx_unsigned_borsh({
      txSigningRequests: [
        {
          nearAccountId: input.relayerAccount,
          receiverId: input.receiverId,
          actions: [...input.actions],
        },
      ],
      transactionContext: {
        nearPublicKeyStr: signerPublicKey,
        nextNonce: input.nonce,
        txBlockHash: input.blockHash,
      },
    }),
  );
  const signatureB64u = await signNearDigestWithSecretKey({
    nearPrivateKey: input.relayerPrivateKey,
    signingDigestB64u: unsignedTx.signingDigestB64u,
    expectedSignerPublicKey: signerPublicKey,
  });
  const finalized = requireFinalizeNearTxFromSignatureOutput(
    threshold_ed25519_finalize_near_tx_from_signature({
      unsignedTransactionBorshB64u: unsignedTx.unsignedTransactionBorshB64u,
      signingDigestB64u: unsignedTx.signingDigestB64u,
      signatureB64u,
      expectedNearAccountId: input.relayerAccount,
      expectedSignerPublicKey: signerPublicKey,
    }),
  );
  return SignedTransaction.fromPlain({
    transaction: null,
    signature: null,
    borsh_bytes: Array.from(base64UrlDecode(finalized.signedTransactionBorshB64u)),
  });
}
