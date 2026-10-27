import type React from 'react';
import type { IconProps } from './strokeIcon';
import './Icon.css';

function iconDimension(value: number | string): string {
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(value)) {
    return `${value}px`;
  }
  return value;
}

// The svg frame every lucide stroke icon here shares; `name` is the lucide icon name.
export function lucideIconSvg(
  name: string,
  {
    size = 24,
    width = size,
    height = size,
    className,
    fill = 'none',
    stroke = 'currentColor',
    strokeWidth = 2,
    style,
    ...rest
  }: IconProps,
  shapes: React.ReactNode,
): React.ReactElement {
  const iconStyle = {
    '--seams-icon-width': iconDimension(width),
    '--seams-icon-height': iconDimension(height),
    '--seams-icon-fill': fill,
    '--seams-icon-stroke': stroke,
    '--seams-icon-stroke-width': strokeWidth,
    ...style,
  };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      style={iconStyle}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`seams-icon seams-icon-${name}${className ? ` ${className}` : ''}`}
      aria-hidden="true"
      focusable="false"
      {...rest}
      data-seams-root=""
    >
      {shapes}
    </svg>
  );
}

// A lucide stroke icon that renders fixed shapes, with no draw-in.
export function lucideIcon(name: string, shapes: React.ReactNode): React.FC<IconProps> {
  return (props) => lucideIconSvg(name, props, shapes);
}
