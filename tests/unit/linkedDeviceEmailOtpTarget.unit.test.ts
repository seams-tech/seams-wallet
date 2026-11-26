import { expect, test } from '@playwright/test';
import type {
  LinkedDeviceApprovalV1,
  LinkedDeviceTargetPreparationV1,
} from '../../packages/shared-ts/src/device-linking/contracts';
import { buildLinkedDeviceTargetPreparationV1 } from '../../packages/shared-ts/src/device-linking/parsers';
import {
  parseLinkDeviceSessionId,
  parseLinkedDeviceEnrollmentId,
  parseLinkedDeviceId,
} from '../../packages/shared-ts/src/signing-lanes/ids';
import {
  parseVerifiedEmailAddress,
  parseWalletAuthMethodId,
  parseWalletId,
  parseWalletKeyId,
} from '../../packages/shared-ts/src/utils/domainIds';
import type { EmailOtpWalletEnrollmentRecord } from '../../packages/mpc-wallet-server/src/core/EmailOtpStores';
import type { LinkedDeviceSessionRecordV1 } from '../../packages/mpc-wallet-server/src/core/deviceLinking/linkedDeviceSessionRecord';
import { D1LinkedDeviceEmailOtpTargetFactorV1 } from '../../packages/mpc-wallet-server/src/router/cloudflare/d1/deviceLinking/d1LinkedDeviceEmailOtpTargetFactor';
import { buildEmailOtpEnrollmentFixture } from './helpers/emailOtpAuthMethod.fixtures';

function required<T>(parsed: { ok: true; value: T } | { ok: false; error: { message: string } }) {
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

const WALLET_ID = required(parseWalletId('wallet-link-target'));
const TARGET_EMAIL = required(parseVerifiedEmailAddress('owner@example.test'));
const ORG_ID = 'org-link-target';

const approval = {
  linkSessionId: required(parseLinkDeviceSessionId('link-session:email-target')),
  walletId: WALLET_ID,
  enrollmentId: required(parseLinkedDeviceEnrollmentId('enrollment:email-target')),
  deviceId: required(parseLinkedDeviceId('linked-device:email-target')),
  targetFactor: { kind: 'email_otp', targetEmail: TARGET_EMAIL },
  expiresAtMs: 10_000,
} as unknown as LinkedDeviceApprovalV1;

const preparation: LinkedDeviceTargetPreparationV1 = buildLinkedDeviceTargetPreparationV1({
  linkSessionId: approval.linkSessionId,
  walletId: approval.walletId,
  enrollmentId: approval.enrollmentId,
  deviceId: approval.deviceId,
  deliveryRecipientPublicKey65B64u:
    'BGsX0fLhLEJH-Lzm5WOkQPJ3A32BLeszoPShOUXYmMKWT-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
  walletAuthMethodId: required(parseWalletAuthMethodId('wallet-auth-method:email-target')),
  ed25519ExportRoot: null,
  targetFactor: { kind: 'email_otp' },
  targetEmail: TARGET_EMAIL,
  ordinarySignerMaterialRecipientRequirements: [
    {
      kind: 'ordinary_signer_material_recipient_requirement_v1',
      walletKeyId: required(parseWalletKeyId('wallet-key:email-target')),
      keyFamily: 'ed25519',
    },
  ],
  issuedAtMs: 1_000,
  expiresAtMs: 10_000,
});

function targetFactor(enrollment: EmailOtpWalletEnrollmentRecord | null) {
  const issued: Record<string, unknown>[] = [];
  const provider = new D1LinkedDeviceEmailOtpTargetFactorV1({
    issuer: {
      create: async (input: Record<string, unknown>) => {
        issued.push(input);
        return {
          ok: true,
          challenge: { challengeId: 'challenge-1', issuedAtMs: 1_000, expiresAtMs: 5_000 },
          delivery: { emailHint: 'o***@example.test' },
        };
      },
    } as never,
    verifier: {} as never,
    enrollments: { readEnrollment: async () => enrollment },
    orgId: ORG_ID,
    grants: {} as never,
  });
  return { provider, issued };
}

function start(provider: D1LinkedDeviceEmailOtpTargetFactorV1) {
  return provider.startChallengeV1({
    session: {} as LinkedDeviceSessionRecordV1,
    approval,
    preparation,
    resend: false,
    requestedAtMs: 1_000,
  });
}

function walletEnrollment(email: string): EmailOtpWalletEnrollmentRecord {
  return buildEmailOtpEnrollmentFixture({
    walletId: String(WALLET_ID),
    orgId: ORG_ID,
    providerUserId: 'google:owner-subject',
    email,
    nowMs: 100,
  });
}

test('a wallet with no Email OTP sends a registration code to the typed address', async () => {
  const { provider, issued } = targetFactor(null);
  expect(await start(provider)).toMatchObject({ kind: 'sent', challengeId: 'challenge-1' });
  expect(issued).toHaveLength(1);
  expect(issued[0]).toMatchObject({
    userId: String(TARGET_EMAIL),
    email: TARGET_EMAIL,
    action: 'wallet_email_otp_registration',
  });
});

test("a wallet with Email OTP sends a device-link code under the enrollment's identity", async () => {
  const { provider, issued } = targetFactor(walletEnrollment(String(TARGET_EMAIL)));
  expect(await start(provider)).toMatchObject({ kind: 'sent' });
  expect(issued).toHaveLength(1);
  expect(issued[0]).toMatchObject({
    userId: 'google:owner-subject',
    orgId: ORG_ID,
    action: 'wallet_email_otp_device_link',
    operation: 'device_link',
  });
  // The issuer reads the address from the enrollment, so the request names none.
  expect(issued[0]).not.toHaveProperty('email');
});

test("a typed address that is not the enrollment's address is refused", async () => {
  const { provider, issued } = targetFactor(walletEnrollment('other@example.test'));
  expect(await start(provider)).toMatchObject({ kind: 'refused', code: 'target_email_mismatch' });
  expect(issued).toHaveLength(0);
});
