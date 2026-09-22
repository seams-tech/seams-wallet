import React from 'react';
import type { TransactionSettingsSectionProps } from './types';
import { SegmentedControl } from './SegmentedControl';

const TRANSACTION_SETTINGS_ACTIVE_BACKGROUND =
  'var(--seams-colors-buttonBackground, var(--seams-colors-primary))';

export const TransactionSettingsSection: React.FC<TransactionSettingsSectionProps> = ({
  currentConfirmConfig,
  onSetUiMode,
  onToggleShowDetails,
  onToggleSkipClick,
  onSetDelay,
  className,
  style,
  isOpen = true,
  theme = 'dark',
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

  if (presentation === 'page') {
    return (
      <div className="seams-transaction-page">
        <fieldset className="seams-transaction-group" disabled={disableAll}>
          <legend>Review appearance</legend>
          <p>Choose where transaction details appear before signing.</p>
          <div className="seams-transaction-choices">
            {UI_CHOICES.map(
              renderUiChoice.bind(null, currentConfirmConfig.uiMode ?? 'modal', onSetUiMode),
            )}
          </div>
        </fieldset>
        <fieldset className="seams-transaction-group" disabled={disableAll || disableRequireClick}>
          <legend>Confirmation step</legend>
          <p>
            {disableRequireClick
              ? 'Choose Modal or Drawer to configure the confirmation step.'
              : 'Choose whether to click Continue before authentication starts.'}
          </p>
          <div className="seams-transaction-choices seams-transaction-choices--two">
            {BEHAVIOR_CHOICES.map(
              renderBehaviorChoice.bind(null, currentConfirmConfig, onSetDelay, onToggleSkipClick),
            )}
          </div>
        </fieldset>
      </div>
    );
  }

  return (
    <div
      className={`seams-dropdown-tx-settings-root ${isOpen ? 'is-expanded' : ''} ${className || ''}`}
      style={style}
      onClick={handleClick}
    >
      <div className="seams-dropdown-toggle-tx-settings">
        <div
          className="seams-dropdown-toggle-tx-settings-content"
          aria-hidden={!isOpen}
          style={{ pointerEvents: isOpen ? 'auto' : 'none' }}
        >
          <div
            style={{
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div>
              <div className="seams-confirmation-options">Confirmer UI</div>
              <div style={{ width: '100%' }}>
                <SegmentedControl
                  items={[
                    { value: 'none', label: 'none', disabled: disableAll },
                    { value: 'modal', label: 'modal', disabled: disableAll },
                    { value: 'drawer', label: 'drawer', disabled: disableAll },
                  ]}
                  value={currentConfirmConfig?.uiMode ?? 'modal'}
                  onValueChange={(v) => onSetUiMode?.(v as 'none' | 'modal' | 'drawer')}
                  activeBg={TRANSACTION_SETTINGS_ACTIVE_BACKGROUND}
                  height={40}
                  buttonFontSize={12}
                  containerStyle={{ background: 'var(--seams-colors-surface2)', width: '100%' }}
                  buttonStyle={{
                    display: 'grid',
                    placeItems: 'center',
                    lineHeight: 1,
                    padding: '0 10px',
                  }}
                  activeButtonStyle={{ color: 'var(--seams-colors-textButton)' }}
                />
              </div>
            </div>
            <div
              style={{
                opacity: disableRequireClick ? 0.6 : 1,
                pointerEvents: disableRequireClick ? 'none' : 'auto',
              }}
            >
              <div className="seams-confirmation-options">Confirmation Options</div>
              <div style={{ width: '100%' }}>
                <SegmentedControl
                  items={[
                    {
                      value: 'skipClick',
                      label: 'skip click',
                      disabled: disableAll || disableRequireClick,
                    },
                    {
                      value: 'requireClick',
                      label: 'require click',
                      disabled: disableAll || disableRequireClick,
                    },
                  ]}
                  value={
                    currentConfirmConfig?.behavior === 'skipClick' ? 'skipClick' : 'requireClick'
                  }
                  onValueChange={(v) => {
                    const wantsSkipClick = v === 'skipClick';
                    const isSkipClick = currentConfirmConfig?.behavior === 'skipClick';
                    if (wantsSkipClick && (currentConfirmConfig?.autoProceedDelay ?? 0) !== 0) {
                      onSetDelay(0);
                    }
                    if (wantsSkipClick !== isSkipClick) onToggleSkipClick?.();
                  }}
                  activeBg={TRANSACTION_SETTINGS_ACTIVE_BACKGROUND}
                  height={40}
                  buttonFontSize={12}
                  containerStyle={{ background: 'var(--seams-colors-surface2)', width: '100%' }}
                  buttonStyle={{
                    display: 'grid',
                    placeItems: 'center',
                    lineHeight: 1,
                    padding: '0 10px',
                  }}
                  activeButtonStyle={{ color: 'var(--seams-colors-textButton)' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
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

function renderUiChoice(
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
      <span className="seams-transaction-choice-indicator" aria-hidden="true" />
      <strong>{choice.label}</strong>
      <span>{choice.description}</span>
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
      <span className="seams-transaction-choice-indicator" aria-hidden="true" />
      <strong>{choice.label}</strong>
      <span>{choice.description}</span>
    </button>
  );
}
