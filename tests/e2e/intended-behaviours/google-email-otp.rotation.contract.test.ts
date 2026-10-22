import { expect, type Request } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { intendedTest as test, autoConfirmWalletIframeUntil } from './harness';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type RotationRouteStage =
  | 'custody_challenge:recovery_status'
  | 'recovery_status'
  | 'email_otp_challenge:wallet_unlock'
  | 'factor_release:wallet_unlock'
  | 'custody_challenge:recovery_rotate'
  | 'recovery_rotate';

type ObservedRotationRoute = {
  readonly stage: string;
  readonly request: Request;
};

type ParentRotationMessage = {
  readonly walletId: unknown;
  readonly payloadKeys: readonly string[];
  readonly authorizationKeys: readonly string[];
  readonly authorizationKind: unknown;
};

type ParentRotationTraffic = {
  readonly rotationMessages: readonly ParentRotationMessage[];
  readonly custodyChallengeRequests: number;
};

const expectedRouteSequence: readonly RotationRouteStage[] = [
  'custody_challenge:recovery_status',
  'recovery_status',
  'email_otp_challenge:wallet_unlock',
  'factor_release:wallet_unlock',
  'custody_challenge:recovery_rotate',
  'recovery_rotate',
];

class ParentRotationMessageProbe {
  static original: MessagePort['postMessage'];
  static messages: ParentRotationMessage[] = [];
  static custodyChallengeRequests = 0;

  static install(): void {
    ParentRotationMessageProbe.original = MessagePort.prototype.postMessage;
    ParentRotationMessageProbe.messages = [];
    ParentRotationMessageProbe.custodyChallengeRequests = 0;
    MessagePort.prototype.postMessage = ParentRotationMessageProbe.post;
  }

  static post(this: MessagePort, ...args: unknown[]): void {
    const message = args[0];
    if (
      message !== null &&
      typeof message === 'object' &&
      Reflect.get(message, 'type') === 'PM_REQUEST_WALLET_CUSTODY_EMAIL_OTP_CHALLENGE'
    ) {
      ParentRotationMessageProbe.custodyChallengeRequests += 1;
    }
    if (
      message !== null &&
      typeof message === 'object' &&
      Reflect.get(message, 'type') === 'PM_ROTATE_WALLET_RECOVERY_CODES'
    ) {
      const payload = Reflect.get(message, 'payload');
      let walletId: unknown = null;
      let payloadKeys: string[] = [];
      let authorizationKeys: string[] = [];
      let authorizationKind: unknown = null;
      if (payload !== null && typeof payload === 'object') {
        walletId = Reflect.get(payload, 'walletId');
        payloadKeys = Object.keys(payload).sort();
        const authorization = Reflect.get(payload, 'authorization');
        if (authorization !== null && typeof authorization === 'object') {
          authorizationKeys = Object.keys(authorization).sort();
          authorizationKind = Reflect.get(authorization, 'kind');
        }
      }
      ParentRotationMessageProbe.messages.push({
        walletId,
        payloadKeys,
        authorizationKeys,
        authorizationKind,
      });
    }
    Reflect.apply(ParentRotationMessageProbe.original, this, args);
  }

  static read(): ParentRotationTraffic {
    return {
      rotationMessages: ParentRotationMessageProbe.messages,
      custodyChallengeRequests: ParentRotationMessageProbe.custodyChallengeRequests,
    };
  }

  static restore(): void {
    MessagePort.prototype.postMessage = ParentRotationMessageProbe.original;
  }
}

function requestOperation(request: Request): string {
  try {
    const body: unknown = request.postDataJSON();
    if (body !== null && typeof body === 'object') {
      const operation = Reflect.get(body, 'operation');
      return typeof operation === 'string' ? operation : 'missing_operation';
    }
  } catch {
    return 'invalid_json';
  }
  return 'invalid_body';
}

function observeRotationRoute(routes: ObservedRotationRoute[], request: Request): void {
  if (request.method() !== 'POST') return;

  const pathname = new URL(request.url()).pathname;
  let stage: string | null = null;
  if (pathname === '/wallets/custody/email-otp/challenge') {
    stage = `custody_challenge:${requestOperation(request)}`;
  } else if (/^\/wallets\/[^/]+\/recovery\/status$/u.test(pathname)) {
    stage = 'recovery_status';
  } else if (pathname === '/wallet/email-otp/challenge') {
    stage = `email_otp_challenge:${requestOperation(request)}`;
  } else if (pathname === '/wallet/email-otp/factor-release') {
    stage = `factor_release:${requestOperation(request)}`;
  } else if (pathname === '/wallets/recovery/rotate') {
    stage = 'recovery_rotate';
  }
  if (stage) routes.push({ stage, request });
}

function isWalletOwnedEmailPromptStage(stage: string): boolean {
  return stage.startsWith('custody_challenge:') || stage.startsWith('email_otp_challenge:');
}

function routeStage(route: ObservedRotationRoute): string {
  return route.stage;
}

async function runRotationFromPage(): Promise<unknown> {
  const rotate: unknown = Reflect.get(window, '__seamsIntendedE2ERotateEmailOtpRecoveryCodes');
  if (typeof rotate !== 'function') {
    throw new Error('Email OTP recovery rotation hook is unavailable');
  }
  return await rotate();
}

async function readParentRotationTraffic(): Promise<ParentRotationTraffic> {
  const probe: unknown = Reflect.get(globalThis, '__seamsRotationPortProbe');
  if (probe === null || typeof probe !== 'function') {
    throw new Error('Parent rotation port probe is unavailable');
  }
  return Reflect.apply(Reflect.get(probe, 'read'), probe, []);
}

function restoreParentRotationProbe(): void {
  const probe: unknown = Reflect.get(globalThis, '__seamsRotationPortProbe');
  if (probe !== null && typeof probe === 'function') {
    Reflect.apply(Reflect.get(probe, 'restore'), probe, []);
    Reflect.deleteProperty(globalThis, '__seamsRotationPortProbe');
  }
}

test('an Email OTP owner rotates recovery codes through three wallet-owned prompts', async (
  { harness, page, context },
  testInfo,
) => {
  testInfo.setTimeout(240_000);
  await harness.registerEmailOtpWallet();
  await harness.awaitNearReady();

  const walletId = await page.getByTestId('intended-e2e-page').getAttribute('data-wallet-id');
  if (!walletId) throw new Error('Registered wallet identity is missing');

  await page.evaluate(
    `${ParentRotationMessageProbe.toString()}; ParentRotationMessageProbe.install(); globalThis.__seamsRotationPortProbe = ParentRotationMessageProbe;`,
  );
  const routes: ObservedRotationRoute[] = [];
  const observe = observeRotationRoute.bind(null, routes);
  context.on('request', observe);

  try {
    const result: unknown = await autoConfirmWalletIframeUntil(
      page,
      page.evaluate(runRotationFromPage),
      { timeoutMs: 120_000, intervalMs: 100 },
    );
    expect(result).toMatchObject({ kind: 'rotated' });
    if (result === null || typeof result !== 'object') {
      throw new Error('Recovery rotation returned an invalid result');
    }
    expect(Object.keys(result).sort()).toEqual(['issuedAtMs', 'kind', 'storeVersion']);
    const issuedAtMs = Reflect.get(result, 'issuedAtMs');
    const storeVersion = Reflect.get(result, 'storeVersion');
    expect(typeof issuedAtMs).toBe('number');
    expect(Number.isSafeInteger(issuedAtMs)).toBe(true);
    expect(issuedAtMs).toBeGreaterThan(0);
    expect(typeof storeVersion).toBe('string');
    expect(storeVersion.length).toBeGreaterThan(0);

    const routeSequence = routes.map(routeStage);
    expect(routeSequence).toEqual(expectedRouteSequence);
    const walletOwnedEmailPrompts = routeSequence.filter(isWalletOwnedEmailPromptStage).length;
    expect(walletOwnedEmailPrompts).toBe(3);
    const routeStatuses: number[] = [];
    for (const route of routes) {
      const response = await route.request.response();
      if (!response) throw new Error(`${route.stage} did not receive a response`);
      expect(response.status(), route.stage).toBe(200);
      routeStatuses.push(response.status());
    }

    const parentTraffic = await page.evaluate(readParentRotationTraffic);
    expect(parentTraffic.custodyChallengeRequests).toBe(0);
    const parentMessages = parentTraffic.rotationMessages;
    expect(parentMessages).toHaveLength(1);
    expect(parentMessages[0]).toEqual({
      walletId,
      payloadKeys: ['authorization', 'walletId'],
      authorizationKeys: ['kind'],
      authorizationKind: 'email_otp',
    });

    const artifact = testInfo.outputPath('email-otp-recovery-rotation.json');
    await writeFile(
      artifact,
      JSON.stringify(
        {
          kind: 'email_otp_recovery_rotation_e2e_v1',
          resultKind: 'rotated',
          issuedAtMsPresent: true,
          storeVersionPresent: true,
          routeSequence,
          routeStatuses,
          walletOwnedEmailPrompts,
          parentMessage: {
            count: parentMessages.length,
            custodyChallengeRequests: parentTraffic.custodyChallengeRequests,
            walletIdMatched: true,
            payloadKeys: parentMessages[0]?.payloadKeys,
            authorizationKeys: parentMessages[0]?.authorizationKeys,
            authorizationKind: parentMessages[0]?.authorizationKind,
          },
          reproduce:
            'SEAMS_INTENDED_PRODUCTION=1 SEAMS_INTENDED_SKIP_BUILD=1 node tests/scripts/run-wallet-intended-isolated.mjs --require-google-token -- e2e/intended-behaviours/google-email-otp.rotation.contract.test.ts',
        },
        null,
        2,
      ) + '\n',
    );
    await testInfo.attach('email-otp-recovery-rotation.json', {
      path: artifact,
      contentType: 'application/json',
    });
  } finally {
    context.off('request', observe);
    try {
      await page.evaluate(restoreParentRotationProbe);
    } catch {
      // The page may have closed after a failed browser action.
    }
  }
});
