import { expect, test } from '@playwright/test';
import {
  chooseTranscriber,
  createNearAiStatusMemory,
  silentWav,
  stateOf,
  TranscriberChoice,
  type NearAiStatus,
} from '../../packages/wallet-server/src/router/domains/speakToSign/speakToSignTranscriber';

const NEAR_AI_KEY = 'nearai_secret_do_not_leak_4b1e';
const MODELS = 'https://cloud-api.near.ai/v1/models';
const WHISPER = 'https://cloud-api.near.ai/v1/audio/transcriptions';

function status(nearAi: NearAiStatus['nearAi'], whisper: NearAiStatus['whisper']): NearAiStatus {
  return { nearAi, whisper, checkedAtMs: 0 };
}

/** A choice with a fake NEAR AI: `answer` gives the status code of each URL, or throws. */
function harness(
  answer: (url: string) => number | Promise<number>,
  options: { hasVeniceBuild?: boolean; nearAiApiKey?: string | null; choiceWaitMs?: number } = {},
) {
  let nowMs = 1_000_000;
  const asked: Array<{ url: string; init: RequestInit }> = [];
  const memory = createNearAiStatusMemory();
  const choice = new TranscriberChoice(
    {
      hasVeniceBuild: options.hasVeniceBuild ?? true,
      nearAiApiKey: options.nearAiApiKey === undefined ? NEAR_AI_KEY : options.nearAiApiKey,
    },
    {
      fetch: (async (url: string, init: RequestInit) => {
        asked.push({ url: String(url), init });
        return new Response('{}', { status: await answer(String(url)) });
      }) as typeof fetch,
      now: () => nowMs,
      memory,
      ...(options.choiceWaitMs === undefined ? {} : { choiceWaitMs: options.choiceWaitMs }),
    },
  );
  return { choice, asked, advance: (ms: number) => void (nowMs += ms) };
}

test('NEAR AI serves unless it or its Whisper is down and the server has a venice build', () => {
  expect(chooseTranscriber({ hasVeniceBuild: false, status: status('down', 'down') })).toBe('nearai');
  expect(chooseTranscriber({ hasVeniceBuild: false, status: null })).toBe('nearai');
  expect(chooseTranscriber({ hasVeniceBuild: true, status: status('up', 'up') })).toBe('nearai');
  expect(chooseTranscriber({ hasVeniceBuild: true, status: status('up', 'slow') })).toBe('nearai');
  expect(chooseTranscriber({ hasVeniceBuild: true, status: status('unknown', 'unknown') })).toBe('nearai');
  expect(chooseTranscriber({ hasVeniceBuild: true, status: status('up', 'down') })).toBe('venice');
  expect(chooseTranscriber({ hasVeniceBuild: true, status: status('down', 'up') })).toBe('venice');
  // No answer in time.
  expect(chooseTranscriber({ hasVeniceBuild: true, status: null })).toBe('venice');
});

test('a 5xx answer is an outage, a 4xx answer is not, and a late answer is slow', () => {
  expect(stateOf(502, 100)).toBe('down');
  expect(stateOf(500, 100)).toBe('down');
  expect(stateOf(401, 100)).toBe('unknown');
  expect(stateOf(429, 100)).toBe('unknown');
  expect(stateOf(200, 100)).toBe('up');
  expect(stateOf(200, 6_000)).toBe('slow');
  expect(silentWav(500).byteLength).toBe(16_044);
});

test('without a venice build or a NEAR AI key, the choice asks nothing and NEAR AI serves', async () => {
  const noBuild = harness(() => 502, { hasVeniceBuild: false });
  expect(await noBuild.choice.choose()).toBe('nearai');
  expect(noBuild.asked).toHaveLength(0);
  const noKey = harness(() => 502, { nearAiApiKey: null });
  expect(await noKey.choice.choose()).toBe('nearai');
  expect(noKey.asked).toHaveLength(0);
});

test('Whisper down gives Venice; the check asks the model list and one silent clip with the key', async () => {
  const down = harness((url) => (url === WHISPER ? 502 : 200));
  expect(await down.choice.choose()).toBe('venice');
  expect(down.asked.map((call) => call.url).sort()).toEqual([WHISPER, MODELS].sort());
  for (const call of down.asked) {
    expect(new Headers(call.init.headers).get('authorization')).toBe(`Bearer ${NEAR_AI_KEY}`);
  }
  const form = down.asked.find((call) => call.url === WHISPER)?.init.body as FormData;
  expect(form.get('model')).toBe('openai/whisper-large-v3');
  expect((form.get('file') as Blob).size).toBe(16_044);

  expect(await harness(() => 200).choice.choose()).toBe('nearai');
  // A refused key is not an outage.
  expect(await harness(() => 401).choice.choose()).toBe('nearai');
  // No answer at all is an outage.
  expect(
    await harness(() => {
      throw new TypeError('connect failed');
    }).choice.choose(),
  ).toBe('venice');
});

test('one check serves the calls of 60 s, and a check that does not answer in time gives Venice', async () => {
  const cached = harness((url) => (url === WHISPER ? 502 : 200));
  expect(await cached.choice.choose()).toBe('venice');
  expect(await cached.choice.choose()).toBe('venice');
  expect(cached.asked).toHaveLength(2);
  cached.advance(61_000);
  expect(await cached.choice.choose()).toBe('venice');
  expect(cached.asked).toHaveLength(4);

  const late = harness(() => new Promise<number>((resolve) => setTimeout(() => resolve(200), 200)), {
    choiceWaitMs: 20,
  });
  expect(await late.choice.choose()).toBe('venice');
});
