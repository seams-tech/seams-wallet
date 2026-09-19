import LogOutIcon from './icons/LogOutIcon2';
import { memo } from 'react';
import type { LockMenuItemProps } from './types';

export const LockMenuItem: React.FC<LockMenuItemProps> = memo(
  ({ onLock, className, style }) => {
    return (
      <button
        className={`seams-dropdown-menu-item ${className || ''}`}
        style={style}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation();
          onLock();
        }}
      >
        <div className="seams-dropdown-menu-item-icon">
          <LogOutIcon />
        </div>
        <div className="seams-dropdown-menu-item-content">
          <div className="seams-dropdown-menu-item-label">Lock Wallet</div>
        </div>
      </button>
    );
  },
);
