import { WalletText } from '@/react/context/WalletLocale';
import React from 'react';
import type { TransactionSettingsSectionProps } from './types';
import type { ConfirmationBehavior, ConfirmationConfig } from '@/core/types/signer-worker';

export const TransactionSettingsSection: React.FC<TransactionSettingsSectionProps> = ({
  currentConfirmConfig,
  onSetUiMode,
  onToggleSkipClick,
  onSetDelay,
  className,
  style,
  isOpen = true,
  presentation = 'menu',
}) => {
  React.useEffect(() => {
    if (!isOpen) return;
    if (currentConfirmConfig?.behavior !== 'skipClick') return;
    const delay = currentConfirmConfig?.autoProceedDelay ?? 0;
    if (delay === 0) return;
    onSetDelay(0);
  }, [currentConfirmConfig?.autoProceedDelay, currentConfirmConfig?.behavior, isOpen, onSetDelay]);

  const reviewLabelId = React.useId();

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const disableAll = !isOpen;
  // The menu is narrow: its cards show the drawing and the label only.
  const compact = presentation === 'menu';
  // A stored uiMode 'none' predates this screen: it shows as review off, with
  // no layout chosen, until the user picks one.
  const uiMode = currentConfirmConfig.uiMode ?? 'modal';
  const reviewOn = uiMode !== 'none' && currentConfirmConfig.behavior !== 'skipClick';
  const toggleReview = (): void => {
    if (reviewOn) {
      setBehavior(currentConfirmConfig, onSetDelay, onToggleSkipClick, 'skipClick');
      return;
    }
    if (uiMode === 'none') onSetUiMode?.('modal');
    setBehavior(currentConfirmConfig, onSetDelay, onToggleSkipClick, 'requireClick');
  };

  return (
    <div
      className={`seams-transaction-page${className ? ` ${className}` : ''}`}
      data-presentation={presentation}
      style={style}
      onClick={compact ? handleClick : undefined}
    >
      <div className="seams-transaction-review-setting">
        <div className="seams-transaction-review-row">
          <span className="seams-transaction-review-text">
            <strong id={reviewLabelId}>
              <WalletText message="Review before signing" />
            </strong>
            <span>
              {reviewOn ? (
                <WalletText message="Show the transaction details, then click Continue to sign." />
              ) : (
                <WalletText message="Passkey authentication starts as soon as the details appear." />
              )}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            className="seams-transaction-switch"
            aria-checked={reviewOn}
            aria-labelledby={reviewLabelId}
            disabled={disableAll}
            onClick={toggleReview}
          >
            <span aria-hidden="true" />
          </button>
        </div>
        <p>
          <WalletText message="On phones, in Safari and for Email OTP sign-in, the wallet always waits for Continue." />
        </p>
      </div>
      <fieldset className="seams-transaction-group" disabled={disableAll}>
        <legend>
          <WalletText message="Review appearance" />
        </legend>
        <p>
          <WalletText message="Choose where transaction details appear before signing." />
        </p>
        <div className="seams-transaction-choices">
          {UI_CHOICES.map(renderUiChoice.bind(null, compact, uiMode, onSetUiMode))}
        </div>
      </fieldset>
    </div>
  );
};

type UiChoice = { value: 'modal' | 'drawer'; label: string; description: string };
const UI_CHOICES: UiChoice[] = [
  { value: 'modal', label: 'Modal', description: 'Review the transaction in a centered dialog.' },
  { value: 'drawer', label: 'Drawer', description: 'Review the transaction in a slide-out panel.' },
];
// A small drawing of where the details appear: the page, dimmed, with a
// dialog or a drawer on top of it.
function ChoicePreview({ kind }: { kind: UiChoice['value'] }): React.ReactElement {
  return (
    <span className="seams-transaction-preview" data-preview={kind} aria-hidden="true">
      <span className="seams-tp-page">
        <i />
        <i />
        <i />
      </span>
      <span className="seams-tp-scrim" />
      <span className="seams-tp-panel">
        <i />
        <i />
        <b />
      </span>
    </span>
  );
}

function renderUiChoice(
  compact: boolean,
  selected: ConfirmationConfig['uiMode'],
  onSelect: TransactionSettingsSectionProps['onSetUiMode'],
  choice: UiChoice,
) {
  return (
    <button
      type="button"
      key={choice.value}
      className="seams-transaction-choice"
      aria-pressed={selected === choice.value}
      onClick={onSelect?.bind(null, choice.value)}
    >
      <ChoicePreview kind={choice.value} />
      <span className="seams-transaction-choice-text">
        <span className="seams-transaction-choice-head">
          <strong>
            <WalletText copy={choice.label} />
          </strong>
          <span className="seams-transaction-choice-indicator" aria-hidden="true" />
        </span>
        {compact ? null : (
          <span className="seams-transaction-choice-description">
            <WalletText copy={choice.description} />
          </span>
        )}
      </span>
    </button>
  );
}

function setBehavior(
  config: TransactionSettingsSectionProps['currentConfirmConfig'],
  setDelay: TransactionSettingsSectionProps['onSetDelay'],
  toggle: TransactionSettingsSectionProps['onToggleSkipClick'],
  value: ConfirmationBehavior,
) {
  if (value === 'skipClick' && (config.autoProceedDelay ?? 0) !== 0) setDelay(0);
  if ((value === 'skipClick') !== (config.behavior === 'skipClick')) toggle();
}
