import { expect, test } from '@playwright/test';
import {
  PASSKEY_PRF_FIRST_SALT_V1,
  PASSKEY_PRF_SECOND_SALT_V1,
} from '@shared/utils/signingSessionSeal';
import {
  getPrfFirstSaltV1,
  getPrfSecondSaltV1,
} from '../../../packages/mpc-wallet/src/core/signingEngine/webauthnAuth/credentials/helpers';
import {
  getPrfFirstB64uFromCredential,
  redactCredentialExtensionOutputs,
} from '../../../packages/mpc-wallet/src/core/signingEngine/webauthnAuth/credentials/credentialExtensions';
import {
  PRF_FIRST_SALT_V1,
  PRF_SECOND_SALT_V1,
} from '../../../packages/mpc-wallet/src/core/signingEngine/threshold/crypto/prfSalts';
import { PRF_FIRST_SALT_V1_HEX, PRF_SECOND_SALT_V1_HEX, bytesToBase64Url } from './ceremonyFixtures';

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

test('every path to the PRF salts gives the same fixed bytes', () => {
  // Server option builders, the recovery options parser and the platform runtime.
  expect([hex(PASSKEY_PRF_FIRST_SALT_V1), hex(PASSKEY_PRF_SECOND_SALT_V1)]).toEqual([
    PRF_FIRST_SALT_V1_HEX,
    PRF_SECOND_SALT_V1_HEX,
  ]);
  // The salts that `@seams/mpc-wallet/client` exports.
  expect([hex(PRF_FIRST_SALT_V1), hex(PRF_SECOND_SALT_V1)]).toEqual([
    PRF_FIRST_SALT_V1_HEX,
    PRF_SECOND_SALT_V1_HEX,
  ]);
  // The passkey prompt, which takes a copy for each ceremony.
  const first = getPrfFirstSaltV1();
  expect([hex(first), hex(getPrfSecondSaltV1())]).toEqual([
    PRF_FIRST_SALT_V1_HEX,
    PRF_SECOND_SALT_V1_HEX,
  ]);
  first.fill(0);
  expect(hex(getPrfFirstSaltV1())).toBe(PRF_FIRST_SALT_V1_HEX);
  expect(hex(PASSKEY_PRF_FIRST_SALT_V1)).toBe(PRF_FIRST_SALT_V1_HEX);
});

test('the PRF result of the first salt is read from clientExtensionResults and can be redacted', () => {
  const prfFirstB64u = bytesToBase64Url(new Uint8Array(32).fill(7));
  const credential = {
    id: 'credential-1',
    response: { clientDataJSON: 'e30', clientExtensionResults: { prf: {} } },
    clientExtensionResults: { prf: { results: { first: ` ${prfFirstB64u} `, second: 'second' } } },
  };
  expect(getPrfFirstB64uFromCredential(credential)).toBe(prfFirstB64u);
  expect(getPrfFirstB64uFromCredential({ clientExtensionResults: { prf: {} } })).toBeNull();
  expect(getPrfFirstB64uFromCredential({ clientExtensionResults: null })).toBeNull();

  // A credential sent to a server carries no PRF result.
  const redacted = redactCredentialExtensionOutputs(credential);
  expect(redacted.clientExtensionResults).toBeNull();
  expect(redacted.response).toEqual({ clientDataJSON: 'e30', clientExtensionResults: null });
  expect(getPrfFirstB64uFromCredential(redacted)).toBeNull();
});
