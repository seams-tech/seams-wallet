import type { SignNEP413MessageParams, SignNEP413MessageResult } from '@seams/wallet';
import type { useSeams } from '@seams/wallet/react';

type NearSigner = ReturnType<typeof useSeams>['seams']['near'];
type DelegateInput = Parameters<NearSigner['signDelegateAction']>[0]['delegate'];

export type IntendedNearSigningContext = {
  near: NearSigner;
  walletSession: string;
  signerSlot: number;
  onEvent: (event: unknown) => void;
};

type MessageInput = { nearAccountId: string; params: SignNEP413MessageParams };
type DelegateProof = { hash: string; nearAccountId: string; borshBytes: number[] };

declare global {
  interface Window {
    __seamsIntendedE2ESignMessage?: (input: MessageInput) => Promise<SignNEP413MessageResult>;
    __seamsIntendedE2ESignDelegate?: (input: DelegateInput) => Promise<DelegateProof>;
  }
}

export class IntendedNearSigningHelpers {
  constructor(private readonly readContext: () => IntendedNearSigningContext) {}

  install(): void {
    window.__seamsIntendedE2ESignMessage = this.signMessage.bind(this);
    window.__seamsIntendedE2ESignDelegate = this.signDelegate.bind(this);
  }

  private async signMessage(input: MessageInput): Promise<SignNEP413MessageResult> {
    const context = this.readContext();
    const startedAt = performance.now();
    const result = await context.near.signMessage({
      walletSession: context.walletSession,
      nearAccount: input.nearAccountId,
      params: input.params,
      options: { signerSlot: context.signerSlot, onEvent: context.onEvent },
    });
    console.info('[Intended NEAR benchmark]', JSON.stringify({
      event: 'near_sdk_message_signing_timing',
      durationMs: performance.now() - startedAt,
    }));
    return result;
  }

  private async signDelegate(delegate: DelegateInput): Promise<DelegateProof> {
    const context = this.readContext();
    const result = await context.near.signDelegateAction({
      walletSession: context.walletSession,
      nearAccount: delegate.senderId,
      delegate,
      options: { signerSlot: context.signerSlot, onEvent: context.onEvent },
    });
    return {
      hash: result.hash,
      nearAccountId: result.nearAccountId,
      borshBytes: Array.from(result.signedDelegate.borshBytes),
    };
  }
}
