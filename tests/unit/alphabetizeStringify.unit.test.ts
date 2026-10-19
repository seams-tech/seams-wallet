import { expect, test } from '@playwright/test';
import { alphabetizeStringify } from '@shared/utils/digests';

test('alphabetizeStringify recursively sorts object keys and preserves array order', () => {
  const value = {
    z: 3,
    a: { z: 'last', a: 'first' },
    m: [
      { b: 2, a: 1 },
      { d: 4, c: 3 },
    ],
  };

  expect(alphabetizeStringify(value)).toBe(
    '{"a":{"a":"first","z":"last"},"m":[{"a":1,"b":2},{"c":3,"d":4}],"z":3}',
  );
});
