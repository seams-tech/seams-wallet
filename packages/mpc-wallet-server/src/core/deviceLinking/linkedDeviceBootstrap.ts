import type { LinkDeviceSessionId } from '@shared/signing-lanes/ids';
import type { LinkedDeviceSessionRecordV1 } from './linkedDeviceSessionRecord';

export type LinkedDeviceBootstrapResult =
  | { readonly ok: true; readonly record: LinkedDeviceSessionRecordV1 | null }
  | {
      readonly ok: false;
      readonly code: 'home_conflict' | 'home_unavailable';
      readonly record?: never;
    };

export interface LinkedDeviceBootstrapStore {
  read(linkSessionId: LinkDeviceSessionId): Promise<LinkedDeviceBootstrapResult>;
  create(record: LinkedDeviceSessionRecordV1): Promise<LinkedDeviceBootstrapResult>;
  claim(record: LinkedDeviceSessionRecordV1): Promise<LinkedDeviceBootstrapResult>;
  finish(record: LinkedDeviceSessionRecordV1): Promise<LinkedDeviceBootstrapResult>;
}

export function requireLinkedDeviceBootstrapRecord(
  result: LinkedDeviceBootstrapResult,
): LinkedDeviceSessionRecordV1 | null {
  if (result.ok) return result.record;
  throw Object.assign(new Error('Linked-device bootstrap authority rejected the request'), {
    code: result.code,
  });
}

export function linkedDeviceBootstrapFailure(
  error: unknown,
): 'home_conflict' | 'home_unavailable' | null {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'home_conflict' || error.code === 'home_unavailable')
  )
    return error.code;
  return null;
}
