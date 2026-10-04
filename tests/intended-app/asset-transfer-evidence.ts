import type { IncomingMessage, ServerResponse } from 'node:http';

type Transfer = {
  pathname: string;
  startedAtMs: number;
  finishedAtMs: number;
  status: number;
  contentEncoding: string;
  encodedBodyBytes: number;
  completion: 'finished' | 'closed';
};

function chunkSize(chunk: unknown, encoding: unknown): number {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(
      chunk,
      typeof encoding === 'string' && Buffer.isEncoding(encoding) ? encoding : 'utf8',
    );
  }
  return chunk instanceof Uint8Array ? chunk.byteLength : 0;
}

class TransferResponse {
  private bytes = 0;
  private readonly startedAtMs = Date.now();
  private readonly originalWrite: ServerResponse['write'];
  private readonly originalEnd: ServerResponse['end'];

  constructor(
    private readonly pathname: string,
    private readonly response: ServerResponse,
    private readonly transfers: Transfer[],
  ) {
    this.originalWrite = response.write;
    this.originalEnd = response.end;
    response.write = this.write.bind(this);
    response.end = this.end.bind(this);
    response.once('close', this.complete.bind(this));
  }

  private write(...args: unknown[]): boolean {
    this.bytes += chunkSize(args[0], args[1]);
    return Reflect.apply(this.originalWrite, this.response, args);
  }

  private end(...args: unknown[]): ServerResponse {
    this.bytes += chunkSize(args[0], args[1]);
    return Reflect.apply(this.originalEnd, this.response, args);
  }

  private complete(): void {
    this.transfers.push({
      pathname: this.pathname,
      startedAtMs: this.startedAtMs,
      finishedAtMs: Date.now(),
      status: this.response.statusCode,
      contentEncoding: String(this.response.getHeader('content-encoding') ?? 'identity'),
      encodedBodyBytes: this.bytes,
      completion: this.response.writableFinished ? 'finished' : 'closed',
    });
  }
}

class AssetTransferRecorder {
  private readonly transfers: Transfer[] = [];

  handle(request: IncomingMessage, response: ServerResponse, next: () => void): void {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/__asset-transfers') {
      response.setHeader('cache-control', 'no-store');
      if (request.method === 'DELETE') {
        this.transfers.length = 0;
        response.statusCode = 204;
        response.end();
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(this.transfers));
      return;
    }
    if (/\.(?:m?js|wasm|css)$/u.test(pathname)) {
      // Installed before preview compression: its compressed writes reach this observer.
      new TransferResponse(pathname, response, this.transfers);
    }
    next();
  }
}

export function createAssetTransferEvidenceMiddleware() {
  const recorder = new AssetTransferRecorder();
  return recorder.handle.bind(recorder);
}
