import { intendedTest as test } from './harness';

test('passkey registration establishes an immediately usable owner session', async ({ harness }) => {
  await harness.registerPasskeyWallet();
  await harness.assertRegistrationOwnerSessionIsActive();
  await harness.signTempoTransaction('post_registration');
  await harness.awaitNearReady();
  await harness.signNearTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.assertRegistrationOwnerSessionIsActive();
});
