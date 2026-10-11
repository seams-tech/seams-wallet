export function toSerializableTempoError(
  error: unknown,
): { code?: string; message?: string; details?: unknown } | undefined {
  if (error == null) return undefined;
  if (typeof error === 'string') return { message: error };
  if (error instanceof Error) {
    const code = 'code' in error ? String(error.code || '').trim() : '';
    return {
      ...(code ? { code } : {}),
      message: String(error.message || ''),
    };
  }
  if (typeof error === 'object') {
    const value = error as { code?: unknown; message?: unknown; details?: unknown };
    const code = String(value.code || '').trim();
    const message = String(value.message || '').trim();
    return {
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
      ...(value.details !== undefined ? { details: value.details } : {}),
    };
  }
  return { message: String(error) };
}
