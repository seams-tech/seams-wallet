// The market bet of the `spoken-intent` crate (seams-tech/speak-to-sign):
// `SpokenRequestV1::MarketBet`. A bet moves value, as a transfer does: Wallet core signs the
// token's `ft_transfer_call` to the market, and the market contract checks the verdict that the
// call carries. Its limits, its sentence, its request and its call are the `market_bet` entry of
// `SPOKEN_KINDS` (`@shared/speakToSign/spokenKinds`), which the co-signer also reads.

import type { SpokenTypedFields } from '@shared/speakToSign/spokenKinds';
import {
  BET_OUTCOMES,
  USDC_UNITS_PER_HUNDREDTH,
  type BetOutcome,
} from '@shared/speakToSign/spokenRequest';
import { parseSpeakableHundredths } from './spokenTransfer';

export { BET_OUTCOMES, type BetOutcome };

/** A spoken bet. The owner says the amount, the outcome and the market id. */
export type SpokenBetAction = Extract<SpokenTypedFields, { kind: 'market_bet' }>;

/** `"0.5"` USDC to base units, or null when the grammar cannot speak the amount. */
export function parseSpeakableUsdc(text: string): bigint | null {
  const hundredths = parseSpeakableHundredths(text);
  return hundredths === null ? null : hundredths * USDC_UNITS_PER_HUNDREDTH;
}
