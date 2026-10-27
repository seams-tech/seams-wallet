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
const controlledDropdown: AccountMenuButtonProps = {
  nearAccountId: null,
  presentation: 'dropdown',
  isMenuOpen: true,
  onMenuOpenChange: onOpenChange,
};
const preview: AccountMenuButtonMockProps = { presentation: 'dropdown', defaultOpen: false };
void [dropdown, modal, controlledDropdown, preview];

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
];
