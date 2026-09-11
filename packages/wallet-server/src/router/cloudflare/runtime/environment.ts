import { normalizeSessionString } from './sessionAdapterRuntime';

export type CloudflareWorkerEnvironment = Readonly<Record<string, unknown>>;

export function requireEnvironmentString(
  env: CloudflareWorkerEnvironment,
  name: string,
): string {
  const value = readEnvironmentString(env, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function readEnvironmentString(
  env: CloudflareWorkerEnvironment,
  name: string,
): string {
  return normalizeSessionString(env[name]);
}

export function readEnvironmentCsv(input: unknown): string[] {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const raw of normalizeSessionString(input).split(',')) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    values.push(value);
    seen.add(value);
  }
  return values;
}
