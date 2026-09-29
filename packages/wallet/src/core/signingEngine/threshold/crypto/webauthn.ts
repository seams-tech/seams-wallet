import type { ProfileAuthenticatorRecord } from '../../../indexedDB';
import {
  type WebAuthnAuthenticatorRecord,
  type WebAuthnCredentialStorePort,
  type WebAuthnPromptPort,
} from '../../webauthnAuth/credentials/collectAuthenticationCredentialForChallengeB64u';
import {
  getPrfFirstB64uFromCredential,
  redactCredentialExtensionOutputs,
} from '../../webauthnAuth/credentials/credentialExtensions';

export { getPrfFirstB64uFromCredential, redactCredentialExtensionOutputs };

type ThresholdAuthenticatorRecord = ProfileAuthenticatorRecord & WebAuthnAuthenticatorRecord;
export type ThresholdCredentialStorePort =
  WebAuthnCredentialStorePort<ThresholdAuthenticatorRecord>;
export type ThresholdWebAuthnPromptPort = WebAuthnPromptPort;
