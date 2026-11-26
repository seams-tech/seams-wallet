export function recordRegistrationServerTiming(
  sink: Array<readonly [string, number]>,
  name: string,
  startedAtMs: number,
): void {
  sink.push([name, Math.max(0, Date.now() - startedAtMs)]);
}

/** The `Server-Timing` header of a registration route's recorded waits. */
export function registrationServerTimingHeaders(
  serverTiming: readonly (readonly [string, number])[],
): Record<string, string> | undefined {
  if (serverTiming.length === 0) return undefined;
  const header = serverTiming
    .map(([name, durationMs]) => `${name};dur=${Math.max(0, durationMs).toFixed(1)}`)
    .join(', ');
  return { 'Server-Timing': header };
}

export async function recordRegistrationPromiseTiming<T>(args: {
  readonly sink: Array<readonly [string, number]>;
  readonly name: string;
  readonly startedAtMs: number;
  readonly promise: T | Promise<T>;
}): Promise<T> {
  try {
    return await args.promise;
  } finally {
    recordRegistrationServerTiming(args.sink, args.name, args.startedAtMs);
  }
}
