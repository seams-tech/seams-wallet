export function parseBool(v: unknown): boolean {
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function requireEnvVar<T extends object, K extends keyof T & string>(
  env: T,
  name: K,
): string {
  const raw = (env as any)?.[name] as unknown;
  if (typeof raw !== 'string') throw new Error(`Missing required env var: ${name}`);
  const v = raw.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
