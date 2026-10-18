import { expect, test } from '@playwright/test';
import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import { executeWalletRegistrationEd25519RoundV1 } from '../../packages/wallet/src/core/signingEngine/walletCustody/walletRegistrationEd25519';

type Transport = Parameters<typeof executeWalletRegistrationEd25519RoundV1>[0]['transport'];
type Answer = Awaited<ReturnType<Transport['send']>>;

const executeRequestJson = JSON.stringify({ binding: { lifecycle_id: 'lifecycle-1' }, round: 1 });
const succeeded: Answer = { ok: true, value: { status: 'succeeded' } };
// The Gateway's 409 answer, as the HTTP transport reports it.
const inProgress: Answer = {
  ok: false,
  code: 'execution_in_progress',
  message:
    '{"ok":false,"code":"execution_in_progress","message":"registration execution is already in progress"}',
};

/** Answers each send with the next scripted answer, and repeats the last one. */
class ScriptedRouter {
  readonly bodies: string[] = [];
  readonly waits: number[] = [];

  constructor(private readonly answers: Answer[]) {}

  async send(request: Parameters<Transport['send']>[0]): Promise<Answer> {
    expect(request.kind).toBe('execute');
    expect(request.path).toBe(ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1);
    this.bodies.push(JSON.stringify(request.body));
    const answer = this.answers[Math.min(this.bodies.length, this.answers.length) - 1];
    if (!answer) throw new Error('The scripted Router has no answer');
    return answer;
  }

  async wait(ms: number): Promise<void> {
    this.waits.push(ms);
  }

  run(): Promise<string> {
    return executeWalletRegistrationEd25519RoundV1({
      executeRequestJson,
      transport: this,
      wait: this.wait.bind(this),
    });
  }
}

function sum(total: number, value: number): number {
  return total + value;
}

test('an execute round fails when its execution stays in progress past the retry budget', async () => {
  const router = new ScriptedRouter([inProgress]);
  await expect(router.run()).rejects.toThrow(
    'Router Ed25519 Yao execute failed: {"ok":false,"code":"execution_in_progress"',
  );
  const waited = router.waits.reduce(sum, 0);
  // The budget outlasts the Router's ten-second registration lease.
  expect(waited).toBeGreaterThanOrEqual(15_000);
  expect(waited).toBeLessThan(16_000);
  expect(router.bodies.length).toBe(router.waits.length + 1);
  expect(new Set(router.bodies)).toEqual(new Set([executeRequestJson]));
});

test('an execute round does not repeat a request that failed for another reason', async () => {
  const router = new ScriptedRouter([
    { ok: false, code: 'execution_failed', message: '{"ok":false,"code":"execution_failed"}' },
    succeeded,
  ]);
  await expect(router.run()).rejects.toThrow(
    'Router Ed25519 Yao execute failed: {"ok":false,"code":"execution_failed"}',
  );
  expect(router.bodies).toEqual([executeRequestJson]);
  expect(router.waits).toEqual([]);
});
