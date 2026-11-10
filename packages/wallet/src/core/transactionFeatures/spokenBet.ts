// The market bet of the `spoken-intent` crate (seams-tech/speak-to-sign):
// `SpokenRequestV1::MarketBet`, with the same rules, rendered words, Borsh bytes and digests. The
// crate's golden vectors check this port. A bet moves value, as a transfer does: Wallet core
// signs the token's `ft_transfer_call` to the market, and the market contract checks the verdict
// that the call carries.

import { functionCall } from '@/core/types/actionBuilders';
import type { TransactionInput } from '@/core/types/actions';
import {
  BET_OUTCOMES,
  SPEAK_TO_SIGN_USDC,
  spokenRequestBorsh,
  USDC_UNITS_PER_HUNDREDTH,
  VOICE_BET_STEP_UP_ABOVE_UNITS,
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
import type { SignedVoiceVerdict } from './voiceVerdict';

export { BET_OUTCOMES, type BetOutcome };

/** The market needs gas for `ft_on_transfer` and the token for its callback. */
const BET_CALL_GAS = '100000000000000';
/** NEP-141 asks for exactly 1 yoctoNEAR on `ft_transfer_call`. */
const BET_CALL_DEPOSIT = '1';

/** A spoken bet. The owner says the amount, the outcome and the market id. */
export type SpokenBetAction = Readonly<{
  kind: 'market_bet';
  /** The market contract, a named NEAR account. */
  contract: string;
  /** The token of the stake: the USDC contract of the network. */
  token: string;
  /** 1 or more. */
  marketId: bigint;
  outcome: BetOutcome;
  /** Base units (10^-6 USDC): a whole number of cents, from 0.01 to 1,000,000 USDC. */
  amountUnits: bigint;
}>;

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

/** Borsh of `SpokenRequestV1::MarketBet`, whose explicit tag is 7. */
export function betBorsh(
  network: SpeakToSignNetwork,
  owner: string,
  action: SpokenBetAction,
): Uint8Array {
  return spokenRequestBorsh({
    kind: 'market_bet',
    network,
    owner,
    market: action.contract,
    token: action.token,
    marketId: action.marketId,
    outcome: action.outcome,
    amountUnits: action.amountUnits,
  });
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

/**
 * The sentence of the Wallet's own rule when the bet needs a fresh approval after the voice, or
 * null. The market contract takes only an `accept` verdict, so the verifier cannot ask for it.
 */
export function betStepUpText(action: SpokenBetAction): string | null {
  return action.amountUnits > VOICE_BET_STEP_UP_ABOVE_UNITS
    ? 'A voice bet above 10 USDC needs a passkey.'
    : null;
}

/**
 * The one call that core signs: `ft_transfer_call` on the token, which sends the stake to the
 * market with the bet and its checked verdict in `msg`. The market contract checks the verdict.
 */
export function betTransaction(
  action: SpokenBetAction,
  verdict: SignedVoiceVerdict,
): TransactionInput {
  const msg = JSON.stringify({
    action: 'bet',
    market_id: Number(action.marketId),
    outcome: action.outcome,
    verdict_json: verdict.verdictJson,
    signature_b64: verdict.signatureB64,
  });
  const call = functionCall({
    method: 'ft_transfer_call',
    args: { receiver_id: action.contract, amount: action.amountUnits.toString(), msg },
    gas: BET_CALL_GAS,
    deposit: BET_CALL_DEPOSIT,
  });
  return { receiverId: action.token, actions: [call] };
}
