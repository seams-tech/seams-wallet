import type { ExclusiveUnion } from '@shared/utils/variant';

export type SignNEP413MessageParams = {
  message: string;
  recipient: string;
  state?: string;
};

export type SignNEP413MessageResult = ExclusiveUnion<
  | {
      success: true;
      accountId: string;
      publicKey: string;
      signature: string;
      nonce: string;
      state?: string;
    }
  | { success: false; error: string }
>;

export type SyncAccountResult = ExclusiveUnion<
  | {
      success: true;
      accountId: string;
      walletId: string;
      nearAccountId: string;
      nearEd25519SigningKeyId: string;
      publicKey: string;
      message: string;
      loginState: {
        isLoggedIn: boolean;
      };
    }
  | { success: false; error: string }
>;
