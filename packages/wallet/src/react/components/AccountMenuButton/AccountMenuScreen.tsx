import { WalletText, useWalletLocale } from '@/react/context/WalletLocale';
import { walletText, walletDisplayText } from '@/core/ui/messages';
import React, { useLayoutEffect, useRef } from 'react';

function focusHeading(heading: React.RefObject<HTMLHeadingElement | null>): void {
  heading.current?.focus({ preventScroll: true });
}

/** One navigation level inside the account panel. Focus follows the screen title. */
export function AccountMenuScreen({
  title,
  onBack,
  children,
  className,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const locale = useWalletLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(focusHeading.bind(null, heading), [title]);
  return (
    <section
      key={title}
      className={`seams-account-screen ${className ?? ''}`}
      aria-label={walletDisplayText(locale, title)}
    >
      <div className="seams-account-heading">
        <button
          type="button"
          className="seams-account-back"
          aria-label={walletText(locale, 'Back')}
          onClick={onBack}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
        </button>
        <h2 ref={heading} tabIndex={-1}>
          <WalletText copy={title} />
        </h2>
      </div>
      {children}
    </section>
  );
}
