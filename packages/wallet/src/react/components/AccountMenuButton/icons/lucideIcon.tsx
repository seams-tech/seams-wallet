import type React from 'react';
import type { IconProps } from './strokeIcon';

// The svg frame every lucide stroke icon here shares; `name` is the lucide icon name.
export function lucideIconSvg(
  name: string,
  { size = 24, className, strokeWidth = 2, ...rest }: IconProps,
  shapes: React.ReactNode,
): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`lucide lucide-${name}-icon lucide-${name}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {shapes}
    </svg>
  );
}

// A lucide stroke icon that renders fixed shapes, with no draw-in.
export function lucideIcon(name: string, shapes: React.ReactNode): React.FC<IconProps> {
  return (props) => lucideIconSvg(name, props, shapes);
}
