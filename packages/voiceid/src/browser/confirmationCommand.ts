import { isPlainObject, TransactionReviewError } from '@seams/wallet/voiceid-host';
import type { CONFIRMATION_PHRASES } from './phraseVocabulary';

export type VoiceConfirmation =
  | { readonly kind: 'random'; readonly action?: never }
  | { readonly kind: 'action'; readonly action: keyof typeof CONFIRMATION_PHRASES };

/** App copy selects a phrase family. It never supplies transaction terms or permissions. */
export function parseVoiceConfirmation(value: unknown): VoiceConfirmation {
  if (value === undefined) return { kind: 'random' };
  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.confirmationCommand !== 'string' ||
    value.confirmationCommand.length > 256
  ) {
    throw invalidCommand();
  }
  const command = value.confirmationCommand.normalize('NFC').trim();
  if (!command || /[\u0000-\u001f\u007f]/.test(command)) {
    throw invalidCommand();
  }
  const verb = /^[a-z]+\b/i.exec(command)?.[0].toLowerCase();
  switch (verb) {
    case 'sell':
      return { kind: 'action', action: 'sale' };
    case 'buy':
      return { kind: 'action', action: 'purchase' };
    case 'swap':
      return { kind: 'action', action: 'swap' };
    case 'send':
    case 'transfer':
      return { kind: 'action', action: 'transfer' };
    default:
      return { kind: 'random' };
  }
}

function invalidCommand(): TransactionReviewError {
  return new TransactionReviewError(
    'review_invalid_input',
    'voiceId requires only a nonempty confirmationCommand of at most 256 characters without control characters.',
  );
}
