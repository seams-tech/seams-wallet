import type {
  AuthorizedEcdsaPreprocessingCapability,
  AuthorizedEvmFamilyEcdsaSigningCapability,
  ExactEvmFamilyWalletSessionAuthorization,
} from '../../packages/wallet/src/core/signingEngine/session/material/ecdsaSigningCapability';

declare const preprocessing: AuthorizedEcdsaPreprocessingCapability;
// @ts-expect-error Preprocessing proves no remaining transaction signing allowance.
const signing: AuthorizedEvmFamilyEcdsaSigningCapability = preprocessing;
// @ts-expect-error A broad spread must retain the preprocessing admission discriminant.
const signingSpread: AuthorizedEvmFamilyEcdsaSigningCapability = { ...preprocessing };
// @ts-expect-error Session identity for preprocessing is not signing authorization.
const authorization: ExactEvmFamilyWalletSessionAuthorization = preprocessing.authorization;
// @ts-expect-error Casting cannot cross the incompatible authority discriminants.
const signingCast = preprocessing as AuthorizedEvmFamilyEcdsaSigningCapability;
void signingCast;
void signing;
void signingSpread;
void authorization;

const directSigning: AuthorizedEvmFamilyEcdsaSigningCapability = {
  kind: 'authorized_evm_family_ecdsa_signing_capability',
  capability: preprocessing.capability,
  // @ts-expect-error A direct object literal cannot turn preprocessing into signing authority.
  authorization: preprocessing.authorization,
};
void directSigning;

declare const passkeyRuntime: Extract<
  ExactEvmFamilyWalletSessionAuthorization['runtime'],
  { authBinding: { kind: 'passkey' } }
>;
declare const emailAuthMethod: Extract<
  ExactEvmFamilyWalletSessionAuthorization['selectedAuthMethod'],
  { kind: 'email_otp' }
>;
// @ts-expect-error A preprocessing session cannot pair an email authority with a passkey runtime.
const mismatchedAuth: AuthorizedEcdsaPreprocessingCapability['authorization'] = {
  ...preprocessing.authorization,
  runtime: passkeyRuntime,
  selectedAuthMethod: emailAuthMethod,
};
void mismatchedAuth;
