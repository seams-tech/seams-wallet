import type { FC } from 'react';
import { lucideIconSvg } from './lucideIcon';

type SpinnerIconProps = {
  className?: string;
};

export const SpinnerIcon: FC<SpinnerIconProps> = ({ className }) => {
  const classes = ['seams-menu-spinner-icon', className].filter(Boolean).join(' ');
  return lucideIconSvg(
    'spinner',
    { className: classes },
    <>
      <circle cx="12" cy="12" r="8.5" className="seams-menu-spinner-icon-track" />
      <path
        d="M20.5 12A8.5 8.5 0 0 0 12 3.5"
        className="seams-menu-spinner-icon-head"
        strokeLinecap="round"
      />
    </>,
  );
};

export default SpinnerIcon;
