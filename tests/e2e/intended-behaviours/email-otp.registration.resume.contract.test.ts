import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import { intendedTest as test } from './harness';
import { assertResumedNearRegistration } from './registration-near-resume';

test('Email OTP unlock resumes a lost NEAR execution response after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'email_otp',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
    interruption: 'lost_response',
  });
});
