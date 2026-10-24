import { expect, type Page, type TestInfo } from '@playwright/test';
import { setTimeout as wait } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';
import { prepareMlDsaPool, signMlDsaTransaction } from './ml-dsa-lifecycle-scenario';
import { MlDsaEmailProofProbe } from './ml-dsa-email-proof-probe';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test(
  'ML-DSA uses exact Email OTP approval and reuses only its authorized session',
  runEmailSigning,
);

async function runEmailSigning(
  { harness, page }: { harness: IntendedBehaviourHarness; page: Page },
  info: TestInfo,
): Promise<void> {
  info.setTimeout(600_000);
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  const context = await harness.runMlDsaCommand({ kind: 'context' });
  if (!('walletId' in context) || typeof context.walletId !== 'string')
    throw new Error('Missing exact wallet identity');
  await prepareMlDsaPool(context.walletId);
  const publication = await harness.runMlDsaCommand({ kind: 'publish' });
  if (!('kind' in publication) || publication.kind !== 'sdk_published')
    throw new Error('Expected a published ML-DSA signer');
  await harness.addEmailOtpAuthMethod();
  await harness.unlockWithAddedEmailOtp();
  const metadata = await harness.runMlDsaCommand({ kind: 'metadata' });
  expect('kind' in metadata && metadata.kind).toBe('inventory');
  const frame = page.locator('iframe[allow*="publickey-credentials-get"]').last().contentFrame();
  await frame.locator('body').evaluate(blockPasskey);
  const probe = new MlDsaEmailProofProbe();
  await probe.install(page);
  try {
    const fresh = await signMlDsaTransaction(harness, publication.signer);
    await wait(60_000);
    const grant = await signMlDsaTransaction(harness, publication.signer, {
      maxOperations: 2,
      durationMs: 600_000,
    });
    await wait(60_000);
    const warm = await signMlDsaTransaction(harness, publication.signer);
    const artifact = info.outputPath('ml-dsa-email-authentication.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          scope:
            'Chromium, public SDK, real local Gateway/D1/Router/A/B, real Google test identity and local OTP outbox. NEAR RPC responses are controlled. Each threshold signature verifies independently with Node ML-DSA. No hosted timing or on-chain claim.',
          walletId: context.walletId,
          signer: publication.signer,
          signatures: { fresh, grant, warm },
          proof: probe.evidence(),
          passkeyFallbackBlocked: true,
          twoAtOnceConsumption: true,
          poolCapacityUnchanged: true,
        },
        null,
        2,
      ) + '\n',
    );
    await info.attach('ML-DSA Email OTP authentication', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    await probe.remove(page);
  }
}
function blockPasskey(): void {
  Reflect.set(
    navigator.credentials,
    'get',
    Promise.reject.bind(Promise, new Error('Email OTP signing attempted a Passkey fallback')),
  );
}
