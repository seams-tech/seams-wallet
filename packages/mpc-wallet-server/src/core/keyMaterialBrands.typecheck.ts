import type {
  EcdsaClientVerifyingShareB64u,
  EcdsaKeyHandle,
  EcdsaRelayerKeyId,
  EcdsaThresholdKeyId,
  SigningSessionSealKeyVersion,
} from './keyMaterialBrands';
import {
  formatEcdsaKeyHandleForWire,
  formatSigningSessionSealKeyVersionForWire,
  parseEcdsaClientVerifyingShareB64u,
  parseEcdsaKeyHandle,
  parseEcdsaRelayerKeyId,
  parseSigningSessionSealKeyVersion,
} from './keyMaterialBrands';
import { parseWebAuthnRpId, type WebAuthnRpId } from '@shared/utils/domainIds';
import {
  parseNearEd25519SigningKeyId,
  type NearEd25519SigningKeyId,
} from '@shared/utils/registrationIds';

const seal = parseSigningSessionSealKeyVersion('signing-session-seal-kek-test-r1');
const ecdsaVerifier = parseEcdsaClientVerifyingShareB64u('ecdsa-client-verifier');
const ecdsaRelayerKeyId = parseEcdsaRelayerKeyId('ecdsa-relayer-key-id');
const ecdsaKeyHandle = parseEcdsaKeyHandle('ecdsa-key-handle');
const webAuthnRpIdResult = parseWebAuthnRpId('wallet.example.test');
if (!webAuthnRpIdResult.ok) throw new Error(webAuthnRpIdResult.error.message);
const webAuthnRpId = webAuthnRpIdResult.value;
const nearEd25519SigningKeyId = parseNearEd25519SigningKeyId('ed25519ks_fixture');

function acceptsSeal(value: SigningSessionSealKeyVersion) {
  return formatSigningSessionSealKeyVersionForWire(value);
}

function acceptsEcdsaVerifier(value: EcdsaClientVerifyingShareB64u) {
  return value;
}

function acceptsEcdsaRelayerKeyId(value: EcdsaRelayerKeyId) {
  return value;
}

function acceptsEcdsaThresholdKeyId(value: EcdsaThresholdKeyId) {
  return value;
}

function acceptsEcdsaKeyHandle(value: EcdsaKeyHandle) {
  return formatEcdsaKeyHandleForWire(value);
}

function acceptsWebAuthnRpId(value: WebAuthnRpId) {
  return value;
}

function acceptsNearEd25519SigningKeyId(value: NearEd25519SigningKeyId) {
  return value;
}

acceptsSeal(seal);
acceptsEcdsaVerifier(ecdsaVerifier);
acceptsEcdsaRelayerKeyId(ecdsaRelayerKeyId);
acceptsEcdsaKeyHandle(ecdsaKeyHandle);
acceptsWebAuthnRpId(webAuthnRpId);
acceptsNearEd25519SigningKeyId(nearEd25519SigningKeyId);

// @ts-expect-error raw strings must be parsed at a boundary before core use.
acceptsSeal('signing-session-seal-kek-test-r1');

// @ts-expect-error ECDSA key handles are not threshold key ids.
acceptsEcdsaThresholdKeyId(ecdsaKeyHandle);

// @ts-expect-error raw strings must be parsed at a boundary before core use.
acceptsEcdsaRelayerKeyId('ecdsa-relayer-key-id');

// @ts-expect-error NEAR Ed25519 signing-key ids are not WebAuthn RP ids.
acceptsWebAuthnRpId(nearEd25519SigningKeyId);

// @ts-expect-error WebAuthn RP ids are not NEAR Ed25519 signing-key ids.
acceptsNearEd25519SigningKeyId(webAuthnRpId);
