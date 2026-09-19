import React from 'react';
import TouchIcon from './icons/TouchIcon';
import type { UserAccountButtonProps } from './types';

export const UserAccountButton: React.FC<UserAccountButtonProps> = ({
  username,
  hideUsername,
  fullAccountId,
  emailAddress,
  isOpen,
  onClick,
  onMouseEnter,
  onMouseLeave,
  theme = 'dark',
  menuId,
  triggerId,
}) => {
  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  const hideWhenClosed = hideUsername && !isOpen;
  return (
    <div className={`seams-user-account-button-root ${theme}`}>
      <div
        id={triggerId}
        className={`seams-user-account-button-trigger ${hideWhenClosed ? 'hide-username' : ''} ${isOpen ? 'open' : 'closed'}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        {...(menuId ? ({ 'aria-controls': menuId } as any) : {})}
        onKeyDown={onKeyDown}
        {...(onMouseEnter && { onMouseEnter })}
        {...(onMouseLeave && { onMouseLeave })}
      >
        <div className="seams-user-account--user-content">
          <div
            className={`seams-user-account--avatar ${hideWhenClosed ? 'hide-username' : ''} ${isOpen ? 'expanded' : 'shrunk'}`}
          >
            <TouchIcon
              className={`seams-fingerprint-icon ${isOpen ? 'open' : 'closed'}`}
              strokeWidth={1.4}
            />
          </div>
          {!hideWhenClosed && (
            <UserAccountId
              username={username}
              fullAccountId={fullAccountId}
              emailAddress={emailAddress}
              isOpen={isOpen}
              theme={theme}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const UserAccountId = ({
  username,
  fullAccountId,
  emailAddress,
  isOpen,
  theme = 'dark',
}: {
  username: string;
  fullAccountId?: string;
  emailAddress?: string;
  isOpen: boolean;
  theme?: 'dark' | 'light';
}) => {
  const displayAccountId = (fullAccountId || username || '').trim();

  /* plain identity label (the wallet id) — explorer links live in the
     Accounts section of the dropdown */
  return (
    <div className="seams-user-account--user-details">
      <p className="seams-user-account--username">Settings</p>
      <span
        title={displayAccountId || undefined}
        className={`seams-user-account--account-id ${isOpen ? 'visible' : 'hidden'}`}
      >
        {displayAccountId}
      </span>
      {emailAddress && (
        <span
          title={emailAddress}
          className={`seams-user-account--email ${isOpen ? 'visible' : 'hidden'}`}
        >
          {emailAddress}
        </span>
      )}
    </div>
  );
};
