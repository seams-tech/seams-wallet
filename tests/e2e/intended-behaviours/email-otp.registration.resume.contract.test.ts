import { assertIndependentNearRegistration } from './registration-near-gate';
import {
  assertLateNearCompletionKeepsWalletLocked,
  assertNearReadyTransactionRollsBack,
} from './registration-near-gate';
import {
  ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
  ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
} from '@shared/utils/routerAbEd25519Yao';
import { intendedTest as test } from './harness';
import { assertResumedNearRegistration } from './registration-near-resume';

test('Email OTP unlock resumes planned NEAR admission after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'email_otp',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_ADMISSION_PATH_V1,
    interruption: 'before_request',
  });
});

test('Email OTP unlock resumes the exact encrypted NEAR execution after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'email_otp',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
    interruption: 'before_request',
  });
});

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

test('Email OTP unlock resumes a lost NEAR finalization response after reload', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'email_otp',
    path: '/wallets/register/near-provisioning',
    interruption: 'lost_response',
  });
});

test('Email OTP unlock resumes persisted joined NEAR material without an execution checkpoint', async ({
  harness,
  context,
}) => {
  await assertResumedNearRegistration({
    harness,
    context,
    factor: 'email_otp',
    path: '/wallets/register/near-provisioning',
    interruption: 'before_request',
    retainedCompletion: 'sealed_material',
  });
});

test('Email OTP late NEAR finalization preserves wallet lock and resumes on unlock', async ({
  harness,
  context,
}) => {
  await assertLateNearCompletionKeepsWalletLocked({
    harness,
    context,
    factor: 'email_otp',
    lockSource: 'same_tab',
  });
});

test('email-otp NEAR readiness transaction rollback retains its repair journal', async ({
  harness,
  context,
}) => {
  await assertNearReadyTransactionRollsBack({ harness, context, factor: 'email_otp' });
});

test('email-otp late NEAR completion respects a lock from another tab', async ({
  harness,
  context,
}) => {
  await assertLateNearCompletionKeepsWalletLocked({
    harness,
    context,
    factor: 'email_otp',
    lockSource: 'other_tab',
  });
});

test('email-otp NEAR completion preserves an exhausted EVM signing budget', async ({
  harness,
  context,
}) => {
  await assertIndependentNearRegistration({
    harness,
    context,
    factor: 'email_otp',
    path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
    exhaustBudget: true,
  });
});
