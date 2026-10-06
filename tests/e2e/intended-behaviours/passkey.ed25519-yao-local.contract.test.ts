import { writeFile } from 'node:fs/promises';
import { expect, type BrowserContext, type Request, type Route, type TestInfo } from '@playwright/test';
import { requireRecord } from '@shared/utils/validation';
import { intendedTest as test, type IntendedBehaviourHarness } from './harness';

async function verifyLocalEd25519YaoRegistration({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.signNearTransaction('post_registration');
  await harness.signNearTransaction('post_registration');
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
}

test(
  'public Ed25519 Yao registration signs immediately and after refresh',
  verifyLocalEd25519YaoRegistration,
);

async function verifyLocalEd25519YaoAddSignerAndSigning({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.addPasskeyEd25519YaoWalletSigner();
}

test(
  'public Ed25519 Yao add-signer persists a distinct signer',
  verifyLocalEd25519YaoAddSignerAndSigning,
);

async function verifyEcdsaAddSignerSignsAtOnceAndAfterUnlock({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  await harness.addPasskeyEcdsaWalletSigner({ loseFinalizeResponseOnce: true });
  await harness.signNearTransaction('post_registration');
  await harness.signTempoTransaction('post_registration');
  await harness.signArcEvmTransaction('post_registration');
  await harness.lockWallet();
  await harness.assertWalletLocked();
  await harness.unlockPasskeyWallet();
  await harness.signNearTransaction('post_unlock');
  await harness.signTempoTransaction('post_unlock');
  await harness.signArcEvmTransaction('post_unlock');
}

test(
  'public ECDSA add-signer lets an Ed25519 wallet sign NEAR, Tempo and Arc at once and after unlock, across a lost finalize response',
  verifyEcdsaAddSignerSignsAtOnceAndAfterUnlock,
);

async function verifyExactTransportRetry({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyEd25519YaoWalletWithExactTransportRetry();
  await harness.signNearTransaction('post_registration');
}

test(
  'uncertain Router transport replays the registration and signs with the ready wallet',
  verifyExactTransportRetry,
);

async function verifyTerminalFailureWithoutRetry({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.assertPasskeyEd25519YaoTerminalFailureWithoutRetry();
}

test('terminal burned execution fails without retry', verifyTerminalFailureWithoutRetry);

async function verifyNearFinalizeResumesFromItsDecision({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWalletAcrossNearFinalizeStorageLoss();
  await harness.signNearTransaction('post_unlock');
}

test(
  'deferred NEAR finalize that loses storage after its decision resumes from the decision and signs',
  verifyNearFinalizeResumesFromItsDecision,
);

async function verifyInterruptedExportAuthorizationResumes({
  harness,
}: {
  harness: IntendedBehaviourHarness;
}): Promise<void> {
  await harness.registerPasskeyWallet();
  await harness.awaitNearReady();
  await harness.unlockPasskeyWallet();
  await harness.exportEd25519KeyAcrossInterruptedAuthorization();
}

test(
  'an Ed25519 export interrupted after its authorization committed is admitted by the exact retry',
  verifyInterruptedExportAuthorizationResumes,
);

async function verifyNearMessageSigningAfterRefresh(
  { harness }: { harness: IntendedBehaviourHarness },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  const first = await harness.signNearMessage('Approve checkout before refresh');
  await harness.refreshPagePreservingWalletStorage();
  const second = await harness.signNearMessage('Approve checkout after refresh');
  await harness.signNearTransactionAfterRefresh();
  const artifactPath = testInfo.outputPath('near-message-signatures.json');
  await writeFile(artifactPath, JSON.stringify({ first, second }, null, 2), 'utf8');
  await testInfo.attach('near-message-signatures.json', {
    path: artifactPath,
    contentType: 'application/json',
  });
}

test(
  'public NEAR message signatures verify against the registered key across refresh',
  verifyNearMessageSigningAfterRefresh,
);

class ChangedPrepareAuthority {
  prepareResponses = 0;
  finalizeRequests = 0;

  async changeResponse(route: Route): Promise<void> {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const body = requireRecord(await response.json(), 'prepare response');
    expect(body.kind).toBe('reusable_wallet_session');
    const status = requireRecord(body.session_status, 'prepare session');
    const authorization = requireRecord(status.authorization, 'prepare authority');
    if (typeof authorization.authorityRevocationEpoch !== 'number') {
      throw new Error('Expected the admitted authority revocation epoch');
    }
    authorization.authorityRevocationEpoch += 1;
    this.prepareResponses += 1;
    await route.fulfill({ response, json: body });
  }

  countFinalize(request: Request): void {
    if (new URL(request.url()).pathname === '/router-ab/ed25519/sign') {
      this.finalizeRequests += 1;
    }
  }
}

async function verifyPrepareAuthorityReconciliation(
  { harness, context }: { harness: IntendedBehaviourHarness; context: BrowserContext },
  testInfo: TestInfo,
): Promise<void> {
  await harness.registerPasskeyEd25519YaoWallet();
  const changed = new ChangedPrepareAuthority();
  const change = changed.changeResponse.bind(changed);
  const count = changed.countFinalize.bind(changed);
  const preparePath = '**/router-ab/ed25519/sign/prepare';
  context.on('request', count);
  await context.route(preparePath, change);
  try {
    await expect(harness.signNearTransaction('post_registration')).rejects.toThrow('Wallet Session authority changed before Ed25519 client signing');
    expect(changed.prepareResponses).toBe(1);
    expect(changed.finalizeRequests).toBe(0);
  } finally {
    await context.unroute(preparePath, change);
    context.off('request', count);
  }
  await harness.refreshPagePreservingWalletStorage();
  await harness.signNearTransactionAfterRefresh();
  await harness.signNearMessage('Verify the admitted NEAR session');
  const artifact = testInfo.outputPath('near-prepare-authority.json');
  await writeFile(
    artifact,
    JSON.stringify(
      {
        changedPrepareResponses: changed.prepareResponses,
        finalizeRequestsAfterChangedAuthority: changed.finalizeRequests,
        validTransactionAndMessageVerified: true,
      },
      null,
      2,
    ),
  );
  await testInfo.attach('near-prepare-authority', {
    path: artifact,
    contentType: 'application/json',
  });
}

test(
  'NEAR rejects changed prepare authority before finalize and permits the next valid operation',
  verifyPrepareAuthorityReconciliation,
);
