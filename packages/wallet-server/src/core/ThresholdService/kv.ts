import { isPlainObject } from '@shared/utils/validation';

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readResult(json: unknown): unknown | null {
  if (!isPlainObject(json) || !('result' in json)) return null;
  const v = json.result;
  return v === undefined || v === null ? null : v;
}

export class UpstashRedisRestClient {
  private readonly url: string;
  private readonly token: string;

  constructor(input: { url: string; token: string }) {
    const url = String(input.url || '').trim();
    const token = String(input.token || '').trim();
    if (!url) throw new Error('Upstash client missing url');
    if (!token) throw new Error('Upstash client missing token');
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  private async call(path: string, method: 'GET' | 'POST' = 'POST'): Promise<unknown> {
    const resp = await fetch(`${this.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });
    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`Upstash REST ${resp.status}: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return { result: text };
    }
  }

  async getRaw(key: string): Promise<unknown | null> {
    const k = encodeURIComponent(key);
    const json = await this.call(`/get/${k}`, 'GET');
    return readResult(json);
  }

  async del(key: string): Promise<void> {
    const k = encodeURIComponent(key);
    await this.call(`/del/${k}`, 'POST');
  }

  async setRaw(key: string, value: string, ttlMs?: number): Promise<void> {
    const k = encodeURIComponent(key);
    const v = encodeURIComponent(value);
    const ttlSeconds =
      ttlMs === undefined ? null : Math.max(1, Math.ceil(Math.max(0, Number(ttlMs) || 0) / 1000));

    if (!ttlSeconds) {
      await this.call(`/set/${k}/${v}`, 'POST');
      return;
    }

    // Prefer path-style EX argument, fallback to query param if needed.
    try {
      await this.call(`/set/${k}/${v}/ex/${ttlSeconds}`, 'POST');
    } catch {
      await this.call(`/set/${k}/${v}?ex=${ttlSeconds}`, 'POST');
    }
  }

  async getJson(key: string): Promise<unknown | null> {
    const raw = await this.getRaw(key);
    if (raw === null) return null;
    if (typeof raw === 'string') return tryParseJson(raw);
    return raw;
  }

  async setJson(key: string, value: unknown, ttlMs?: number): Promise<void> {
    await this.setRaw(key, JSON.stringify(value), ttlMs);
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown | null> {
    const keyList = Array.isArray(keys) ? keys : [];
    const argList = Array.isArray(args) ? args : [];
    const segments = ['eval', script, String(keyList.length), ...keyList, ...argList].map((part) =>
      encodeURIComponent(String(part)),
    );
    const json = await this.call(`/${segments.join('/')}`, 'POST');
    if (isPlainObject(json) && typeof json.error === 'string') {
      throw new Error(`Upstash EVAL error: ${json.error}`);
    }
    return readResult(json);
  }
}
