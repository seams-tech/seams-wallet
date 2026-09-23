import type { WalletLaneContext } from '@shared/wallet-region';
import type { WalletId } from '@shared/utils/domainIds';
import { base64UrlEncode } from '@shared/utils/encoders';
import type {
  ManagedWalletLaneCatalogStore,
  ManagedWalletLaneConfiguration,
  WalletHomeLaneDirectoryStore,
  WalletLaneServiceBindingName,
} from '../../../core/walletRegion/WalletRegionStore';
import { resolveManagedWalletLaneRoute } from '../../../core/walletRegion/walletLaneRouting';
import type { CloudflareServiceBindingFetcher } from './routerAbServiceBindings';

export const WALLET_LANE_INTERNAL_REQUEST_HEADER_V1 = 'x-seams-wallet-lane-request';

export const MANAGED_WALLET_LANE_ROUTER_ORIGIN =
  'https://mpc-router.wallet-lane.internal';
export const MANAGED_WALLET_LANE_DERIVER_A_ORIGIN =
  'https://deriver-a.wallet-lane.internal';
export const MANAGED_WALLET_LANE_DERIVER_B_ORIGIN =
  'https://deriver-b.wallet-lane.internal';
export const MANAGED_WALLET_LANE_SIGNING_WORKER_ORIGIN =
  'https://signing-worker.wallet-lane.internal';

export type ManagedWalletLaneServiceRole =
  | 'router'
  | 'deriver_a'
  | 'deriver_b'
  | 'signing_worker';

export interface WalletLaneInternalRequestTokenIssuerV1 {
  issue(input: {
    readonly context: WalletLaneContext;
    readonly serviceRole: ManagedWalletLaneServiceRole;
    readonly request: Request;
  }): Promise<string>;
}

export interface WalletLaneInternalRequestTokenIssuerConfigV1 {
  readonly privateJwk: JsonWebKey & {
    readonly kty: 'OKP';
    readonly crv: 'Ed25519';
    readonly x: string;
    readonly d: string;
  };
  readonly keyId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly lifetimeMs?: number;
  readonly now?: () => number;
}

type ManagedWalletLaneServiceTarget = {
  readonly role: ManagedWalletLaneServiceRole;
  readonly bindingName: WalletLaneServiceBindingName;
};

const DEFAULT_TOKEN_LIFETIME_MS = 15_000;
const MAX_TOKEN_LIFETIME_MS = 30_000;

class Ed25519WalletLaneInternalRequestTokenIssuerV1
  implements WalletLaneInternalRequestTokenIssuerV1
{
  private signingKey: Promise<CryptoKey> | null = null;
  private readonly lifetimeMs: number;
  private readonly now: () => number;

  constructor(private readonly config: WalletLaneInternalRequestTokenIssuerConfigV1) {
    requireNormalizedText(config.keyId, 'wallet lane request token key id');
    requireNormalizedText(config.issuer, 'wallet lane request token issuer');
    requireNormalizedText(config.audience, 'wallet lane request token audience');
    this.lifetimeMs = requireTokenLifetime(config.lifetimeMs ?? DEFAULT_TOKEN_LIFETIME_MS);
    this.now = config.now ?? Date.now;
  }

  async issue(input: {
    readonly context: WalletLaneContext;
    readonly serviceRole: ManagedWalletLaneServiceRole;
    readonly request: Request;
  }): Promise<string> {
    const nowMs = requirePositiveSafeInteger(this.now(), 'wallet lane request issuance time');
    const expiresAtMs = nowMs + this.lifetimeMs;
    if (!Number.isSafeInteger(expiresAtMs)) {
      throw new Error('wallet lane request expiry exceeds the safe integer range');
    }
    const requestUrl = new URL(input.request.url);
    const requestTarget = `${requestUrl.pathname}${requestUrl.search}`;
    const bodyDigestB64u = await requestBodyDigestB64u(input.request);
    const headerB64u = encodeJsonBase64Url({
      alg: 'EdDSA',
      kid: this.config.keyId,
      typ: 'wallet-lane-request+jwt',
    });
    const payloadB64u = encodeJsonBase64Url({
      iss: this.config.issuer,
      aud: this.config.audience,
      iat_ms: nowMs,
      exp_ms: expiresAtMs,
      wallet_lane_context: {
        wallet_id: input.context.walletId,
        lane_id: input.context.laneId,
        lane_epoch: input.context.laneEpoch,
        directory_revision: input.context.directoryRevision,
      },
      service_role: input.serviceRole,
      request_method: input.request.method.toUpperCase(),
      request_target: requestTarget,
      request_body_sha256_b64u: bodyDigestB64u,
    });
    const signingInput = `${headerB64u}.${payloadB64u}`;
    const signature = await crypto.subtle.sign(
      { name: 'Ed25519' },
      await this.requireSigningKey(),
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }

  private requireSigningKey(): Promise<CryptoKey> {
    if (!this.signingKey) {
      this.signingKey = importEd25519SigningKey(this.config.privateJwk);
    }
    return this.signingKey;
  }
}

class ManagedWalletLaneServiceBindingDispatcher {
  constructor(
    private readonly input: {
      readonly walletId: WalletId;
      readonly directory: Pick<WalletHomeLaneDirectoryStore, 'getHomeLane'>;
      readonly catalog: Pick<ManagedWalletLaneCatalogStore, 'getActiveConfiguration'>;
      readonly bindings: Readonly<Record<string, unknown>>;
      readonly tokenIssuer: WalletLaneInternalRequestTokenIssuerV1;
    },
  ) {}

  async fetch(requestInput: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = new Request(requestInput, init);
    const resolution = await resolveManagedWalletLaneRoute({
      walletId: this.input.walletId,
      directory: this.input.directory,
      catalog: this.input.catalog,
    });
    if (resolution.kind !== 'resolved') {
      throw new Error(`managed wallet lane route is unavailable: ${resolution.kind}`);
    }
    const target = serviceTargetForOrigin(
      new URL(request.url).origin,
      resolution.configuration,
    );
    const binding = requireServiceBinding(this.input.bindings, target.bindingName);
    const token = await this.input.tokenIssuer.issue({
      context: resolution.context,
      serviceRole: target.role,
      request,
    });
    const headers = new Headers(request.headers);
    headers.set(WALLET_LANE_INTERNAL_REQUEST_HEADER_V1, token);
    return await binding.fetch(new Request(request, { headers }));
  }
}

export function createEd25519WalletLaneInternalRequestTokenIssuerV1(
  config: WalletLaneInternalRequestTokenIssuerConfigV1,
): WalletLaneInternalRequestTokenIssuerV1 {
  return new Ed25519WalletLaneInternalRequestTokenIssuerV1(config);
}

export function createManagedWalletLaneServiceBindingFetch(input: {
  readonly walletId: WalletId;
  readonly directory: Pick<WalletHomeLaneDirectoryStore, 'getHomeLane'>;
  readonly catalog: Pick<ManagedWalletLaneCatalogStore, 'getActiveConfiguration'>;
  readonly bindings: Readonly<Record<string, unknown>>;
  readonly tokenIssuer: WalletLaneInternalRequestTokenIssuerV1;
}): typeof globalThis.fetch {
  const dispatcher = new ManagedWalletLaneServiceBindingDispatcher(input);
  return dispatcher.fetch.bind(dispatcher);
}

function serviceTargetForOrigin(
  origin: string,
  configuration: Extract<
    ManagedWalletLaneConfiguration,
    { readonly status: 'available' | 'draining' }
  >,
): ManagedWalletLaneServiceTarget {
  switch (origin) {
    case MANAGED_WALLET_LANE_ROUTER_ORIGIN:
      return { role: 'router', bindingName: configuration.routerBinding };
    case MANAGED_WALLET_LANE_DERIVER_A_ORIGIN:
      return { role: 'deriver_a', bindingName: configuration.deriverABinding };
    case MANAGED_WALLET_LANE_DERIVER_B_ORIGIN:
      return { role: 'deriver_b', bindingName: configuration.deriverBBinding };
    case MANAGED_WALLET_LANE_SIGNING_WORKER_ORIGIN:
      return { role: 'signing_worker', bindingName: configuration.signingWorkerBinding };
    default:
      throw new Error(`unsupported managed wallet lane service origin: ${origin}`);
  }
}

function requireServiceBinding(
  bindings: Readonly<Record<string, unknown>>,
  bindingName: WalletLaneServiceBindingName,
): CloudflareServiceBindingFetcher {
  const candidate = bindings[bindingName];
  if (
    candidate === null ||
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    typeof (candidate as { readonly fetch?: unknown }).fetch !== 'function'
  ) {
    throw new Error(`managed wallet lane service binding ${bindingName} is unavailable`);
  }
  return candidate as CloudflareServiceBindingFetcher;
}

function requireNormalizedText(value: string, label: string): string {
  if (!value || value.trim() !== value || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function requireTokenLifetime(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TOKEN_LIFETIME_MS) {
    throw new Error(`wallet lane request token lifetime must be 1-${MAX_TOKEN_LIFETIME_MS} ms`);
  }
  return value;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid`);
  return value;
}

function encodeJsonBase64Url(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

async function requestBodyDigestB64u(request: Request): Promise<string> {
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', copyToArrayBuffer(body));
  return base64UrlEncode(new Uint8Array(digest));
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const output = new ArrayBuffer(bytes.length);
  new Uint8Array(output).set(bytes);
  return output;
}

async function importEd25519SigningKey(
  privateJwk: WalletLaneInternalRequestTokenIssuerConfigV1['privateJwk'],
): Promise<CryptoKey> {
  if (!privateJwk.x || !privateJwk.d) {
    throw new Error('wallet lane request signing JWK requires public and private key material');
  }
  return await crypto.subtle.importKey('jwk', privateJwk, { name: 'Ed25519' }, false, ['sign']);
}
