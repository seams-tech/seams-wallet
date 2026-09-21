import { expect, test } from '@playwright/test';
import { setupBasicPasskeyTest, sdkEsmPath } from '../setup';

const REPORTER_MODULE = sdkEsmPath(
  'SeamsWeb/walletIframe/host/surface-measurement-reporter.js',
);

test.describe('wallet-iframe surface measurement diagnostics', () => {
  test.beforeEach(async ({ page }) => {
    await setupBasicPasskeyTest(page);
  });

  test('deduplicates sizes, ignores late callbacks after disposal, and sequences remounts', async ({
    page,
  }) => {
    const result = await page.evaluate(async (modulePath) => {
      const { createWalletIframeSurfaceMeasurementReporter } = await import(modulePath);
      const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
      const callbacks: ResizeObserverCallback[] = [];
      const measurements: { sequence: number; widthCssPx: number; heightCssPx: number }[] = [];
      let disconnectCount = 0;
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        value: class {
          constructor(callback: ResizeObserverCallback) {
            callbacks.push(callback);
          }
          observe(): void {}
          disconnect(): void {
            disconnectCount += 1;
          }
        },
      });
      const element = document.createElement('div');
      element.style.width = '320px';
      element.style.height = '100px';
      document.body.appendChild(element);
      try {
        const reporter = createWalletIframeSurfaceMeasurementReporter({
          kind: 'request_surface',
          element,
          requestId: 'measurement-disposal',
          postMeasurement: (measurement: (typeof measurements)[number]) =>
            measurements.push(measurement),
        });
        callbacks[0](
          [{ contentRect: { width: 320, height: 100 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
        callbacks[0](
          [{ contentRect: { width: 320, height: 140 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
        reporter.disconnect();
        reporter.disconnect();
        callbacks[0](
          [{ contentRect: { width: 320, height: 200 } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
        const beforeRemount = measurements.length;
        const replacement = createWalletIframeSurfaceMeasurementReporter({
          kind: 'request_surface',
          element,
          requestId: 'measurement-remount',
          postMeasurement: (measurement: (typeof measurements)[number]) =>
            measurements.push(measurement),
        });
        replacement.disconnect();
        return { beforeRemount, measurements, disconnectCount };
      } finally {
        element.remove();
        if (originalResizeObserver)
          Object.defineProperty(window, 'ResizeObserver', originalResizeObserver);
      }
    }, REPORTER_MODULE);
    expect(result.beforeRemount).toBe(2);
    expect(result.disconnectCount).toBe(2);
    expect(result.measurements.map(({ heightCssPx }) => heightCssPx)).toEqual([100, 140, 100]);
    expect(result.measurements[1].sequence).toBeGreaterThan(result.measurements[0].sequence);
    expect(result.measurements[2].sequence).toBeGreaterThan(result.measurements[1].sequence);
  });

  test('allows the anchored auth menu to stream its height animation', async ({ page }) => {
    const warnings = await page.evaluate(async (modulePath) => {
      const { createWalletIframeSurfaceMeasurementReporter } = await import(modulePath);
      const capturedWarnings: string[] = [];
      const originalWarn = console.warn;
      const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
      const originalPerformanceNow = Object.getOwnPropertyDescriptor(performance, 'now');
      const observerCallbacks: ResizeObserverCallback[] = [];
      let now = 0;

      console.warn = (...args: unknown[]) => {
        capturedWarnings.push(args.map(String).join(' '));
      };
      Object.defineProperty(window, 'ResizeObserver', {
        configurable: true,
        value: class {
          constructor(callback: ResizeObserverCallback) {
            observerCallbacks.push(callback);
          }

          observe(): void {}

          disconnect(): void {}

          unobserve(): void {}
        },
      });
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => now,
      });

      const emitHeight = (observerIndex: number, height: number): void => {
        observerCallbacks[observerIndex]?.(
          [{ contentRect: { width: 320, height } } as ResizeObserverEntry],
          {} as ResizeObserver,
        );
      };
      const streamHeightChanges = (observerIndex: number, settledAt: number): void => {
        for (const [offset, height] of [110, 120, 130, 140].entries()) {
          now = settledAt + offset * 20;
          emitHeight(observerIndex, height);
        }
      };
      const createSurface = (): HTMLDivElement => {
        const element = document.createElement('div');
        element.style.width = '320px';
        element.style.height = '100px';
        document.body.appendChild(element);
        return element;
      };

      try {
        const requestSurface = createSurface();
        const requestReporter = createWalletIframeSurfaceMeasurementReporter({
          kind: 'request_surface',
          element: requestSurface,
          requestId: 'request-surface-diagnostic-test',
          postMeasurement: () => {},
        });
        streamHeightChanges(0, 500);
        requestReporter.disconnect();
        requestSurface.remove();

        const requestWarnings = capturedWarnings.splice(0);
        const authMenuSurface = createSurface();
        const authMenuReporter = createWalletIframeSurfaceMeasurementReporter({
          kind: 'auth_menu_surface',
          element: authMenuSurface,
          requestId: 'auth-menu-diagnostic-test',
          authMenuSessionId: 'auth-menu-diagnostic-session',
          postMeasurement: () => {},
        });
        streamHeightChanges(1, 1_000);
        authMenuReporter.disconnect();
        authMenuSurface.remove();

        return {
          requestWarnings,
          authMenuWarnings: capturedWarnings,
        };
      } finally {
        console.warn = originalWarn;
        if (originalResizeObserver) {
          Object.defineProperty(window, 'ResizeObserver', originalResizeObserver);
        } else {
          delete (window as Partial<typeof window>).ResizeObserver;
        }
        if (originalPerformanceNow) {
          Object.defineProperty(performance, 'now', originalPerformanceNow);
        } else {
          delete (performance as Partial<Performance>).now;
        }
      }
    }, REPORTER_MODULE);

    expect(warnings.requestWarnings).toContainEqual(
      expect.stringContaining('[SEAMS] request_surface posted 4 surface measurements'),
    );
    expect(warnings.authMenuWarnings).toEqual([]);
  });
});
