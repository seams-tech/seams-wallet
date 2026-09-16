import { expect, test } from '@playwright/test';
import { projectLocalLoginAuthMethods } from '@/SeamsWeb/operations/auth/login';
import { buildActiveEmailOtpAuthMethodFixture } from './helpers/emailOtpAuthMethod.fixtures';

test('projects the verified Email OTP address for the login account menu', () => {
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress: 'n6378056@gmail.com',
    emailHashHex: 'email-hash-login-menu',
  });

  expect(
    projectLocalLoginAuthMethods({
      records: [fixture.record],
      localRecords: [fixture.localRecord],
    }),
  ).toEqual([
    {
      walletId: 'coral-reef-r8f5ju',
      authMethod: 'email_otp',
      emailAddress: 'n6378056@gmail.com',
    },
  ]);
});

test('does not infer an Email OTP address from an unrelated registration authority id', () => {
  const fixture = buildActiveEmailOtpAuthMethodFixture({
    walletId: 'coral-reef-r8f5ju',
    emailAddress: 'n6378056@gmail.com',
    emailHashHex: 'email-hash-login-menu',
  });

  expect(
    projectLocalLoginAuthMethods({
      records: [fixture.record],
      localRecords: [],
    }),
  ).toEqual([
    {
      walletId: 'coral-reef-r8f5ju',
      authMethod: 'email_otp',
      emailAddress: null,
    },
  ]);
});
