/**
 * Compile-time fixtures for the same-device auth-method addition contract.
 *
 * Every `@ts-expect-error` below is a state the contract forbids. If one ever
 * starts compiling, the branch union has been widened — a same-family addition
 * has become expressible — and this file fails the build rather than the
 * behaviour failing in a browser.
 */

import {
  type AddWalletAuthMethodBranchV1,
  type WalletAuthMethodFamilyV1,
} from './addWalletAuthMethod';

/* Exhaustiveness: the switch below must cover both branches to compile. */
function targetFamilyByHand(branch: AddWalletAuthMethodBranchV1): WalletAuthMethodFamilyV1 {
  switch (branch) {
    case 'passkey_to_email_otp':
      return 'email_otp';
    case 'email_otp_to_passkey':
      return 'passkey';
    default: {
      const unhandled: never = branch;
      return unhandled;
    }
  }
}
void targetFamilyByHand;

/* A third branch is not addable without changing the union. */
// @ts-expect-error 'passkey_to_passkey' is not a branch the contract models
const unsupportedBranch: AddWalletAuthMethodBranchV1 = 'passkey_to_passkey';
void unsupportedBranch;
