import { expect, type Route, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isHex, recoverTransactionAddress } from 'viem';
import {
  intendedTest as test,
  requireNearSigningResult,
  verifyNearEd25519Signature,
  waitForWalletIframeConfirmationSettlement,
} from './harness';
import { GatewayRequestEvidence } from './gateway-request-evidence';
import { NearRegistrationGate } from './registration-near-gate';

class LostActivationResponse {
  ceremonyId = '';
  walletId = '';
  walletKeys: { chainTarget: { chainId: number }; thresholdOwnerAddress: string }[] = [];
  exactReplays = 0;
  unlocks = 0;
  otherRegistrationRequests = 0;
  nearProvisioningRequests = 0;
  nextResponse: 'committed' | 'wrong_activation_digest' = 'committed';
  private originalBody: string | null = null;
  private projection: unknown = null;

  observe(request: Request): void {
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'POST') return;
    if (pathname === '/wallet/unlock/verify') {
      expect(request.postDataJSON().expected_origin).toBe(new URL(request.frame().url()).origin);
      this.unlocks += 1;
    }
    if (
      pathname === '/wallets/register/near-admission' ||
      pathname === '/wallets/register/near-provisioning'
    ) {
      this.nearProvisioningRequests += 1;
    } else if (pathname.startsWith('/wallets/register/') && pathname !== '/wallets/register/activate') {
      this.otherRegistrationRequests += 1;
    }
  }

  async handle(route: Route): Promise<void> {
    try {
      await this.deliverReplay(route);
    } catch (error) {
      await route.abort();
      throw error;
    }
  }

  private async deliverReplay(route: Route): Promise<void> {
    const body = route.request().postData();
    const headers = await route.request().allHeaders();
    if (process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1') {
      const accessToken = process.env.SEAMS_INTENDED_BENCHMARK_ACCESS_TOKEN;
      if (!accessToken || accessToken.length < 32) {
        throw new Error('Hosted activation replay requires benchmark access');
      }
      // Direct replay bypasses the browser route that supplies benchmark access.
      headers['x-r150-benchmark-access'] = accessToken;
    }
    if (this.originalBody === null) {
      this.originalBody = body;
      const first = await route.fetch({ headers });
      expect(first.ok()).toBe(true);
      const committed = await first.json();
      expect(committed.registrationEstablishedSession.kind).toBe('issued');
      this.ceremonyId = route.request().postDataJSON().registrationCeremonyId;
      expect(this.ceremonyId).toEqual(expect.any(String));
      this.walletId = committed.walletId;
      this.walletKeys = committed.ecdsa.walletKeys;
      // Discard the committed response and deliver the browser's exact transport replay.
    } else {
      expect(route.request().postDataJSON()).toEqual(JSON.parse(this.originalBody));
    }
    const replay = await route.fetch({ headers });
    expect(replay.ok()).toBe(true);
    const committed = await replay.json();
    expect(committed.walletId).toBe(this.walletId);
    expect(committed.registrationEstablishedSession.kind).toBe('already_committed');
    expect(committed.registrationEstablishedSession.session).not.toHaveProperty(
      'operationCredential',
    );
    expect(committed.ecdsa.walletKeys).toEqual(this.walletKeys);
    if (this.projection !== null) expect(committed).toEqual(this.projection);
    this.projection = committed;
    this.exactReplays += 1;
    if (this.nextResponse === 'wrong_activation_digest') {
      this.nextResponse = 'committed';
      const altered = structuredClone(committed);
      altered.ecdsa.activation.activation_request_digest.bytes[0] ^= 1;
      await route.fulfill({ response: replay, json: altered });
      return;
    }
    await route.fulfill({ response: replay });
  }

  requestDigest(): string {
    if (!this.originalBody) throw new Error('Activation was never observed');
    return createHash('sha256').update(this.originalBody).digest('hex');
  }
}

for (const signerPlan of ['ecdsa_only', 'mixed'] as const) {
  test(`Passkey ${signerPlan} activation response loss resumes the same wallet after reload and signs`, async ({
    harness,
    context,
    page,
  }, testInfo) => {
    const lost = new LostActivationResponse();
    const nearGate = new NearRegistrationGate();
    const holdNear = nearGate.hold.bind(nearGate);
    const nearPath = '**/wallets/register/near-provisioning';
    const gateway = new GatewayRequestEvidence();
    gateway.start(context);
    const handle = lost.handle.bind(lost);
    const observe = lost.observe.bind(lost);
    const activatePath = '**/wallets/register/activate';
    context.on('request', observe);
    await context.route(activatePath, handle);
    try {
      if (signerPlan === 'ecdsa_only') {
        await expect(harness.registerPasskeyEcdsaOnlyWallet()).rejects.toThrow(
          'exact-method unlock',
        );
      } else {
        await expect(harness.registerPasskeyWallet()).rejects.toThrow('exact-method unlock');
      }
      expect(lost.exactReplays).toBe(1);
      expect(lost.unlocks).toBe(0);
      const registrationRequests = lost.otherRegistrationRequests;
      expect(registrationRequests).toBeGreaterThan(0);
      await page.reload();
      if (signerPlan === 'mixed') await context.route(nearPath, holdNear);
      const pendingWallet = page.getByLabel('Pending wallet', { exact: true });
      const recovery = page.getByTestId('registration-resume-result');
      await pendingWallet.fill('unrelated-wallet.testnet');
      await page.getByRole('button', { name: 'Resume with exact passkey', exact: true }).click();
      await expect(recovery).toHaveAttribute('data-state', 'failed');
      await expect(recovery).toContainText('pending ECDSA registration commit was not found');
      expect(lost.exactReplays).toBe(1);
      expect(lost.unlocks).toBe(0);
      await pendingWallet.fill(lost.walletId);
      lost.nextResponse = 'wrong_activation_digest';
      await page.getByRole('button', { name: 'Resume with exact passkey', exact: true }).click();
      await expect(recovery).toHaveAttribute('data-state', 'failed');
      await expect(recovery).toContainText('pending ECDSA activation facts mismatch');
      expect(lost.unlocks).toBe(0);
      const resumeStartedAt = performance.now();
      await page.getByRole('button', { name: 'Resume with exact passkey', exact: true }).click();
      await expect(recovery).not.toHaveAttribute('data-state', 'pending', { timeout: 60_000 });
      const resumeEndedAt = performance.now();
      expect(JSON.parse(await recovery.innerText()).kind).toBe('published');
      expect(JSON.parse(await recovery.innerText()).result).toEqual({
        kind: 'published',
        walletId: lost.walletId,
        registrationCeremonyId: lost.ceremonyId,
        sessionResult: 'already_committed',
      });
      expect(lost.exactReplays).toBe(3);
      expect(lost.unlocks).toBe(1);
      expect(lost.otherRegistrationRequests).toBe(registrationRequests);

      await page.getByTestId('intended-sign-arc-evm').click();
      const confirm = page
        .frameLocator('iframe.seams-wallet-overlay-iframe')
        .locator('#seams-confirm-portal button.btn-confirm, #seams-confirm-portal button.confirm')
        .last();
      await confirm.click({ timeout: 30_000 });
      const result = page.getByTestId('intended-result-json');
      await expect(result).toContainText('arc_evm_sign_success', { timeout: 60_000 });
      const signed = JSON.parse(await result.innerText()).action.result;
      if (!isHex(signed.rawTxHex)) throw new Error('Expected a serialized signed transaction');
      const recoveredAddress = await recoverTransactionAddress({
        serializedTransaction: signed.rawTxHex,
      });
      const registeredKey = lost.walletKeys.find(matchesChain.bind(null, signed.chainId));
      if (!registeredKey) throw new Error('Signed chain has no registered key');
      expect(recoveredAddress.toLowerCase()).toBe(
        registeredKey.thresholdOwnerAddress.toLowerCase(),
      );

      if (signerPlan === 'mixed') {
        await expect.poll(nearGate.observed.bind(nearGate), { timeout: 60_000 }).toBeGreaterThan(0);
        const pendingSession = await harness.readCurrentWalletSessionStatus();
        nearGate.release();
        await waitForWalletIframeConfirmationSettlement(page);
        await page.getByTestId('intended-await-near-ready').click({ timeout: 10_000 });
        await expect(result).toContainText('near_provisioning_ready', { timeout: 60_000 });
        const ready = JSON.parse(await result.innerText()).action.result;
        expect(ready.walletId).toBe(lost.walletId);
        const readySession = await harness.readCurrentWalletSessionStatus();
        expect(readySession.walletSessionId).toBe(pendingSession.walletSessionId);
        expect(readySession.quotaId).toBe(pendingSession.quotaId);
        expect(readySession.remainingUses).toBe(pendingSession.remainingUses);
        expect(readySession.expiresAtMs).toBe(pendingSession.expiresAtMs);
        expect(readySession.authorization.capabilitySubjects).toEqual(
          expect.arrayContaining([...pendingSession.authorization.capabilitySubjects]),
        );
        await page.getByTestId('intended-sign-near').click();
        await confirm.click({ timeout: 30_000 });
        await expect(result).toContainText('near_sign_success', { timeout: 60_000 });
        const nearResult = requireNearSigningResult(JSON.parse(await result.innerText()), {
          walletId: lost.walletId,
          nearAccountId: ready.nearAccountId,
        });
        await verifyNearEd25519Signature({
          registration: { operationalPublicKey: ready.operationalPublicKey },
          result: nearResult,
        });
        expect(lost.unlocks).toBe(1);
        expect(lost.otherRegistrationRequests).toBe(registrationRequests);
        expect(lost.nearProvisioningRequests).toBeGreaterThan(0);
      }

      const evidence = {
        kind: 'registration_activation_response_loss_e2e_v1',
        signerPlan,
        reproduce:
          'node tests/scripts/run-wallet-intended-isolated.mjs -- e2e/intended-behaviours/passkey.registration.activation-resume.contract.test.ts',
        walletId: lost.walletId,
        registrationCeremonyId: lost.ceremonyId,
        activationRequestSha256: lost.requestDigest(),
        exactReplays: lost.exactReplays,
        exactMethodUnlocks: lost.unlocks,
        recovery: {
          elapsedMs: resumeEndedAt - resumeStartedAt,
          gateway: await gateway.window(resumeStartedAt, resumeEndedAt),
        },
        verifiedSignatures: signerPlan === 'mixed' ? 2 : 1,
        nearSignatureVerified: signerPlan === 'mixed',
        evmSignedWhileNearHeld: signerPlan === 'mixed',
        nearExtensionPreservedSession: signerPlan === 'mixed',
        nearProvisioningRequests: lost.nearProvisioningRequests,
        alteredActivationDigestRejectedBeforeUnlock: true,
        unrelatedWalletRejectedBeforeReplay: true,
        applicationSuppliesCeremonyId: false,
        applicationSuppliesPasskeyOrigin: false,
        registrationRequestsBeforeResume: registrationRequests,
        registrationRequestsAfterResume: lost.otherRegistrationRequests,
        registeredAddress: registeredKey.thresholdOwnerAddress,
        recoveredAddress,
        rawTxHex: signed.rawTxHex,
      };
      const hosted = process.env.SEAMS_INTENDED_EXTERNAL_GATEWAY === '1';
      const arm = process.env.SEAMS_INTENDED_BENCHMARK_ARM;
      const region = process.env.SEAMS_INTENDED_PROBE_REGION;
      const runId = process.env.SEAMS_INTENDED_BENCHMARK_RUN_ID;
      if (
        hosted &&
        ((arm !== 'd1' && arm !== 'do') ||
          !region ||
          !/^[a-z0-9-]+$/u.test(region) ||
          !runId ||
          !/^[a-z0-9-]+$/u.test(runId))
      ) {
        throw new Error('Hosted activation recovery requires an arm, region and run identity');
      }
      const suffix = hosted ? `-hosted_${arm}-${region}-${runId}-${testInfo.repeatEachIndex}` : '';
      const artifactName = `registration-activation-resume-${signerPlan}${suffix}.json`;
      const artifactPath = path.resolve(testInfo.config.rootDir, '../.artifacts/r150', artifactName);
      await mkdir(path.dirname(artifactPath), { recursive: true });
      await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`);
      await testInfo.attach(artifactName, {
        path: artifactPath,
        contentType: 'application/json',
      });
    } finally {
      nearGate.release();
      await context.unroute(nearPath, holdNear);
      gateway.stop(context);
      context.off('request', observe);
      await context.unroute(activatePath, handle);
    }
  });
}

function matchesChain(chainId: number, walletKey: { chainTarget: { chainId: number } }): boolean {
  return walletKey.chainTarget.chainId === chainId;
}
