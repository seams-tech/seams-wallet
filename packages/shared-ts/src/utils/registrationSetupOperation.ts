import { secureRandomBase64Url } from './secureRandomId';

export function parseRegistrationSetupOperationId(value: unknown): string | null {
  return typeof value === 'string' && /^wreg_[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
}

export function createRegistrationSetupOperationId(): string {
  return `wreg_${secureRandomBase64Url(32)}`;
}
