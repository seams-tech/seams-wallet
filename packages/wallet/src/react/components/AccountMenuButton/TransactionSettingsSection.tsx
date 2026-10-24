import { WalletText } from '@/react/context/WalletLocale';
import React from 'react';
import type { TransactionSettingsSectionProps } from './types';
import TouchIcon from './icons/TouchIcon';

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

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const disableRequireClick = currentConfirmConfig?.uiMode === 'none';
  const disableAll = !isOpen;
  // The menu is narrow: its cards show the drawing and the label only.
  const compact = presentation === 'menu';

  return (
    <div
      className={`seams-transaction-page${className ? ` ${className}` : ''}`}
      data-presentation={presentation}
      style={style}
      onClick={compact ? handleClick : undefined}
    >
      <fieldset className="seams-transaction-group" disabled={disableAll}>
        <legend>
          <WalletText message="Review appearance" />
        </legend>
        <p>
          <WalletText message="Choose where transaction details appear before signing." />
        </p>
        <div className="seams-transaction-choices">
          {UI_CHOICES.map(
            renderUiChoice.bind(null, compact, currentConfirmConfig.uiMode ?? 'modal', onSetUiMode),
          )}
        </div>
      </fieldset>
      <fieldset className="seams-transaction-group" disabled={disableAll || disableRequireClick}>
        <legend>
          <WalletText message="Confirmation step" />
        </legend>
        <p>
          {disableRequireClick ? (
            <WalletText message="Choose Modal or Drawer to configure the confirmation step." />
          ) : (
            <WalletText message="Choose whether to click Continue before authentication starts." />
          )}
        </p>
        <div className="seams-transaction-choices">
          {BEHAVIOR_CHOICES.map(
            renderBehaviorChoice.bind(
              null,
              compact,
              currentConfirmConfig,
              onSetDelay,
              onToggleSkipClick,
            ),
          )}
        </div>
      </fieldset>
    </div>
  );
};

type UiChoice = { value: 'none' | 'modal' | 'drawer'; label: string; description: string };
const UI_CHOICES: UiChoice[] = [
  {
    value: 'none',
    label: 'No review',
    description: 'Start authentication without showing a review panel.',
  },
  { value: 'modal', label: 'Modal', description: 'Review the transaction in a centered dialog.' },
  { value: 'drawer', label: 'Drawer', description: 'Review the transaction in a slide-out panel.' },
];
type BehaviorChoice = { value: 'skipClick' | 'requireClick'; label: string; description: string };
const BEHAVIOR_CHOICES: BehaviorChoice[] = [
  {
    value: 'skipClick',
    label: 'Start automatically',
    description: 'Begin authentication as soon as the review opens.',
  },
  {
    value: 'requireClick',
    label: 'Click to continue',
    description: 'Review the details, then click Continue to start authentication.',
  },
];

// A small drawing of what each choice shows before authentication: the page,
// then a dialog, a drawer or the passkey prompt on top of it.
function ChoicePreview({
  kind,
}: {
  kind: UiChoice['value'] | BehaviorChoice['value'];
}): React.ReactElement {
  const prompt = (
    <span className="seams-tp-prompt">
      <TouchIcon width={18} height={18} strokeWidth={1.5} />
    </span>
  );
  return (
    <span className="seams-transaction-preview" data-preview={kind} aria-hidden="true">
      <span className="seams-tp-page">
        <i />
        <i />
        <i />
      </span>
      {kind === 'none' ? (
        prompt
      ) : (
        <>
          <span className="seams-tp-scrim" />
          <span className="seams-tp-panel">
            <i />
            <i />
            {kind === 'skipClick' ? prompt : <b />}
          </span>
        </>
      )}
    </span>
  );
}

function renderUiChoice(
  compact: boolean,
  selected: UiChoice['value'],
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
  value: BehaviorChoice['value'],
) {
  if (value === 'skipClick' && (config.autoProceedDelay ?? 0) !== 0) setDelay(0);
  if ((value === 'skipClick') !== (config.behavior === 'skipClick')) toggle();
}

function renderBehaviorChoice(
  compact: boolean,
  config: TransactionSettingsSectionProps['currentConfirmConfig'],
  setDelay: TransactionSettingsSectionProps['onSetDelay'],
  toggle: TransactionSettingsSectionProps['onToggleSkipClick'],
  choice: BehaviorChoice,
) {
  const selected = config.behavior === 'skipClick' ? 'skipClick' : 'requireClick';
  return (
    <button
      type="button"
      key={choice.value}
      className="seams-transaction-choice"
      aria-pressed={selected === choice.value}
      onClick={setBehavior.bind(null, config, setDelay, toggle, choice.value)}
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
