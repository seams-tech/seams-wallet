/** @jsxImportSource preact */

export type PadlockIconProps = {
  size?: string;
  strokeWidth?: number;
};

export function PadlockIcon(props: PadlockIconProps) {
  const size = props.size ?? '100%';
  const strokeWidth = props.strokeWidth ?? 2;
  return (
    <svg
      class="padlock-icon seams-padlock-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={strokeWidth}
      stroke-linecap="round"
      stroke-linejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
