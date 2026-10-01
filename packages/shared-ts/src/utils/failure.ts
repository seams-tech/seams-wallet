// Failure results reach the wire as built, so the keys keep this order.

export function failure<const C extends string>(
  code: C,
  message: string,
): { ok: false; code: C; message: string } {
  return { ok: false, code, message };
}

export function failedVerification<const C extends string>(
  code: C,
  message: string,
): { ok: false; verified: false; code: C; message: string } {
  return { ok: false, verified: false, code, message };
}
