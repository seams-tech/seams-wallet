/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';

// The frame the menu's 24-unit stroke icons share.
function strokeIcon(
  size: string,
  strokeWidth: string,
  ...shapes: ComponentChildren[]
): ComponentChildren {
  return (
    <>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width={strokeWidth}
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        {shapes}
      </svg>
    </>
  );
}

export function fingerprintIcon(): ComponentChildren {
  return strokeIcon(
    '22',
    '1.5',
    <path d="M6.405 19.048c.184-.443.353-.894.507-1.351" />,
    <path d="M14.343 20.693c.266-.751.502-1.516.707-2.294.186-.706.346-1.422.478-2.147" />,
    <path d="M19.448 17.058c.364-1.964.555-3.989.555-6.058 0-4.418-3.582-8-8-8-1.255 0-2.443.289-3.501.805" />,
    <path d="M3.523 15.025c.314-1.29.48-2.638.48-4.025 0-1.74.556-3.351 1.499-4.664" />,
    <path d="M12.003 11c0 2.76-.447 5.416-1.273 7.899-.213.639-.451 1.266-.712 1.881" />,
    <path d="M7.712 14.5c.191-1.138.291-2.308.291-3.5 0-2.209 1.791-4 4-4s4 1.791 4 4c0 .617-.02 1.229-.058 1.836" />,
  );
}

export function accountDropdownIcon(): ComponentChildren {
  return (
    <>
      <svg
        class="seams-account-dropdown-arrow"
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M9.75 3h4.5v10.28l4.3-4.3 3.18 3.18L12 21.9l-9.73-9.74 3.18-3.18 4.3 4.3V3Z" />
      </svg>
    </>
  );
}

export function backIcon(): ComponentChildren {
  return strokeIcon('18', '2.25', <path d="m15 18-6-6 6-6" />);
}

export function linkDeviceIcon(): ComponentChildren {
  return strokeIcon(
    '18',
    '2',
    <rect width="5" height="5" x="3" y="3" rx="1" />,
    <rect width="5" height="5" x="16" y="3" rx="1" />,
    <rect width="5" height="5" x="3" y="16" rx="1" />,
    <path d="M21 16h-3a2 2 0 0 0-2 2v3" />,
    <path d="M21 21v.01" />,
    <path d="M12 7v3a2 2 0 0 1-2 2H7" />,
    <path d="M3 12h.01" />,
    <path d="M12 3h.01" />,
    <path d="M12 16v.01" />,
    <path d="M16 12h1" />,
    <path d="M21 12v.01" />,
    <path d="M12 21v-1" />,
  );
}

export function recoveryIcon(): ComponentChildren {
  return strokeIcon(
    '18',
    '2',
    <path d="M20 11v6" />,
    <path d="M20 13h2" />,
    <path d="M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 2.072.578" />,
    <circle cx="10" cy="7" r="4" />,
    <circle cx="20" cy="19" r="2" />,
  );
}

export function mailIcon(): ComponentChildren {
  return strokeIcon(
    '21',
    '1.75',
    <rect x="2.75" y="5" width="18.5" height="14" rx="2.75" />,
    <path d="m3.75 7.75 6.94 4.86a2.25 2.25 0 0 0 2.62 0l6.94-4.86" />,
  );
}

export function linkFailedIcon(): ComponentChildren {
  return strokeIcon(
    '22',
    '1.75',
    <path d="M9 17H7A5 5 0 0 1 7 7h2" />,
    <path d="M15 7h2a5 5 0 0 1 3.54 8.54" />,
    <path d="m2 2 20 20" />,
    <path d="M8 12h3" />,
  );
}

export function rerollIcon(): ComponentChildren {
  return (
    <>
      <svg
        class="seams-input-action-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </svg>
    </>
  );
}

// Google's own mark, so the provider button is recognisable at a glance.
export function googleIcon(): ComponentChildren {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function chevronIcon(): ComponentChildren {
  return strokeIcon('13', '1.75', <path d="m9 6 6 6-6 6" />);
}

export function shieldIcon(): ComponentChildren {
  return strokeIcon(
    '14',
    '1.6',
    <path d="M12 3 4.5 6v5.5c0 4.2 2.7 7.4 7.5 9.5 4.8-2.1 7.5-5.3 7.5-9.5V6L12 3Z" />,
    <path d="m8.5 11.5 2.5 2.5 4.5-5" />,
  );
}

export function alertIcon(): ComponentChildren {
  return strokeIcon(
    '15',
    '1.6',
    <path d="M12 8v5" />,
    <path d="M12 16v.1" />,
    <circle cx="12" cy="12" r="9" />,
  );
}
