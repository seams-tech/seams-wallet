// The market bet of the `spoken-intent` crate (seams-tech/speak-to-sign):
// `SpokenRequestV1::MarketBet`, with the same rules, rendered words, Borsh bytes and digests. The
// crate's golden vectors check this port. A bet moves value, as a transfer does: Wallet core
// signs the token's `ft_transfer_call` to the market, and the market contract checks the verdict
// that the call carries. The request and the call are in `SPOKEN_KINDS`
// (`@shared/speakToSign/spokenKinds`), which the co-signer also reads.

import type { SpokenTypedFields } from '@shared/speakToSign/spokenKinds';
import {
  BET_OUTCOMES,
  SPEAK_TO_SIGN_USDC,
  USDC_UNITS_PER_HUNDREDTH,
  type BetOutcome,
} from '@shared/speakToSign/spokenRequest';
import type { SpeakToSignNetwork } from './plugins';
import {
  amountWords,
  displayAmount,
  integerWords,
  isSpeakableAccount,
  isSpeakableHundredths,
  parseSpeakableHundredths,
  type RenderedTransfer,
} from './spokenTransfer';

export { BET_OUTCOMES, type BetOutcome };

/** A spoken bet. The owner says the amount, the outcome and the market id. */
export type SpokenBetAction = Extract<SpokenTypedFields, { kind: 'market_bet' }>;

/** `"0.5"` USDC to base units, or null when the grammar cannot speak the amount. */
export function parseSpeakableUsdc(text: string): bigint | null {
  const hundredths = parseSpeakableHundredths(text);
  return hundredths === null ? null : hundredths * USDC_UNITS_PER_HUNDREDTH;
}

/** Why core cannot build this bet, or null. */
export function betActionRefusal(
  network: SpeakToSignNetwork,
  action: SpokenBetAction,
): 'bet_not_valid' | null {
  const valid =
    isSpeakableAccount(action.contract) &&
    // Another token can have other decimals, so "usdc" and the amount would name another value.
    action.token === SPEAK_TO_SIGN_USDC[network] &&
    action.marketId >= 1n &&
    action.marketId <= BigInt(Number.MAX_SAFE_INTEGER) &&
    BET_OUTCOMES.includes(action.outcome) &&
    action.amountUnits % USDC_UNITS_PER_HUNDREDTH === 0n &&
    isSpeakableHundredths(action.amountUnits / USDC_UNITS_PER_HUNDREDTH);
  return valid ? null : 'bet_not_valid';
}

/** "bet zero point five usdc yes on market nine". */
export function renderBet(action: SpokenBetAction): RenderedTransfer {
  const hundredths = action.amountUnits / USDC_UNITS_PER_HUNDREDTH;
  const words = [
    'bet',
    ...amountWords(hundredths),
    'usdc',
    action.outcome,
    'on',
    'market',
    ...integerWords(action.marketId),
  ];
  return {
    displayText: `Bet ${displayAmount(hundredths)} USDC ${action.outcome} on market ${action.marketId}`,
    spokenText: words.join(' '),
  };
}

/** The `request` of the verifier's `verify` input. */
export function betVerifyRequest(action: SpokenBetAction): Readonly<Record<string, unknown>> {
  return {
    kind: 'market_bet',
    market: action.contract,
    token: action.token,
    market_id: Number(action.marketId),
    outcome: action.outcome,
    amount_units: action.amountUnits.toString(),
  };
}
