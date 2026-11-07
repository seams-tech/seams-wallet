import React, { useEffect, useId, useState } from 'react';
import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletDisplayText, walletText } from '@/core/ui/messages';
import type { WalletAsset } from '@/core/assets/assetList';
import { TokenArtwork } from './TokenArtwork';
import { networkLabel } from './assetFormat';

type QrState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly dataUrl: string }
  | { readonly kind: 'failed' };

function depositAddress(
  asset: WalletAsset,
  nearAccount: string | null,
  evmAddress: string | null,
): string | null {
  return asset.kind === 'near_native' || asset.kind === 'nep141' ? nearAccount : evmAddress;
}

function useQrCode(text: string | null): QrState {
  const [state, setState] = useState<QrState>({ kind: 'loading' });
  useEffect(() => {
    if (!text) return;
    let live = true;
    setState({ kind: 'loading' });
    import('qrcode')
      .then((qrcode) =>
        qrcode.toDataURL(text, { margin: 1, width: 320, errorCorrectionLevel: 'M' }),
      )
      .then((dataUrl) => {
        if (live) setState({ kind: 'ready', dataUrl });
      })
      .catch(() => {
        if (live) setState({ kind: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [text]);
  return state;
}

/** Receive into this wallet: one asset, its network, the address, a QR code and a warning. */
export function DepositPanel({
  assets,
  nearAccount,
  evmAddress,
  initialAssetId,
}: {
  assets: readonly WalletAsset[];
  nearAccount: string | null;
  evmAddress: string | null;
  initialAssetId?: string;
}): React.JSX.Element {
  const locale = useWalletLocale();
  const selectId = useId();
  const choices = assets.filter((asset) => depositAddress(asset, nearAccount, evmAddress));
  const [assetId, setAssetId] = useState(
    choices.find((asset) => asset.id === initialAssetId)?.id ?? choices[0]?.id ?? '',
  );
  const asset = choices.find((entry) => entry.id === assetId) ?? choices[0];
  const address = asset ? depositAddress(asset, nearAccount, evmAddress) : null;
  const qr = useQrCode(address);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [address]);

  if (!asset || !address) {
    return (
      <p className="seams-account-description">
        <WalletText message="This wallet has no address for deposits yet." />
      </p>
    );
  }
  const network = walletDisplayText(locale, networkLabel(asset));
  const copy = () => {
    void navigator.clipboard?.writeText(address).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <div className="seams-assets-form">
      <div className="seams-assets-field">
        <TokenArtwork artwork={asset.artwork} size={26} />
        <span className="seams-assets-field-text">
          <label className="seams-assets-field-label" htmlFor={selectId}>
            <WalletText message="Asset" />
          </label>
          <select
            id={selectId}
            className="seams-assets-select"
            value={asset.id}
            onChange={(event) => setAssetId(event.target.value)}
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {walletText(locale, '{value0} on {value1}', {
                  value0: choice.symbol,
                  value1: walletDisplayText(locale, networkLabel(choice)),
                })}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div className="seams-assets-qr-card">
        <div className="seams-assets-qr">
          {qr.kind === 'ready' ? (
            <img
              src={qr.dataUrl}
              width={156}
              height={156}
              alt={walletText(locale, 'QR code for {value0}', { value0: address })}
            />
          ) : (
            <span className="seams-assets-qr-placeholder" aria-hidden="true" />
          )}
        </div>
        <code className="seams-assets-address">{address}</code>
        <button type="button" className="seams-assets-secondary is-on-surface" onClick={copy}>
          {copied ? <WalletText message="Copied" /> : <WalletText message="Copy address" />}
        </button>
        <span className="seams-assets-visually-hidden" role="status">
          {copied ? walletText(locale, 'Copied') : ''}
        </span>
      </div>
      <div className="seams-account-inset">
        {asset.symbol === network ? (
          <WalletText
            message="Send only {value0} to this address. Tokens sent on another network do not arrive here."
            values={{ value0: asset.symbol }}
          />
        ) : (
          <WalletText
            message="Send only {value0} on {value1} to this address. Tokens sent on another network do not arrive here."
            values={{ value0: asset.symbol, value1: network }}
          />
        )}
      </div>
      {asset.bridge ? (
        <p className="seams-assets-note">
          <WalletText
            message="This address takes {value0} as a token on NEAR. A deposit from the {value1} network itself is not supported here yet."
            values={{ value0: asset.symbol, value1: walletDisplayText(locale, asset.name) }}
          />
        </p>
      ) : null}
    </div>
  );
}
