import React from 'react';

export interface ContentSwitcherProps {
  waiting: boolean;
  waitingText?: string;
  waitingSubtext?: string;
  waitingSDKEventsText?: string;
  showScanDevice?: boolean;
  showQRCodeElement?: React.ReactNode;
  children: React.ReactNode;
  backButton?: React.ReactNode;
}

export const ContentSwitcher: React.FC<ContentSwitcherProps> = ({
  waiting,
  waitingText = 'Waiting for Passkey…',
  waitingSubtext = '',
  waitingSDKEventsText = '',
  showScanDevice = false,
  showQRCodeElement,
  children,
  backButton,
}) => {
  // Animate height of the switcher as content changes
  const switcherRef = React.useRef<HTMLDivElement | null>(null);
  const contentAreaRef = React.useRef<HTMLDivElement | null>(null);
  const sizerRef = React.useRef<HTMLDivElement | null>(null);
  const isInitialMount = React.useRef(true);

  React.useEffect(() => {
    isInitialMount.current = false;
  }, []);

  // Track whether user prefers reduced motion
  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Helper to read current content height and apply to the switcher
  const syncHeight = React.useCallback(() => {
    const wrap = switcherRef.current;
    const sizer = sizerRef.current;
    if (!wrap || !sizer) return;
    // Use scrollHeight to capture intrinsic content size regardless of flex context
    const next = sizer.scrollHeight;
    if (prefersReducedMotion) {
      // Apply without animation
      wrap.style.transition = 'none';
      wrap.style.height = `${next}px`;
      void wrap.offsetHeight;
      wrap.style.transition = '';
      return;
    }
    // Normal path: let CSS transition handle the interpolation
    wrap.style.height = `${next}px`;
  }, [prefersReducedMotion]);

  // Observe size changes of the content area
  React.useLayoutEffect(() => {
    const area = contentAreaRef.current;
    const sizer = sizerRef.current;
    if (!area || !sizer) return;

    // Initial sync after mount/update
    syncHeight();

    // ResizeObserver to capture dynamic content changes (e.g., QR render)
    const ro = new ResizeObserver(() => {
      // Use rAF to coalesce layout reads/writes with rendering
      requestAnimationFrame(syncHeight);
    });
    ro.observe(sizer);

    // Re-sync after fonts load (text metrics can change)
    const fonts = document?.fonts;
    if (fonts?.ready) {
      fonts.ready.then(() => syncHeight()).catch(() => {});
    }

    // Also re-sync on window resize
    const onResize = () => syncHeight();
    window.addEventListener('resize', onResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [syncHeight, waiting, showScanDevice, children]);

  return (
    <div ref={switcherRef} className="seams-content-switcher">
      {/* Back button - absolutely positioned overlay */}
      {backButton}

      {/* Content areas - conditionally rendered with smooth transitions */}
      <div ref={contentAreaRef} className="seams-content-area">
        <div ref={sizerRef} className="seams-content-sizer">
          {waiting && (
            <div className="seams-waiting">
              <div className="seams-waiting-message">
                <div className="seams-waiting-text">{waitingText}</div>
                {waitingSubtext.trim().length > 0 && (
                  <div className="seams-waiting-subtext">{waitingSubtext}</div>
                )}
                {waitingSDKEventsText.trim().length > 0 && (
                  <div className="seams-waiting-sdk-events">{waitingSDKEventsText}</div>
                )}
              </div>
              <div aria-label="Loading" className="seams-spinner" />
            </div>
          )}

          {showScanDevice && <div className="seams-scan-device-content">{showQRCodeElement}</div>}

          {!waiting && !showScanDevice && (
            <div className={`seams-signin-menu${isInitialMount.current ? ' seams-no-animation' : ''}`}>
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ContentSwitcher;
