import React from 'react';
import { UserAccountButton } from './UserAccountButton';
import { ProfileDropdown } from './ProfileDropdown';
import './Web3AuthProfileButton.css';

type AccountMenuButtonViewProps = {
  buttonRef: React.RefObject<HTMLDivElement | null>;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  trigger: React.ComponentProps<typeof UserAccountButton>;
  dropdown: React.ComponentProps<typeof ProfileDropdown>;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

/** Shared rendering for the connected account menu and its provider-free preview. */
export function AccountMenuButtonView({
  buttonRef,
  dropdownRef,
  trigger,
  dropdown,
  className,
  style,
  children,
}: AccountMenuButtonViewProps): React.JSX.Element {
  return (
    <div
      ref={buttonRef}
      className={`seams-profile-button-morphable ${trigger.isOpen ? 'open' : 'closed'}${className ? ` ${className}` : ''}`}
      style={style}
      data-state={trigger.isOpen ? 'open' : 'closed'}
    >
      <UserAccountButton {...trigger} />
      <ProfileDropdown {...dropdown} ref={dropdownRef} />
      {children}
    </div>
  );
}
