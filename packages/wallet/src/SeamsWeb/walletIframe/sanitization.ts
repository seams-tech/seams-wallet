/**
 * Security utilities for WalletIframe HTML generation
 * Prevents injection attacks in srcdoc and HTML generation
 */

/**
 * Sanitizes sdkBasePath to prevent injection attacks
 *
 * Removes or normalizes:
 * - HTML/JS special characters that could break out of attributes
 * - Path traversal attempts (../)
 * - Dangerous protocols at the beginning (javascript:, data:, vbscript:)
 * - Duplicate slashes, while preserving scheme separators (e.g., https://)
 *
 * Supports both path-only inputs (e.g., "/sdk") and absolute URLs
 * (e.g., "https://wallet.example.com/sdk").
 */
export function sanitizeSdkBasePath(path: string): string {
  let p = String(path ?? '').trim();

  // Remove characters unsafe for HTML/JS attribute contexts
  p = p.replace(/[<>"']/g, '');

  // Remove protocol injection only at the start (ignore in queries/fragments)
  p = p
    .replace(/^\s*javascript:/i, '')
    .replace(/^\s*data:/i, '')
    .replace(/^\s*vbscript:/i, '');

  // Remove path traversal attempts
  p = p.replace(/\.\./g, '');

  // Collapse duplicate slashes but DO NOT touch the scheme separator ("://")
  p = p.replace(/([^:])\/{2,}/g, '$1/');

  // If this is a plain path (not an absolute URL), normalize leading slash
  const isAbsoluteUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p);
  if (!isAbsoluteUrl) {
    p = p.replace(/^\/+/, '/');
  }

  // Remove a single trailing slash (but not if it's the root "/")
  if (p.length > 1) {
    p = p.replace(/\/$/, '');
  }

  return p;
}

/**
 * Escapes HTML attribute values to prevent injection
 *
 * Converts special characters to HTML entities:
 * - & -> &amp;
 * - " -> &quot;
 * - ' -> &#x27;
 * - < -> &lt;
 * - > -> &gt;
 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
