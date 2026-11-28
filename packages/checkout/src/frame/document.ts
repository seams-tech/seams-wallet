import { PROVIDER_SCRIPTS } from './providers';

/** The file of the frame's script, beside the document on the checkout origin. */
export const CHECKOUT_FRAME_SCRIPT = 'checkout-frame.js';

/**
 * The document of the checkout frame. It is static: the script gets the order from the page
 * that embeds the frame. The same document answers at `/return`, where a provider sends the
 * customer back.
 */
export const CHECKOUT_FRAME_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Seams Checkout</title>
    <script type="module" src="/${CHECKOUT_FRAME_SCRIPT}"></script>
  </head>
  <body></body>
</html>
`;

const STRIPE_HOSTS = 'https://js.stripe.com https://*.js.stripe.com';
const KOMOJU_FIELDS = new URL(PROVIDER_SCRIPTS.komoju).origin;

/**
 * The Content-Security-Policy of the checkout document. Scripts come only from the checkout
 * origin, Stripe.js and KOMOJU Fields: no analytics and no other third party. This list is the
 * basis of the written statement that a merchant relies on for PCI DSS SAQ A.
 *
 * `parentOrigins` are the project's allowed origins: only they can embed the frame.
 */
export function checkoutFrameCsp(parentOrigins: readonly string[]): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${STRIPE_HOSTS} ${KOMOJU_FIELDS}`,
    // KOMOJU Fields put a style element into the document. Styles cannot read the card fields,
    // which are in the providers' own frames.
    `style-src 'self' 'unsafe-inline' ${KOMOJU_FIELDS}`,
    `frame-src ${STRIPE_HOSTS} https://hooks.stripe.com ${KOMOJU_FIELDS} https://komoju.com`,
    "connect-src 'self' https://api.stripe.com https://komoju.com",
    "img-src 'self' data: https://*.stripe.com https://komoju.com",
    "font-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${parentOrigins.length > 0 ? parentOrigins.join(' ') : "'none'"}`,
  ].join('; ');
}
