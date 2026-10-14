import React from 'react';
import TouchIcon from './icons/TouchIcon';
import { MailIcon } from './icons/MailIcon';

type AuthenticationMethodRowProps = {
  kind: 'passkey' | 'email_otp';
  title: string;
  description: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
};

export function AuthenticationMethodRow({
  kind,
  title,
  description,
  action,
  children,
}: AuthenticationMethodRowProps): React.JSX.Element {
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
