/** Passkey confirmation worker. */
import { awaitUserConfirmationV2 } from '../../uiConfirm/awaitUserConfirmation';
import { UserConfirmMessageType } from '../../stepUpConfirmation/channel/confirmTypes';
import type { UserConfirmWorkerResponsePayload } from '../../../types/secure-confirm-worker';

type UserConfirmWorkerGlobal = typeof globalThis & {
  awaitUserConfirmationV2?: typeof awaitUserConfirmationV2;
};

type UserConfirmWorkerIncomingMessage = {
  id?: unknown;
  type?: unknown;
  payload?: unknown;
};

type SecureConfirmRequestPayload = {
  requestId: string;
};

(globalThis as UserConfirmWorkerGlobal).awaitUserConfirmationV2 = awaitUserConfirmationV2;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asIncomingMessage(value: unknown): UserConfirmWorkerIncomingMessage {
  const record = asRecord(value);
  return record
    ? {
        id: record.id,
        type: record.type,
        payload: record.payload,
      }
    : {};
}

function postUserConfirmWorkerResponse(
  id: unknown,
  payload: UserConfirmWorkerResponsePayload,
): void {
  const response =
    payload.success === true
      ? {
          ...(typeof id === 'string' && id.trim() ? { id: id.trim() } : {}),
          success: true as const,
          data: payload.data,
        }
      : {
          ...(typeof id === 'string' && id.trim() ? { id: id.trim() } : {}),
          success: false as const,
          error: payload.error,
        };
  self.postMessage(response);
}

function forwardUserConfirmProgressToHost(value: unknown): void {
  const envelope = asRecord(value);
  if (envelope) self.postMessage(envelope);
}

function parseSecureConfirmRequestPayload(value: unknown): SecureConfirmRequestPayload | null {
  const record = asRecord(value);
  if (!record) return null;
  if ('request' in record) return null;
  const requestId = typeof record.requestId === 'string' ? record.requestId.trim() : '';
  return requestId ? { requestId } : null;
}

self.onmessage = (event: MessageEvent) => {
  const incoming = asIncomingMessage(event.data);
  const eventType = incoming.type;
  if (eventType === UserConfirmMessageType.USER_PASSKEY_CONFIRM_RESPONSE) return;
  if (eventType === UserConfirmMessageType.USER_PASSKEY_CONFIRM_PROGRESS) {
    forwardUserConfirmProgressToHost(event.data);
    return;
  }

  const id = incoming.id;
  if (eventType === 'PING') {
    postUserConfirmWorkerResponse(id, { success: true, data: { ok: true } });
    return;
  }

  if (eventType === 'SECURE_CONFIRM_REQUEST') {
    void (async () => {
      try {
        const payload = asRecord(incoming.payload);
        const request = parseSecureConfirmRequestPayload(payload);
        if (!request) {
          postUserConfirmWorkerResponse(id, {
            success: false,
            error: 'Invalid SECURE_CONFIRM_REQUEST payload: missing requestId',
          });
          return;
        }
        const requestToken = typeof id === 'string' ? id.trim() : '';
        if (!requestToken) {
          postUserConfirmWorkerResponse(id, {
            success: false,
            error: 'Invalid SECURE_CONFIRM_REQUEST message: missing id',
          });
          return;
        }
        await awaitUserConfirmationV2({
          kind: 'pending_request',
          requestId: request.requestId,
          requestToken,
        });
        postUserConfirmWorkerResponse(id, {
          success: true,
          data: { ok: true },
        });
      } catch (error: unknown) {
        postUserConfirmWorkerResponse(id, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return;
  }

  if (typeof id === 'string' && id.trim()) {
    postUserConfirmWorkerResponse(id, {
      success: false,
      error: `Unsupported UserConfirm worker message type: ${String(eventType)}`,
    });
  }
};

self.onerror = (error) => {
  console.error('[passkey-confirm-worker] error:', error);
};

self.onunhandledrejection = (event) => {
  console.error('[passkey-confirm-worker] Unhandled promise rejection:', event.reason);
  event.preventDefault();
};
