import React from 'react';
import TouchIcon from './icons/TouchIcon';
import { MailIcon } from './icons/MailIcon';

type AuthenticationMethodRowProps = {
  kind: 'passkey' | 'email_otp';
  title: string;
  description: string;
  action?: React.ReactNode;
  onSelect?: () => void;
  children?: React.ReactNode;
};

export function AuthenticationMethodRow({
  kind,
  title,
  description,
  action,
  onSelect,
  children,
}: AuthenticationMethodRowProps): React.JSX.Element {
  if (onSelect) {
    return (
      <li className="seams-account-method-list-item">
        <button type="button" className="seams-account-method-button" onClick={onSelect}>
          <span className="seams-account-avatar">
            {kind === 'passkey' ? (
              <TouchIcon width={20} height={20} strokeWidth={1.5} />
            ) : (
              <MailIcon size={20} strokeWidth={1.5} />
            )}
          </span>
          <div>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </li>
    );
  }
  return (
    <li className="seams-linked-devices-modal-item seams-linked-devices-modal-item--row">
      <span className="seams-linked-devices-modal-item-icon" aria-hidden="true">
        {kind === 'passkey' ? (
          <TouchIcon width={20} height={20} strokeWidth={1.5} />
        ) : (
          <MailIcon size={20} strokeWidth={1.75} />
        )}
      </span>
      <div className="seams-linked-devices-modal-item-content">
        <div className="seams-linked-devices-modal-item-main">
          <span className="seams-linked-devices-modal-item-name">{title}</span>
          <span className="seams-linked-devices-modal-standing tone-active">Active</span>
        </div>
        <div className="seams-linked-devices-modal-item-detail">{description}</div>
        {children}
      </div>
      {action}
    </li>
  );
}
