import { ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1 } from '@shared/utils/routerAbEd25519Yao';
import type { RouterAbEd25519YaoHttpActivationTransportV1 } from '../threshold/ed25519/yaoClient';

/** Delays between sends of one execute request while its execution is in progress. */
const IN_PROGRESS_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
/**
 * The longest total delay. It outlasts the Router's ten-second registration
 * lease, after which the exact request takes the execution over.
 */
const IN_PROGRESS_RETRY_BUDGET_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one registration execute round at the Router and returns its result.
 *
 * The Router claims a registration before it runs it. While an earlier send
 * of the same request holds that claim, the answer is `execution_in_progress`.
 * A resume after a reload meets this: the page lost the reply of its first
 * send, and the Router still runs it. The exact request is sent again with
 * bounded backoff until the Router answers it with the recorded result or
 * lets it take the lapsed claim over.
 */
export async function executeWalletRegistrationEd25519RoundV1(input: {
  readonly executeRequestJson: string;
  readonly transport: Pick<RouterAbEd25519YaoHttpActivationTransportV1, 'send'>;
  readonly wait?: (ms: number) => Promise<void>;
}): Promise<string> {
  const wait = input.wait ?? delay;
  const body = JSON.parse(input.executeRequestJson);
  let waitedMs = 0;
  for (let attempt = 0; ; attempt += 1) {
    const response = await input.transport.send({
      kind: 'execute',
      path: ROUTER_AB_ED25519_YAO_REGISTRATION_EXECUTE_PATH_V1,
      body,
    });
    if (response.ok) return JSON.stringify(response.value);
    if (response.code !== 'execution_in_progress' || waitedMs >= IN_PROGRESS_RETRY_BUDGET_MS) {
      throw new Error(`Router Ed25519 Yao execute failed: ${response.message}`);
    }
    const delayMs =
      IN_PROGRESS_RETRY_DELAYS_MS[Math.min(attempt, IN_PROGRESS_RETRY_DELAYS_MS.length - 1)];
    await wait(delayMs);
    waitedMs += delayMs;
  }
}
