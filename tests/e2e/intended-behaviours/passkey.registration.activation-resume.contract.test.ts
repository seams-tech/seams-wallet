import { expect, type Route, type Request } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isHex, recoverTransactionAddress } from 'viem';
import { intendedTest as test } from './harness';
import { GatewayRequestEvidence } from './gateway-request-evidence';

class LostActivationResponse {
  ceremonyId = '';
  walletId = '';
  walletKeys: { chainTarget: { chainId: number }; thresholdOwnerAddress: string }[] = [];
  exactReplays = 0;
  unlocks = 0;
  otherRegistrationRequests = 0;
  nextResponse: 'committed' | 'wrong_activation_digest' = 'committed';
  private originalBody: string | null = null;
  private projection: unknown = null;

  observe(request: Request): void {
    const pathname = new URL(request.url()).pathname;
    if (request.method() !== 'POST') return;
    if (pathname === '/wallet/unlock/verify') this.unlocks += 1;
    if (pathname.startsWith('/wallets/register/') && pathname !== '/wallets/register/activate') {
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
    if (this.originalBody === null) {
      this.originalBody = body;
      const first = await route.fetch();
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
    const replay = await route.fetch();
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
      await page.getByLabel('Pending wallet', { exact: true }).fill(lost.walletId);
      await page.getByLabel('Registration ceremony', { exact: true }).fill(lost.ceremonyId);
      lost.nextResponse = 'wrong_activation_digest';
      await page.getByRole('button', { name: 'Resume with exact passkey', exact: true }).click();
      const recovery = page.getByTestId('registration-resume-result');
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
        verifiedSignatures: 1,
        alteredActivationDigestRejectedBeforeUnlock: true,
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
      gateway.stop(context);
      context.off('request', observe);
      await context.unroute(activatePath, handle);
    }
  });
}

function matchesChain(chainId: number, walletKey: { chainTarget: { chainId: number } }): boolean {
  return walletKey.chainTarget.chainId === chainId;
}
