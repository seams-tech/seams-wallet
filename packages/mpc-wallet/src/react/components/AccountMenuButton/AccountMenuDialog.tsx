import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletDisplayText } from '@/core/ui/messages';
import { AccountMenuScreen } from './AccountMenuScreen';
import React from 'react';
import { Theme, useTheme } from '../theme';

type AccountMenuDialogPresentation = 'page' | 'embedded';

// The themed frame and title an account-menu screen renders its content inside: a labelled
// region on the settings page, or a back-navigable screen inside the account menu.
export const AccountMenuDialogFrame: React.FC<{
  readonly presentation: AccountMenuDialogPresentation;
  readonly onClose: () => void;
  readonly dialogRef: React.RefObject<HTMLDivElement | null>;
  readonly contentClassName: string;
  readonly titleId: string;
  readonly title: string;
  readonly children: React.ReactNode;
}> = ({ presentation, onClose, dialogRef, contentClassName, titleId, title, children }) => {
  const locale = useWalletLocale();
  const { theme, tokens } = useTheme();
  const scopedTokens = React.useMemo(
    () => (theme === 'dark' ? { dark: tokens } : { light: tokens }),
    [theme, tokens],
  );
  if (presentation === 'embedded') {
    return (
      <AccountMenuScreen
        title={walletDisplayText(locale, title)}
        onBack={onClose}
        className={contentClassName}
      >
        {children}
      </AccountMenuScreen>
    );
  }
  return (
    <Theme theme={theme} tokens={scopedTokens}>
      <div
        className={`seams-linked-devices-modal-backdrop theme-${theme}`}
        data-presentation={presentation}
        role="presentation"
      >
        <div
          ref={dialogRef}
          className={`seams-linked-devices-modal-content ${contentClassName}`}
          role="region"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <div className="seams-account-menu-dialog-main">
            <h2 id={titleId} className="seams-linked-devices-modal-title">
              <WalletText copy={title} />
            </h2>
            {children}
          </div>
        </div>
      </div>
    </Theme>
  );
};
