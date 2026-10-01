import type { ExclusiveUnion } from '@shared/utils/variant';

export type PlatformResult<Ok, Code extends string> = ExclusiveUnion<
  { ok: true; value: Ok } | { ok: false; code: Code; message: string }
>;

export type HttpTransport = {
  kind: 'http_transport';
  request(input: {
    method: 'GET' | 'POST';
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
  }): Promise<PlatformResult<{ status: number; body: unknown }, 'network_error' | 'timeout'>>;
};
