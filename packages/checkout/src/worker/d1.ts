/** The part of Cloudflare D1 that the checkout Worker uses. */
export type D1Statement = {
  bind(...values: readonly (string | number | null)[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ readonly results: T[] }>;
  run(): Promise<D1Run>;
};

type D1Run = { readonly meta: { readonly changes?: number } };

export type D1 = {
  prepare(query: string): D1Statement;
  /** Runs the statements in one transaction. */
  batch(statements: readonly D1Statement[]): Promise<readonly D1Run[]>;
};

export function changedRows(run: D1Run | undefined): number {
  return run?.meta.changes ?? 0;
}

/** True when a write failed because a row with the same unique key exists. */
export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}
