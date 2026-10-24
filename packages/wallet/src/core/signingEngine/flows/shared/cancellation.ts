class SigningCancelledError extends Error {
  readonly code = 'cancelled';

  constructor() {
    super('Request cancelled');
    this.name = 'SigningCancelledError';
  }
}

export function assertSigningNotCancelled(shouldAbort: () => boolean): void {
  if (shouldAbort()) throw new SigningCancelledError();
}
