import { errorMessage } from '@shared/utils/errors';
import type { NearClient } from './NearClient';
import { toAccountId } from '@/core/types/accountIds';

function isMissingAccount(error: unknown): boolean {
  return /UNKNOWN_ACCOUNT|unknown\s+account|account\b[^\n]*\bdoes not exist/iu.test(
    errorMessage(error),
  );
}

function isTransientLookupFailure(error: unknown): boolean {
  return /server error|internal|temporar|timeout|throttl|too many requests|429|empty response|rpc request failed|failed to fetch/iu.test(
    errorMessage(error),
  );
}

function resolveRetryDelay(resolve: () => void): void {
  setTimeout(resolve, 150);
}

export async function accountExists(nearClient: NearClient, input: string): Promise<boolean> {
  const accountId = toAccountId(input);
  try {
    await nearClient.viewAccount(accountId);
    return true;
  } catch (error: unknown) {
    if (isMissingAccount(error)) return false;
    if (!isTransientLookupFailure(error)) throw error;
  }

  await new Promise<void>(resolveRetryDelay);
  try {
    await nearClient.viewAccount(accountId);
    return true;
  } catch (error: unknown) {
    if (isMissingAccount(error)) return false;
    throw error;
  }
}
