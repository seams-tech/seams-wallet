import { sha256HexUtf8 } from '@shared/utils/digests';
import { parseSessionOrigin, type SessionOrigin } from '../../../../authorization/domain';
import type { D1TenantScope } from '../../../../core/d1TenantStore';
import type { D1DatabaseLike } from '../../../../storage/tenantRoute';
import { extractBearerCredential } from '../../../auth/routerApiKeyAuth';
import { D1WalletRelocationApprovals } from './d1WalletRelocationApprovals';
import type { WalletRelocationChallengeBinding } from './d1WalletRelocationChallenges';
import { readWalletRelocationOwner } from './d1WalletRelocationOwner';

// This identity permits reads of an existing matching move, never new admission or signing.
export class WalletRelocationReadAccess {
  readonly #binding: WalletRelocationChallengeBinding;

  private constructor(binding: WalletRelocationChallengeBinding) {
    this.#binding = binding;
    Object.freeze(this);
  }

  static async authenticate(input: {
    readonly database: D1DatabaseLike;
    readonly scope: D1TenantScope;
    readonly binding: WalletRelocationChallengeBinding;
    readonly request: Request;
    readonly allowedOrigins: readonly SessionOrigin[];
    readonly nowMs: number;
  }): Promise<WalletRelocationReadAccess | null> {
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) return null;
    const token = extractBearerCredential(input.request.headers);
    if (!token) return null;
    let origin: SessionOrigin;
    try {
      origin = parseSessionOrigin(input.request.headers.get('origin'));
    } catch {
      return null;
    }
    if (
      origin !== input.binding.origin ||
      !input.allowedOrigins.includes(origin) ||
      input.nowMs >= input.binding.credentialExpiresAtMs ||
      (await sha256HexUtf8(token)) !== input.binding.credentialDigestHex
    )
      return null;
    const approval = await new D1WalletRelocationApprovals(input.database, input.scope).read(
      input.binding,
    );
    if (!approval || approval.approvedAtMs > input.nowMs) return null;
    const owner = await readWalletRelocationOwner(input.database, input.scope, input.binding);
    if (
      !owner ||
      owner.authority.authorityDigestB64u !== approval.authorityDigestB64u ||
      owner.authority.revocationEpoch !== approval.authorityRevocationEpoch
    )
      return null;
    return new WalletRelocationReadAccess(input.binding);
  }

  get binding(): WalletRelocationChallengeBinding {
    return this.#binding;
  }
}
