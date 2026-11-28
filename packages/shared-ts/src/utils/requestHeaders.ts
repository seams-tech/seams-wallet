type HeaderBag = Headers | Record<string, unknown>;

/** One header as trimmed text. A plain record can hold the name in any of three cases. */
export function readRequestHeader(headers: HeaderBag, name: string): string {
  if (headers instanceof Headers) {
    return String(headers.get(name) || '').trim();
  }
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return '';
}

export function extractBearerCredential(headers: HeaderBag): string | null {
  const authHeader = readRequestHeader(headers, 'authorization');
  const bearerPrefix = 'bearer ';
  if (!authHeader.toLowerCase().startsWith(bearerPrefix)) return null;
  return authHeader.slice(bearerPrefix.length).trim() || null;
}

/** The client address: the first entry when a proxy sends a list. */
export function resolveSourceIpFromFetchHeaders(headers: HeaderBag): string | null {
  const raw =
    readRequestHeader(headers, 'cf-connecting-ip') ||
    readRequestHeader(headers, 'x-forwarded-for') ||
    readRequestHeader(headers, 'x-real-ip');
  return raw.split(',')[0]?.trim() || null;
}
