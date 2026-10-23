import { WalletText } from '@/react/context/WalletLocale';
import React from 'react';
import TouchIcon from './icons/TouchIcon';
import { MailIcon } from './icons/MailIcon';
import { HoverArrowIcon } from './icons/HoverArrowIcon';
import { LaptopIcon } from './icons/LaptopIcon';

type AuthenticationMethodRowProps = {
  kind: 'passkey' | 'email_otp' | 'voiceid';
  title: string;
  description: string;
  /** Replaces the method's default icon, as for a linked device. */
  icon?: React.ReactNode;
  action?: React.ReactNode;
  onSelect?: () => void;
  children?: React.ReactNode;
};

function methodIcon(kind: AuthenticationMethodRowProps['kind']): React.ReactNode {
  switch (kind) {
    case 'passkey':
      return <TouchIcon width={20} height={20} strokeWidth={1.5} />;
    case 'email_otp':
      return <MailIcon size={20} strokeWidth={1.75} />;
    case 'voiceid':
      return <LaptopIcon size={20} strokeWidth={1.75} />;
  }
}

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
            {icon ?? methodIcon(kind)}
          </span>
          <div>
            <strong>
              <WalletText copy={title} />
            </strong>
            <small>
              <WalletText copy={description} />
            </small>
          </div>
          <HoverArrowIcon />
        </button>
      </li>
    );
  }
  return (
    <li className="seams-linked-devices-modal-item seams-linked-devices-modal-item--row">
      <span className="seams-linked-devices-modal-item-icon" aria-hidden="true">
        {icon ?? methodIcon(kind)}
      </span>
      <div className="seams-linked-devices-modal-item-content">
        <div className="seams-linked-devices-modal-item-main">
          <span className="seams-linked-devices-modal-item-name">
            <WalletText copy={title} />
          </span>
          <span className="seams-linked-devices-modal-standing tone-active">
            <WalletText message="Active" />
          </span>
        </div>
        <div className="seams-linked-devices-modal-item-detail">
          <WalletText copy={description} />
        </div>
        {children}
      </div>
      {action}
    </li>
  );
}
