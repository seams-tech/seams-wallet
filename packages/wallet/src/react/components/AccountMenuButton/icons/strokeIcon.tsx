import React from 'react';

export type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
  animate?: boolean;
};

type DrawInProps = Pick<
  React.SVGAttributes<SVGElement>,
  'pathLength' | 'strokeDasharray' | 'strokeDashoffset' | 'style'
>;

// Renders a lucide stroke icon whose strokes draw in on the first frame after mount, fading
// from `fromColor` to currentColor. `drawShapes` spreads the draw-in props onto each shape.
export function useDrawInStrokeIcon(
  { size = 24, className, strokeWidth = 2, animate = true, style, ...rest }: IconProps,
  name: string,
  fromColor: string,
  drawShapes: (drawIn: DrawInProps) => React.ReactNode,
): React.ReactElement {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    if (!animate) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [animate]);

  const animationDuration = '900ms';
  const dash = 100;
  const dashProps = animate
    ? {
        pathLength: dash,
        strokeDasharray: dash,
        strokeDashoffset: mounted ? 0 : dash,
        style: {
          stroke: mounted ? 'currentColor' : fromColor,
          transition: `stroke-dashoffset ${animationDuration} cubic-bezier(0.22, 1, 0.36, 1), stroke ${animationDuration} ease`,
          ...style,
        } as React.CSSProperties,
      }
    : { style };

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
      {drawShapes(dashProps)}
    </svg>
  );
}
