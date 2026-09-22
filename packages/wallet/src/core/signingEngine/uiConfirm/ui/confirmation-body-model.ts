import { isNearSigningProgressNotice, parseNearAccountFundingNotice } from '../nearFundingNotice';

export type ConfirmationBodyModel =
  | { kind: 'empty' }
  | { kind: 'text' | 'status'; text: string }
  | { kind: 'funding'; accountId: string; shortAccountId: string };

export function buildConfirmationBody(body: string): ConfirmationBodyModel {
  const text = body.trim();
  if (!text) return { kind: 'empty' };
  if (isNearSigningProgressNotice(text)) return { kind: 'status', text };
  const funding = parseNearAccountFundingNotice(text);
  if (funding)
    return {
      kind: 'funding',
      accountId: funding.accountId,
      shortAccountId: funding.shortAccountId,
    };
  return { kind: 'text', text };
}
