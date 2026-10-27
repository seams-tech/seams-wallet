import type { VoiceIdConfirmationOptions } from '@seams/wallet';
import type { BoundNearSigner, BoundEvmSigner } from '@seams/wallet/react';
import type { VoiceConfirmation } from '@voiceid/browser/confirmationCommand';

const voiceId: VoiceIdConfirmationOptions = {
  confirmationCommand: 'Sell 100 NEAR for USDC at $5.5',
};
const nearOptions: NonNullable<
  Parameters<BoundNearSigner['signAndSendTransaction']>[0]['options']
> = { voiceId };
const evmOptions: NonNullable<Parameters<BoundEvmSigner['signAndSendTransaction']>[0]['options']> =
  { voiceId };

// @ts-expect-error A supplied VoiceID configuration requires its command.
const missingCommand: VoiceIdConfirmationOptions = {};
const obsoleteName: VoiceIdConfirmationOptions = {
  // @ts-expect-error confirmationContext is not an accepted configuration field.
  confirmationContext: 'Sell 100 NEAR',
};
const uncheckedPhrase: VoiceIdConfirmationOptions = {
  confirmationCommand: 'Sell 100 NEAR',
  // @ts-expect-error The application cannot replace the Wallet challenge.
  phrase: 'approve me',
};
// @ts-expect-error A generic challenge cannot retain an action.
const mixed: VoiceConfirmation = { kind: 'random', action: 'sale' };
const sale = { kind: 'action', action: 'sale' } as const;
// @ts-expect-error A spread cannot retain the action after selecting a generic challenge.
const mixedSpread: VoiceConfirmation = { ...sale, kind: 'random' };
// @ts-expect-error A raw command is not a parsed confirmation purpose.
const rawPurpose = 'Sell 100 NEAR' as VoiceConfirmation;

void [
  voiceId,
  nearOptions,
  evmOptions,
  missingCommand,
  obsoleteName,
  uncheckedPhrase,
  mixed,
  mixedSpread,
  rawPurpose,
];
