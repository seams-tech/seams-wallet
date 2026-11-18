import { intendedTest as test } from '../../e2e/intended-behaviours/harness';
import { JOURNEYS } from './journeys';
import { runWithSeamsWeb } from './seamsWebDriver';

// Key export must not leave secret-bearing DOM or network captures in the evidence.
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

for (const journey of JOURNEYS) {
  if (journey.method === 'passkey') test(journey.title, runWithSeamsWeb(journey));
}
