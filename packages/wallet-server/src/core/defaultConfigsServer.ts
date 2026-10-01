// Server-only defaults and helpers.
//
// Keep this separate from `client/src/core/config/defaultConfigs.ts` so browser bundles don't
// accidentally pull in server-oriented defaults/config.

// Threshold store defaults (Cloudflare Workers + Durable Objects).
export const THRESHOLD_DO_OBJECT_NAME_DEFAULT = 'threshold-store' as const;

// Default base prefix for threshold keyspaces when a host does not specify any prefix variables.
// This matches the SDK's published prefix defaults (w3a:threshold-ed25519:*).
export const THRESHOLD_PREFIX_DEFAULT = 'w3a' as const;
