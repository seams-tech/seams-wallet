import React, { Fragment } from 'react';
import { MenuItem } from './MenuItem';
import { LockMenuItem } from './LockMenuItem';
import { TransactionSettingsSection } from './TransactionSettingsSection';
import type { ProfileDropdownProps, MenuItem as MenuItemModel } from './types';
import './ProfileDropdown.css';

const SECURITY_ITEMS = [
  'authentication-methods',
  'scan-link-device',
  'linked-devices',
  'recovery-codes',
];
function isSecurityItem(item: MenuItemModel): boolean {
  return SECURITY_ITEMS.includes(item.id ?? '');
}
function compareSecurityItems(a: MenuItemModel, b: MenuItemModel): number {
  return SECURITY_ITEMS.indexOf(a.id ?? '') - SECURITY_ITEMS.indexOf(b.id ?? '');
}
function isAccountItem(item: MenuItemModel): boolean {
  return !isSecurityItem(item);
}
function storeMenuRef(
  refs: React.MutableRefObject<(HTMLElement | null)[]>,
  index: number,
  element: HTMLButtonElement | null,
): void {
  refs.current[index] = element;
}

function MenuGroup({
  label,
  items,
  props,
}: {
  label: string;
  items: MenuItemModel[];
  props: ProfileDropdownProps;
}): React.JSX.Element {
  return (
    <section className="seams-account-menu-group" aria-label={label}>
      <h3>{label}</h3>
      {items.map(renderItem.bind(null, props))}
    </section>
  );
}
function renderItem(props: ProfileDropdownProps, item: MenuItemModel): React.JSX.Element {
  const index = props.menuItems.indexOf(item);
  return (
    <Fragment key={item.id}>
      <MenuItem
        ref={storeMenuRef.bind(null, props.menuItemsRef, index)}
        item={item}
        onClose={props.onClose}
        isHighlighted={item.id === props.highlightedMenuItemId}
      />
      {item.id === 'transaction-settings' &&
      props.transactionSettingsOpen &&
      props.currentConfirmConfig &&
      props.onToggleSkipClick &&
      props.onSetDelay ? (
        <TransactionSettingsSection
          currentConfirmConfig={props.currentConfirmConfig}
          onSetUiMode={props.onSetUiMode}
          onToggleSkipClick={props.onToggleSkipClick}
          onSetDelay={props.onSetDelay}
          isOpen
          theme={props.theme}
        />
      ) : null}
    </Fragment>
  );
}
export function ProfileDropdown(props: ProfileDropdownProps): React.JSX.Element {
  props.menuItemsRef.current.length = props.menuItems.length;
  return (
    <div className="seams-profile-dropdown-menu">
      <MenuGroup
        label="Security & devices"
        items={props.menuItems.filter(isSecurityItem).sort(compareSecurityItems)}
        props={props}
      />
      <MenuGroup
        label="Accounts & transactions"
        items={props.menuItems.filter(isAccountItem)}
        props={props}
      />
      <LockMenuItem onLock={props.onLock} className="seams-lock-menu-item" />
    </div>
  );
}
