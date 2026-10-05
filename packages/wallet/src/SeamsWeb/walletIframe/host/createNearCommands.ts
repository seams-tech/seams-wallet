import {
  sendTransaction,
  signAndSendTransaction,
  signTransactionWithActions,
} from '@/SeamsWeb/operations/near/actions';
import { signDelegateAction as signDelegateActionCore } from '@/SeamsWeb/operations/near/signDelegateAction';
import { signNEP413Message as signNEP413MessageCore } from '@/SeamsWeb/operations/near/signNEP413';
import type { NearCommands } from '@/SeamsWeb/publicApi/nearCommands';
import type { NearSigningWebContext } from '@/SeamsWeb/signingSurface/types';
import { IndexedDBManager } from '@/core/indexedDB';
import {
  walletSessionAuthorizations,
  type WalletCapabilitySubjectV1,
} from '@/core/indexedDB/seamsWalletDB/walletSessionAuthorizationStore';
import { fundImplicitNearAccountForTesting } from '@/core/rpcClients/relayer/walletRegistration';
import type {
  NearAccountRef,
  WalletSessionRef,
} from '@/core/signingEngine/interfaces/ecdsaChainTarget';
import type { SeamsConfigsReadonly } from '@/core/types/seams';
import { toError } from '@shared/utils/errors';
export function createWalletHostNearCommands(getContext: () => NearSigningWebContext): NearCommands {
  const commands = new WalletHostNearCommands(getContext);
  return {
    fundImplicitNearAccountForTesting: commands.fundImplicitNearAccountForTesting.bind(commands),
    signAndSendTransaction: commands.signAndSendTransaction.bind(commands),
    signTransactionWithActions: commands.signTransactionWithActions.bind(commands),
    sendTransaction: commands.sendTransaction.bind(commands),
    signDelegateAction: commands.signDelegateAction.bind(commands),
    signNEP413Message: commands.signNEP413Message.bind(commands),
  };
}
function relayerUrlFromConfigs(configs: SeamsConfigsReadonly): string {
  const relayerUrl = String(configs.network.relayer?.url || '').trim();
  if (!relayerUrl) throw new Error('Relayer URL is not configured');
  return relayerUrl;
}
function requireNearPublicKey(value: unknown): string {
  const nearPublicKey = String(value || '').trim();
  if (!nearPublicKey) throw new Error('NEAR public key is required');
  return nearPublicKey;
}
function hasEd25519SigningSubject(subjects: readonly WalletCapabilitySubjectV1[]): boolean {
  for (const subject of subjects) {
    if (subject.kind === 'sign' && subject.keyFamily === 'ed25519') return true;
  }
  return false;
}
async function requireCurrentEd25519WalletSessionToken(
  walletSession: WalletSessionRef,
): Promise<string> {
  const selected = await IndexedDBManager.resolveSelectedWalletAuthority(
    String(walletSession.walletId),
  );
  if (selected.kind !== 'resolved') {
    throw new Error('Current Ed25519 wallet session is required for implicit NEAR funding');
  }
  const { selection, authMethod, authority } = selected;
  if (
    selection.lockState !== 'unlocked' ||
    selection.walletId !== walletSession.walletId ||
    selection.walletAuthMethodId !== authMethod.walletAuthMethodId ||
    authMethod.walletId !== walletSession.walletId ||
    authMethod.walletAuthorityId !== authority.authorityId ||
    authMethod.status !== 'active' ||
    authority.walletId !== walletSession.walletId ||
    authority.state !== 'active'
  ) {
    throw new Error('Current Ed25519 wallet session is required for implicit NEAR funding');
  }
  const read = await walletSessionAuthorizations.readExactWithOperationCredential({
    walletId: walletSession.walletId,
    authorityId: authority.authorityId,
    authMethodId: authMethod.walletAuthMethodId,
  });
  if (
    read.kind !== 'found' ||
    read.record.authorityDigestB64u !== authority.authorityDigestB64u ||
    read.record.authorityRevocationEpoch !== authority.revocationEpoch ||
    read.record.expiresAtMs <= Date.now() ||
    !hasEd25519SigningSubject(read.record.capabilitySubjects)
  ) {
    throw new Error('Current Ed25519 wallet session is required for implicit NEAR funding');
  }
  return read.operationCredential.token;
}
async function fundImplicitNearAccountFromCurrentSession(args: {
  configs: SeamsConfigsReadonly;
  walletSession: WalletSessionRef;
  nearAccount: NearAccountRef;
  nearPublicKey: string;
}): ReturnType<typeof fundImplicitNearAccountForTesting> {
  return await fundImplicitNearAccountForTesting({
    relayerUrl: relayerUrlFromConfigs(args.configs),
    walletId: args.walletSession.walletId,
    nearAccountId: args.nearAccount.accountId,
    nearPublicKeyStr: requireNearPublicKey(args.nearPublicKey),
    walletSessionToken: await requireCurrentEd25519WalletSessionToken(args.walletSession),
  });
}
class WalletHostNearCommands {
  constructor(private readonly getContext: () => NearSigningWebContext) {}
  async fundImplicitNearAccountForTesting(
    args: Parameters<NearCommands['fundImplicitNearAccountForTesting']>[0],
  ): ReturnType<NearCommands['fundImplicitNearAccountForTesting']> {
    return await fundImplicitNearAccountFromCurrentSession({
      configs: this.getContext().configs,
      walletSession: args.walletSession,
      nearAccount: args.nearAccount,
      nearPublicKey: args.nearPublicKey,
    });
  }
  async signAndSendTransaction(
    args: Parameters<NearCommands['signAndSendTransaction']>[0],
  ): ReturnType<NearCommands['signAndSendTransaction']> {
    const nearAccountId = args.nearAccount.accountId;
    const transaction = {
      receiverId: args.receiverId,
      actions: args.actions,
    };
    try {
      return await signAndSendTransaction({
        context: this.getContext(),
        nearAccountId,
        walletSession: args.walletSession,
        transactionInput: transaction,
        options: args.options,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await args.options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async signTransactionWithActions(
    args: Parameters<NearCommands['signTransactionWithActions']>[0],
  ): ReturnType<NearCommands['signTransactionWithActions']> {
    const nearAccountId = args.nearAccount.accountId;
    const { transaction, options } = args;
    try {
      return await signTransactionWithActions({
        context: this.getContext(),
        nearAccountId,
        walletSession: args.walletSession,
        transactionInput: transaction,
        options,
      });
    } catch (error: unknown) {
      const e = toError(error);
      await options?.afterCall?.(false, undefined, e);
      throw e;
    }
  }
  async sendTransaction(
    args: Parameters<NearCommands['sendTransaction']>[0],
  ): ReturnType<NearCommands['sendTransaction']> {
    const nearAccountId = args.nearAccount.accountId;
    return await sendTransaction({
      context: this.getContext(),
      nearAccountId,
      walletSession: args.walletSession,
      signedTransaction: args.signedTransaction,
      options: args.options,
    });
  }
  async signDelegateAction(
    args: Parameters<NearCommands['signDelegateAction']>[0],
  ): ReturnType<NearCommands['signDelegateAction']> {
    const nearAccountId = args.nearAccount.accountId;
    const { delegate, options } = args;
    return await signDelegateActionCore({
      context: this.getContext(),
      nearAccountId,
      walletSession: args.walletSession,
      delegate,
      options,
    });
  }
  async signNEP413Message(
    args: Parameters<NearCommands['signNEP413Message']>[0],
  ): ReturnType<NearCommands['signNEP413Message']> {
    const nearAccountId = args.nearAccount.accountId;
    const result = await signNEP413MessageCore({
      context: this.getContext(),
      nearAccountId,
      walletSession: args.walletSession,
      params: args.params,
      options: args.options,
    });
    if (result?.success) {
      await args.options?.afterCall?.(true, result);
    } else {
      const signingError = toError(result?.error || 'NEP-413 signing failed');
      await args.options?.afterCall?.(false, undefined, signingError);
    }
    return result;
  }
}
