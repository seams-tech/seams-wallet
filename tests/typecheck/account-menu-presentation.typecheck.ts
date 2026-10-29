import type { AccountMenuButtonProps } from '@/react/components/AccountMenuButton/types';
import type { AccountMenuButtonMockProps } from '@/react/components/AccountMenuButton/AccountMenuButtonMock';
import { profileOpenControl } from '@/react/components/AccountMenuButton/hooks/useProfileState';

function onOpenChange(_open: boolean): void {}

const dropdown: AccountMenuButtonProps = { nearAccountId: null };
const modal: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'modal',
  isMenuOpen: false,
  onMenuOpenChange: onOpenChange,
};
const drawer: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'drawer',
  isMenuOpen: false,
  onMenuOpenChange: onOpenChange,
};
const drawerPreview: AccountMenuButtonMockProps = {
  presentation: 'drawer',
  isMenuOpen: true,
  onMenuOpenChange: onOpenChange,
};
const controlledDropdown: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'dropdown',
  isMenuOpen: true,
  onMenuOpenChange: onOpenChange,
};
const preview: AccountMenuButtonMockProps = { presentation: 'dropdown', defaultOpen: false };
void [dropdown, modal, drawer, drawerPreview, controlledDropdown, preview];

// @ts-expect-error Drawer settings require a controlled open state.
const drawerWithoutOpen: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'drawer',
  onMenuOpenChange: onOpenChange,
};
// @ts-expect-error Drawer settings require a close handler.
const drawerWithoutChange: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'drawer',
  isMenuOpen: true,
};

// @ts-expect-error Modal settings require an explicit controlled open state.
const missingOpen: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'modal',
  onMenuOpenChange: onOpenChange,
};
// @ts-expect-error Modal settings require a handler for close requests.
const missingChange: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'modal',
  isMenuOpen: true,
};
// @ts-expect-error Controlled dropdowns also need a close handler.
const missingDropdownChange: AccountMenuButtonProps = { nearAccountId: null, isMenuOpen: true };
// @ts-expect-error Full-page settings use WalletSettingsPage.
const invalidPresentation: AccountMenuButtonProps = { nearAccountId: null, presentation: 'page' };

const defaultPreview = { defaultOpen: true };
// @ts-expect-error Broad spreads cannot combine drawer control with a default open value.
const mixedDrawerPreview: AccountMenuButtonMockProps = {
  ...defaultPreview,
  presentation: 'drawer',
  isMenuOpen: true,
  onMenuOpenChange: onOpenChange,
};
// @ts-expect-error Broad spreads cannot combine a default open value with modal control.
const mixedPreview: AccountMenuButtonMockProps = {
  ...defaultPreview,
  presentation: 'modal',
  isMenuOpen: false,
  onMenuOpenChange: onOpenChange,
};
type OpenControl = ReturnType<typeof profileOpenControl>;
const uncontrolled: OpenControl = { kind: 'uncontrolled', initialOpen: false };
// @ts-expect-error A controlled state cannot carry an uncontrolled initial value.
const mixedControl: OpenControl = { ...uncontrolled, kind: 'controlled', open: true, onOpenChange };
// @ts-expect-error An uncontrolled state cannot carry a current controlled value.
const invalidUncontrolled: OpenControl = { kind: 'uncontrolled', initialOpen: false, open: true };
void [
  missingOpen,
  missingChange,
  missingDropdownChange,
  invalidPresentation,
  mixedPreview,
  mixedControl,
  invalidUncontrolled,
  drawerWithoutOpen,
  drawerWithoutChange,
  mixedDrawerPreview,
];
