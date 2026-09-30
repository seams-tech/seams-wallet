import { errorMessage } from '@shared/utils/errors';

type WorkerErrorPayload = {
  message: string;
  code?: string;
  coreCode?: string;
};

export function asWorkerErrorPayload(err: unknown): WorkerErrorPayload {
  if (err && typeof err === 'object') {
    const message =
      typeof (err as { message?: unknown }).message === 'string'
        ? String((err as { message?: string }).message).trim()
        : '';
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? String((err as { code?: string }).code).trim()
        : '';
    const coreCode =
      typeof (err as { coreCode?: unknown }).coreCode === 'string'
        ? String((err as { coreCode?: string }).coreCode).trim()
        : '';
    return {
      message: message || errorMessage(err),
      ...(code ? { code } : {}),
      ...(coreCode ? { coreCode } : {}),
    };
  }
  return { message: errorMessage(err) };
}

/** The failure reply a worker posts back for request `id`. */
export function workerErrorReply(id: string, err: WorkerErrorPayload) {
  return {
    id,
    ok: false,
    error: err.message,
    ...(err.code ? { code: err.code } : {}),
    ...(err.coreCode ? { coreCode: err.coreCode } : {}),
  };
}
