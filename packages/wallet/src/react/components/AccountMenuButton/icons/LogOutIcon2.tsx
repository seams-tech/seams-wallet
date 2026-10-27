import React from 'react';
import { lucideIconSvg } from './lucideIcon';

const LogOutIcon: React.FC<{
  className?: string;
  width?: string;
  height?: string;
  style?: React.CSSProperties;
}> = ({ className, width = '20px', height = '20px', style }) =>
  lucideIconSvg(
    'log-out',
    { width, height, className, style, viewBox: '0 0 20 20', strokeWidth: 1.67 },
    <>
      <path
        d="M15.0003 6.66667L18.3337 10M18.3337 10L15.0003 13.3333M18.3337 10H7.50033M12.5003 3.50337C11.438 2.86523 10.2047 2.5 8.88922 2.5C4.90049 2.5 1.66699 5.85786 1.66699 10C1.66699 14.1421 4.90049 17.5 8.88922 17.5C10.2047 17.5 11.438 17.1348 12.5003 16.4966"
        stroke="currentColor"
        strokeWidth="1.67"
        strokeLinecap="round"
        strokeLinejoin="round"
      ></path>
    </>,
  );

export default LogOutIcon;
