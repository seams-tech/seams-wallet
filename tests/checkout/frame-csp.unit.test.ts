import { expect, test } from '@playwright/test';
import { CHECKOUT_FRAME_HTML, checkoutFrameCsp } from '../../packages/checkout/src/frame/document';
import { PROVIDER_SCRIPTS } from '../../packages/checkout/src/frame/providers';

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name!, values];
    }),
  );
}

test.describe('the Content-Security-Policy of the checkout document', () => {
  const policy = directives(checkoutFrameCsp(['https://shop.example.test']));

  test('scripts come only from the checkout origin, Stripe.js and KOMOJU Fields', () => {
    // Another script host in this list breaks the statement that merchants rely on for PCI.
    expect(policy.get('script-src')).toEqual([
      "'self'",
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://multipay.komoju.com',
    ]);
    expect(policy.get('default-src')).toEqual(["'none'"]);
    for (const values of policy.values()) {
      expect(values).not.toContain("'unsafe-eval'");
      expect(values).not.toContain('*');
      expect(values).not.toContain('https:');
    }
    expect(policy.get('script-src')).not.toContain("'unsafe-inline'");
  });

  test('each provider script that the frame loads is a host of the policy', () => {
    for (const script of Object.values(PROVIDER_SCRIPTS)) {
      expect(policy.get('script-src')).toContain(new URL(script).origin);
    }
  });

  test('frames and requests go only to the providers and to the checkout origin', () => {
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://api.stripe.com', 'https://komoju.com']);
    expect(policy.get('frame-src')).toEqual([
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://hooks.stripe.com',
      'https://multipay.komoju.com',
      'https://komoju.com',
    ]);
    expect(policy.get('form-action')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
  });

  test('only the project origins can embed the frame, and no origin means nobody', () => {
    expect(policy.get('frame-ancestors')).toEqual(['https://shop.example.test']);
    expect(directives(checkoutFrameCsp([])).get('frame-ancestors')).toEqual(["'none'"]);
  });

  test('the document has one script, of its own origin, and no inline script or style', () => {
    expect(CHECKOUT_FRAME_HTML.match(/<script/g)).toHaveLength(1);
    expect(CHECKOUT_FRAME_HTML).toContain('<script type="module" src="/checkout-frame.js"></script>');
    expect(CHECKOUT_FRAME_HTML).not.toMatch(/<style|\sstyle=|\son\w+=/);
  });
});
