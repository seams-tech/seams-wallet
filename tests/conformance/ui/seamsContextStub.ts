/**
 * Stands in for `react/context` when the authentication-methods fixture is bundled: the account
 * menu reads `useSeams()` from here, so the check controls the wallet, the login state and the
 * session refresh without a SeamsWeb instance.
 */

let current: unknown = null;

export function provideSeams(value: unknown): void {
  current = value;
}

export function useSeams(): unknown {
  if (current === null) throw new Error('The conformance fixture provided no Seams context');
  return current;
}
