import React from 'react';
import TouchIcon from './icons/TouchIcon';
import { MailIcon } from './icons/MailIcon';
import { HoverArrowIcon } from './icons/HoverArrowIcon';

type AuthenticationMethodRowProps = {
  kind: 'passkey' | 'email_otp';
  title: string;
  description: string;
  /** Replaces the method's default icon, as for a linked device. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onSelect?: () => void;
  children?: React.ReactNode;
};

export function AuthenticationMethodRow({
  kind,
  title,
  description,
  icon,
  action,
  onSelect,
  children,
}: AuthenticationMethodRowProps): React.JSX.Element {
  if (onSelect) {
    return (
      <li className="seams-account-method-list-item">
        <button type="button" className="seams-account-method-button" onClick={onSelect}>
          <span className="seams-account-avatar">
            {icon ??
              (kind === 'passkey' ? (
                <TouchIcon width={20} height={20} strokeWidth={1.5} />
              ) : (
                <MailIcon size={20} strokeWidth={1.5} />
              ))}
          </span>
          <div>
            <strong>{title}</strong>
            <small>{description}</small>
          </div>
          <HoverArrowIcon />
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
