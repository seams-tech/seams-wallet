import React, { useEffect, useId, useRef, useState } from 'react';
import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletDisplayText, walletText } from '@/core/ui/messages';
import type { WalletAsset } from '@/core/assets/assetList';
import { lucideIcon } from '../icons/lucideIcon';
import { TokenArtwork } from './TokenArtwork';
import { networkLabel } from './assetFormat';

const ChevronDownIcon = lucideIcon('chevron-down', <path d="m6 9 6 6 6-6" />);
const CheckIcon = lucideIcon('check', <path d="M20 6 9 17l-5-5" />);

/**
 * The Asset field on Receive and Send: the chosen asset, and a list of every choice with its
 * artwork and network. A listbox in the panel's own tokens replaces the platform's select menu.
 */
export function AssetPicker({
  assets,
  value,
  onChange,
  disabled = false,
  aside,
}: {
  assets: readonly WalletAsset[];
  value: WalletAsset;
  onChange: (assetId: string) => void;
  disabled?: boolean;
  aside?: React.ReactNode;
}): React.JSX.Element {
  const locale = useWalletLocale();
  const id = useId();
  const ids = { label: `${id}label`, value: `${id}value`, list: `${id}list` };
  const optionId = (index: number) => `${id}option${index}`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const label = (asset: WalletAsset) =>
    walletText(locale, '{value0} on {value1}', {
      value0: asset.symbol,
      value1: walletDisplayText(locale, networkLabel(asset)),
    });
  const show = () => {
    setActive(
      Math.max(
        0,
        assets.findIndex((asset) => asset.id === value.id),
      ),
    );
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (asset: WalletAsset) => {
    close();
    if (asset.id !== value.id) onChange(asset.id);
  };

  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  });
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    show();
  };
  const onListKeyDown = (event: React.KeyboardEvent) => {
    const last = assets.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        setActive((index) => Math.min(index + 1, last));
        break;
      case 'ArrowUp':
        setActive((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        setActive(0);
        break;
      case 'End':
        setActive(last);
        break;
      case 'Enter':
      case ' ': {
        const asset = assets[active];
        if (asset) choose(asset);
        break;
      }
      // The dialog closes on an Escape nothing else handled; this one closes only the list.
      case 'Escape':
        close();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="seams-assets-picker" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="seams-assets-field seams-assets-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? ids.list : undefined}
        aria-labelledby={`${ids.label} ${ids.value}`}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKeyDown}
      >
        <TokenArtwork artwork={value.artwork} size={26} />
        <span className="seams-assets-field-text">
          <span id={ids.label} className="seams-assets-field-label">
            <WalletText message="Asset" />
          </span>
          <span id={ids.value} className="seams-assets-picker-value">
            {label(value)}
          </span>
        </span>
        {aside ? <span className="seams-assets-field-aside">{aside}</span> : null}
        <ChevronDownIcon size={16} className="seams-assets-picker-chevron" />
      </button>
      {open ? (
        <ul
          ref={list}
          id={ids.list}
          className="seams-assets-picker-list"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={ids.label}
          aria-activedescendant={optionId(active)}
          onKeyDown={onListKeyDown}
          // A click on an option keeps focus in the list; focus that leaves the picker closes it.
          onMouseDown={(event) => event.preventDefault()}
          onBlur={(event) => {
            if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
          }}
        >
          {assets.map((asset, index) => {
            const selected = asset.id === value.id;
            return (
              <li
                key={asset.id}
                id={optionId(index)}
                className={`seams-assets-picker-option${index === active ? ' is-active' : ''}`}
                role="option"
                aria-selected={selected}
                aria-label={label(asset)}
                onClick={() => choose(asset)}
                onMouseMove={() => setActive(index)}
              >
                <TokenArtwork artwork={asset.artwork} size={28} />
                <span className="seams-assets-picker-option-text">
                  <span className="seams-assets-picker-symbol">{asset.symbol}</span>
                  <span className="seams-assets-picker-network">
                    {walletDisplayText(locale, networkLabel(asset))}
                  </span>
                </span>
                {selected ? <CheckIcon size={16} className="seams-assets-picker-check" /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
