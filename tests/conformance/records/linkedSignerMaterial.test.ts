import { expect, test } from '@playwright/test';
import { base64UrlDecode, base64UrlEncode } from '@shared/utils/base64';
import { parseDigestB64u } from '@shared/utils/canonicalPrimitives';
import { parseWalletAuthorityId, parseWalletId } from '@shared/utils/domainIds';
import { requireParsed } from '@shared/passkey-custody/primitives';
import { routerAbMpcMaterialActivationRefToWire } from '@shared/utils/routerAbNormalSigningIdentity';
import {
  openWalletAuthorityLinkedSignerMaterialV1,
  parseWalletAuthorityLinkedSignerMaterialRecordV1,
  sealWalletAuthorityLinkedSignerMaterialV1,
} from '@/core/indexedDB/linkedAuthoritySignerMaterial';
import type { WalletAuthorityLinkedSignerMaterialRecordV1 } from '@/core/indexedDB/passkeyClientDB.types';
import { buildMpcMaterialActivationRefFixture } from '../../unit/helpers/ecdsaMaterialRef.fixtures';
import { committedRecordFixture, readRecordFixture } from './recordFixtures';

/* Linked-device signer material: the MPC material a linked device seals under the factor of
   its new method. The new wallet code must open the records that today's code sealed, through
   the secret sink (audit row 3.9). The AAD binds the authority, the wallet, the method, the
   package set, the target factor, the key family and the material activation. */

type LinkedSignerMaterialFixture = {
  readonly factorSecretB64u: string;
  readonly materialB64u: string;
  readonly records: readonly Record<string, unknown>[];
};

const WALLET_ID = 'wallet-conformance-linked';
const walletId = requireParsed(parseWalletId(WALLET_ID), 'walletId');
const ZERO_DIGEST = parseDigestB64u(base64UrlEncode(new Uint8Array(32)));
const FACTOR_SECRET = new Uint8Array(32).fill(51);
const MATERIAL = new Uint8Array(64).fill(52);
const materialActivation = buildMpcMaterialActivationRefFixture(
  'conformance-linked',
  WALLET_ID,
  'worker',
);
const materialActivationWire = routerAbMpcMaterialActivationRefToWire(materialActivation);
const bytes32 = (fill: number) => new Array<number>(32).fill(fill);

const TARGET_FACTORS = [
  {
    kind: 'passkey',
    walletAuthMethodId: 'wallet-auth-method:conformance-linked-passkey',
    verificationDigestB64u: base64UrlEncode(new Uint8Array(32).fill(53)),
    rpId: 'wallet.example.test',
    credentialIdB64u: base64UrlEncode(new Uint8Array(32).fill(54)),
  },
  {
    kind: 'email_otp',
    walletAuthMethodId: 'wallet-auth-method:conformance-linked-email',
    verificationDigestB64u: base64UrlEncode(new Uint8Array(32).fill(55)),
    emailHashHex: 'b'.repeat(64),
    registrationAuthorityId: 'registration-authority:conformance-linked',
  },
] as const;

/** The record fields other than the sealed bytes, in the shape the parser accepts. */
function unsealedRecordFields(targetFactor: (typeof TARGET_FACTORS)[number]) {
  return {
    kind: 'wallet_authority_linked_signer_material_v1',
    authorityId: 'authority:conformance-linked',
    walletAuthMethodId: targetFactor.walletAuthMethodId,
    activationId: materialActivation.activationId,
    keyFamily: 'ed25519',
    materialActivation,
    packageSetDigestB64u: base64UrlEncode(new Uint8Array(32).fill(56)),
    targetFactor,
    publicFacts: {
      keyFamily: 'ed25519',
      participantIds: [1, 2],
      targetBinding: {
        lifecycle: {
          lifecycle_id: 'ceremony-conformance-linked',
          work_kind: 'registration_prepare',
          primitive_request_kind: 'registration',
          root_share_epoch: 'v1',
          account_id: WALLET_ID,
          session_id: 'ceremony-conformance-linked',
          signer_set_id: 'near',
          selected_server_id: 'worker',
        },
        operation: 'registration',
        session_id: bytes32(1),
        stable_key_context_binding: bytes32(2),
        material_activation: materialActivationWire,
      },
      applicationBinding: {
        wallet_id: WALLET_ID,
        near_ed25519_signing_key_id: 'near-key-conformance-linked',
        signing_root_id: 'project:dev',
        key_creation_signer_slot: 1,
      },
      activationReceipt: {
        transcript: bytes32(3),
        registered_public_key: bytes32(4),
        joined_client_commitment: bytes32(5),
        joined_signing_worker_commitment: bytes32(6),
        signing_worker_verifying_share: bytes32(7),
        state_epoch: 1,
        material_activation: materialActivationWire,
      },
    },
  } as const;
}

/** Seals the material with today's writer and returns the stored record. */
async function sealRecord(
  targetFactor: (typeof TARGET_FACTORS)[number],
): Promise<WalletAuthorityLinkedSignerMaterialRecordV1> {
  const fields = parseWalletAuthorityLinkedSignerMaterialRecordV1({
    ...unsealedRecordFields(targetFactor),
    sealedMaterialB64u: base64UrlEncode(new Uint8Array(1)),
    sealedMaterialDigestB64u: ZERO_DIGEST,
  });
  const sealed = await sealWalletAuthorityLinkedSignerMaterialV1({
    factorSecret: new Uint8Array(FACTOR_SECRET),
    aad: { ...fields, walletId },
    material: new Uint8Array(MATERIAL),
  });
  return parseWalletAuthorityLinkedSignerMaterialRecordV1({ ...fields, ...sealed });
}

function expectedIdentity(record: WalletAuthorityLinkedSignerMaterialRecordV1) {
  return { ...record, walletId };
}

function withoutSealedBytes(record: Record<string, unknown>): Record<string, unknown> {
  const { sealedMaterialB64u: _bytes, sealedMaterialDigestB64u: _digest, ...rest } = record;
  return rest;
}

test('today seals linked signer material in the committed record shape', async () => {
  const records = await Promise.all(TARGET_FACTORS.map(sealRecord));
  const written: LinkedSignerMaterialFixture = {
    factorSecretB64u: base64UrlEncode(FACTOR_SECRET),
    materialB64u: base64UrlEncode(MATERIAL),
    records: JSON.parse(JSON.stringify(records)),
  };
  const committed = await committedRecordFixture('linked-signer-material', written);
  // The nonce is random, so only the fields around the sealed bytes must match.
  expect(written.records.map(withoutSealedBytes)).toEqual(
    committed.records.map(withoutSealedBytes),
  );
  for (const record of records) {
    const opened = await openWalletAuthorityLinkedSignerMaterialV1({
      record,
      factorSecret: new Uint8Array(FACTOR_SECRET),
      expected: expectedIdentity(record),
    });
    expect(opened.kind).toBe('opened_wallet_authority_linked_signer_material_v1');
  }
});

test('today opens the committed linked signer material and refuses each mismatch', async () => {
  const fixture = await readRecordFixture<LinkedSignerMaterialFixture>('linked-signer-material');
  const factorSecret = base64UrlDecode(fixture.factorSecretB64u);
  const otherAuthorityId = requireParsed(parseWalletAuthorityId('authority:other'), 'authorityId');
  for (const raw of fixture.records) {
    const record = parseWalletAuthorityLinkedSignerMaterialRecordV1(raw);
    expect(JSON.parse(JSON.stringify(record))).toEqual(raw);
    const open = (overrides: {
      readonly secret?: Uint8Array<ArrayBuffer>;
      readonly expected?: Partial<ReturnType<typeof expectedIdentity>>;
    }) =>
      openWalletAuthorityLinkedSignerMaterialV1({
        record,
        factorSecret: overrides.secret ?? new Uint8Array(factorSecret),
        expected: { ...expectedIdentity(record), ...overrides.expected },
      });
    const opened = await open({});
    if (opened.kind !== 'opened_wallet_authority_linked_signer_material_v1') {
      throw new Error(`committed material did not open: ${opened.reason}`);
    }
    expect(base64UrlEncode(opened.material)).toBe(fixture.materialB64u);
    const refusals = [
      await open({ secret: new Uint8Array(32).fill(1) }),
      await open({ expected: { authorityId: otherAuthorityId } }),
      await open({
        expected: { targetFactor: { ...record.targetFactor, verificationDigestB64u: ZERO_DIGEST } },
      }),
      await open({ expected: { packageSetDigestB64u: ZERO_DIGEST } }),
    ];
    expect(refusals.map((result) => ('reason' in result ? result.reason : result.kind))).toEqual([
      'sealed_material_authentication_failed',
      'identity_mismatch',
      'target_factor_mismatch',
      'package_digest_mismatch',
    ]);
  }
});
