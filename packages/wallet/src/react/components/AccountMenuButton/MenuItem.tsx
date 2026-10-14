import { forwardRef, memo } from 'react';
import type { MenuItemProps } from './types';

export const MenuItem = memo(
  forwardRef<HTMLButtonElement, MenuItemProps>(
    ({ item, onClose, className, style, isHighlighted = false }, ref) => {
      const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!item.disabled) {
          if (item.onClick) {
            item.onClick();
          }
          if (!item.keepOpenOnClick) {
            onClose();
          }
        }
      };

      const disabledClass = item.disabled ? ' disabled' : '';
      const highlightedClass = isHighlighted ? ' highlighted' : '';
      const classNameProps = className ? ` ${className}` : '';

      return (
        <button
          ref={ref}
          type="button"
          disabled={item.disabled}
          data-account-menu-item={item.id}
          className={`seams-dropdown-menu-item${disabledClass}${classNameProps}${highlightedClass}`}
          style={style}
          onClick={handleClick}
        >
          <div className="seams-dropdown-menu-item-icon">{item.icon}</div>
          <div className="seams-dropdown-menu-item-content">
            <div className="seams-dropdown-menu-item-label">{item.label}</div>
            <div className="seams-dropdown-menu-item-description">{item.description}</div>
          </div>
          {!item.disabled ? (
            <svg
              className="seams-account-menu-chevron"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          ) : null}
        </button>
      );
    },
  ),
);
