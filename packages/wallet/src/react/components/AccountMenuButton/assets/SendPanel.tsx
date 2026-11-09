import React, { useId, useState } from 'react';
import { WalletText } from '@/react/context/WalletLocale';
import type { WalletMessage } from '@/core/ui/messages';
import type { WalletAsset } from '@/core/assets/assetList';
import type { AssetBalance } from '@/core/assets/readAssetBalances';
import {
  maxSendBaseUnits,
  parseSendAmount,
  type PreparedSend,
  type SendRejection,
  type SendRequest,
} from '@/core/assets/send';
import { AssetPicker } from './AssetPicker';
import { exactAssetAmount, formatAssetAmount } from './assetFormat';

export type ReadySend = Exclude<PreparedSend, { kind: 'rejected' }>;

export type SendOutcome =
  | { readonly kind: 'sent'; readonly transactionId: string }
  /** Nothing was submitted; the user can try again. */
  | { readonly kind: 'not_sent'; readonly message: string }
  /** Submission may have happened; never resend automatically. */
  | { readonly kind: 'unknown'; readonly message: string };

type ReadBalance = Extract<AssetBalance, { kind: 'read' }>;

type FormState =
  | { readonly kind: 'editing'; readonly error: WalletMessage | null }
  // The Max fee probe is in flight; the form waits so the result cannot replace a review.
  | { readonly kind: 'pricing_max' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'confirming' }
  | { readonly kind: 'sent'; readonly transactionId: string }
  | { readonly kind: 'failed'; readonly message: string; readonly retry: boolean };

const REJECTION_MESSAGES: Readonly<Record<SendRejection, WalletMessage>> = {
  invalid_amount: 'Enter a valid amount.',
  invalid_recipient: 'Enter a valid recipient for this network.',
  missing_account: 'This NEAR account does not exist.',
  chain_not_configured: 'This network is not configured in this app.',
  unavailable: 'The network could not check these details. Try again.',
};

// These errors say that the balance is too low, so the panel offers Receive for the asset.
const BALANCE_ERRORS: ReadonlySet<WalletMessage> = new Set<WalletMessage>([
  'This is more than you can send.',
  'The amount and the network fee are more than you hold. Use Max.',
]);

function isNearAsset(asset: WalletAsset): boolean {
  return asset.kind === 'near_native' || asset.kind === 'nep141';
}

function feeInAssetUnits(asset: WalletAsset, maxFeeNative: bigint): bigint {
  if (asset.kind === 'evm_native') return maxFeeNative;
  if (asset.kind === 'erc20' && asset.paysGas) {
    const divisor = 10n ** BigInt(asset.paysGas.nativeDecimals - asset.decimals);
    return (maxFeeNative + divisor - 1n) / divisor;
  }
  return 0n;
}

/** Send out of this wallet: asset, amount, recipient, then the wallet's own confirm card. */
export function SendPanel({
  balances,
  initialAssetId,
  fromFor,
  prepare,
  send,
  onSent,
  onReceive,
}: {
  balances: readonly AssetBalance[];
  initialAssetId?: string;
  fromFor: (asset: WalletAsset) => string | null;
  prepare: (request: SendRequest) => Promise<PreparedSend>;
  send: (prepared: ReadySend) => Promise<SendOutcome>;
  onSent?: () => void;
  /** Opens Receive for an asset, from the error that says the balance is too low. */
  onReceive?: (assetId: string) => void;
}): React.JSX.Element {
  const ids = { amount: useId(), recipient: useId(), error: useId() };
  const choices = balances.filter(
    (balance): balance is ReadBalance =>
      balance.kind === 'read' && BigInt(balance.available) > 0n && fromFor(balance.asset) !== null,
  );
  const [assetId, setAssetId] = useState(
    choices.find((choice) => choice.asset.id === initialAssetId)?.asset.id ??
      choices[0]?.asset.id ??
      '',
  );
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [state, setState] = useState<FormState>({ kind: 'editing', error: null });
  // The balances can arrive after the first render, so the requested asset still applies then.
  const selected =
    choices.find((choice) => choice.asset.id === (assetId || initialAssetId)) ?? choices[0];

  if (!selected) {
    return (
      <p className="seams-account-description">
        <WalletText message="This wallet holds nothing to send yet." />
      </p>
    );
  }
  const asset = selected.asset;
  const from = fromFor(asset) ?? '';
  const available = BigInt(selected.available);
  const busy =
    state.kind === 'pricing_max' || state.kind === 'checking' || state.kind === 'confirming';

  const fillMax = async () => {
    let maxFeeNative: bigint | undefined;
    if (asset.kind === 'evm_native' || (asset.kind === 'erc20' && asset.paysGas)) {
      setState({ kind: 'pricing_max' });
      // A transfer of one base unit to the sender itself prices the fee.
      const probe = await prepare({
        asset,
        from,
        recipient: from,
        amount: exactAssetAmount('1', asset.decimals),
      });
      if (probe.kind !== 'evm') {
        setState({ kind: 'editing', error: REJECTION_MESSAGES.unavailable });
        return;
      }
      maxFeeNative = probe.maxFeeNative;
    }
    const max = maxSendBaseUnits({ asset, available, maxFeeNative });
    setAmount(max > 0n ? exactAssetAmount(max.toString(), asset.decimals) : '0');
    setState({ kind: 'editing', error: null });
  };

  const review = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const parsed = parseSendAmount(amount, asset.decimals);
    if (parsed.kind !== 'valid') {
      setState({ kind: 'editing', error: 'Enter a valid amount.' });
      return;
    }
    if (parsed.baseUnits > available) {
      setState({ kind: 'editing', error: 'This is more than you can send.' });
      return;
    }
    setState({ kind: 'checking' });
    const prepared = await prepare({ asset, from, recipient, amount });
    if (prepared.kind === 'rejected') {
      setState({ kind: 'editing', error: REJECTION_MESSAGES[prepared.reason] });
      return;
    }
    if (
      prepared.kind === 'evm' &&
      prepared.baseUnits + feeInAssetUnits(asset, prepared.maxFeeNative) > available
    ) {
      setState({
        kind: 'editing',
        error: 'The amount and the network fee are more than you hold. Use Max.',
      });
      return;
    }
    setState({ kind: 'confirming' });
    const outcome = await send(prepared);
    if (outcome.kind === 'sent') {
      setState({ kind: 'sent', transactionId: outcome.transactionId });
      onSent?.();
      return;
    }
    setState({ kind: 'failed', message: outcome.message, retry: outcome.kind === 'not_sent' });
  };

  if (state.kind === 'sent') {
    return (
      <div className="seams-assets-form">
        <div className="seams-account-inset" role="status">
          <WalletText message="Funds sent." />
          <code className="seams-assets-tx">{state.transactionId}</code>
        </div>
        <button
          type="button"
          className="seams-assets-secondary"
          onClick={() => {
            setAmount('');
            setState({ kind: 'editing', error: null });
          }}
        >
          <WalletText message="Send again" />
        </button>
      </div>
    );
  }

  const near = isNearAsset(asset);
  const error = state.kind === 'editing' ? state.error : null;
  return (
    <form className="seams-assets-form" onSubmit={review} noValidate>
      <AssetPicker
        assets={choices.map((choice) => choice.asset)}
        value={asset}
        disabled={busy}
        onChange={(id) => {
          setAssetId(id);
          setAmount('');
          setRecipient('');
          setState({ kind: 'editing', error: null });
        }}
        aside={
          <WalletText
            message="{value0} available"
            values={{ value0: formatAssetAmount(selected.available, asset.decimals) }}
          />
        }
      />
      <div className="seams-assets-amount-box">
        <label className="seams-assets-field-label" htmlFor={ids.amount}>
          <WalletText message="Amount" />
        </label>
        <div className="seams-assets-amount-row">
          <input
            id={ids.amount}
            className="seams-assets-amount-input"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            disabled={busy}
            aria-invalid={
              error === 'Enter a valid amount.' || error === 'This is more than you can send.'
            }
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setAmount(event.target.value)}
          />
          <span className="seams-assets-unit">{asset.symbol}</span>
          <button
            type="button"
            className="seams-assets-pill"
            onClick={() => void fillMax()}
            disabled={busy}
          >
            <WalletText message="Max" />
          </button>
        </div>
      </div>
      <div className="seams-assets-field is-input">
        <span className="seams-assets-field-text">
          <label className="seams-assets-field-label" htmlFor={ids.recipient}>
            <WalletText message="To" />
          </label>
          <input
            id={ids.recipient}
            className="seams-assets-text-input"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={near ? 'name.near' : '0x…'}
            value={recipient}
            disabled={busy}
            aria-invalid={
              error === 'Enter a valid recipient for this network.' ||
              error === 'This NEAR account does not exist.'
            }
            aria-describedby={error ? ids.error : undefined}
            onChange={(event) => setRecipient(event.target.value)}
          />
        </span>
      </div>
      {error ? (
        <p id={ids.error} className="seams-assets-error" role="alert">
          <WalletText message={error} />
        </p>
      ) : null}
      {onReceive && error && BALANCE_ERRORS.has(error) ? (
        <button
          type="button"
          className="seams-assets-secondary"
          onClick={() => onReceive(asset.id)}
        >
          <WalletText message="Receive {value0}" values={{ value0: asset.symbol }} />
        </button>
      ) : null}
      {state.kind === 'failed' ? (
        <p className="seams-assets-error" role="alert">
          <WalletText copy={state.message} />
          {state.retry ? null : (
            <>
              {' '}
              <WalletText message="The funds may have been sent. Check your balance before you try again." />
            </>
          )}
        </p>
      ) : null}
      <button
        type="submit"
        className="seams-account-action primary"
        disabled={busy || (state.kind === 'failed' && !state.retry)}
      >
        {state.kind === 'checking' ? (
          <WalletText message="Checking…" />
        ) : state.kind === 'confirming' ? (
          <WalletText message="Confirm in your wallet…" />
        ) : (
          <WalletText message="Review and send" />
        )}
      </button>
      <p className="seams-assets-note is-centered">
        <WalletText message="The wallet shows the transaction next. Nothing is signed before you confirm." />
      </p>
    </form>
  );
}
