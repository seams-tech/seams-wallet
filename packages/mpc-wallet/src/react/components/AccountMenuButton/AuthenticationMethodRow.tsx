import { WalletText } from '@/react/context/WalletLocale';
import React from 'react';
import TouchIcon from './icons/TouchIcon';
import { MailIcon } from './icons/MailIcon';
import { HoverArrowIcon } from './icons/HoverArrowIcon';
import { lucideIconSvg } from './icons/lucideIcon';

type AuthenticationMethodRowProps = {
  kind: 'passkey' | 'email_otp' | 'voiceid';
  title: string;
  /** Plain copy is localized; an element carries its own live region or tone. */
  description: string | React.ReactElement;
  chip?: string;
  /** Replaces the method's default icon, as for a linked device. */
  icon?: React.ReactNode;
  /** The row's one trailing control, such as Remove or a switch. */
  action?: React.ReactNode;
  /** Full-width actions or a confirmation under a divider. */
  footer?: React.ReactNode;
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
      return lucideIconSvg(
        'voiceid',
        { size: 20, strokeWidth: 1.75 },
        <path d="M4 10v4m4-7v10m4-14v18m4-14v10m4-7v4" />,
      );
  }
}

export function AuthenticationMethodRow({
  kind,
  title,
  description,
  chip,
  icon,
  action,
  footer,
  onSelect,
  children,
}: AuthenticationMethodRowProps): React.JSX.Element {
  if (onSelect) {
    return (
      <li className="seams-account-method-list-item">
        <button type="button" className="seams-account-method-button" onClick={onSelect}>
          <span className="seams-account-avatar">{icon ?? methodIcon(kind)}</span>
          <div>
            <strong>
              <WalletText copy={title} />
            </strong>
            <small>{renderDescription(description)}</small>
          </div>
          <HoverArrowIcon />
        </button>
      </li>
    );
  }
  return (
    <li
      className="seams-linked-devices-modal-item seams-linked-devices-modal-item--row"
      data-auth-method={kind}
    >
      <span className="seams-linked-devices-modal-item-icon" aria-hidden="true">
        {icon ?? methodIcon(kind)}
      </span>
      <div className="seams-linked-devices-modal-item-content">
        <div className="seams-linked-devices-modal-item-main">
          <span className="seams-linked-devices-modal-item-name">
            <WalletText copy={title} />
          </span>
          {chip ? (
            <span className="seams-linked-devices-modal-standing tone-active">
              <WalletText copy={chip} />
            </span>
          ) : null}
        </div>
        <div className="seams-linked-devices-modal-item-detail">
          {renderDescription(description)}
        </div>
        {children}
      </div>
      {action}
      {footer ? <div className="seams-auth-method-footer">{footer}</div> : null}
    </li>
  );
}

function renderDescription(description: string | React.ReactElement): React.ReactNode {
  return typeof description === 'string' ? <WalletText copy={description} /> : description;
}
