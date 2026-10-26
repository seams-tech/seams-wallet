import React from 'react';
import { WalletText } from '../../context/WalletLocale';
import { AccountMenuScreen } from './AccountMenuScreen';

/** The same detail screen for every signing algorithm. */
export function SigningKeyDetails(props: {
  readonly title: string;
  readonly account: string;
  readonly status: string;
  readonly publicKey: string | null;
  readonly publicKeyLabel: string;
  readonly keyId: string | null;
  readonly exportNote?: string;
  readonly onBack: () => void;
  readonly onExport: () => void;
  readonly children?: React.ReactNode;
}) {
  return (
    <AccountMenuScreen title={props.title} onBack={props.onBack}>
      <p className="seams-signing-key-account">{props.account}</p>
      <p>
        <WalletText copy={props.status} />
      </p>
      {props.keyId ? (
        <p className="seams-signing-key-account">
          <WalletText copy="Key ID" />: {props.keyId}
        </p>
      ) : null}
      {props.publicKey ? (
        <label className="seams-signing-key-public">
          <WalletText copy="Public key" />
          <textarea
            className="seams-signing-key-fingerprint"
            aria-label={props.publicKeyLabel}
            rows={3}
            readOnly
            value={props.publicKey}
          />
        </label>
      ) : null}
      <div className="seams-signing-key-actions">
        {props.children}
        <button type="button" className="seams-account-action" onClick={props.onExport}>
          <WalletText copy="Export key" />
        </button>
      </div>
      {props.exportNote ? (
        <p className="seams-account-description">
          <WalletText copy={props.exportNote} />
        </p>
      ) : null}
    </AccountMenuScreen>
  );
}
