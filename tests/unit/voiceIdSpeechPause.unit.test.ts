import { expect, test } from '@playwright/test';
import { endPauseMs, expectedSpeechMs } from '../../packages/voiceid/src/browser/speechPause';

test('a sentence counts digits, dots and dashes as spoken words', () => {
  // "send zero point zero one near to seams dash v one dot testnet": 13 words.
  expect(expectedSpeechMs('Send 0.01 NEAR to seams-v1.testnet')).toBe(13 * 200);
  expect(expectedSpeechMs('Send 0.01 NEAR to seams-v1.testnet.')).toBe(13 * 200);
  expect(expectedSpeechMs('This note is helpful')).toBe(4 * 200);
  expect(expectedSpeechMs('  ')).toBe(0);
});

test('a short pause ends a recording only after the whole sentence was voiced', () => {
  const sentence = expectedSpeechMs('Send 0.01 NEAR to seams-v1.testnet');
  // A pause inside the sentence keeps the long pause.
  expect(endPauseMs(sentence - 32, sentence)).toBe(1_500);
  expect(endPauseMs(sentence, sentence)).toBe(800);
  // Without a known sentence, the long pause stays.
  expect(endPauseMs(10_000, null)).toBe(1_500);
});
