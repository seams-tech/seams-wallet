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

test('alphabetizeStringify does not mutate or replace the input graph', () => {
  const nested = { z: 2, a: 1 };
  const arrayEntry = { d: 4, c: 3 };
  const value = { z: nested, a: [arrayEntry] };
  const before = JSON.stringify(value);

  alphabetizeStringify(value);

  expect(JSON.stringify(value)).toBe(before);
  expect(value.z).toBe(nested);
  expect(value.a[0]).toBe(arrayEntry);
  expect(Object.keys(value)).toEqual(['z', 'a']);
  expect(Object.keys(nested)).toEqual(['z', 'a']);
});
